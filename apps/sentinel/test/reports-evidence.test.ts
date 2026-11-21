import { describe, expect, it } from "vitest";
import { REPORT_LIMITS, type Hypothesis, type RequestRow, type ToolResult } from "@sentinel/contracts";
import { checkCaseFile, checkConflicts } from "../src/reports/evidence.ts";
import { MAX_TIMELINE_POINTS, buildTimeline, capRows } from "../src/reports/timeline.ts";
import { toModelText } from "../src/reports/tools.ts";
import { HYPOTHESIS, MIN, NOW, SCOPE, caseFile, iso, row } from "./reports-helpers.ts";

const older = row({ id: "acc:3", ts: iso(NOW - 19 * MIN), method: "GET", path: "/api/users", payload: "id=1%20UNION%20SELECT", http_status: 500 });
const newer = row({ id: "sen:mk2-1", ts: iso(NOW - 18 * MIN), method: "GET", path: "/api/users?id=1 UNION SELECT", attack_type: "sql_injection", blocked: true });
const known = new Map<string, RequestRow>([[older.id, older], [newer.id, newer]]);
const lookup = (id: string) => known.get(id) ?? null;

function result(rows: ToolResult["rows"]): ToolResult {
  return { scope: { ...SCOPE, store: "all" }, total: rows.length, returned: rows.length, truncated: false, rows, error: null };
}

describe("toModelText", () => {
  it("writes one header line and a pipe table", () => {
    const text = toModelText(result([newer]));
    const [header, ...table] = text.split("\n");
    expect(header).toMatch(/^scope/);
    expect(header).toMatch(/total=1/);
    expect(header).toMatch(/returned=1/);
    expect(header).toMatch(/truncated=false/);
    expect(table.join("\n")).toContain("|");
    expect(text).toContain("sen:mk2-1");
    expect(text).not.toContain("TRUNCATED");
  });

  it("stays within the byte limit for a huge result and marks the cut", () => {
    // Two-byte characters: the limit is in bytes, not characters.
    const rows = Array.from({ length: 50 }, (_, i) => row({ id: `acc:${i + 1}`, ts: iso(NOW - 19 * MIN + i), payload: "ñ".repeat(REPORT_LIMITS.payloadChars) }));
    const text = toModelText(result(rows));
    expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(REPORT_LIMITS.resultBytes);
    expect(text).toContain("TRUNCATED");
    expect(text).toContain("acc:1");
    expect(text).not.toContain("acc:50");
  });
});

describe("checkCaseFile", () => {
  const input = {
    ...caseFile([]),
    facts: [
      { text: "UNION SELECT got a 500", evidence: ["sen:mk2-1", "sen:unknown"] },
      { text: "Cites only another IP", evidence: ["sen:foreign"] },
      { text: "Probe then blocked retry", evidence: ["sen:mk2-1", "acc:3"] },
    ],
  };

  it("drops unresolved IDs and facts left with no evidence", () => {
    const out = checkCaseFile(input, lookup);
    expect(out.caseFile.facts).toEqual([
      { text: "UNION SELECT got a 500", evidence: ["sen:mk2-1"] },
      { text: "Probe then blocked retry", evidence: ["sen:mk2-1", "acc:3"] },
    ]);
    expect(out.removedFacts).toBe(1);
  });

  it("keeps verdict, summary and gaps", () => {
    const { caseFile: out } = checkCaseFile(input, lookup);
    expect(out).toMatchObject({ verdict: input.verdict, confidence: input.confidence, summary: input.summary, gaps: input.gaps });
  });

  it("returns the cited rows once each, oldest first", () => {
    expect(checkCaseFile(input, lookup).rows).toEqual([older, newer]);
  });

  it("filters exploitEvidence through the same lookup, and its rows join the cited rows", () => {
    const withExploit = caseFile([["acc:3"]], "exploited", ["sen:mk2-1", "sen:foreign", "sen:mk2-1"]);
    const out = checkCaseFile(withExploit, lookup);
    expect(out.caseFile.exploitEvidence).toEqual(["sen:mk2-1"]);
    expect(out.rows).toEqual([older, newer]);
    expect(out.removedFacts).toBe(0);
  });

  it("empties exploitEvidence unless the verdict is exploited", () => {
    const out = checkCaseFile(caseFile([["acc:3"]], "attempt_only", ["sen:mk2-1"]), lookup);
    expect(out.caseFile.exploitEvidence).toEqual([]);
    expect(out.rows).toEqual([older]);
  });

  it("removes nothing when every ID resolves", () => {
    const clean = caseFile([["acc:3"]]);
    expect(checkCaseFile(clean, lookup)).toEqual({ caseFile: clean, removedFacts: 0, rows: [older] });
  });
});

describe("checkConflicts", () => {
  const h: Hypothesis = {
    ...HYPOTHESIS,
    conflicts: [
      { claim: "A WAF rule covers it", evidence: ["sen:mk2-1", "sen:unknown"], note: "The blocked retry still reached the app first." },
      { claim: "No data left", evidence: ["eng:404"], note: "Not in scope." },
    ],
  };

  it("drops unresolved IDs and conflicts left with no evidence, and returns their rows", () => {
    const out = checkConflicts(h, lookup);
    expect(out.hypothesis.conflicts).toEqual([{ claim: "A WAF rule covers it", evidence: ["sen:mk2-1"], note: "The blocked retry still reached the app first." }]);
    expect(out.removedConflicts).toBe(1);
    expect(out.rows).toEqual([newer]);
    expect(out.hypothesis.rootCause).toEqual(h.rootCause);
  });
});

describe("buildTimeline", () => {
  it("marks damage only on rows listed in exploitEvidence when the verdict is exploited", () => {
    expect(buildTimeline([older, newer], caseFile([["acc:3"]], "exploited", ["sen:mk2-1"]))).toEqual([
      { id: "acc:3", ts: older.ts, attack_type: null, http_status: 500, blocked: null, damage: false },
      { id: "sen:mk2-1", ts: newer.ts, attack_type: "sql_injection", http_status: null, blocked: true, damage: true },
    ]);
  });

  it("does not mark a row that facts cite but exploitEvidence leaves out", () => {
    const points = buildTimeline([older, newer], caseFile([["sen:mk2-1", "acc:3"]], "exploited", []));
    expect(points.map((p) => p.damage)).toEqual([false, false]);
  });

  it("marks no damage when the verdict is not exploited, even with exploitEvidence set", () => {
    const points = buildTimeline([older, newer], caseFile([["sen:mk2-1", "acc:3"]], "attempt_only", ["sen:mk2-1", "acc:3"]));
    expect(points.map((p) => p.damage)).toEqual([false, false]);
  });

  it("marks no damage without a case file", () => {
    expect(buildTimeline([older, newer], null).every((p) => !p.damage)).toBe(true);
  });
});

describe("capRows", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ id: `acc:${i + 1}`, ts: iso(NOW - 20 * MIN + i * 1000) }));

  it("returns the rows unchanged at or under the cap", () => {
    const rows = many(MAX_TIMELINE_POINTS);
    expect(capRows(rows, ["acc:7"])).toBe(rows);
  });

  it("keeps every cited row, stays within the cap and keeps time order when there are more rows", () => {
    const rows = many(MAX_TIMELINE_POINTS * 2 + 80);
    const keep = ["acc:3", "acc:777", `acc:${rows.length}`];
    const capped = capRows(rows, keep);
    const ids = capped.map((r) => r.id);
    expect(capped.length).toBeLessThanOrEqual(MAX_TIMELINE_POINTS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of keep) expect(ids).toContain(id);
    expect(ids).toEqual(rows.filter((r) => ids.includes(r.id)).map((r) => r.id));
  });

  it("spreads the other rows over the whole window instead of keeping only the first ones", () => {
    const rows = many(MAX_TIMELINE_POINTS * 3);
    const ids = capRows(rows, []).map((r) => Number(r.id.slice(4)));
    expect(ids.length).toBeGreaterThan(MAX_TIMELINE_POINTS / 2);
    expect(Math.min(...ids)).toBeLessThanOrEqual(3);
    expect(Math.max(...ids)).toBeGreaterThan(rows.length - 5);
  });
});

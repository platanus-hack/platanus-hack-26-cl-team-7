// Assumes apps/web/src/reports/ReportView.tsx exports `ReportBody({ report }: { report: Report })`, the view without polling or fetches.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Hypothesis, Report, TimelinePoint } from "@sentinel/contracts";
import { ReportBody } from "../src/reports/ReportView";
import { DecisionBar } from "../src/reports/DecisionBar";
import { REASON_MAX_LENGTH, canSubmitRefusal } from "../src/reports/decision";
import { tokensText } from "../src/reports/parts";
import { timelineMarks } from "../src/reports/timeline";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const SCRIPT = "<script>alert(1)</script>";
const IMG = "<img src=x onerror=alert(1)>";

function point(p: Partial<TimelinePoint> & { id: string; ts: string }): TimelinePoint {
  return { attack_type: null, http_status: null, blocked: null, damage: false, ...p };
}

describe("timelineMarks", () => {
  const points = [
    point({ id: "sen:c", ts: iso(NOW - 60_000), http_status: 200 }),
    point({ id: "sen:a", ts: iso(NOW - 180_000), http_status: 500 }),
    point({ id: "sen:b", ts: iso(NOW - 120_000), blocked: true, http_status: 403 }),
  ];

  it("orders marks by time and keeps x inside the width", () => {
    const marks = timelineMarks(points, 600);
    expect(marks.map((m) => m.id)).toEqual(["sen:a", "sen:b", "sen:c"]);
    for (const m of marks) {
      expect(m.x).toBeGreaterThanOrEqual(0);
      expect(m.x).toBeLessThanOrEqual(600);
    }
    expect(marks[0]!.x).toBeLessThan(marks[1]!.x);
    expect(marks[1]!.x).toBeLessThan(marks[2]!.x);
  });

  it("spaces marks in proportion to time", () => {
    const [a, b, c] = timelineMarks(points, 600);
    expect(b!.x - a!.x).toBeCloseTo(c!.x - b!.x, 5);
  });

  it.each<[string, Partial<TimelinePoint>, string]>([
    ["damage over blocked and status", { damage: true, blocked: true, http_status: 500 }, "damage"],
    ["blocked over an error status", { blocked: true, http_status: 500 }, "blocked"],
    ["4xx as error", { blocked: false, http_status: 404 }, "error"],
    ["5xx as error", { http_status: 502 }, "error"],
    ["2xx as ok", { blocked: false, http_status: 200 }, "ok"],
    ["3xx as ok", { http_status: 302 }, "ok"],
    ["no status as unknown", { blocked: false, http_status: null }, "unknown"],
  ])("maps %s", (_label, p, tone) => {
    expect(timelineMarks([point({ id: "acc:1", ts: iso(NOW), ...p })], 400)[0]!.tone).toBe(tone);
  });

  it("centres a single point", () => {
    expect(timelineMarks([point({ id: "acc:1", ts: iso(NOW) })], 400)).toEqual([{ id: "acc:1", x: 200, tone: "unknown" }]);
  });

  it("places points with the same timestamp at one finite x", () => {
    const marks = timelineMarks([point({ id: "acc:1", ts: iso(NOW) }), point({ id: "acc:2", ts: iso(NOW) })], 400);
    expect(marks).toHaveLength(2);
    expect(marks[0]!.x).toBe(marks[1]!.x);
    expect(Number.isFinite(marks[0]!.x)).toBe(true);
  });

  it("returns nothing for no points", () => {
    expect(timelineMarks([], 400)).toEqual([]);
  });
});

describe("canSubmitRefusal", () => {
  it.each(["", "   ", "ok"])("blocks %j", (text) => {
    expect(canSubmitRefusal(text)).toBe(false);
  });
  it("allows a real reason", () => {
    expect(canSubmitRefusal("use a WAF rule instead")).toBe(true);
    expect(canSubmitRefusal("  abc  ")).toBe(true);
  });
  it("follows the contract limit for the longest reason", () => {
    expect(REASON_MAX_LENGTH).toBe(1000);
    expect(canSubmitRefusal("x".repeat(REASON_MAX_LENGTH!))).toBe(true);
    expect(canSubmitRefusal("x".repeat(REASON_MAX_LENGTH! + 1))).toBe(false);
  });
});

describe("tokensText", () => {
  it.each<[number, number, string]>([
    [12_500, 700, "12.5k in · 0.7k out"],
    [1200, 300, "1.2k in · 0.3k out"],
    [42, 0, "42 in · 0 out"],
  ])("formats %i in and %i out", (input, output, text) => {
    expect(tokensText({ input, output })).toBe(text);
  });
});

const HYPOTHESIS: Hypothesis = {
  rootCause: { cwe: "CWE-79", owasp: "A05:2025", endpoint: "POST /api/comments", parameter: "body", explanation: `Comment body is rendered raw, so ${IMG} runs.` },
  fix: {
    change: "Encode comment text on output and add a strict Content-Security-Policy.",
    where: "comments template, renderComment",
    test: { method: "POST", path: "/api/comments", payload: SCRIPT, expect: "Stored as text and shown escaped" },
  },
  rejected: { option: "Strip <script> tags with a regex", reason: "Event handlers and other tags still run." },
  confidence: "high",
  restatedReason: null,
  changed: null,
  conflicts: [],
};

const REASON = "We cannot ship a CSP this week, fix it in the template only";
const CHANGED = "Dropped the CSP; the fix is output encoding in renderComment only.";

function report(revisions: Report["revisions"]): Report {
  return {
    id: "r1",
    scope: { ip: "203.0.113.42", from: iso(NOW - 600_000), to: iso(NOW) },
    status: "awaiting_decision",
    createdAt: NOW,
    updatedAt: NOW,
    caseFile: {
      verdict: "exploited",
      confidence: "high",
      summary: "Stored XSS on POST /api/comments: exploited.",
      facts: [{ text: `The comment body held ${SCRIPT}`, evidence: ["sen:x1"] }],
      exploitEvidence: ["sen:x1"],
      gaps: ["Response bodies are not logged."],
    },
    evidence: [{ id: "sen:x1", ts: iso(NOW - 300_000), method: "POST", path: "/api/comments", payload: `${SCRIPT}${IMG}`, attack_type: "xss", http_status: 200, blocked: false }],
    timeline: [{ id: "sen:x1", ts: iso(NOW - 300_000), attack_type: "xss", http_status: 200, blocked: false, damage: true }],
    revisions,
    analystModel: "claude-opus-5-5",
    analystTokens: { input: 1200, output: 300 },
    error: null,
  };
}

const rev = (n: number, hypothesis: Hypothesis, decision: Report["revisions"][number]["decision"]) => ({
  n, hypothesis, createdAt: NOW, model: "claude-opus-5-5", tokens: { input: 800, output: 400 }, decision,
});

describe("ReportBody", () => {
  const html = renderToStaticMarkup(createElement(ReportBody, { report: report([rev(1, HYPOTHESIS, null)]) }));

  it("shows attacker text escaped", () => {
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders no script or img tags", () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
  });

  it("shows the refusal reason and what changed on revision 2", () => {
    const second: Hypothesis = { ...HYPOTHESIS, restatedReason: "No CSP this week; fix in the template.", changed: CHANGED };
    const out = renderToStaticMarkup(
      createElement(ReportBody, { report: report([rev(1, HYPOTHESIS, { kind: "refuse", reason: REASON, at: NOW }), rev(2, second, null)]) }),
    );
    expect(out).toContain(REASON);
    expect(out).toContain(CHANGED);
  });
});

describe("ReportBody details", () => {
  const html = renderToStaticMarkup(createElement(ReportBody, { report: report([rev(1, HYPOTHESIS, null)]) }));

  it("shows the analyst model and tokens in one line", () => {
    expect(html).toContain("Analyst claude-opus-5-5 · 1.2k in · 0.3k out");
  });

  it("shows the tokens of each revision", () => {
    expect(html).toContain("0.8k in · 0.4k out");
  });

  it("leaves the analyst line out when the report has no model yet", () => {
    const out = renderToStaticMarkup(createElement(ReportBody, { report: { ...report([]), analystModel: null, analystTokens: null } }));
    expect(out).not.toContain("Analyst");
  });

  it("marks the evidence row that shows the exploit", () => {
    expect(html).toContain('aria-label="Exploit evidence"');
    const base = report([rev(1, HYPOTHESIS, null)]);
    const none = { ...base, caseFile: { ...base.caseFile!, exploitEvidence: [] } };
    expect(renderToStaticMarkup(createElement(ReportBody, { report: none }))).not.toContain("Exploit evidence");
  });
});

describe("DecisionBar", () => {
  const bar = (status: Report["status"], atLimit = false) =>
    renderToStaticMarkup(
      createElement(DecisionBar, {
        status,
        atLimit,
        busy: false,
        error: null,
        refusing: false,
        setRefusing: () => undefined,
        onApprove: async () => true,
        onRefuse: async () => true,
        onStartNew: () => undefined,
      }),
    );

  it("offers a new report once the fix is approved", () => {
    const html = bar("approved");
    expect(html).toContain("Start new");
    expect(html).not.toContain("Approve</button>");
    expect(html).not.toContain("Refuse");
  });

  it("replaces Refuse with Start new at the revision limit", () => {
    const html = bar("awaiting_decision", true);
    expect(html).toContain("Start new");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Refuse");
  });

  it("asks for a decision while one is due", () => {
    const html = bar("awaiting_decision");
    expect(html).toContain("Refuse");
    expect(html).toContain("Approve");
    expect(html).not.toContain("Start new");
  });
});

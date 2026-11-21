import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { type EvidenceRun } from "@sentinel/contracts";
import { EvidenceJournal } from "../src/ultimo-paso/journal.ts";
import { evidenceRoutes } from "../src/ultimo-paso/routes.ts";
import { lookupAdvisory } from "../src/ultimo-paso/research.ts";

const replayDirectory = fileURLToPath(new URL("../../../ultimo-paso/scoreboard/evidence/", import.meta.url));
const observedAt = "2026-11-21T20:00:00.000Z";
const context = { run_id: "run-a", data_plane: "extproc", trace_id: "trace-a", fixture_id: "fixture-a", ts: observedAt, route: "/litoral/receipt" };

describe("Último Paso evidence API", () => {
  let directory: string;
  let db: DatabaseSync;
  let journal: EvidenceJournal;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "up-evidence-"));
    db = new DatabaseSync(":memory:");
    journal = new EvidenceJournal(db, directory);
  });

  afterEach(() => {
    journal.stop();
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test("replays the exact disclosure and containment counts", async () => {
    const api = evidenceRoutes({ replayDirectory, journal });
    const response = await api.request("/runs/recorded");
    expect(response.status).toBe(200);
    const run = await response.json() as EvidenceRun;
    const first = run.traces.filter((trace) => trace.case === "first_protected");
    const leaks = (arm: string) => first.filter((trace) => trace.arm === arm && (trace.observed?.headerEvidence || trace.observed?.bodyEvidence));
    expect(first).toHaveLength(12);
    expect(leaks("original")).toHaveLength(2);
    expect(leaks("patched")).toHaveLength(0);
    const repeats = run.traces.filter((trace) => trace.arm === "patched" && trace.case === "repeat");
    expect(repeats).toHaveLength(6);
    for (const trace of repeats) expect(trace.observed?.upstreamHits).toBe(0);
    const html = await api.request("/runs/recorded/export/html");
    expect(html.headers.get("content-disposition")).toContain("attachment");
    expect(await html.text()).toContain("CVE-2025-55182");
  });

  test("joins an independent wire measurement to persisted events and removes raw security fields", async () => {
    const request = { ...context, kind: "request", method: "GET", symbol: "browse", actor: "192.0.2.2|client|private-cookie",
      payload_capture: { state: "recorded", body_bytes: 42, sha256: "a".repeat(64), body_base64: "raw-payload" },
      reason: "raw-payload", path: "/litoral/receipt?secret=payload", authorization: "private-key", body: "raw-payload" };
    const wire = { ...context, kind: "wire", case: "first_protected", label: "disclosure-fixture",
      evidence_in_headers: false, evidence_in_body: false, status: 500, upstream_hits: 1 };
    const file = join(directory, "run.jsonl");
    appendFileSync(file, JSON.stringify(request) + "\n" + JSON.stringify(wire).slice(0, 30));
    journal.poll();
    expect(journal.revision()).toBe(1);
    appendFileSync(file, JSON.stringify(wire).slice(30) + "\n");
    journal.poll();
    journal.stop();
    journal = new EvidenceJournal(db, directory);
    expect(journal.revision()).toBe(2);
    const api = evidenceRoutes({ replayDirectory, journal });
    const exported = await (await api.request("/runs/run-a/export/json")).text();
    expect(exported).not.toMatch(/private-cookie|private-key|raw-payload|192\.0\.2\.2|secret=payload/);
    const run = JSON.parse(exported) as EvidenceRun;
    expect(run.traces).toHaveLength(1);
    expect(run.traces[0]?.events.map(({ kind }) => kind)).toEqual(["request", "wire"]);
    expect(run.traces[0]?.observed?.upstreamHits).toBe(1);
    expect(run.traces[0]?.events[0]?.payload).toEqual({ state: "recorded", bodyBytes: 42, sha256: "a".repeat(64) });
  });

  test("links matching rules and suspicious progressions while excluding benign and unrelated traffic", async () => {
    const add = (id: string, second: number, fields: Record<string, unknown>) => journal.add({
      ...context, kind: "request", trace_id: id, actor: "same-observed-actor",
      ts: new Date(Date.parse(observedAt) + second * 1000).toISOString(), ...fields,
    });
    add("fingerprint", 0, { symbol: "fingerprint", route: "/version" });
    add("probe", 1, { symbol: "probe", pattern: "xss", route: "/surco/service" });
    add("same-signal", 2, { symbol: "probe", pattern: "xss", route: "/surco/" });
    add("old-signal", 130, { symbol: "probe", pattern: "xss", route: "/surco/" });
    add("other-actor", 3, { symbol: "probe", pattern: "xss", actor: "other-observed-actor" });
    add("clean", 4, { symbol: "browse", route: "/surco/service" });
    add("benign-labelled", 5, { symbol: "probe", pattern: "xss", route: "/surco/service" });
    add("benign-labelled", 5, { kind: "wire", label: "legitimate", case: "other_route",
      evidence_in_headers: false, evidence_in_body: false, status: 200, upstream_hits: 1 });
    add("contained", 8, { action: "divert", rule_id: "contain-9" });
    add("origin", 6, { kind: "rule_installed", rule_id: "contain-9", incident_id: "incident-a" });
    const api = evidenceRoutes({ replayDirectory, journal });
    const res = await api.request("/runs/run-a");
    const run = await res.json() as EvidenceRun;
    const probe = run.traces.find((t) => t.id === "probe");
    expect(probe?.related?.map((l) => [l.trace, l.confidence]).sort()).toEqual([
      ["run-a/extproc/fingerprint", "inferred"], ["run-a/extproc/same-signal", "inferred"],
    ]);
    expect(probe?.related?.find((l) => l.trace.endsWith("/fingerprint"))?.reason).toContain("progressed from fingerprinting");
    expect(run.traces.find((t) => t.id === "contained")?.related).toMatchObject([
      { trace: "run-a/extproc/origin", confidence: "rule-linked" },
    ]);
  });

  test("keeps one request event when a restart reimports an older row with capture metadata", () => {
    const request = { ...context, kind: "request", method: "GET", symbol: "browse", actor: "observed-client" };
    journal.add(request);
    // Simulate an entry written before stable event identifiers were introduced.
    db.prepare("UPDATE up_evidence SET fingerprint=?").run("legacy-record-hash");
    journal.add({ ...request, payload_capture: { state: "recorded", body_bytes: 0, sha256: "a".repeat(64) } });
    const events = journal.run("run-a")?.traces[0]?.events;
    expect(events).toHaveLength(1);
    expect(events?.[0]?.payload?.state).toBe("recorded");
  });

  test("orders the latest runs by observed time rather than import order", () => {
    journal.add({ ...context, kind: "request", run_id: "newer", ts: "2026-11-21T21:00:00.000Z" });
    journal.add({ ...context, kind: "request", run_id: "older", ts: observedAt });
    expect(journal.runs().map((run) => run.id)).toEqual(["newer", "older"]);
  });

  test("reports a source-backed fixture analogue when enrichment is disabled, with no fake delivery", async () => {
    journal.add({ ...context, kind: "rule_installed", rule_id: "contain-1", incident_id: "incident-a", expires_at: observedAt });
    journal.add({ ...context, kind: "alert_created", rule_id: "contain-1", incident_id: "incident-a" });
    journal.add({ ...context, kind: "alert_delivery", rule_id: "contain-1", incident_id: "incident-a", reason: "failed-http-503" });
    await Promise.resolve();
    const events = journal.run("run-a")?.traces[0]?.events ?? [];
    expect(events.find((e) => e.kind === "alert_delivery")?.reason).toBe("failed-http-503");
    expect(events.filter((e) => e.kind === "research").map((e) => e.research?.status)).toEqual(["pending", "not-configured"]);
  });

  test("streams the current revision on reconnect", async () => {
    journal.add({ ...context, kind: "request" });
    const api = evidenceRoutes({ replayDirectory, journal });
    for (let count = 0; count < 2; count++) {
      const res = await api.request("/stream");
      const reader = res.body!.getReader();
      const { value } = await reader.read();
      expect(new TextDecoder().decode(value)).toContain("event: revision");
      expect(new TextDecoder().decode(value)).toContain("id: 1");
      await reader.cancel();
    }
    expect(journal.revision()).toBe(1);
  });
});

describe("Firecrawl advisory lookup", () => {
  const reply = (body: unknown): typeof fetch => async () => Response.json(body);
  const advisory = reply({ success: true, data: { markdown: "CVE-2026-118662 affects the indicated Vite release." } });

  test("loads a pinned advisory without sending request data", async () => {
    const result = await lookupAdvisory("bruma", "test-key", undefined, async (url, options) => {
      expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
      expect(options?.body).not.toContain("test-key");
      expect(JSON.parse(String(options?.body)).url).toEqual("https://github.com/advisories/GHSA-8g5g-mxqh-grgj");
      return advisory(url, options);
    });
    expect(result).toMatchObject({ status: "fixture-analogue", cve: "CVE-2026-118662" });
    expect(result.retrievedAt).toBeDefined();
    expect(await lookupAdvisory("other", "test-key", { package: "vite", version: "6.4.4" }, advisory))
      .toMatchObject({ status: "verified-version" });
  });

  test("uses a candidate classification for search and an unresolved state for unrelated sources", async () => {
    const inventory = { package: "example-component", version: "1.2.3" };
    const search = (url: string) => reply({ success: true, data: { web: [{ url, title: "CVE-2026-12345" }] } });
    expect(await lookupAdvisory("other", "test-key", inventory, search("https://github.com/advisories/GHSA-test")))
      .toMatchObject({ status: "potential-match" });
    expect(await lookupAdvisory("other", "test-key", inventory, search("https://unknown.test/advisories")))
      .toMatchObject({ status: "unresolved" });
  });

  test("reports missing credentials, provider rate limits, and timeouts", async () => {
    expect((await lookupAdvisory("bruma")).status).toBe("not-configured");
    expect((await lookupAdvisory("other")).status).toBe("unresolved");
    expect((await lookupAdvisory("bruma", "test-key", undefined, async () => new Response("", { status: 429 }))).note).toContain("429");
    expect((await lookupAdvisory("bruma", "test-key", undefined, async () => { throw new DOMException("timeout", "TimeoutError"); })).note).toContain("timed out");
  });
});

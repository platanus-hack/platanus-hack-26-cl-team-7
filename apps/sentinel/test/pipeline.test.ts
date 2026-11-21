import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { services, type PipelineFixture, type Project } from "@sentinel/contracts";
import { Pipeline, type PipelineDeps } from "../src/ultimo-paso/pipeline.ts";
import { planInputs } from "../src/ultimo-paso/providers.ts";
import { EvidenceJournal } from "../src/ultimo-paso/journal.ts";
import { lookupAdvisory } from "../src/ultimo-paso/research.ts";
import { createApp } from "../src/app.ts";
import { setup } from "./helpers.ts";

test.each([true, false])("runs and reproduces via Sentinel with provider success = %s", async (available) => {
  const db = new DatabaseSync(":memory:");
  const obs = { trace: "trace", status: 200, hits: 1, evidence: true, detected: null };
  const score = { detected: true, contained: true, executed: false, directEvidence: true, proxyEvidence: false };
  const fixture: PipelineFixture = { id: "first", weakness: "disclosure", A: obs, B: { ...obs, detected: true }, retry: obs,
    actual: score, expected: score, rule: "contain-1", passed: true };
  const deps: PipelineDeps = {
    inputs: vi.fn(async () => ({ notes: ["A1", "A2", "A3"], first: "receipt-body", provider: "test" })),
    evaluate: vi.fn(async (run, _notes, _first, emit) => {
      for (const project of Object.keys(services) as Project[]) {
        emit({ kind: "stage", project, stage: "traffic", status: "passed" });
        emit({ kind: "project", project, evidenceRun: run + "-" + project, customers: { A: [], B: [] },
          fixtures: [{ ...fixture, cve: services[project].cve }, { ...fixture, id: "second", cve: services[project].cve }] });
      }
    }),
    advisory: vi.fn(async (project: Project) => lookupAdvisory(project, "test-token", undefined, async (url, request) => {
      expect(url).toBe("https://api.firecrawl.dev/v2/scrape");
      expect(JSON.parse(String(request?.body)).url).toBe(services[project].url);
      return available
        ? Response.json({ success: true, data: { markdown: services[project].cve } })
        : new Response(null, { status: 429 });
    })),
    analyze: vi.fn(async () => {
      if (!available) throw Error("timeout");
      return "La regla se instaló y la ejecución de la contención se midió por separado.";
    }),
  };
  const pipeline = new Pipeline(db, deps);
  const journal = new EvidenceJournal(db);
  const { store, bus, ai, deception } = setup();
  try {
    const api = createApp({ store, bus, ai, deception, evidence: { replayDirectory: ".", journal, pipeline } });
    const prefix = "/v1/ultimo-paso/pipeline/runs";
    const send = (path: string, init?: RequestInit) => api.request(new URL(path, "http://localhost"), init);
    const post = (mode: string, source?: string) => send(prefix, { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ mode, source }) });
    expect((await send("/v1/health")).status).toBe(200);
    expect((await send("/v1/reports")).status).toBe(503);
    expect((await post("invalid")).status).toBe(400);
    const first = pipeline.start("real");
    expect(first).toHaveProperty("id");
    if (!("id" in first) || !first.id) throw Error("run was rejected");
    expect(pipeline.start("real")).toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(pipeline.get(first.id!)?.status).toBe("completed"));
    const stored = pipeline.get(first.id)!;
    expect(stored.projects[0]?.stages.research.status).toBe(available ? "passed" : "degraded");
    expect(stored.projects[0]?.stages.ticket.status).toBe(available ? "passed" : "degraded");
    expect(stored.projects[0]?.incidents[0]?.cases).toEqual(["first", "second"]);
    const report = await send(`${prefix}/${first.id}/tickets/bruma/disclosure`);
    expect(report.headers.get("content-disposition")).toContain(".md");
    const markdown = await report.text();
    expect(markdown).toContain("Acción ejecutada");
    expect(markdown).toContain("6.4.5");
    expect(markdown).toContain(available ? "Aviso consultado con Firecrawl" : "Referencia curada");
    expect((await post("reproduce", "missing")).status).toBe(404);
    const replay = await post("reproduce", first.id);
    expect(replay.status).toBe(202);
    const { id } = await replay.json() as { id: string };
    expect(pipeline.get(id)).toMatchObject({ source: first.id, projects: stored.projects });
    expect(deps.evaluate).toHaveBeenCalledTimes(1);
    expect(deps.inputs).toHaveBeenCalledTimes(1);
    expect(deps.advisory).toHaveBeenCalledTimes(3);
    expect(deps.analyze).toHaveBeenCalledTimes(3);
  } finally { pipeline.stop(); journal.stop(); ai.stop(); bus.stop(); store.close(); db.close(); }
});

test("normalizes catalog data and accepts only a predefined probe identifier", async () => {
  const reply = (value: unknown): typeof fetch => async () => Response.json({ choices: [{ message: { content: JSON.stringify(value) } }] });
  const inputs = await planInputs("key", "test-model", reply({ notes: ["CAT-1", "CAT_2", "CAT 3"], first: "receipt-body" }));
  expect(inputs).toEqual({ notes: ["CAT1", "CAT2", "CAT3"], first: "receipt-body", provider: "test-model" });
  const denied = await planInputs("key", "test-model", reply({ notes: ["CAT1", "/untrusted", "CAT3"], first: "unknown" }));
  expect(denied.first).toBe("");
  expect((await planInputs("key", "test-model", async () => { throw new DOMException("timeout", "TimeoutError"); })).first).toBe("");
});

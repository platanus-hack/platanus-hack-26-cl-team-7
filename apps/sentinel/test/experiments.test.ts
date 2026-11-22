import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ExperimentProject, type FixtureResult } from "@sentinel/contracts";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createExperimentProviders } from "../src/experiments/providers.ts";
import { experimentRoutes } from "../src/experiments/routes.ts";
import { createExperimentService } from "../src/experiments/service.ts";
import { ExperimentStore } from "../src/experiments/store.ts";
import { migrate } from "../src/schema.ts";

afterEach(() => vi.unstubAllGlobals());

function fixture(project: FixtureResult["project"], position: number): FixtureResult {
  const expected = { detected: true, contained: true, executed: true, directEvidence: true, proxyEvidence: false };
  const trace = `${project}-${position}`;
  const A = { trace: `${trace}-A`, status: 200, hits: 1, evidence: true, detected: null, decision: null, rule: null };
  const B = { ...A, trace: `${trace}-B`, evidence: false, detected: true, decision: "replace" };
  return { kind: "fixture", project, id: trace, weakness: "marker", A, B, retry: { ...B, trace: `${trace}-retry`, hits: 0 },
    rule: "r1", actual: expected, expected, passed: true };
}

describe("recorded experiments", () => {
  it("returns an actionable readiness failure without starting a recording or calling providers", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      migrate(db);
      const store = new ExperimentStore(db);
      const providers = createExperimentProviders("x", {});
      const inputs = vi.spyOn(providers, "inputs");
      const run = vi.fn(async () => undefined);
      const service = createExperimentService(store, { readiness: async () => "Inicia Lima con limactl start espejismo.", run }, providers);
      const app = new Hono().route("/v1", experimentRoutes(store, service));
      const reply = await app.request("/v1/experiments/runs", { method: "POST" });
      expect(reply.status).toBe(503);
      expect(await reply.text()).toContain("limactl start espejismo");
      expect(store.list().map((item) => item.mode)).toEqual(["recorded"]);
      expect(run).not.toHaveBeenCalled();
      expect(inputs).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it("serves the seed baseline and a completed live record, without re-running on reads or streams", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      migrate(db);
      const store = new ExperimentStore(db);
      const providers = createExperimentProviders("x", {});
      const inputs = vi.spyOn(providers, "inputs");
      const feedback = vi.spyOn(providers, "feedback");
      const run = vi.fn<NonNullable<Parameters<typeof createExperimentService>[1]>["run"]>(async (_id, _notes, _first, emit) => {
        for (const project of ExperimentProject.options) for (const pos of [1, 2, 3]) emit(fixture(project, pos));
      });
      const service = createExperimentService(store, { readiness: async () => null, run }, providers);
      const app = new Hono().route("/v1", experimentRoutes(store, service));
      const [baseline] = store.list();
      expect(baseline?.mode).toBe("recorded");
      expect(store.entries(baseline!.id).map((row) => row.event.kind === "baseline" && row.event.protected.yes)).toEqual([0, 0, 1]);

      const started = await app.request("/v1/experiments/runs", { method: "POST" });
      expect(started.status).toBe(202);
      const { id } = await started.json() as { id: string };
      await vi.waitFor(() => expect(store.get(id)?.status).toBe("completed"));
      const response = await app.request(`/v1/experiments/runs/${id}`);
      const saved = await response.json();
      const resumed = await app.request(`/v1/experiments/runs/${id}/events?after=1`, { headers: { "Last-Event-ID": "2" } });
      const text = await resumed.text();
      expect(text).not.toMatch(/(?:^|\n)id: 2\n/);
      expect(text).toContain("id: 3\n");
      expect(text).toContain("event: done\n");
      expect(await (await app.request(`/v1/experiments/runs/${id}`)).json()).toEqual(saved);
      expect(run).toHaveBeenCalledTimes(1);
      expect(inputs).toHaveBeenCalledTimes(1);
      expect(feedback).toHaveBeenCalledTimes(24);
      expect(store.entries(id).filter((e) => e.event.kind === "feedback" && e.event.status === "unconfigured")).toHaveLength(24);
      service.stop();
    } finally {
      db.close();
    }
  });

  it("preserves evidence when a running process is interrupted and restarted", () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-experiments-test-"));
    const file = join(dir, "runs.db");
    try {
      const first = new DatabaseSync(file);
      migrate(first);
      const original = new ExperimentStore(first);
      original.start("live");
      original.append("live", fixture("surco", 1));
      first.close();
      const reopened = new DatabaseSync(file);
      try {
        const saved = new ExperimentStore(reopened);
        expect(saved.get("live")?.status).toBe("interrupted");
        expect(saved.entries("live").map((e) => e.event)).toEqual([fixture("surco", 1)]);
        saved.append("live", fixture("surco", 2));
        expect(saved.entries("live")).toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scores unsupported claims from arm-specific observations and sends no tools to OpenRouter", async () => {
    const fetchProvider = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ message: { content: "success" } }] }));
    vi.stubGlobal("fetch", fetchProvider);
    const providers = createExperimentProviders("x", { openrouter: "test" });
    const cases = [fixture("surco", 1)];
    const signal = new AbortController().signal;
    const A = await providers.feedback("surco", cases, "A", 1, 1, signal);
    const B = await providers.feedback("surco", cases, "B", 1, 2, signal);
    expect(A).toMatchObject({ seenEvidence: true, reported: true, unsupported: false });
    expect(B).toMatchObject({ seenEvidence: false, reported: true, unsupported: true });
    const body = JSON.parse(String(fetchProvider.mock.calls[1]![1]?.body));
    expect(body).not.toHaveProperty("tools");
    expect(body.messages[0].content).not.toContain("surco");
    expect(body.messages[0].content).toContain('"evidence":false');
  });
});

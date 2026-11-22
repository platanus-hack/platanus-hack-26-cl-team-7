/**
 * Acceptance tests for the panel's patch step (spec part C), through `labAgents` and the site store.
 * The step strip comes only from the run's stage events; the store follows a finished run's stream
 * while the server reports `patching`. Fake EventSource and fetch; nothing leaves the process.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExperimentDetail, type ExperimentEntry, type ExperimentEvent, type ExperimentProject, type ExperimentRun, type PatchResult } from "@sentinel/contracts";
import { labAgents, type LabAgent } from "../src/experiments/labTrack";

type Stage = Extract<ExperimentEvent, { kind: "stage" }>;
const read = (url: URL) => ExperimentDetail.parse(JSON.parse(readFileSync(url, "utf8")));
const recorded = read(new URL("../../sentinel/src/experiments/recorded-run.json", import.meta.url));
/** A finished run that predates the stage events: the recording's cases and legitimate traffic, with no stage, analysis or research event. */
const older: ExperimentDetail = { run: recorded.run, entries: recorded.entries.filter(({ event }) => event.kind === "fixture" || event.kind === "control") };

/** The recording's cases and legitimate traffic, without its stage, research and feedback events. */
const measured = recorded.entries.filter(({ event }) => event.kind === "fixture" || event.kind === "control").map(({ event }) => event);

function detail(run: Partial<ExperimentRun>, events: ExperimentEvent[]): ExperimentDetail {
  const entries: ExperimentEntry[] = [...measured, ...events].map((event, i) => ({ seq: i + 1, at: null, event }));
  return { run: { ...recorded.run, ...run }, entries };
}
const stage = (project: ExperimentProject, name: Stage["stage"], status: Stage["status"], elapsedMs?: number): Stage =>
  ({ kind: "stage", project, stage: name, status, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
const patch = (project: ExperimentProject, status: PatchResult["status"], explanation = ""): PatchResult => ({
  kind: "patch", project, status, model: "claude-test", attempts: 1,
  edits: [{ file: "targets/businesses/service.py", old: 'record["reference"] = b.private_ref', new: 'record["reference"] = b.public_ref' }],
  explanation, cwe: "CWE-200", replay: { attacks: { yes: 0, total: 2 }, legit: { yes: 3, total: 3 } },
  timings: { agentMs: 1500, verifyMs: 900 }, tokens: { input: 10, output: 5 }, error: null,
});
const researchDone = (project: ExperimentProject): ExperimentEvent =>
  ({ kind: "research", project, source: null, cve: null, status: "retrieved", fixes: ["Actualizar."], evidence: [] });
const site = (sites: LabAgent[], project: ExperimentProject) => sites.find((s) => s.project === project)!;
const strip = (s: LabAgent) => s.steps.map((x) => [x.stage, x.status, x.elapsedMs]);
const RUNNING = { status: "running" as const, finished: null };
const DONE = { status: "completed" as const };

describe("step strip", () => {
  it("shows detection and containment of the bundled recording (its only stage events), with no patch step and no patch", () => {
    const sites = labAgents(recorded);
    expect(sites.map((s) => s.project)).toEqual(["nextjs", "vite"]);
    for (const s of sites) {
      expect(s.patch).toBeNull();
      expect(s.steps.map((x) => [x.stage, x.label])).toEqual([["detection", "Detección"], ["containment", "Contención"]]);
      expect(strip(s)).toEqual([["detection", "passed", null], ["containment", "passed", null]]);
    }
  });

  it("has no patch step and no patch for an older finished run", () => {
    expect(labAgents(older).length).toBeGreaterThan(0);
    for (const s of labAgents(older)) {
      expect(s.patch).toBeNull();
      expect(s.steps.some((x) => x.stage === "patch")).toBe(false);
    }
  });

  it("follows a live run: latest status per stage, pending until a stage event, no patch step, other stages left out", () => {
    const events = [
      stage("nextjs", "inputs", "running"), stage("nextjs", "inputs", "degraded", 3),
      stage("nextjs", "traffic", "running"), stage("nextjs", "traffic", "passed", 50), stage("nextjs", "fixtures", "running"),
      stage("nextjs", "detection", "passed", 4), stage("nextjs", "containment", "failed", 9), stage("nextjs", "analysis", "passed", 6),
      stage("nextjs", "research", "running"), stage("nextjs", "feedback", "running"),
    ];
    const nextjs = site(labAgents(detail(RUNNING, events)), "nextjs");
    expect(nextjs.steps.map((x) => x.label)).toEqual(["Detección", "Contención", "Análisis", "Aviso"]);
    expect(strip(nextjs)).toEqual([["detection", "passed", 4], ["containment", "failed", 9], ["analysis", "passed", 6], ["research", "running", null]]);
    expect(nextjs.live).toBe(true);
    expect(nextjs.patch).toBeNull();

    const early = site(labAgents(detail(RUNNING, [stage("nextjs", "fixtures", "running")])), "nextjs");
    expect(strip(early)).toEqual([["detection", "pending", null], ["containment", "pending", null], ["analysis", "pending", null], ["research", "pending", null]]);
  });

  it("moves the patch step with its events: running, then the terminal status with elapsedMs and the patch", () => {
    const head = [stage("vite", "detection", "passed"), stage("vite", "containment", "passed"), stage("vite", "analysis", "passed", 800), stage("vite", "research", "running"),
      researchDone("vite"), stage("vite", "research", "passed", 1200), stage("vite", "patch", "running")];
    const running = site(labAgents(detail(RUNNING, head)), "vite");
    expect(strip(running).slice(2)).toEqual([["analysis", "passed", 800], ["research", "passed", 1200], ["patch", "running", null]]);
    expect(running.patch).toBeNull();
    expect(running.live).toBe(true);

    const event = patch("vite", "verified", "Cierra la fuga.");
    const done = site(labAgents(detail(DONE, [...head, event, stage("vite", "patch", "passed", 3400)])), "vite");
    expect(strip(done).at(-1)).toEqual(["patch", "passed", 3400]);
    expect(done.patch).toEqual(event);
    expect(done.live).toBe(false);
  });

  it("uses the latest patch event and passes every terminal status through", () => {
    const first = patch("vite", "failed", "primero");
    const second = patch("vite", "verified", "segundo");
    const s = site(labAgents(detail(DONE, [stage("vite", "patch", "running"), first, stage("vite", "patch", "failed", 10),
      stage("vite", "patch", "running"), second, stage("vite", "patch", "passed", 20)])), "vite");
    expect(s.patch).toEqual(second);
    expect(strip(s).at(-1)).toEqual(["patch", "passed", 20]);
    for (const status of ["failed", "degraded", "skipped"] as const) {
      const t = site(labAgents(detail(DONE, [stage("vite", "patch", "running"), stage("vite", "patch", status, 7)])), "vite");
      expect(strip(t).at(-1)).toEqual(["patch", status, 7]);
    }
  });

  it("is live while a finished run is patching and its patch stage runs, and keeps projects apart", () => {
    const events = [stage("vite", "patch", "running")];
    const sites = labAgents(detail({ ...DONE, patching: true }, events));
    expect(site(sites, "vite").live).toBe(true);
    expect(strip(site(sites, "vite")).at(-1)).toEqual(["patch", "running", null]);
    // Patching, but nextjs's patch step has not started: it shows no patch step and is not live.
    expect(site(sites, "nextjs").live).toBe(false);
    expect(site(sites, "nextjs").steps.some((x) => x.stage === "patch")).toBe(false);

    const over = labAgents(detail(DONE, events));
    expect(site(over, "vite").live).toBe(false);
    expect(site(over, "nextjs").steps.some((x) => x.stage === "patch")).toBe(false);
  });
});

/* ------------------------------- store ------------------------------- */

class FakeSource {
  static all: FakeSource[] = [];
  readonly url: string;
  closed = false;
  private readonly listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
  constructor(url: string) {
    this.url = url;
    FakeSource.all.push(this);
  }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

/** A Sentinel that serves one finished run; `server.run` is what the list and detail return. */
function serve(run: ExperimentRun) {
  const server = { run };
  const fetchFake = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/experiments/runs")) return Response.json({ items: [server.run] });
    if (url.endsWith(`/v1/experiments/runs/${encodeURIComponent(run.id)}`)) return Response.json({ run: server.run, entries: recorded.entries });
    return Response.json({ error: { code: "not_found", message: "no" } }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchFake);
  vi.stubGlobal("EventSource", FakeSource);
  return { server, fetchFake };
}

async function openStore() {
  vi.resetModules();
  return import("../src/site/store");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeSource.all = [];
});

describe("site store and the patching run", () => {
  const last = recorded.entries.at(-1)!.seq;
  const runId = recorded.run.id;

  it("follows a finished run over SSE while it is patching, and closes the stream on done", async () => {
    const { server, fetchFake } = serve({ ...recorded.run, patching: true });
    const { startSite, useSite } = await openStore();
    const stop = startSite();
    try {
      await vi.waitFor(() => expect(FakeSource.all).toHaveLength(1));
      const source = FakeSource.all[0]!;
      expect(source.url).toContain(`/v1/experiments/runs/${encodeURIComponent(runId)}/events?after=${last}`);
      const nextjs = () => site(useSite.getState().sites, "nextjs");
      expect(nextjs().steps.some((x) => x.stage === "patch")).toBe(false);

      const push = (seq: number, event: ExperimentEvent) => source.emit("entry", { seq, at: null, event });
      push(last + 1, stage("nextjs", "patch", "running"));
      expect(strip(nextjs()).at(-1)).toEqual(["patch", "running", null]);
      expect(nextjs().live).toBe(true);
      const event = patch("nextjs", "verified", "Cierra la fuga.");
      push(last + 2, event);
      push(last + 2, patch("nextjs", "failed", "duplicado"));
      expect(nextjs().patch).toEqual(event);
      push(last + 3, stage("nextjs", "patch", "passed", 2100));
      expect(strip(nextjs()).at(-1)).toEqual(["patch", "passed", 2100]);

      const { patching: _, ...finished } = server.run;
      server.run = finished;
      const calls = fetchFake.mock.calls.length;
      source.emit("done", finished);
      expect(source.closed).toBe(true);
      expect(useSite.getState().detail?.run).not.toHaveProperty("patching");
      expect(nextjs().live).toBe(false);
      expect(strip(nextjs()).at(-1)).toEqual(["patch", "passed", 2100]);
      await vi.waitFor(() => expect(fetchFake.mock.calls.length).toBeGreaterThan(calls));
      await vi.waitFor(() => expect(useSite.getState().runs[0]).not.toHaveProperty("patching"));
      expect(FakeSource.all).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("opens no stream for a finished run, and opens one when a later poll lists it as patching", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { server, fetchFake } = serve(recorded.run);
    const { startSite, useSite } = await openStore();
    const stop = startSite();
    try {
      await vi.waitFor(() => expect(useSite.getState().detail?.run.id).toBe(runId));
      expect(FakeSource.all).toHaveLength(0);
      expect(useSite.getState().sites.every((s) => !s.steps.some((x) => x.stage === "patch"))).toBe(true);

      server.run = { ...recorded.run, patching: true };
      const calls = fetchFake.mock.calls.length;
      vi.advanceTimersByTime(8000);
      await vi.waitFor(() => expect(fetchFake.mock.calls.length).toBeGreaterThan(calls));
      await vi.waitFor(() => expect(FakeSource.all).toHaveLength(1));
      expect(useSite.getState().detail?.run.patching).toBe(true);
    } finally {
      stop();
    }
  });
});

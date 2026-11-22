import { randomUUID } from "node:crypto";
import { ExperimentProject, type ExperimentEvent, type ExperimentStage, type FixtureResult, type PatchResult } from "@sentinel/contracts";
import { emptyPatch, type Patcher } from "./patch.ts";
import type { createExperimentProviders } from "./providers.ts";
import type { ExperimentStore } from "./store.ts";
import type { createWorker } from "./worker.ts";

type Worker = Pick<ReturnType<typeof createWorker>, "readiness" | "run">;
type Providers = ReturnType<typeof createExperimentProviders>;
type StartResult = { id: string } | { error: string; status: 409 | 503 };
type ResearchEvent = Extract<ExperimentEvent, { kind: "research" }>;
type StageStatus = Extract<ExperimentEvent, { kind: "stage" }>["status"];

const patchStage: Record<PatchResult["status"], StageStatus> = { verified: "passed", failed: "failed", unavailable: "degraded", unconfigured: "degraded", no_finding: "skipped" };
/**
 * A backfill retries a project whose patch step did not get to the model (`unconfigured`, or `unavailable` with no attempt and
 * no tokens). Every other result ends it for good, so a patch that already spent a model call is never paid for again.
 */
const settledPatch = (patch: PatchResult) => patch.status === "verified" || patch.status === "failed" || patch.status === "no_finding"
  || (patch.status === "unavailable" && (patch.attempts > 0 || patch.tokens.input > 0));
const oneLine = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").slice(0, 300);
const ratio = (count: { yes: number; total: number }) => `${count.yes}/${count.total}`;

export function createExperimentService(store: ExperimentStore, worker: Worker | undefined, providers: Providers, patcher?: Patcher, now: () => number = Date.now) {
  let starting = false;
  let active: { id: string; controller: AbortController } | undefined;
  let stopped = false;
  const backfilling = new Map<string, Promise<void>>();
  const backfillController = new AbortController();

  /**
   * Appends events for one run. A terminal stage event gets `elapsedMs` (time since the same project's first `running` event
   * for that stage) and one log line. Events stay ordered per project because each project awaits its steps in sequence.
   */
  function emitter(id: string, signal: AbortSignal) {
    const started = new Map<string, number>();
    const open = new Map<string, [ExperimentProject, ExperimentStage]>();
    const append = (event: ExperimentEvent) => {
      if (signal.aborted) return;
      if (event.kind === "stage") {
        const key = `${event.project}:${event.stage}`;
        const since = started.get(key);
        if (event.status === "running") {
          if (since === undefined) started.set(key, now());
          open.set(key, [event.project, event.stage]);
        } else {
          open.delete(key);
          if (since !== undefined) event = { ...event, elapsedMs: Math.max(0, now() - since) };
          console.log(`[experiments] run=${id} project=${event.project} stage=${event.stage} status=${event.status} ms=${event.elapsedMs ?? "-"}`);
        }
      }
      store.append(id, event);
    };
    const stage = (project: ExperimentProject, name: ExperimentStage, status: StageStatus) => append({ kind: "stage", project, stage: name, status });
    /** Ends with `failed` every stage that is still running, so a broken run never leaves a step running in the panel. */
    const abandonOpen = () => { for (const [project, name] of open.values()) stage(project, name, "failed"); };

    /** Runs after research for one project. Whatever happens here never changes the research events or the run's result. */
    async function patchStep(project: ExperimentProject, cases: FixtureResult[], research: ResearchEvent) {
      if (!patcher || signal.aborted) return;
      stage(project, "patch", "running");
      const result = await patcher.patch(project, cases, research, signal).catch(() => emptyPatch(project, "unavailable", "The patch step failed."));
      // An aborted run drops the event below, so the log must not claim a result.
      if (signal.aborted) return void console.log(`[experiments] run=${id} project=${project} patch=aborted`);
      append(result);
      stage(project, "patch", patchStage[result.status]);
      const replay = result.replay;
      console.log(`[experiments] run=${id} project=${project} patch=${result.status} attempts=${result.attempts} agentMs=${result.timings.agentMs} verifyMs=${result.timings.verifyMs} `
        + `tokensIn=${result.tokens.input} tokensOut=${result.tokens.output} replay=${replay ? ratio(replay.attacks) : "-"} legit=${replay ? ratio(replay.legit) : "-"} error=${JSON.stringify(result.error)}`);
    }

    return { append, stage, abandonOpen, patchStep };
  }

  async function execute(id: string, signal: AbortSignal, selected?: ExperimentProject) {
    const { append, stage, abandonOpen, patchStep } = emitter(id, signal);
    const projects = selected ? [selected] : ExperimentProject.options;
    const fixtures = new Map(projects.map((project) => [project, [] as FixtureResult[]]));
    let passed = true;
    try {
      for (const project of projects) stage(project, "inputs", "running");
      await worker!.run(id, projects, (event) => {
        append(event);
        // Detection and containment are judged after the worker ends; the strip shows them running while the worker measures.
        if (event.kind === "stage" && event.stage === "traffic" && event.status === "running") {
          stage(event.project, "detection", "running");
          stage(event.project, "containment", "running");
        }
        if (event.kind === "fixture") fixtures.get(event.project)!.push(event);
        if ((event.kind === "stage" && event.status === "failed") || (event.kind === "fixture" && !event.passed)) passed = false;
      }, signal);
      if (signal.aborted) return;
      for (const project of projects) {
        append({ kind: "stage", project, stage: "inputs", status: fixtures.get(project)!.length ? "passed" : "failed" });
        if (!fixtures.get(project)!.length) passed = false;
      }
      await Promise.all(projects.map(async (project) => {
        const cases = fixtures.get(project)!;
        // A target whose container never came up (e.g. a known emulation crash) already has failed
        // stages from the worker; there is nothing measured to analyze, research or feed back.
        if (cases.length === 0) return;
        stage(project, "detection", cases.every((f) => f.actual.detected === f.expected.detected) ? "passed" : "failed");
        stage(project, "containment", cases.every((f) => f.actual.executed === f.expected.executed && f.actual.contained === f.expected.contained) ? "passed" : "failed");
        // The agent reads the measured exploit first; the fix research starts from what it identified.
        stage(project, "analysis", "running");
        const analysis = await providers.analyze(project, cases);
        if (signal.aborted) return;
        append(analysis);
        stage(project, "analysis", analysis.status === "completed" ? "passed" : "degraded");
        stage(project, "research", "running");
        stage(project, "feedback", "running");
        const research = async () => {
          const result = await providers.research(project, cases, analysis);
          append(result);
          stage(project, "research", result.status === "retrieved" ? "passed" : result.status === "no_finding" ? "skipped" : "degraded");
          await patchStep(project, cases, result);
        };
        const feedback = async () => {
          let complete = true;
          for (const repetition of [1, 2, 3]) {
            const arms = repetition % 2 ? ["A", "B"] as const : ["B", "A"] as const;
            for (const [index, arm] of arms.entries()) {
              if (signal.aborted) return;
              const result = await providers.feedback(project, cases, arm, repetition, index + 1, signal);
              append(result);
              if (result.status !== "completed") complete = false;
            }
          }
          stage(project, "feedback", complete ? "passed" : "degraded");
        };
        await Promise.all([research(), feedback()]);
      }));
      if (signal.aborted) return;
      console.log(`[experiments] run=${id} status=${passed ? "completed" : "failed"}`);
      store.finish(id, passed ? "completed" : "failed", passed ? null : "Una o más mediciones no coincidieron con lo esperado.");
    } catch (err) {
      if (signal.aborted) return;
      console.error(`[experiments] run=${id} status=failed error=${oneLine(err)}`);
      abandonOpen();
      store.finish(id, "failed", err instanceof Error && err.message ? err.message : "Falló la ejecución local. Se conservaron las observaciones registradas.");
    }
  }

  async function start(project?: ExperimentProject): Promise<StartResult> {
    if (!worker || stopped) return { error: "La ejecución en vivo requiere Reaper en loopback.", status: 503 } as const;
    if (starting || active) return { error: "Ya hay una ejecución A/B en curso.", status: 409 } as const;
    starting = true;
    try {
      const issue = await worker.readiness();
      if (issue || stopped) return { error: issue ?? "Reaper se está cerrando.", status: 503 } as const;
      const id = `pipeline-${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      const controller = new AbortController();
      store.start(id);
      active = { id, controller };
      void execute(id, controller.signal, project).finally(() => { active = undefined; });
      return { id } as const;
    } finally {
      starting = false;
    }
  }

  /**
   * Adds the patch step to a finished run that has research but no patch yet (the recorded run, at startup). The run
   * reports `patching` meanwhile so its event stream stays open. Resolves when the step ends; callers need not await it.
   */
  function backfill(runId: string): Promise<void> {
    const running = backfilling.get(runId);
    if (running) return running;
    if (!patcher || stopped || store.get(runId)?.status !== "completed") return Promise.resolve();
    const events = store.entries(runId).map(({ event }) => event);
    const jobs = ExperimentProject.options.flatMap((project) => {
      const research = events.find((e): e is ResearchEvent => e.kind === "research" && e.project === project);
      const cases = events.filter((e): e is FixtureResult => e.kind === "fixture" && e.project === project);
      const settled = events.some((e) => e.kind === "patch" && e.project === project && settledPatch(e));
      return research && cases.length && !settled ? [{ project, cases, research }] : [];
    });
    if (!jobs.length) return Promise.resolve();
    const { patchStep } = emitter(runId, backfillController.signal);
    const started = now();
    console.log(`[experiments] run=${runId} backfill=start projects=${jobs.map((j) => j.project).join(",")}`);
    store.setPatching(runId, true);
    const job = Promise.all(jobs.map(({ project, cases, research }) => patchStep(project, cases, research)))
      .then(() => undefined, (err: unknown) => console.error(`[experiments] run=${runId} backfill failed: ${oneLine(err)}`))
      .finally(() => {
        console.log(`[experiments] run=${runId} backfill=end ms=${Math.max(0, now() - started)}`);
        store.setPatching(runId, false);
        backfilling.delete(runId);
      });
    backfilling.set(runId, job);
    return job;
  }

  function stop() {
    stopped = true;
    backfillController.abort();
    if (!active) return;
    active.controller.abort();
    store.finish(active.id, "interrupted", "Reaper se cerró durante la ejecución.");
  }

  return { start, stop, backfill };
}

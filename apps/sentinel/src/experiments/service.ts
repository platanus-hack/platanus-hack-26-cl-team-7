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

export function createExperimentService(store: ExperimentStore, worker: Worker | undefined, providers: Providers, patcher?: Patcher, now: () => number = Date.now) {
  let starting = false;
  let active: { id: string; controller: AbortController } | undefined;
  let stopped = false;
  const backfilling = new Map<string, Promise<void>>();
  const backfillController = new AbortController();

  /**
   * Appends events for one run. A terminal stage event gets `elapsedMs` (time since the same project's `running` event for that
   * stage) and one log line. Events stay ordered per project because each project awaits its steps in sequence.
   */
  function emitter(id: string, signal: AbortSignal) {
    const started = new Map<string, number>();
    const append = (event: ExperimentEvent) => {
      if (signal.aborted) return;
      if (event.kind === "stage") {
        const key = `${event.project}:${event.stage}`;
        const since = started.get(key);
        if (event.status === "running") started.set(key, now());
        else if (since !== undefined) event = { ...event, elapsedMs: Math.max(0, now() - since) };
        if (event.status !== "running") console.log(`[experiments] run=${id} project=${event.project} stage=${event.stage} status=${event.status} ms=${event.elapsedMs ?? "-"}`);
      }
      store.append(id, event);
    };
    const stage = (project: ExperimentProject, name: ExperimentStage, status: StageStatus) => append({ kind: "stage", project, stage: name, status });

    /** Runs after research for one project. Whatever happens here never changes the research events or the run's result. */
    async function patchStep(project: ExperimentProject, cases: FixtureResult[], research: ResearchEvent) {
      if (!patcher || signal.aborted) return;
      stage(project, "patch", "running");
      const result = await patcher.patch(project, cases, research, signal).catch(() => emptyPatch(project, "unavailable", "The patch step failed."));
      append(result);
      stage(project, "patch", patchStage[result.status]);
      console.log(`[experiments] run=${id} project=${project} patch=${result.status} attempts=${result.attempts} agentMs=${result.timings.agentMs} verifyMs=${result.timings.verifyMs} tokensIn=${result.tokens.input} tokensOut=${result.tokens.output}`);
    }

    return { append, stage, patchStep };
  }

  async function execute(id: string, signal: AbortSignal, selected?: ExperimentProject) {
    const { append, stage, patchStep } = emitter(id, signal);
    const projects = selected ? [selected] : ExperimentProject.options;
    const fixtures = new Map(projects.map((project) => [project, [] as FixtureResult[]]));
    let passed = true;
    try {
      for (const project of projects) stage(project, "inputs", "running");
      const plan = await providers.inputs(selected);
      if (signal.aborted) return;
      append(plan);
      for (const project of projects) stage(project, "inputs", plan.provider === "openrouter" ? "passed" : "degraded");
      await worker!.run(id, plan.notes, plan.first, (event) => {
        append(event);
        if (event.kind === "fixture") fixtures.get(event.project)!.push(event);
        if ((event.kind === "stage" && event.status === "failed") || (event.kind === "fixture" && !event.passed)) passed = false;
      }, signal, selected);
      if (signal.aborted) return;
      if (projects.some((project) => !fixtures.get(project)?.length || fixtures.get(project)!.length !== providers.cases(project))) throw Error("Incomplete project results");
      await Promise.all(projects.map(async (project) => {
        const cases = fixtures.get(project)!;
        stage(project, "detection", cases.every((f) => f.actual.detected === f.expected.detected) ? "passed" : "failed");
        stage(project, "containment", cases.every((f) => f.actual.executed === f.expected.executed && f.actual.contained === f.expected.contained) ? "passed" : "failed");
        stage(project, "research", "running");
        stage(project, "feedback", "running");
        const research = async () => {
          const result = await providers.research(project, cases);
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
      if (!signal.aborted) store.finish(id, passed ? "completed" : "failed", passed ? null : "Una o más mediciones no coincidieron con lo esperado.");
    } catch {
      if (!signal.aborted) store.finish(id, "failed", "Falló la ejecución local. Se conservaron las observaciones registradas.");
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
      const patched = events.some((e) => e.kind === "patch" && e.project === project);
      return research && cases.length && !patched ? [{ project, cases, research }] : [];
    });
    if (!jobs.length) return Promise.resolve();
    const { patchStep } = emitter(runId, backfillController.signal);
    store.setPatching(runId, true);
    const job = Promise.all(jobs.map(({ project, cases, research }) => patchStep(project, cases, research)))
      .then(() => undefined, (err: unknown) => console.error(`[experiments] run=${runId} backfill failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => { store.setPatching(runId, false); backfilling.delete(runId); });
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

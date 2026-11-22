import { randomUUID } from "node:crypto";
import { ExperimentProject, type ExperimentEvent, type FixtureResult } from "@sentinel/contracts";
import type { createExperimentProviders } from "./providers.ts";
import type { ExperimentStore } from "./store.ts";
import type { createWorker } from "./worker.ts";

type Worker = ReturnType<typeof createWorker>;
type Providers = ReturnType<typeof createExperimentProviders>;
type StartResult = { id: string } | { error: string; status: 409 | 503 };

export function createExperimentService(store: ExperimentStore, worker: Worker | undefined, providers: Providers) {
  let starting = false;
  let active: { id: string; controller: AbortController } | undefined;
  let stopped = false;

  async function execute(id: string, signal: AbortSignal, selected?: ExperimentProject) {
    const append = (event: ExperimentEvent) => { if (!signal.aborted) store.append(id, event); };
    const projects = selected ? [selected] : ExperimentProject.options;
    const fixtures = new Map(projects.map((project) => [project, [] as FixtureResult[]]));
    let passed = true;
    try {
      for (const project of projects) append({ kind: "stage", project, stage: "inputs", status: "running" });
      const plan = await providers.inputs(selected);
      if (signal.aborted) return;
      append(plan);
      for (const project of projects) append({ kind: "stage", project, stage: "inputs", status: plan.provider === "openrouter" ? "passed" : "degraded" });
      await worker!.run(id, plan.notes, plan.first, (event) => {
        append(event);
        if (event.kind === "fixture") fixtures.get(event.project)!.push(event);
        if ((event.kind === "stage" && event.status === "failed") || (event.kind === "fixture" && !event.passed)) passed = false;
      }, signal, selected);
      if (signal.aborted) return;
      if (projects.some((project) => !fixtures.get(project)?.length || fixtures.get(project)!.length !== providers.cases(project))) throw Error("Incomplete project results");
      await Promise.all(projects.map(async (project) => {
        const cases = fixtures.get(project)!;
        append({ kind: "stage", project, stage: "detection", status: cases.every((f) => f.actual.detected === f.expected.detected) ? "passed" : "failed" });
        append({ kind: "stage", project, stage: "containment", status: cases.every((f) => f.actual.executed === f.expected.executed && f.actual.contained === f.expected.contained) ? "passed" : "failed" });
        append({ kind: "stage", project, stage: "research", status: "running" });
        append({ kind: "stage", project, stage: "feedback", status: "running" });
        const research = async () => {
          const result = await providers.research(project, cases);
          append(result);
          append({ kind: "stage", project, stage: "research", status: result.status === "retrieved" ? "passed" : result.status === "no_finding" ? "skipped" : "degraded" });
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
          append({ kind: "stage", project, stage: "feedback", status: complete ? "passed" : "degraded" });
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

  function stop() {
    stopped = true;
    if (!active) return;
    active.controller.abort();
    store.finish(active.id, "interrupted", "Reaper se cerró durante la ejecución.");
  }

  return { start, stop };
}

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { pipelineStages, services, type PipelineFixture, type PipelineProject, type PipelineRun, type PipelineStage, type Project, type Research, type StageStatus } from "@sentinel/contracts";
import { row } from "./evidence.ts";

const projects = Object.keys(services) as Project[];
const time = () => new Date().toISOString();

type WorkerMessage =
  | { kind: "stage"; project: Project; stage: "traffic" | "fixtures"; status: StageStatus }
  | { kind: "project"; project: Project; evidenceRun: string; customers: NonNullable<PipelineProject["customers"]>; fixtures: PipelineFixture[] };

export interface PipelineDeps {
  inputs: () => Promise<{ notes: string[]; first: string; provider: string }>;
  advisory: (project: Project) => Promise<Research>;
  analyze: (fixtures: PipelineFixture[]) => Promise<string | undefined>;
  evaluate: (id: string, notes: string[], first: string, emit: (message: WorkerMessage) => void, signal: AbortSignal) => Promise<void>;
}

export function fixtureWorker(root: string, journals: string, vm = "espejismo"): PipelineDeps["evaluate"] {
  return async (id, notes, first, emit, signal) => {
    const args = ["-m", "scoreboard.pipeline_eval", "--run-id", id, "--notes", notes.join(","), "--first", first,
      "--events", resolve(journals), "--payloads", join(root, "scoreboard/runs/private-payloads")];
    const mac = process.platform === "darwin";
    const child = spawn(mac ? "limactl" : "python3",
      mac ? ["shell", "--workdir", root, vm, "python3", ...args] : args,
      { cwd: root, stdio: ["ignore", "pipe", "ignore"], signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]) });
    const code = new Promise<number | null>((done, fail) => {
      child.once("error", fail);
      child.once("close", done);
    });
    const lines = createInterface({ input: child.stdout });
    try {
      const consume = (async () => {
        for await (const line of lines) {
          if (!line.startsWith("PIPELINE ")) continue;
          const data = row(JSON.parse(line.slice(9)));
          if ((projects as string[]).includes(String(data.project)) && (data.kind === "stage" || data.kind === "project"))
            emit(data as unknown as WorkerMessage);
        }
      })();
      const [exit] = await Promise.all([code, consume]);
      if (exit !== 0) throw Error("fixture execution");
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  };
}

function newProject(project: Project): PipelineProject {
  return { project, incidents: [], stages: Object.fromEntries(pipelineStages.map((s) => [s, { status: "pending" }])) as PipelineProject["stages"] };
}

function incidentGroups(project: PipelineProject) {
  const groups = new Map<string, PipelineProject["incidents"][number]>();
  for (const f of project.fixtures ?? []) {
    const incident = groups.get(f.weakness) ?? { id: f.weakness, cases: [], cve: f.cve };
    incident.cases.push(f.id);
    groups.set(f.weakness, incident);
  }
  return [...groups.values()];
}

function ticket(project: PipelineProject, incident: PipelineProject["incidents"][number], analysis?: string) {
  const advisory = incident.advisory;
  const observations = (project.fixtures ?? []).filter((item) => incident.cases.includes(item.id));
  const yes = (v: boolean) => v ? "Sí" : "No";
  const lines = observations.map((f) => `| \`${f.id}\` | ${yes(f.actual.directEvidence)} | ${yes(f.actual.proxyEvidence)} | ${yes(f.actual.detected)} | ${yes(f.actual.contained)} | ${yes(f.actual.executed)} |`);
  const safeAnalysis = analysis?.replace(/https?:\/\/\S+|[@<>]|[\r\n]/g, " ").replace(/[[\]`]/g, "").trim();
  const sourceNote = advisory?.retrievedAt ? "Aviso consultado con Firecrawl." : "Referencia curada. La consulta en vivo está pendiente.";
  return [
    `# ${services[project.project].name} · ${incident.id}`,
    "Borrador de GitHub issue para revisión. La evaluación usó fixtures sintéticos.",
    "## Evidencia A/B",
    "| Fixture | Evidencia en A | Evidencia en B | Detectado en B | Regla instalada | Acción ejecutada |",
    "| --- | --- | --- | --- | --- | --- |", ...lines,
    `Run de evidencia: \`${project.evidenceRun}\``,
    "## Aviso y corrección",
    ...(advisory?.source ? [
      `- [${advisory.cve ?? incident.cve ?? "Aviso del proveedor"}](${advisory.source})`,
      `- ${sourceNote}`,
      ...(advisory.retrievedAt ? [`- Consultado: ${advisory.retrievedAt}`] : []),
      ...(advisory.affected ? [`- Versiones afectadas: ${advisory.affected}`] : []),
      ...(advisory.fix ? [`- Corrección recomendada: ${advisory.fix}`] : []),
    ] : ["Sin un CVE asociado. Revisar la señal observada y el control correspondiente."]),
    ...(safeAnalysis ? ["## Análisis asistido del proyecto", safeAnalysis] : []),
    "## Verificación",
    "- [ ] Validar la versión desplegada y aplicar la corrección del proveedor si corresponde.",
    "- [ ] Repetir las mediciones de detección y tráfico legítimo tras el cambio.", "",
  ].join("\n\n").replace(/\n\n(?=\|)/g, "\n");
}

export class Pipeline {
  private readonly db: DatabaseSync;
  private readonly deps: PipelineDeps;
  private active?: AbortController;
  private closed = false;

  constructor(db: DatabaseSync, deps: PipelineDeps) {
    this.db = db;
    this.deps = deps;
    db.exec(`CREATE TABLE IF NOT EXISTS up_pipeline_run (id TEXT PRIMARY KEY, result TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS up_pipeline_revision (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO up_pipeline_revision VALUES (1,0);`);
    for (const run of this.list().filter((record) => record.status === "running")) {
      run.status = "failed";
      run.error = "La ejecución fue interrumpida.";
      run.finished = time();
      for (const project of run.projects) for (const stage of Object.values(project.stages)) {
        if (stage.status === "running") stage.status = "failed";
      }
      this.save(run);
    }
  }

  revision() {
    return Number(this.db.prepare("SELECT revision FROM up_pipeline_revision WHERE id=1").get()?.revision ?? 0);
  }

  list(): PipelineRun[] {
    return this.db.prepare("SELECT result FROM up_pipeline_run ORDER BY rowid DESC LIMIT 30")
      .all().map((v) => JSON.parse(String(v.result)) as PipelineRun);
  }

  get(id: string): PipelineRun | undefined {
    const value = this.db.prepare("SELECT result FROM up_pipeline_run WHERE id=?").get(id);
    return value ? JSON.parse(String(value.result)) as PipelineRun : undefined;
  }

  private save(run: PipelineRun) {
    if (this.closed) return;
    this.db.prepare("INSERT INTO up_pipeline_run VALUES (?,?) ON CONFLICT (id) DO UPDATE SET result=excluded.result")
      .run(run.id, JSON.stringify(run));
    this.db.exec("UPDATE up_pipeline_revision SET revision=revision+1 WHERE id=1");
  }

  start(mode: PipelineRun["mode"], source?: string) {
    if (this.active) return { error: "Ya hay una ejecución activa.", status: 409 } as const;
    const id = "pipeline-" + randomUUID().replaceAll("-", "").slice(0, 24);
    if (mode === "reproduce") {
      const recorded = source ? this.get(source) : undefined;
      if (!recorded || !recorded.finished || !recorded.projects.some((p) => p.fixtures?.length))
        return { error: "La ejecución grabada no está disponible.", status: 404 } as const;
      this.save({ ...recorded, id, mode, source, started: time(), finished: time() });
      return { id } as const;
    }
    const run: PipelineRun = { id, mode, status: "running", started: time(), projects: projects.map(newProject) };
    this.save(run);
    const controller = new AbortController();
    this.active = controller;
    void this.execute(run, controller.signal).finally(() => { this.active = undefined; });
    return { id } as const;
  }

  private async execute(run: PipelineRun, signal: AbortSignal) {
    const pending: Promise<void>[] = [];
    const set = (project: PipelineProject, stage: PipelineStage, status: StageStatus, detail?: string) => {
      project.stages[stage] = { status, detail, time: time() };
      this.save(run);
    };
    try {
      for (const p of run.projects) set(p, "inputs", "running");
      const inputs = await this.deps.inputs();
      if (signal.aborted) return;
      run.inputs = inputs;
      for (const p of run.projects) set(p, "inputs", inputs.first ? "passed" : "degraded", inputs.provider);
      await this.deps.evaluate(run.id, inputs.notes, inputs.first, (event) => {
        const p = run.projects.find((value) => value.project === event.project);
        if (!p) return;
        if (event.kind === "stage") {
          set(p, event.stage, event.status);
          return;
        }
        p.evidenceRun = event.evidenceRun;
        p.customers = event.customers;
        p.fixtures = event.fixtures;
        p.incidents = incidentGroups(p);
        set(p, "scoring", p.fixtures.every((f) => f.passed) ? "passed" : "failed");
        pending.push(this.enrich(p, (stage, status, detail) => set(p, stage, status, detail)));
      }, signal);
      await Promise.all(pending);
      if (run.projects.some((p) => !p.fixtures)) throw Error("incomplete");
      run.status = run.projects.some((p) => ["traffic", "scoring"].some((s) => p.stages[s as PipelineStage].status === "failed")) ? "failed" : "completed";
    } catch {
      await Promise.allSettled(pending);
      run.status = "failed";
      run.error = "La ejecución local se interrumpió. Las mediciones disponibles se conservaron.";
      for (const project of run.projects) for (const stage of Object.values(project.stages)) {
        if (stage.status === "running") stage.status = "failed";
      }
    } finally {
      run.finished = time();
      this.save(run);
    }
  }

  private async enrich(project: PipelineProject, stage: (stage: PipelineStage, status: StageStatus, detail?: string) => void) {
    stage("research", "running");
    const relevant = project.incidents.filter((item) => item.cve === services[project.project].cve);
    let advisory: Research | undefined;
    if (relevant.length > 0) {
      advisory = await this.deps.advisory(project.project).catch(() => undefined);
      for (const item of relevant) item.advisory = advisory;
    }
    stage("research", advisory?.retrievedAt || relevant.length === 0 ? "passed" : "degraded", advisory?.note);
    stage("ticket", "running");
    const summary = await this.deps.analyze(project.fixtures ?? []).catch(() => undefined);
    for (const incident of project.incidents) incident.draft = ticket(project, incident, summary);
    stage("ticket", summary ? "passed" : "degraded", summary ? undefined : "Borrador generado con las mediciones. Análisis de Anthropic no disponible.");
  }

  stop() {
    this.closed = true;
    this.active?.abort();
  }
}

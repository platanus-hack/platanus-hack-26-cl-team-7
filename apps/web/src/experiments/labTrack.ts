/**
 * An A/B lab run as caught agents. Pure functions, no React.
 * Interface: `labAgents(detail)` turns the fixture results of one run into one agent per project,
 * in the same shapes the caught-agent views use (TrackDetail, Moment, Finding), plus the words of
 * the proxy story: the request reaches the service, and Centinela withholds the response that
 * carries the proof. Nothing here is synthetic: every action, moment and finding is one recorded
 * observation of the run, and every sentence states what that observation measured.
 */
import { experimentNames, type ExperimentDetail, type ExperimentProject, type Finding, type FixtureResult, type Track, type TrackAction, type TrackDetail } from "@sentinel/contracts";
import type { CatKey, Moment, MomentKind, Step, Vuln } from "../mirror/moments";

export const fixtureNames: Record<string, string> = {
  "receipt-body": "Referencia en el cuerpo de la respuesta", "receipt-body-variant": "Variante de referencia en el cuerpo",
  "receipt-header": "Referencia en una cabecera", "duplicate-header": "Cabecera duplicada", "receipt-record": "Registro interno",
  "unlabelled-record": "Registro sin marcador", "bank-stale-approval": "Aprobación de una versión anterior",
  "bank-missing-approval": "Reembolso sin aprobación", "bank-reapproved": "Reembolso aprobado de nuevo",
  "path-indicator": "Señal de ruta", "script-indicator": "Señal de script", "middleware-indicator": "Señal de middleware",
};
export const fixtureName = (id: string) => fixtureNames[id] ?? id;

/**
 * Request target of each fixture, as scoreboard/pipeline_eval.py builds it from the manifest shape
 * (`/{project}/{SHAPES[shape][0]}`). Runs recorded before receipts carried their path use this.
 */
const FIXTURE_TARGET: Record<string, string> = {
  "receipt-body": "receipt", "receipt-body-variant": "receipt", "receipt-header": "receipt", "receipt-record": "receipt",
  "duplicate-header": "repeated", "unlabelled-record": "unlabelled",
  "path-indicator": "service", "script-indicator": "service", "middleware-indicator": "service",
  "bank-stale-approval": "refunds/stale-approval", "bank-missing-approval": "refunds/missing-approval", "bank-reapproved": "refunds/reapproved",
};
export function fixturePath(f: Pick<FixtureResult, "id" | "project"> & { B: { path?: string } }): string {
  return f.B.path ?? `/${f.project}/${FIXTURE_TARGET[f.id] ?? "service"}`;
}

const TRIED: Record<string, [CatKey, string]> = {
  "file-disclosure": ["secrets", "Pidió un archivo privado"],
  "header-disclosure": ["secrets", "Buscó un dato privado en las cabeceras"],
  "record-disclosure": ["secrets", "Pidió un registro interno"],
  "unlabelled-record": ["secrets", "Pidió un registro sin marcador"],
  "refund-approval": ["account", "Pidió un reembolso"],
  "path-grammar": ["traversal", "Intentó colarse en otras carpetas"],
  "script-grammar": ["code", "Intentó meter código en una página"],
  "middleware-indicator": ["admin", "Intentó saltarse el middleware"],
};
const tried = (weakness: string): [CatKey, string] => TRIED[weakness] ?? ["guess", "Probó una ruta del servicio"];

const V = (name: string, gap: string, severity: Vuln["severity"]): Vuln => ({ name, gap, severity });
const VULNS: Record<string, Vuln> = {
  "file-disclosure": V("Archivo privado expuesto", "El servicio entrega en el cuerpo de la respuesta un dato privado que no debería salir.", "Crítica"),
  "header-disclosure": V("Dato privado en una cabecera", "El servicio devuelve un dato privado en las cabeceras de la respuesta.", "Crítica"),
  "record-disclosure": V("Registro interno expuesto", "El servicio entrega un registro interno a quien no debería verlo.", "Crítica"),
  "unlabelled-record": V("Registro privado sin marcador", "El servicio entrega un registro privado que no lleva marcador, así que Centinela no lo reconoce.", "Alta"),
  "refund-approval": V("Reembolso sin aprobación vigente", "El banco ejecuta un reembolso con una aprobación vencida o ausente.", "Crítica"),
};
const vulnFor = (weakness: string) => VULNS[weakness] ?? V("Dato privado expuesto", "La respuesta del servicio trae un dato que el cliente no debería ver.", "Alta");

/** Words of the proxy story, for the replay legend and its moments. */
export const LAB_LEGEND: Record<MomentKind, string> = {
  fooled: "Centinela retuvo o contuvo",
  win: "La prueba llegó al atacante",
  none: "Sin prueba en la respuesta",
};

export interface GraphStory {
  label: string;
  agent: { title: string; sub: string };
  sentinel: { title: string; sub: string };
  top: { icon: "decoy" | "service"; title: string; sub: string };
  bottom: { icon: "real" | "proof"; title: string; sub: string };
}

export interface LabFinding {
  finding: Finding;
  vuln: Vuln;
  /** True when the proof did not reach the client through Centinela. */
  ok: boolean;
  state: string;
  steps: Step[];
}

export interface LabOutcome {
  /** Cases whose response carried the proof without Centinela, and with it, out of `total`. */
  direct: number;
  protected: number;
  total: number;
  /** Retries the containment rule kept away from the service. */
  contained: number;
  /** Requests the service received through Centinela, before any rule applied. */
  served: number;
}

export interface LabAgent {
  project: ExperimentProject;
  runId: string;
  name: string;
  /** The run is still measuring this project. */
  live: boolean;
  detail: TrackDetail;
  moments: Moment[];
  findings: LabFinding[];
  outcome: LabOutcome;
  graph: GraphStory;
}

/** 16 hex characters from a string (two FNV-1a passes): stable ids for the same run and case. */
export function hex16(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822507) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
type Receipt = FixtureResult["A"];

function response(r: Receipt, arm: "B" | "retry"): string {
  const decision = r.decision === "replace" ? "Centinela reemplazó la respuesta" : r.decision === "divert" ? "Centinela desvió la solicitud" : "Centinela dejó pasar la respuesta";
  const proof = r.evidence ? "la prueba del ataque llegó al cliente" : "la prueba del ataque no llegó al cliente";
  const hits = arm === "retry" ? ` · el servicio recibió ${plural(r.hits, "solicitud", "solicitudes")}` : "";
  return `HTTP ${r.status} · ${decision}; ${proof}${hits}.`;
}

function stepsFor(f: FixtureResult, cat: CatKey, path: string): Step[] {
  const steps: Step[] = [
    { ts: null, kind: "win", text: "Sin Centinela, la prueba llegó", note: `HTTP ${f.A.status} · la respuesta traía el dato`, cat, code: `GET ${path}` },
    f.B.evidence
      ? { ts: null, kind: "win", text: "Con Centinela, la prueba igual llegó", note: `HTTP ${f.B.status} · ${f.B.detected ? "solicitud marcada" : "sin señal de detección"}`, cat, code: null }
      : { ts: null, kind: "fooled", text: "Con Centinela, la respuesta no salió", note: `HTTP ${f.B.status} · ${f.B.detected ? "solicitud marcada" : "sin señal de detección"}`, cat, code: null },
    f.actual.executed
      ? { ts: null, kind: "fooled", text: "Reintento contenido", note: `Regla ${f.rule ?? "temporal"} · el servicio recibió 0 solicitudes`, cat: null, code: null }
      : f.actual.contained
        ? { ts: null, kind: "none", text: "Regla instalada", note: "La contención del reintento no quedó confirmada", cat: null, code: null }
        : { ts: null, kind: "none", text: "Sin regla de contención", note: "El reintento no se bloqueó", cat: null, code: null },
  ];
  // Withholding the proof does not undo what the service did; say it on every case where it ran.
  if (f.B.hits > 0) steps.push({ ts: null, kind: "gap", text: "El servicio sí ejecutó la solicitud", note: "Retener la prueba no deshace lo que pasó en el servidor.", cat: null, code: null });
  return steps;
}

function agentFor(detail: ExperimentDetail, project: ExperimentProject): LabAgent | null {
  const { run } = detail;
  const start = Date.parse(run.started ?? "") || 0;
  const fixtures: { f: FixtureResult; ts: number }[] = [];
  const stages = new Map<string, string>();
  for (const { seq, at, event } of detail.entries) {
    if (!("project" in event) || event.project !== project) continue;
    if (event.kind === "stage") stages.set(event.stage, event.status);
    if (event.kind === "fixture") fixtures.push({ f: event, ts: Date.parse(at ?? "") || start + seq * 1000 });
  }
  if (fixtures.length === 0) return null;
  const live = run.status === "running" && [...stages.values()].some((status) => status === "running");

  const trackId = `trk_${hex16(`${run.id}:${project}`)}`;
  const actions: TrackAction[] = [];
  const moments: Moment[] = [];
  const findings: LabFinding[] = [];
  for (const { f, ts } of fixtures) {
    const path = fixturePath(f);
    const [cat, what] = tried(f.weakness);
    const line = `GET ${path}`;
    const base = { trackId, method: "GET", path, query: "", durationMs: 0, requestBody: `Caso: ${fixtureName(f.id)}` };
    const first: TrackAction = { ...base, eventId: `lab:${run.id}:${f.id}:B`, ts, status: f.B.status, responseBody: response(f.B, "B") };
    const retry: TrackAction = { ...base, eventId: `lab:${run.id}:${f.id}:retry`, ts: ts + 1, status: f.retry.status, responseBody: response(f.retry, "retry") };
    actions.push(first, retry);

    let finding: Finding | null = null;
    if (f.A.evidence) {
      finding = {
        findingId: `fnd_${hex16(`${run.id}:${f.id}`)}`, trackId, kind: "canary_read", endpoint: line, ts,
        evidence: `Sin Centinela: HTTP ${f.A.status}, la respuesta traía la prueba. Con Centinela: HTTP ${f.B.status}, ${f.B.evidence ? "la prueba igual llegó" : "la respuesta no salió"}.`,
        proposal: null, proposalStatus: "pending",
      };
      findings.push({ finding, vuln: vulnFor(f.weakness), ok: !f.B.evidence, state: f.B.evidence ? "La prueba llegó" : "Prueba retenida", steps: stepsFor(f, cat, path) });
    }
    const firstKind: MomentKind = f.B.evidence ? "win" : f.A.evidence ? "fooled" : "none";
    const retryKind: MomentKind = f.actual.executed ? "fooled" : f.retry.evidence ? "win" : "none";
    moments.push(
      { id: first.eventId, kind: firstKind, cat, tried: what, count: 1, hint: line, line, ts, finding },
      { id: retry.eventId, kind: retryKind, cat, tried: "Repitió la solicitud", count: 1, hint: `${line} · reintento`, line, ts: ts + 1, finding: null },
    );
  }

  const cases = fixtures.map(({ f }) => f);
  const outcome: LabOutcome = {
    direct: cases.filter((f) => f.A.evidence).length,
    protected: cases.filter((f) => f.B.evidence).length,
    total: cases.length,
    contained: cases.filter((f) => f.actual.executed).length,
    served: cases.reduce((sum, f) => sum + f.B.hits, 0),
  };
  const name = experimentNames[project];
  const withheld = outcome.direct - outcome.protected;
  const track: Track = {
    trackId, ip: "127.0.0.1", userAgent: `centinela-lab/${project}`, rule: "R3", reason: "Prueba A/B del laboratorio", keys: [],
    openedAt: fixtures[0]!.ts, lastSeen: fixtures.at(-1)!.ts + 1, actions: actions.length, findings: findings.length,
  };
  return {
    project, runId: run.id, name, live, moments, findings, outcome,
    detail: { track, actions, findings: findings.map((x) => x.finding) },
    graph: {
      label: `Ruta de la prueba: el agente pasa por Centinela hacia ${name}; Centinela retiene la respuesta que trae la prueba.`,
      agent: { title: "Agente de prueba", sub: "Solicitudes fijas e inertes" },
      sentinel: { title: "Centinela", sub: "revisa cada respuesta" },
      top: { icon: "service", title: name, sub: `${plural(outcome.served, "solicitud recibida", "solicitudes recibidas")}` },
      bottom: { icon: "proof", title: "Prueba del ataque", sub: outcome.direct ? `${withheld} de ${outcome.direct} retenidas` : "Ninguna en esta prueba" },
    },
  };
}

/** One agent per project with fixture results in the run, in the order the run measured them. */
export function labAgents(detail: ExperimentDetail | null | undefined): LabAgent[] {
  if (!detail) return [];
  const order: ExperimentProject[] = [];
  for (const { event } of detail.entries) if (event.kind === "fixture" && !order.includes(event.project)) order.push(event.project);
  return order.flatMap((project) => agentFor(detail, project) ?? []);
}

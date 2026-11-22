/**
 * One A/B run as the sites Reaper protects. Pure functions, no React.
 * Interface: `labAgents(detail)` turns a run into one site per project: its CVE case, the replay
 * (TrackDetail, Moment, Finding, the shapes the replay components use), every request as raw HTTP
 * side by side (without Reaper | with Reaper | retry), the legitimate traffic, and the researched fix.
 * Only cases modelled on a published CVE are kept. Nothing here is synthetic: every row is one
 * recorded observation of the run, and every sentence states what that observation measured.
 */
import { experimentNames, type ExperimentDetail, type ExperimentEvent, type ExperimentProject, type Finding, type FixtureResult, type Track, type TrackAction, type TrackDetail } from "@sentinel/contracts";
import type { CatKey, Moment, MomentKind, Step, Vuln } from "../mirror/moments";

export const fixtureNames: Record<string, string> = {
  "nextjs-auth-bypass": "Bypass de middleware con una cabecera",
  "vite-file-read": "Lectura de /etc/passwd",
  "react2shell-rce": "Ejecución remota por RSC",
  "langflow-rce": "Ejecución remota en Langflow",
};
export const fixtureName = (id: string) => fixtureNames[id] ?? id;

/** Advisory of each real CVE the lab exploits, for runs recorded before fixtures carried it. */
export const CVE_SOURCES: Record<string, string> = {
  "CVE-2025-29927": "https://github.com/advisories/GHSA-f82v-jwr5-mffw",
  "CVE-2025-30208": "https://github.com/advisories/GHSA-x574-m823-4x7w",
  "CVE-2025-55182": "https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components",
  "CVE-2026-33017": "https://github.com/advisories/GHSA-4gr9-m9jp-cq37",
};

/** Request target of a case, as the real exploit sent it. */
export function fixturePath(f: Pick<FixtureResult, "id" | "project"> & { B: { path?: string } }): string {
  return f.B.path ?? "/";
}

const TRIED: Record<string, [CatKey, string]> = {
  "auth-bypass": ["admin", "Envió la cabecera que salta la autenticación del middleware"],
  "file-read": ["traversal", "Pidió leer un archivo del sistema del servidor"],
  rce: ["code", "Ejecutó un comando en el servidor"],
};
const tried = (weakness: string): [CatKey, string] => TRIED[weakness] ?? ["guess", "Probó una ruta del servicio"];

const V = (name: string, gap: string, severity: Vuln["severity"]): Vuln => ({ name, gap, severity });
const VULNS: Record<string, Vuln> = {
  "auth-bypass": V("Bypass de autenticación del middleware", "El middleware deja pasar una petición con la cabecera x-middleware-subrequest y entrega una página protegida sin credenciales.", "Crítica"),
  "file-read": V("Lectura arbitraria de archivos", "El servidor de desarrollo entrega el contenido de un archivo del sistema (/etc/passwd) saltando su control de acceso.", "Crítica"),
  rce: V("Ejecución remota de código", "El servidor deserializa de forma insegura la entrada del atacante y ejecuta un comando; el resultado vuelve en la respuesta.", "Crítica"),
};
const vulnFor = (weakness: string) => VULNS[weakness] ?? V("Dato privado expuesto", "La respuesta del servicio trae un dato que el cliente no debería ver.", "Alta");

/** Words of the proxy story, for the replay legend and its moments. */
export const LAB_LEGEND: Record<MomentKind, string> = {
  fooled: "Reaper retuvo o contuvo",
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
  /** True when the proof did not reach the client through Reaper. */
  ok: boolean;
  state: string;
  steps: Step[];
}

export interface LabOutcome {
  /** Cases whose response carried the proof without Reaper, and with it, out of `total`. */
  direct: number;
  protected: number;
  total: number;
  /** Retries the containment rule kept away from the service. */
  contained: number;
  /** Requests the service received through Reaper, before any rule applied. */
  served: number;
}

type Receipt = FixtureResult["A"];
export interface TrafficCell {
  role: "direct" | "protected" | "retry";
  label: string;
  receipt: Receipt;
}
export interface TrafficRow {
  id: string;
  kind: "attack" | "legit";
  title: string;
  method: string;
  target: string;
  /** The fictional canary that marks the proof in a response, for highlighting. */
  proof: string | null;
  cells: TrafficCell[];
  verdict: string;
  /** "win" when the proof reached the client through Reaper, "fooled" when Reaper held it back. */
  tone: MomentKind;
}

export interface LabResearch {
  status: Extract<ExperimentEvent, { kind: "research" }>["status"];
  fixes: string[];
  source: string | null;
}

/** What the analyst agent concluded after reading the measured PoC. */
export interface LabAnalysis {
  status: Extract<ExperimentEvent, { kind: "analysis" }>["status"];
  cve: string | null;
  confirmed: boolean;
  summary: string;
}

export interface LabAgent {
  project: ExperimentProject;
  runId: string;
  name: string;
  /** The run is still measuring this project. */
  live: boolean;
  cve: { id: string; source: string | null } | null;
  detail: TrackDetail;
  moments: Moment[];
  findings: LabFinding[];
  outcome: LabOutcome;
  legit: { A: { passed: number; total: number }; B: { passed: number; total: number } };
  traffic: TrafficRow[];
  research: LabResearch | null;
  analysis: LabAnalysis | null;
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

function response(r: Receipt, arm: "B" | "retry"): string {
  const decision = r.decision === "replace" ? "Reaper reemplazó la respuesta" : r.decision === "divert" ? "Reaper desvió la solicitud" : "Reaper dejó pasar la respuesta";
  const proof = r.evidence ? "la prueba del ataque llegó al cliente" : "la prueba del ataque no llegó al cliente";
  const hits = arm === "retry" ? ` · el servicio recibió ${plural(r.hits, "solicitud", "solicitudes")}` : "";
  return `HTTP ${r.status} · ${decision}; ${proof}${hits}.`;
}

function stepsFor(f: FixtureResult, cat: CatKey, path: string): Step[] {
  const seen = (r: Receipt) => (r.detected ? "solicitud marcada" : "sin señal de detección");
  const steps: Step[] = [
    { ts: null, kind: "win", text: "Sin Reaper, la prueba llegó", note: `HTTP ${f.A.status} · la respuesta traía el dato`, cat, code: `GET ${path}` },
    f.B.evidence
      ? { ts: null, kind: "win", text: "Con Reaper, la prueba igual llegó", note: `HTTP ${f.B.status} · ${seen(f.B)}`, cat, code: null }
      : { ts: null, kind: "fooled", text: "Con Reaper, la respuesta no salió", note: `HTTP ${f.B.status} · ${seen(f.B)}`, cat, code: null },
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

function verdict(f: FixtureResult): [string, MomentKind] {
  if (f.B.evidence) return ["La prueba llegó al atacante también con Reaper", "win"];
  if (!f.A.evidence) return ["La respuesta no traía la prueba", "none"];
  return [f.actual.executed ? "Reaper retuvo la prueba y contuvo el reintento" : "Reaper retuvo la prueba", "fooled"];
}

function agentFor(detail: ExperimentDetail, project: ExperimentProject): LabAgent | null {
  const { run } = detail;
  const start = Date.parse(run.started ?? "") || 0;
  const fixtures: { f: FixtureResult; ts: number }[] = [];
  const controls: Extract<ExperimentEvent, { kind: "control" }>[] = [];
  const stages = new Map<string, string>();
  let research: LabResearch | null = null;
  let analysis: LabAnalysis | null = null;
  for (const { seq, at, event } of detail.entries) {
    if (!("project" in event) || event.project !== project) continue;
    if (event.kind === "stage") stages.set(event.stage, event.status);
    // Only the cases modelled on a published CVE: deliberate controls of older runs are left out.
    if (event.kind === "fixture" && event.cve) fixtures.push({ f: event, ts: Date.parse(at ?? "") || start + seq * 1000 });
    if (event.kind === "control") controls.push(event);
    if (event.kind === "research") research = { status: event.status, fixes: event.fixes, source: event.source };
    if (event.kind === "analysis") analysis = { status: event.status, cve: event.cve, confirmed: event.confirmed, summary: event.summary };
  }
  if (fixtures.length === 0) return null;
  const live = run.status === "running" && [...stages.values()].some((status) => status === "running");

  const trackId = `trk_${hex16(`${run.id}:${project}`)}`;
  const actions: TrackAction[] = [];
  const moments: Moment[] = [];
  const findings: LabFinding[] = [];
  const traffic: TrafficRow[] = [];
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
        evidence: `Sin Reaper: HTTP ${f.A.status}, la respuesta traía la prueba. Con Reaper: HTTP ${f.B.status}, ${f.B.evidence ? "la prueba igual llegó" : "la respuesta no salió"}.`,
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
    const [words, tone] = verdict(f);
    traffic.push({
      id: `case:${f.id}`, kind: "attack", title: fixtureName(f.id), method: f.A.raw?.request.method ?? "GET", target: f.A.raw?.request.target ?? path,
      proof: f.proof ?? null, verdict: words, tone,
      cells: [
        { role: "direct", label: "Sin Reaper", receipt: f.A },
        { role: "protected", label: "Con Reaper", receipt: f.B },
        { role: "retry", label: "Reintento con Reaper", receipt: f.retry },
      ],
    });
  }

  // Legitimate customers: each submitted the same form directly (A) and through Reaper (B), in order.
  const byArm = { A: controls.filter((c) => c.arm === "A"), B: controls.filter((c) => c.arm === "B") };
  byArm.A.forEach((a, i) => {
    const b = byArm.B[i];
    const passed = a.passed && (b?.passed ?? false);
    traffic.push({
      id: `legit:${i}`, kind: "legit", title: `Cliente legítimo ${i + 1}`, method: a.receipt.raw?.request.method ?? "POST",
      target: a.receipt.raw?.request.target ?? `/${project}/workspace`, proof: null,
      verdict: passed ? "Pasó igual con y sin Reaper" : "Reaper cambió el resultado de un cliente legítimo", tone: passed ? "none" : "win",
      cells: [{ role: "direct", label: "Sin Reaper", receipt: a.receipt }, ...(b ? [{ role: "protected" as const, label: "Con Reaper", receipt: b.receipt }] : [])],
    });
  });
  const count = (items: typeof controls) => ({ passed: items.filter((c) => c.passed).length, total: items.length });

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
  const cveId = cases[0]!.cve!;
  const track: Track = {
    trackId, ip: "127.0.0.1", userAgent: `reaper-lab/${project}`, rule: "R3", reason: "Prueba A/B del laboratorio", keys: [],
    openedAt: fixtures[0]!.ts, lastSeen: fixtures.at(-1)!.ts + 1, actions: actions.length, findings: findings.length,
  };
  return {
    project, runId: run.id, name, live, moments, findings, outcome, traffic, research, analysis,
    cve: { id: cveId, source: research?.source ?? cases[0]?.source ?? CVE_SOURCES[cveId] ?? null },
    legit: { A: count(byArm.A), B: count(byArm.B) },
    detail: { track, actions, findings: findings.map((x) => x.finding) },
    graph: {
      label: `Ruta de la prueba: el agente pasa por Reaper hacia ${name}; Reaper retiene la respuesta que trae la prueba.`,
      agent: { title: "Agente de prueba", sub: "Solicitudes fijas e inertes" },
      sentinel: { title: "Reaper", sub: "revisa cada respuesta" },
      top: { icon: "service", title: name, sub: `${plural(outcome.served, "solicitud recibida", "solicitudes recibidas")}` },
      bottom: { icon: "proof", title: "Prueba del ataque", sub: outcome.direct ? `${withheld} de ${outcome.direct} retenidas` : "Ninguna en esta prueba" },
    },
  };
}

/** One site per project with CVE cases in the run, in the order the run measured them. */
export function labAgents(detail: ExperimentDetail | null | undefined): LabAgent[] {
  if (!detail) return [];
  const order: ExperimentProject[] = [];
  for (const { event } of detail.entries) if (event.kind === "fixture" && event.cve && !order.includes(event.project)) order.push(event.project);
  return order.flatMap((project) => agentFor(detail, project) ?? []);
}

/** A raw request as a curl command line, for copying. */
export function curlOf(raw: NonNullable<Receipt["raw"]>["request"], origin = "http://127.0.0.1:9120"): string {
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const parts = ["curl", "-i", ...(raw.method !== "GET" ? ["-X", raw.method] : [])];
  for (const [k, v] of raw.headers) if (k.toLowerCase() !== "x-up-fixture-id") parts.push("-H", quote(`${k}: ${v}`));
  if (raw.body) parts.push("--data", quote(raw.body));
  parts.push(quote(origin + raw.target));
  return parts.join(" ");
}

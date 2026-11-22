/**
 * One A/B run as the sites Reaper protects. Pure functions, no React.
 * Interface: `labAgents(detail)` turns a run into one site per project: its CVE case, the replay
 * (TrackDetail, Moment, Finding, the shapes the replay components use), every request as raw HTTP
 * side by side (without Reaper | with Reaper | retry), the legitimate traffic, the researched fix, the
 * agent's patch, and the stage strip (detection, containment, research, patch) read from the stage events.
 * Only cases modelled on a published CVE are kept. Nothing here is synthetic: every row is one
 * recorded observation of the run, and every sentence states what that observation measured.
 */
import { experimentNames, type ExperimentDetail, type ExperimentEvent, type ExperimentProject, type ExperimentStage, type Finding, type FixtureResult, type PatchEdit, type PatchResult, type Track, type TrackAction, type TrackDetail } from "@sentinel/contracts";
import type { CatKey, Moment, MomentKind, Step, Vuln } from "../mirror/moments";

export const fixtureNames: Record<string, string> = {
  "receipt-body": "Referencia privada en el cuerpo", "receipt-body-variant": "Variante con otra nota",
  "receipt-header": "Referencia privada en una cabecera", "duplicate-header": "Cabecera duplicada",
  "receipt-record": "Registro interno", "bank-stale-approval": "Aprobación de una versión anterior",
  "bank-missing-approval": "Reembolso sin aprobación",
};
export const fixtureName = (id: string) => fixtureNames[id] ?? id;

/** Advisory of the CVE each site's case is modelled on (the same references Sentinel's research reads). */
export const CVE_SOURCES: Record<string, string> = {
  "CVE-2026-118662": "https://github.com/advisories/GHSA-8g5g-mxqh-grgj",
  "CVE-2025-55182": "https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components",
  "CVE-2025-29927": "https://github.com/advisories/GHSA-f82v-jwr5-mffw",
  "CVE-2026-129289": "https://access.redhat.com/security/vulnerabilities/RHSB-2026-020",
};

/** Request target of each case, as scoreboard/pipeline_eval.py builds it, for runs recorded before receipts carried it. */
const FIXTURE_TARGET: Record<string, string> = {
  "receipt-body": "receipt", "receipt-body-variant": "receipt", "receipt-header": "receipt", "receipt-record": "receipt",
  "duplicate-header": "repeated", "bank-stale-approval": "refunds/stale-approval", "bank-missing-approval": "refunds/missing-approval",
};
export function fixturePath(f: Pick<FixtureResult, "id" | "project"> & { B: { path?: string } }): string {
  return f.B.path ?? `/${f.project}/${FIXTURE_TARGET[f.id] ?? "service"}`;
}

const TRIED: Record<string, [CatKey, string]> = {
  "file-disclosure": ["secrets", "Pidió un recibo con datos privados"],
  "header-disclosure": ["secrets", "Buscó un dato privado en las cabeceras"],
  "record-disclosure": ["secrets", "Pidió un registro interno"],
  "refund-approval": ["account", "Pidió un reembolso"],
};
const tried = (weakness: string): [CatKey, string] => TRIED[weakness] ?? ["guess", "Probó una ruta del servicio"];

const V = (name: string, gap: string, severity: Vuln["severity"]): Vuln => ({ name, gap, severity });
const VULNS: Record<string, Vuln> = {
  "file-disclosure": V("Dato privado en el cuerpo de la respuesta", "El servicio entrega en el cuerpo de la respuesta una referencia privada que no debería salir.", "Crítica"),
  "header-disclosure": V("Dato privado en una cabecera", "El servicio devuelve una referencia privada en las cabeceras de la respuesta.", "Crítica"),
  "record-disclosure": V("Registro interno expuesto", "El servicio entrega un registro interno a quien no debería verlo.", "Crítica"),
  "refund-approval": V("Reembolso sin aprobación vigente", "El banco responde un reembolso cuya aprobación es de otra versión o no existe.", "Crítica"),
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

type StageStatus = Extract<ExperimentEvent, { kind: "stage" }>["status"];
/** The stages the panel shows for a project, in pipeline order, with the words of each. */
const STRIP = [["detection", "Detección"], ["containment", "Contención"], ["research", "Aviso"], ["patch", "Parche"]] as const satisfies readonly (readonly [ExperimentStage, string])[];
export type LabStepStage = (typeof STRIP)[number][0];
export interface LabStep {
  stage: LabStepStage;
  label: string;
  /** "pending" until the run emits a stage event for it; then the latest stage event's status. */
  status: "pending" | StageStatus;
  /** Milliseconds from the stage's running event to its terminal event, when the run recorded it. */
  elapsedMs: number | null;
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
  /** The latest patch event of the project: the AppSec agent's patch, applied to a copy and replayed. */
  patch: PatchResult | null;
  /** detection, containment, research and patch, derived only from the project's stage events. */
  steps: LabStep[];
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
  const stages = new Map<ExperimentStage, { status: StageStatus; elapsedMs: number | null }>();
  let research: LabResearch | null = null;
  let patch: PatchResult | null = null;
  for (const { seq, at, event } of detail.entries) {
    if (!("project" in event) || event.project !== project) continue;
    if (event.kind === "stage") stages.set(event.stage, { status: event.status, elapsedMs: event.elapsedMs ?? null });
    // Only the cases modelled on a published CVE: deliberate controls of older runs are left out.
    if (event.kind === "fixture" && event.cve) fixtures.push({ f: event, ts: Date.parse(at ?? "") || start + seq * 1000 });
    if (event.kind === "control") controls.push(event);
    if (event.kind === "research") research = { status: event.status, fixes: event.fixes, source: event.source };
    if (event.kind === "patch") patch = event;
  }
  if (fixtures.length === 0) return null;
  const anyRunning = [...stages.values()].some(({ status }) => status === "running");
  // The patch step can keep running after the run finished (the recorded run is patched at startup).
  const live = (run.status === "running" && anyRunning) || (run.patching === true && stages.get("patch")?.status === "running");
  // A run that is over and never had a patch step is an older run: the strip has no patch step to wait for.
  const inProgress = run.status === "running" || run.patching === true;
  const steps = STRIP.flatMap(([stage, label]): LabStep[] => {
    const seen = stages.get(stage);
    if (!seen && stage === "patch" && !inProgress) return [];
    // A step left "running" by a stop or restart never gets its terminal event: once nothing runs, it was cut off.
    const status = seen?.status === "running" && !inProgress ? "degraded" : seen?.status ?? "pending";
    return [{ stage, label, status, elapsedMs: seen?.elapsedMs ?? null }];
  });

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
    project, runId: run.id, name, live, moments, findings, outcome, traffic, research, patch, steps,
    cve: { id: cveId, source: research?.source ?? CVE_SOURCES[cveId] ?? null },
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

/** Milliseconds as seconds with a decimal comma: "1,2 s". */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`;
}

/** The Spanish words for each error the patch step records, by the start of the server's text. */
const PATCH_ERRORS: readonly (readonly [string, string])[] = [
  ["verifier stopped", "Reaper se detuvo durante la verificación."],
  ["verifier timed out after 45 s", "La verificación tardó más de 45 s."],
  ["uv not found", "Falta uv para verificar el parche."],
  ["verifier exited", "El verificador falló."],
  ["invalid model output", "La respuesta del agente no tenía el formato pedido."],
  ["the patch changed the canary", "El parche cambió el dato de prueba en vez de cerrar la falla."],
  ["the patch adds a forbidden construct", "El parche usaba una construcción no permitida."],
];

/** What a patch error means for the person reading the panel. The server's text is English and may carry model or verifier output, so it is never shown. */
export function patchErrorText(error: string): string {
  const text = error.trim().toLowerCase();
  return PATCH_ERRORS.find(([start]) => text.startsWith(start))?.[1] ?? "El intento no se pudo verificar.";
}

export interface DiffLine {
  sign: "-" | "+";
  text: string;
}

/** The lines an edit removes ("-") and adds ("+"). An empty `new` only removes. */
export function diffLines(edit: Pick<PatchEdit, "old" | "new">): DiffLine[] {
  const lines = (text: string, sign: DiffLine["sign"]): DiffLine[] =>
    text === "" ? [] : text.replace(/\n$/, "").split("\n").map((line) => ({ sign, text: line }));
  const removed = lines(edit.old, "-");
  const added = lines(edit.new, "+");
  // Lines the edit keeps at the start and the end are context, not change: leave them out.
  while (removed.length > 1 && added.length > 1 && removed[0]!.text === added[0]!.text) { removed.shift(); added.shift(); }
  while (removed.length > 1 && added.length > 1 && removed.at(-1)!.text === added.at(-1)!.text) { removed.pop(); added.pop(); }
  return [...removed, ...added];
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

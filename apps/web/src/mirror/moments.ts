/**
 * A caught agent in plain Spanish. Pure functions, no React.
 * Interface:
 * - `buildMoments(actions, findings)` turns stored requests into a few moments, oldest first.
 *   Consecutive tries that found nothing become one moment; tries that fooled the agent merge
 *   by kind; each proof is its own moment.
 * - `vulnOf(finding)`, `chainTo(track, moments, findingId)` explain a proof: what is weak and
 *   the steps the agent took to find it.
 * - `caughtFor`, `agentName`, `disguises` give the words around the replay.
 * Every string from a track is attacker controlled and must be rendered as text.
 */
import type { Finding, Track, TrackAction } from "@sentinel/contracts";

export type MomentKind = "fooled" | "win" | "none";

export interface Moment {
  /** Stable across refetches: the first request's eventId, or the findingId of a proof without its request. */
  id: string;
  kind: MomentKind;
  /** What the agent tried (the most common kind in the moment), as a key and in plain words. */
  cat: CatKey;
  tried: string;
  /** Number of requests in the moment. */
  count: number;
  /** "GET /search" for the first request of the moment. */
  hint: string;
  /** The first request in full, decoded: "GET /search?q=juice' OR '1'='1". */
  line: string;
  ts: number;
  /** Set on a proof moment. */
  finding: Finding | null;
}

const nf = new Intl.NumberFormat("es");
export const numEs = (n: number) => nf.format(n);

function readable(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

/** The agent's name from its user agent: "Chrome 142 · Windows", "curl 8.7.1", "python-httpx 0.28". */
export function agentName(ua: string): string {
  const u = ua.trim();
  if (!u) return "Agente sin nombre";
  if (u.startsWith("Mozilla/")) {
    const os = /Windows/.test(u) ? "Windows" : /iPhone|iPad/.test(u) ? "iOS" : /Mac OS X|Macintosh/.test(u) ? "macOS" : /Android/.test(u) ? "Android" : /Linux/.test(u) ? "Linux" : "";
    const b =
      /Edg\/(\d+)/.exec(u)?.[1] !== undefined ? `Edge ${/Edg\/(\d+)/.exec(u)![1]}`
      : /Firefox\/(\d+)/.exec(u) ? `Firefox ${/Firefox\/(\d+)/.exec(u)![1]}`
      : /Chrome\/(\d+)/.exec(u) ? `Chrome ${/Chrome\/(\d+)/.exec(u)![1]}`
      : /Version\/(\d+).*Safari/.exec(u) ? `Safari ${/Version\/(\d+)/.exec(u)![1]}`
      : "Navegador";
    return os ? `${b} · ${os}` : b;
  }
  const tool = /^([\w.-]+)\/([\w.]+)/.exec(u);
  if (tool) return `${tool[1]} ${tool[2]}`.slice(0, 32);
  return u.split(/[\s;(]/)[0]!.slice(0, 32) || "Agente sin nombre";
}

/** Why the router caught an agent, in plain Spanish. */
export function caughtFor(t: Pick<Track, "rule" | "reason">): string {
  // The router's swarm link (agent-detection/mirror/swarm.py) opens its tracks as R1 with this reason.
  if (t.reason.startsWith("swarm link")) return "Usó una ruta señuelo que solo recibió otro agente";
  if (t.rule === "R1") return "Buscó páginas que no existen";
  if (t.rule === "R2") return "Revisó muchas páginas muy rápido";
  const sig = /critical flag: ([^(]+)/.exec(t.reason)?.[1]?.trim();
  return sig ? `Envió un patrón de ataque (${sig})` : "Envió un patrón de ataque";
}

export type CatKey = "code" | "sql" | "traversal" | "params" | "secrets" | "admin" | "account" | "browse" | "guess";

export const CAT_LABEL: Record<CatKey, string> = {
  code: "Intentó meter código en una página",
  sql: "Intentó engañar al buscador",
  traversal: "Intentó colarse en otras carpetas",
  params: "Probó ajustes ocultos",
  secrets: "Buscó archivos secretos",
  admin: "Buscó herramientas de administración",
  account: "Probó las páginas de cuenta",
  browse: "Navegó la tienda como un cliente",
  guess: "Adivinó páginas que podrían existir",
};

/** What a request tried. */
export function categoryKey(a: Pick<TrackAction, "path" | "query">): CatKey {
  const q = readable(a.query).toLowerCase();
  const p = a.path.toLowerCase();
  if (/<\s*script|javascript:|on(error|load)\s*=|<\s*(img|svg|iframe|b)\b/.test(q)) return "code";
  if (/'\s*(or|and|union|--|;|\)|'|$)|union\s+select|'\s*=\s*'|sleep\s*\(|\\$/.test(q) || /%27/.test(p)) return "sql";
  if (/\.\.\/|%c0%ae|%2e%2e/.test(q + p)) return "traversal";
  if ((q.match(/&/g) ?? []).length >= 3) return "params";
  if (/\.env|\.git|config|passwd|\.ds_store|auth_user|\.htaccess|backup|\.sql\b/.test(p)) return "secrets";
  if (/admin|server|status|info|metrics|health|api-docs|swagger|graphql|trace|well-known|cgi|bin\/|scripts|\.asp|\.php|\.pl\b|\.jsp|\.sh\b|docs|^\/api/.test(p)) return "admin";
  if (/login|logout|account|cart|register|signup/.test(p)) return "account";
  if (p === "/" || /^\/(products|search|static|robots\.txt|favicon)/.test(p)) return "browse";
  return "guess";
}

/** What a request tried, in plain words. */
export function category(a: Pick<TrackAction, "path" | "query">): string {
  return CAT_LABEL[categoryKey(a)];
}

/** How the decoy answer looked to the agent: a 4xx found nothing, anything else looked like a find. */
export function kindOf(status: number): MomentKind {
  return status >= 400 && status < 500 ? "none" : "fooled";
}

export const OUTCOME: Record<MomentKind, string> = { fooled: "recibió páginas falsas", win: "su ataque funcionó", none: "no encontró nada" };

const lineOf = (a: Pick<TrackAction, "method" | "path" | "query">) => `${a.method} ${a.path}${a.query ? `?${a.query}` : ""}`;

/** The tap quotes the proving request as "Request: METHOD target", the target cut at 512 characters. */
const QUOTE_CAP = 512;
function quoted(f: Finding): string {
  return /Request: (\S+ \S+)/.exec(f.evidence)?.[1] ?? "";
}

/** A route pattern ("/api/products/{id}", "/static/**") as a regex; a plain path matches itself. */
function routeRegex(pattern: string): RegExp {
  const wildcard = pattern.endsWith("/**");
  const base = (wildcard ? pattern.slice(0, -3) : pattern).replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{[^/}]+\\?\}/g, "[^/]+");
  return new RegExp(`^${base}${wildcard ? "(/.*)?" : ""}$`);
}

/**
 * The request that proved a finding. The request the evidence quotes wins. Otherwise: same method,
 * a path the finding's route matches, not a 4xx, and answered at most 5 s before the finding.
 */
function proofIndex(actions: TrackAction[], f: Finding): number {
  const [method = "", route = ""] = f.endpoint.split(" ", 2);
  const re = routeRegex(route);
  const quote = quoted(f);
  const named = (a: TrackAction) => {
    const line = lineOf(a);
    return quote !== "" && (line === quote || (quote.length >= QUOTE_CAP + method.length + 1 && line.startsWith(quote)));
  };
  let best = -1;
  let bestScore = Infinity;
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]!;
    const gap = f.ts - (a.ts + a.durationMs);
    if (a.method !== method || a.status >= 400 || a.ts > f.ts + 1000 || gap > 5000 || !re.test(a.path.replace(/(.)\/+$/, "$1"))) continue;
    const score = (named(a) ? 0 : 1e12) + Math.abs(gap);
    if (score < bestScore) [best, bestScore] = [i, score];
  }
  return best;
}

/** Stored requests (any order) and findings to moments, oldest first. */
export function buildMoments(actions: TrackAction[], findings: Finding[]): Moment[] {
  const sorted = [...actions].sort((x, y) => x.ts - y.ts || x.eventId.localeCompare(y.eventId));
  const proofAt = new Map<number, Finding>();
  const loose: Finding[] = [];
  for (const f of [...findings].sort((x, y) => x.ts - y.ts)) {
    const i = proofIndex(sorted, f);
    if (i >= 0 && !proofAt.has(i)) proofAt.set(i, f);
    else loose.push(f);
  }

  type Open = Moment & { key: string | null; tally: Map<CatKey, number> };
  const out: Open[] = [];
  sorted.forEach((a, i) => {
    const finding = proofAt.get(i) ?? null;
    const cat = categoryKey(a);
    const kind = finding ? "win" : kindOf(a.status);
    const key = finding ? null : kind === "none" ? "none" : `${cat}|${kind}`;
    const last = out[out.length - 1];
    if (last && key && last.key === key) {
      last.count++;
      last.tally.set(cat, (last.tally.get(cat) ?? 0) + 1);
      return;
    }
    const line = readable(lineOf(a));
    out.push({ id: a.eventId, key, kind, cat, tried: "", count: 1, hint: `${a.method} ${a.path}`, line, ts: a.ts, finding, tally: new Map([[cat, 1]]) });
  });
  // A proof whose request is no longer stored still shows, at its time.
  for (const f of loose) {
    const cat = categoryKey({ path: f.endpoint.split(" ", 2)[1] ?? "/", query: "" });
    const at = out.findIndex((o) => o.ts > f.ts);
    const line = readable(quoted(f)) || f.endpoint;
    out.splice(at < 0 ? out.length : at, 0, { id: f.findingId, key: null, kind: "win", cat, tried: "", count: 1, hint: f.endpoint, line, ts: f.ts, finding: f, tally: new Map([[cat, 1]]) });
  }
  return out.map(({ key: _key, tally, ...m }) => {
    let cat = m.cat;
    let top = 0;
    for (const [c, n] of tally) if (n > top) [cat, top] = [c, n];
    return { ...m, cat, tried: CAT_LABEL[cat] };
  });
}

export type Severity = "Crítica" | "Alta";
export interface Vuln {
  name: string;
  /** The weakness, in one plain sentence. */
  gap: string;
  severity: Severity;
}

const V = (name: string, gap: string, severity: Severity): Vuln => ({ name, gap, severity });
/** Attack signatures (agent-detection/engine/signatures.py) by family; the first match wins. */
const SIGNATURE_VULNS: [RegExp, Vuln][] = [
  [/^sql (tautology|numeric tautology|union select|comment break|stacked query|error function|time delay|metadata)/, V("Inyección SQL", "El texto que escribe el usuario llega directo a la base de datos.", "Crítica")],
  [/^xss /, V("Inyección de código en la página (XSS)", "La página muestra lo que escribe el usuario sin limpiarlo.", "Alta")],
  [/^path traversal/, V("Acceso a archivos fuera de la carpeta", "El servidor entrega archivos que están fuera de su carpeta pública.", "Crítica")],
  [/^(command injection|log4shell)/, V("Ejecución de comandos", "El texto del usuario se ejecuta como un comando en el servidor.", "Crítica")],
  [/template|erb or jsp|stream wrapper/, V("Inyección en el servidor", "El servidor interpreta como código lo que escribe el usuario.", "Crítica")],
  [/^crlf/, V("Inyección de cabeceras", "El usuario puede agregar cabeceras a la respuesta del servidor.", "Alta")],
  [/^cloud metadata/, V("Acceso a credenciales de la nube", "El servidor deja leer los datos internos de la nube.", "Crítica")],
  [/server status|php info|spring actuator|database admin|nmap probe/, V("Panel interno expuesto", "Una página interna de administración se abre desde la web.", "Alta")],
  [/macos metadata|editor project file/, V("Archivo interno expuesto", "Un archivo interno del proyecto se descarga desde la web.", "Alta")],
];
const FILE_VULN = V("Archivo privado expuesto", "Un archivo privado, que puede tener claves, se descarga desde la web.", "Crítica");

/** What is weak, from the finding kind and the attack signature in its evidence. */
export function vulnOf(f: Pick<Finding, "kind" | "evidence">): Vuln {
  if (f.kind === "auth_flip") return V("Salto del inicio de sesión", "Se puede entrar a una cuenta sin la contraseña correcta.", "Crítica");
  if (f.kind === "canary_read") return V("Lectura de datos privados", "Datos de otros usuarios se pueden leer sin permiso.", "Crítica");
  const sig = (/signature '([^']+)'/.exec(f.evidence)?.[1] ?? "").toLowerCase();
  if (!sig) return V("Ataque que funcionó", "Una entrada del usuario cambia lo que hace el servidor.", "Alta");
  // Any other signature names a file a web server should never hand out (keys, dumps, configs).
  return SIGNATURE_VULNS.find(([re]) => re.test(sig))?.[1] ?? FILE_VULN;
}

/** The tap ends the evidence of a finding with this when every client's repeat reaches the twin (agent-detection/mirror/findings.py). */
const BLOCKED = "Blocked for every client";
const LOGIN_PATHS = new Set(["/login", "/login/", "/api/session", "/api/session/"]);

/**
 * Whether Reaper already keeps this attack out of the real shop, for any client. The tap marks it:
 * the router and the virtual patch read the URI, and the login check reads a login POST's body;
 * a body signature anywhere else is not caught. Findings stored before that mark are judged from
 * the request they quote: a signature with no body, or on a login POST, was caught.
 */
export function contained(f: Pick<Finding, "kind" | "evidence">): boolean {
  // Only the part the tap writes counts: the quoted request after " Request: " is the attacker's own text.
  if ((f.evidence.split(" Request: ", 1)[0] ?? "").endsWith(`${BLOCKED}.`)) return true;
  if (f.kind === "canary_read" || !/signature '[^']+'/.test(f.evidence)) return false;
  const req = /Request: (\S+) (\S+)( body )?/.exec(f.evidence);
  if (!req) return false;
  const [, method, target, body] = req;
  return !body || (method === "POST" && LOGIN_PATHS.has((target ?? "").split("?")[0] ?? ""));
}

/** What the decoy answer proved, from evidence like "got 200, 723 bytes; the 404 page has 10". */
export function answerOf(f: Pick<Finding, "evidence">): string {
  const m = /got (\d{3}), (\d+) bytes; the 404 page has (\d+)/.exec(f.evidence);
  if (!m) return "La copia falsa respondió como si el ataque hubiera funcionado.";
  return `Respondió ${m[1]} con ${numEs(Number(m[2]))} bytes de contenido; una página que no existe ocupa ${numEs(Number(m[3]))} bytes.`;
}

export interface Step {
  ts: number | null;
  text: string;
  note: string;
  kind: "caught" | MomentKind | "gap";
  /** What the step tried, for its icon. */
  cat: CatKey | null;
  /** The request line that proved the finding, on the last step. */
  code: string | null;
}

const STEPS_BEFORE = 5;

/** The trace from the catch to a proof: the catch, the last moments before it, the proof. */
export function chainTo(track: Pick<Track, "rule" | "reason" | "openedAt" | "actions">, moments: Moment[], findingId: string): Step[] {
  const at = moments.findIndex((m) => m.finding?.findingId === findingId);
  if (at < 0) return [];
  const proof = moments[at]!;
  const before = moments.slice(0, at);
  const shown = before.slice(-STEPS_BEFORE);
  const steps: Step[] = [{ ts: track.openedAt, text: "Detectado y desviado a la copia falsa", note: caughtFor(track), kind: "caught", cat: null, code: null }];
  // Reaper sends some requests, not all: say so instead of counting only the ones we hold.
  const loaded = moments.reduce((s, m) => s + (m.id === m.finding?.findingId ? 0 : m.count), 0);
  const unseen = track.actions > loaded;
  if (before.length > shown.length || unseen) {
    const n = before.slice(0, before.length - shown.length).reduce((s, m) => s + m.count, 0);
    const text = unseen ? "Más intentos antes" : `${numEs(n)} ${n === 1 ? "intento anterior" : "intentos anteriores"}`;
    steps.push({ ts: null, text, note: unseen ? "No todos se muestran aquí." : "", kind: "gap", cat: null, code: null });
  }
  for (const m of shown)
    steps.push({ ts: m.ts, text: m.tried, note: `${numEs(m.count)} ${m.count === 1 ? "intento" : "intentos"} · ${OUTCOME[m.kind]}`, kind: m.kind, cat: m.cat, code: null });
  steps.push({ ts: proof.ts, text: "Ataque confirmado en la copia falsa", note: answerOf(proof.finding!), kind: "win", cat: proof.cat, code: proof.line });
  return steps;
}

/**
 * The browser or tool identities (user agents) seen for this agent, as words; "" for just one.
 * Each is a different user agent the router linked to this agent; Reaper keeps 64 keys at most
 * (apps/sentinel/src/deception.ts), so a full list means there were more.
 */
export function disguises(track: Pick<Track, "keys">, maxKeys = 64): string {
  const n = track.keys.filter((k) => k.kind === "ip_ua").length;
  if (n < 2) return "";
  return track.keys.length >= maxKeys ? `más de ${n} identidades` : `${n} identidades`;
}

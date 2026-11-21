/**
 * Plain words for the caught agents screen. Interface: `browserName`, `clientWords`, `whyCaught`,
 * `signatureWords`, `PROOF_TITLE`, `proofDetail`, `knownBy`, `requestLine`, `splitFix`.
 * The API keeps its own terms (track, rule, finding kind, key kind); only the UI translates.
 * Every input string is attacker-controlled: these functions return text, never markup.
 */
import type { Finding, FindingKind, RuleId, Track, TrackAction, TrackKey, TrackKeyKind } from "@sentinel/contracts";

/** Tools whose name alone says what they are, matched against the start of the client name, lower case. */
const TOOLS: Record<string, string> = {
  curl: "curl",
  wget: "Wget",
  gobuster: "Gobuster scanner",
  dirbuster: "DirBuster scanner",
  feroxbuster: "feroxbuster scanner",
  zgrab: "ZGrab scanner",
  masscan: "masscan scanner",
  "python-requests": "Python requests",
  "python-httpx": "Python httpx",
  "python-urllib": "Python urllib",
  aiohttp: "Python aiohttp",
  "go-http-client": "Go HTTP client",
  "node-fetch": "Node fetch",
  undici: "Node fetch",
  axios: "axios",
  okhttp: "OkHttp",
  java: "Java HTTP client",
  postmanruntime: "Postman",
  insomnia: "Insomnia",
};

/** Scanners that often hide inside a browser-like name. */
const SCANNERS: [RegExp, string][] = [
  [/Fuzz Faster U Fool|\bffuf\b/i, "ffuf scanner"],
  [/\bsqlmap\b/i, "sqlmap scanner"],
  [/\bNikto\b/i, "Nikto scanner"],
  [/\bNmap Scripting Engine\b/i, "Nmap scanner"],
  [/\bNuclei\b/i, "Nuclei scanner"],
  [/\bWPScan\b/i, "WPScan scanner"],
];

/** Browser names, most specific first: Edge and Opera say Chrome too, Chrome says Safari too. */
const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\/|\bOpera\b/, "Opera"],
  [/\bFirefox\/|\bFxiOS\//, "Firefox"],
  [/\bChrome\/|\bCriOS\/|\bChromium\//, "Chrome"],
  [/\bVersion\/[\d.]+.*Safari\/|\bSafari\//, "Safari"],
];

/** The client in plain words: "curl", "ffuf scanner", "Safari". */
export function browserName(userAgent: string): string {
  const ua = userAgent.trim();
  if (!ua) return "No browser name";
  if (/^\(\)\s*\{/.test(ua)) return "Shellshock test";
  for (const [re, name] of SCANNERS) if (re.test(ua)) return name;
  if (ua.startsWith("Mozilla/") || /AppleWebKit|Gecko\//.test(ua)) {
    for (const [re, name] of BROWSERS) if (re.test(ua)) return name;
    return "Browser";
  }
  const lower = ua.toLowerCase();
  for (const [key, name] of Object.entries(TOOLS)) if (lower.startsWith(key)) return name;
  return ua.split(/[\s/;(]/, 1)[0]?.slice(0, 40) || "Unknown client";
}

/**
 * Who the agent is in a few words: its first browser name, and how many others it used
 * when it rotated them ("Chrome (and 62 other browser names)").
 */
export function clientWords(t: Pick<Track, "userAgent" | "keys">): string {
  const name = browserName(t.userAgent);
  const others = t.keys.filter((k) => k.kind === "ip_ua").length - 1;
  if (others < 1) return name;
  return `${name} (and ${others} other browser ${others === 1 ? "name" : "names"})`;
}

/** Signature families with a clearer plain name. Signatures not listed read well as they are. */
const SIGNATURE_FAMILY: [RegExp, string][] = [
  [/^sql\b/, "SQL injection test"],
  [/^xss\b/, "Script injection test"],
  [/^(?:template|erb or jsp)\b/, "Template injection test"],
  [/^command injection$|^shell path$/, "Command injection test"],
  [/^log4shell$/, "Log4Shell test"],
  [/^crlf\b/, "Header injection test"],
  [/^path traversal/, "Path traversal test"],
];

/** "sql tautology" -> "SQL injection test"; "dotenv file" stays "dotenv file". */
export function signatureWords(signature: string): string {
  const s = signature.trim().toLowerCase();
  for (const [re, words] of SIGNATURE_FAMILY) if (re.test(s)) return words;
  return s;
}

const WHY: Record<RuleId, string> = {
  R1: "Probed 5 missing pages",
  R2: "Scanned many pages fast",
  R3: "Sent an attack pattern",
};

/** Why the agent was caught. R1 keeps its real count; R3 names its signature. */
export function whyCaught(rule: RuleId, reason: string): string {
  if (rule === "R1") {
    const n = /^(\d+) requests outside/.exec(reason)?.[1];
    return n ? `Probed ${n} missing pages` : WHY.R1;
  }
  if (rule === "R3") {
    const sig = /critical flag:\s*(.+)$/i.exec(reason)?.[1];
    return sig ? `${WHY.R3}: ${signatureWords(sig)}` : WHY.R3;
  }
  return WHY[rule];
}

export const PROOF_TITLE: Record<FindingKind, string> = {
  signature_success: "Exploit worked on the decoy",
  canary_read: "Read decoy data",
  auth_flip: "Got past login on the decoy",
};

export interface ProofDetail {
  /** One or two plain sentences. */
  text: string;
  /** The literal request that proved it, when the evidence carries one. */
  request: string | null;
}

/** Turns a finding's evidence into plain sentences plus its request line. Unknown shapes fall back to the evidence. */
export function proofDetail(f: Pick<Finding, "kind" | "endpoint" | "evidence">): ProofDetail {
  const cut = f.evidence.lastIndexOf(". Request: ");
  const request = cut === -1 ? null : f.evidence.slice(cut + ". Request: ".length).trim() || null;
  const body = cut === -1 ? f.evidence : f.evidence.slice(0, cut);
  const sig = /signature '([^']+)'/.exec(body)?.[1];
  const test = sig ? signatureWords(sig) : null;
  const on = test ? `${capital(test)} on ${f.endpoint}.` : `${f.endpoint}.`;

  if (f.kind === "signature_success") {
    const m = /got (\d{3}), (\d+) bytes; the 404 page has (\d+)/.exec(body);
    if (m) return { text: `${on} The decoy answered ${m[1]} with ${m[2]} bytes, where a missing page gets ${m[3]} bytes.`, request };
  } else if (f.kind === "auth_flip") {
    const m = /answered this track (\d{3}).*?, now (\d{3})/.exec(body);
    if (m) return { text: `${on} The decoy refused this agent with ${m[1]} before, then answered ${m[2]}.`, request };
  } else {
    const m = /holds canary (\S+) \(([^)]+)\)/.exec(body);
    if (m) return { text: `${f.endpoint} answered with a decoy ${m[1]!.replace(/_/g, " ")} planted in ${m[2]}.`, request };
  }
  return { text: body, request };
}

/**
 * "address, with or without browser (it used 31 different browser names), a decoy login":
 * how later requests are tied to this agent. An address key and an address-and-browser key
 * together read as one phrase, so the address is not said twice.
 */
export function knownBy(keys: TrackKey[]): string {
  const count = (kind: TrackKeyKind) => keys.filter((k) => k.kind === kind).length;
  const pairs = count("ip_ua");
  const ips = count("ip");
  const logins = count("twin_born");
  const parts: string[] = [];
  if (pairs > 0) {
    const base = ips > 0 ? "address, with or without browser" : "address and browser";
    parts.push(pairs > 1 ? `${base} (it used ${pairs} different browser names)` : base);
  } else if (ips > 0) parts.push("address");
  if (logins > 0) parts.push(logins > 1 ? `${logins} decoy logins` : "a decoy login");
  return parts.join(", ");
}

/** The literal request line: `GET /search?q=1`. */
export const requestLine = (a: Pick<TrackAction, "method" | "path" | "query">) => `${a.method} ${a.query ? `${a.path}?${a.query}` : a.path}`;

/** Splits "Lead. Fix: 1. Do this. 2. Do that." into the lead and its numbered steps. Without steps, the whole text is the lead. */
export function splitFix(summary: string): { lead: string; steps: string[] } {
  const text = summary.trim();
  const first = /(?:^|\s)1\.\s/.exec(text);
  if (!first) return { lead: text, steps: [] };
  const lead = text.slice(0, first.index).trim().replace(/\s*Fix:$/i, "").trim();
  const steps: string[] = [];
  let rest = text.slice(first.index).trim();
  for (let n = 1; rest; n++) {
    const next = new RegExp(`\\s${n + 1}\\.\\s`).exec(rest);
    const step = (next ? rest.slice(0, next.index) : rest).replace(new RegExp(`^${n}\\.\\s`), "").trim();
    if (step) steps.push(step);
    rest = next ? rest.slice(next.index).trim() : "";
  }
  return { lead, steps };
}

/** System words the AI proposal may still use, whole words only, with their plain word. */
const FIX_WORDS: [RegExp, string][] = [
  [/\bmirror lanes?\b/gi, "decoy"],
  [/\btwins\b/gi, "decoys"],
  [/\btwin\b/gi, "decoy"],
];

/**
 * The fix text as the screen shows it: "the twin returned" reads "the decoy returned".
 * Display only; Copy fix copies the proposal unchanged.
 */
export function plainFix(text: string): string {
  let out = text;
  for (const [re, word] of FIX_WORDS) out = out.replace(re, (m) => (m[0] === m[0]!.toUpperCase() ? capital(word) : word));
  return out;
}

function capital(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

import { z } from "zod";

/** Sentinel API version prefix. Every route lives under it. */
export const API_PREFIX = "/v1";
export const DEFAULT_PORT = 8787;

export const RANGES = ["5m", "1h", "24h"] as const;
export const Range = z.enum(RANGES);
export type Range = z.infer<typeof Range>;

export const RANGE_MS: Record<Range, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

/** Chart bucket size for each range, so every range draws about 30–60 points. */
export const BUCKET_MS: Record<Range, number> = {
  "5m": 10_000,
  "1h": 60_000,
  "24h": 30 * 60_000,
};

export const ATTACK_TYPES = [
  "prompt_injection",
  "jailbreak",
  "sql_injection",
  "xss",
  "path_traversal",
  "credential_stuffing",
  "unknown",
] as const;
export const AttackType = z.enum(ATTACK_TYPES);
export type AttackType = z.infer<typeof AttackType>;

export const ATTACK_LABEL: Record<AttackType, string> = {
  prompt_injection: "Prompt injection",
  jailbreak: "Jailbreak",
  sql_injection: "SQL injection",
  xss: "Cross-site scripting",
  path_traversal: "Path traversal",
  credential_stuffing: "Credential stuffing",
  unknown: "Unknown",
};

/** killed = stopped. active = got through or needs a human. analyzing = AI verdict pending. */
export const EventStatus = z.enum(["killed", "active", "analyzing"]);
export type EventStatus = z.infer<typeof EventStatus>;

export const VerdictSource = z.enum(["rules", "ai", "block"]);
export type VerdictSource = z.infer<typeof VerdictSource>;

/** Optional location hint a gateway can forward (for example from a CDN header). */
export const GeoHint = z.object({
  country: z.string().max(64).optional(),
  countryCode: z.string().length(2).optional(),
  city: z.string().max(64).optional(),
  network: z.string().max(96).optional(),
});
export type GeoHint = z.infer<typeof GeoHint>;

/** What a gateway or the simulator sends to POST /v1/events. */
export const IngestEvent = z.object({
  /** When the gateway saw the request. Outside [now − 24 h, now + 30 s] the server uses its own clock. */
  ts: z.number().int().positive().optional(),
  ip: z.ipv4().or(z.ipv6()),
  method: z.string().max(10).default("GET"),
  path: z.string().max(512),
  payload: z.string().max(8192).default(""),
  userAgent: z.string().max(512).default(""),
  /** True when the request was a failed login. Feeds the credential stuffing rule. */
  failedLogin: z.boolean().optional(),
  geo: GeoHint.optional(),
});
export type IngestEvent = z.input<typeof IngestEvent>;
export type IngestEventParsed = z.output<typeof IngestEvent>;

export const IngestBody = z.union([IngestEvent, z.array(IngestEvent).min(1).max(500)]);

export const AttackEvent = z.object({
  id: z.string(),
  seq: z.number().int(),
  ts: z.number().int(),
  ip: z.string(),
  method: z.string(),
  path: z.string(),
  payload: z.string(),
  attackType: AttackType,
  status: EventStatus,
  source: VerdictSource,
  confidence: z.number().min(0).max(1),
});
export type AttackEvent = z.infer<typeof AttackEvent>;

export const Attacker = z.object({
  ip: z.string(),
  country: z.string().nullable(),
  countryCode: z.string().nullable(),
  city: z.string().nullable(),
  network: z.string().nullable(),
  device: z.string().nullable(),
  os: z.string().nullable(),
  browser: z.string().nullable(),
  firstSeen: z.number().int(),
  lastSeen: z.number().int(),
  events: z.number().int(),
  killed: z.number().int(),
  notKilled: z.number().int(),
  topType: AttackType,
  risk: z.number().int().min(0).max(100),
  blocked: z.boolean(),
});
export type Attacker = z.infer<typeof Attacker>;

export const AttackerReport = z.object({
  ip: z.string(),
  summary: z.string(),
  generatedAt: z.number().int(),
  model: z.string(),
});
export type AttackerReport = z.infer<typeof AttackerReport>;

export const SeriesPoint = z.object({
  t: z.number().int(),
  received: z.number().int(),
  killed: z.number().int(),
});
export type SeriesPoint = z.infer<typeof SeriesPoint>;

export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  ai: z.object({ enabled: z.boolean(), model: z.string().nullable() }),
  uptimeMs: z.number().int(),
});
export type Health = z.infer<typeof Health>;

export const Snapshot = z.object({
  range: Range,
  now: z.number().int(),
  bucketMs: z.number().int(),
  series: z.array(SeriesPoint),
  events: z.array(AttackEvent),
  attackers: z.array(Attacker),
  /** Stream position this snapshot includes. Connect with `?after=${epoch}-${seq}`. */
  seq: z.number().int(),
  /** Changes on every Sentinel restart. A different epoch means the client must reload the snapshot. */
  epoch: z.string(),
});
export type Snapshot = z.infer<typeof Snapshot>;

export const AttackerDetail = z.object({
  attacker: Attacker,
  report: AttackerReport.nullable(),
  recent: z.array(AttackEvent),
});
export type AttackerDetail = z.infer<typeof AttackerDetail>;

export const Block = z.object({ ip: z.string(), blockedAt: z.number().int() });
export type Block = z.infer<typeof Block>;

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

/* ------------------------------------------------------------------ */
/* Live stream: GET /v1/stream (SSE). The server coalesces changes into */
/* one "batch" message per 100 ms frame so the UI renders once a frame. */
/* ------------------------------------------------------------------ */

export type StreamChange =
  /**
   * `prev` is set when this updates an event published earlier (for example
   * analyzing → killed). Without `prev` the event is new: count it as received.
   */
  | { kind: "event"; event: AttackEvent; prev?: EventStatus }
  | { kind: "attacker"; attacker: Attacker }
  | { kind: "report"; report: AttackerReport }
  | { kind: "block"; ip: string; blocked: boolean };

/**
 * GET /v1/stream sends `event: ready` with `{ epoch, seq }`, then `event: batch`
 * with ids `${epoch}-${seq}`. `event: reset` means the client missed more than the
 * server kept (or the server restarted): reload the snapshot and reconnect.
 */
export interface StreamBatch {
  epoch: string;
  seq: number;
  now: number;
  changes: StreamChange[];
}

/* ------------------------------------------------------------------ */
/* Copilot: POST /v1/copilot/messages (SSE response)                    */
/* ------------------------------------------------------------------ */

export const CopilotTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});
export const CopilotRequest = z.object({
  messages: z.array(CopilotTurn).min(1).max(40),
  range: Range.default("1h"),
});
export type CopilotRequest = z.input<typeof CopilotRequest>;

export interface ChartBlock {
  title: string;
  subtitle: string;
  source: string;
  note?: string;
  rows: { label: string; value: number; share: number }[];
}

export type CopilotEvent =
  | { type: "reasoning"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; summary: string; ms: number; ok: boolean }
  | { type: "chart"; chart: ChartBlock }
  | { type: "text"; delta: string }
  | { type: "done"; at: number; reasoningMs: number }
  | { type: "error"; code: string; message: string };

export const COPILOT_TOOLS = ["query_events", "get_attacker", "group_attackers", "attack_stats"] as const;

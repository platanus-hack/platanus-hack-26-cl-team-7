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
/* Deception (attacker mirror lane). The router posts events to         */
/* POST /v1/deception/events; the UI reads /v1/tracks and /v1/findings. */
/* Python twin: mirror/contracts.py. Both sides parse                   */
/* packages/contracts/test/fixtures/deception-batch.json.               */
/* ------------------------------------------------------------------ */

/** String limits count code points (zod 4.6's .max()), the way Python's len() counts. */
export const DECEPTION_LIMITS = {
  batch: 500,
  body: 8192,
  text: 512,
  uri: 2048,
  method: 16,
  keyValue: 1024,
  keys: 16,
} as const;
const L = DECEPTION_LIMITS;

/** GET /v1/tracks/:trackId returns at most this many actions, newest first. */
export const MAX_TRACK_ACTIONS = 200;
/** Page size for GET /v1/tracks and GET /v1/findings. */
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** 422 answer to an eventId sent again with a different body. */
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";

export const LANES = ["real", "mirror"] as const;
export const Lane = z.enum(LANES);
export type Lane = z.infer<typeof Lane>;

/** Detection rules of the Python engine (engine.models.RuleId). */
export const RULE_IDS = ["R1", "R2", "R3"] as const;
export const RuleId = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof RuleId>;

export const TRACK_KEY_KINDS = ["ip", "ip_ua", "twin_born"] as const;
export const TrackKeyKind = z.enum(TRACK_KEY_KINDS);
export type TrackKeyKind = z.infer<typeof TrackKeyKind>;

export const FINDING_KINDS = ["canary_read", "auth_flip", "signature_success"] as const;
export const FindingKind = z.enum(FINDING_KINDS);
export type FindingKind = z.infer<typeof FindingKind>;

export const DECEPTION_EVENT_TYPES = ["track.opened", "track.linked", "track.action", "finding.confirmed"] as const;
export type DeceptionEventType = (typeof DECEPTION_EVENT_TYPES)[number];

export const TrackId = z.string().regex(/^trk_[0-9a-f]{16}$/);
export const FindingId = z.string().regex(/^fnd_[0-9a-f]{16}$/);
const Ip = z.ipv4().or(z.ipv6());

/** ip and ip_ua keys carry the value; twin_born keys carry the sha256 hex of the value the twin gave out. */
export const TrackKey = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ip"), value: Ip }),
  z.strictObject({ kind: z.literal("ip_ua"), value: z.string().min(1).max(L.keyValue) }),
  z.strictObject({ kind: z.literal("twin_born"), value: z.string().regex(/^[0-9a-f]{64}$/) }),
]);
export type TrackKey = z.infer<typeof TrackKey>;

/** `${type}:${requestId}` or `${type}:${requestId}:${part}`; requestId comes from Caddy's X-Request-Id. */
function eventIdFor(type: DeceptionEventType) {
  const prefix = type.replace(".", "\\.");
  return z.string().regex(new RegExp(`^${prefix}:[A-Za-z0-9._-]{1,128}(?::[A-Za-z0-9._-]{1,64})?$`));
}

function envelope<T extends DeceptionEventType>(type: T) {
  return {
    type: z.literal(type),
    eventId: eventIdFor(type),
    trackId: TrackId,
    /** Unix milliseconds. */
    ts: z.number().int().positive(),
  };
}

const ActionFields = {
  method: z.string().min(1).max(L.method),
  path: z.string().min(1).max(L.uri),
  query: z.string().max(L.uri),
  status: z.number().int().min(100).max(599),
  durationMs: z.number().int().nonnegative(),
  requestBody: z.string().max(L.body),
  responseBody: z.string().max(L.body),
};

const FindingFields = {
  findingId: FindingId,
  kind: FindingKind,
  endpoint: z.string().min(1).max(L.uri),
  evidence: z.string().min(1).max(L.body),
};

export const TrackOpenedEvent = z.strictObject({
  ...envelope("track.opened"),
  ip: Ip,
  userAgent: z.string().max(L.text),
  rule: RuleId,
  reason: z.string().min(1).max(L.text),
  keys: z.array(TrackKey).min(1).max(L.keys),
});
export const TrackLinkedEvent = z.strictObject({ ...envelope("track.linked"), key: TrackKey });
export const TrackActionEvent = z.strictObject({ ...envelope("track.action"), ...ActionFields });
export const FindingConfirmedEvent = z.strictObject({ ...envelope("finding.confirmed"), ...FindingFields });

export const DeceptionEvent = z.discriminatedUnion("type", [
  TrackOpenedEvent,
  TrackLinkedEvent,
  TrackActionEvent,
  FindingConfirmedEvent,
]);
export type DeceptionEvent = z.infer<typeof DeceptionEvent>;

/** Body of POST /v1/deception/events. */
export const DeceptionBatch = z.array(DeceptionEvent).min(1).max(L.batch);
export type DeceptionBatch = z.infer<typeof DeceptionBatch>;

/** 202 answer. A duplicate is an eventId already stored with the same body. */
export const DeceptionAccepted = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
});
export type DeceptionAccepted = z.infer<typeof DeceptionAccepted>;

/** One flagged client, as the dashboard lists it. */
export const Track = z.object({
  trackId: TrackId,
  ip: z.string(),
  userAgent: z.string(),
  rule: RuleId,
  reason: z.string(),
  keys: z.array(TrackKey),
  openedAt: z.number().int(),
  lastSeen: z.number().int(),
  actions: z.number().int().nonnegative(),
  findings: z.number().int().nonnegative(),
});
export type Track = z.infer<typeof Track>;

export const TrackAction = z.object({
  eventId: z.string(),
  trackId: TrackId,
  ts: z.number().int(),
  ...ActionFields,
});
export type TrackAction = z.infer<typeof TrackAction>;

/** The fix the AI proposes for a confirmed finding. A human applies it. */
export const FixProposal = z.object({
  summary: z.string(),
  generatedAt: z.number().int(),
  model: z.string(),
});
export type FixProposal = z.infer<typeof FixProposal>;

export const Finding = z.object({
  ...FindingFields,
  trackId: TrackId,
  ts: z.number().int(),
  /** null until the AI has written one (or when AI is off). */
  proposal: FixProposal.nullable(),
});
export type Finding = z.infer<typeof Finding>;

/** GET /v1/tracks/:trackId. Unknown ids answer 404 with the ApiError shape. */
export const TrackDetail = z.object({
  track: Track,
  actions: z.array(TrackAction).max(MAX_TRACK_ACTIONS),
  findings: z.array(Finding),
});
export type TrackDetail = z.infer<typeof TrackDetail>;

/** Query of GET /v1/tracks and GET /v1/findings. `cursor` is the previous page's nextCursor. */
export const PageQuery = z.object({
  range: Range.default("24h"),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: z.string().min(1).max(256).optional(),
});
export type PageQuery = z.output<typeof PageQuery>;

export const TrackPage = z.object({ items: z.array(Track), nextCursor: z.string().nullable() });
export type TrackPage = z.infer<typeof TrackPage>;

export const FindingPage = z.object({ items: z.array(Finding), nextCursor: z.string().nullable() });
export type FindingPage = z.infer<typeof FindingPage>;

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
  /**
   * Chart counts for events left out of a busy frame (a frame carries at most
   * MAX_EVENTS_PER_FRAME events). `t` is a 10 s bucket start; add the deltas.
   */
  | { kind: "counts"; buckets: SeriesPoint[] }
  | { kind: "attacker"; attacker: Attacker }
  | { kind: "report"; report: AttackerReport }
  | { kind: "block"; ip: string; blocked: boolean }
  /** A deception track opened or changed (new action, link or finding count). */
  | { kind: "track"; track: Track }
  /** A finding was confirmed, or its fix proposal arrived. */
  | { kind: "finding"; finding: Finding };

/**
 * GET /v1/stream sends `event: ready` with `{ epoch, seq }`, then `event: batch`
 * with ids `${epoch}-${seq}`. `event: reset` means the client missed more than the
 * server kept (or the server restarted): reload the snapshot and reconnect.
 */
export const MAX_EVENTS_PER_FRAME = 500;
/** Snapshots and frames carry at most this many attackers (the highest risk). The UI shows 100. */
export const MAX_ATTACKERS = 200;

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

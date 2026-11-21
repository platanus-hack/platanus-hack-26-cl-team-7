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

/** A finding's fix proposal: being written, written, or given up on after every attempt. */
export const PROPOSAL_STATUSES = ["pending", "ready", "failed"] as const;
export const ProposalStatus = z.enum(PROPOSAL_STATUSES);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

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
  /** "failed" once the AI gave up on it; a Sentinel restart tries again. "pending" while AI is off. */
  proposalStatus: ProposalStatus,
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

/* ------------------------------------------------------------------ */
/* Incident reports: two agents (forensic analyst, AppSec engineer)     */
/* and a human decision. Routes under /v1/reports.                      */
/* ------------------------------------------------------------------ */

/** Log stores the analyst reads. Every evidence ID starts with one of these prefixes. */
export const LOG_STORES = ["sen", "acc", "eng"] as const;
export const LogStore = z.enum(LOG_STORES);
export type LogStore = z.infer<typeof LogStore>;
export const LOG_STORE_LABEL: Record<LogStore, string> = {
  sen: "Sentinel events",
  acc: "Access log",
  eng: "Engine verdicts",
};

/** `sen:<event id>`, `acc:<line number>` or `eng:<verdict id>`. */
export const EvidenceId = z.string().regex(/^(sen|acc|eng):[A-Za-z0-9._-]{1,64}$/);
export type EvidenceId = z.infer<typeof EvidenceId>;

export const ReportVerdict = z.enum(["exploited", "attempt_only", "inconclusive"]);
export type ReportVerdict = z.infer<typeof ReportVerdict>;
export const Confidence = z.enum(["low", "medium", "high"]);
export type Confidence = z.infer<typeof Confidence>;

/** Row limits and text caps that every tool result and agent output obeys. */
export const REPORT_LIMITS = {
  requests: 50,
  payloadChars: 120,
  resultBytes: 4096,
  facts: 8,
  gaps: 3,
  conflicts: 3,
  revisions: 5,
  /** Padding around the attacker's first and last request when the scope window is set. */
  windowPadMs: 5 * 60_000,
} as const;

/** The scope that code sets when a report starts. Tools never take an IP from the model. */
export const ReportScope = z.object({
  ip: z.string(),
  /** ISO 8601, UTC. */
  from: z.string(),
  to: z.string(),
});
export type ReportScope = z.infer<typeof ReportScope>;

/** One request in the same shape for all three stores. A field the store does not hold is null. */
export const RequestRow = z.object({
  id: EvidenceId,
  /** ISO 8601, UTC. */
  ts: z.string(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  /** At most REPORT_LIMITS.payloadChars characters. Attacker-controlled. */
  payload: z.string().nullable(),
  attack_type: AttackType.nullable(),
  http_status: z.number().int().nullable(),
  blocked: z.boolean().nullable(),
});
export type RequestRow = z.infer<typeof RequestRow>;

export const ToolErrorCode = z.enum(["BAD_INPUT", "NOT_FOUND", "OUT_OF_WINDOW", "STORE_DOWN"]);
export type ToolErrorCode = z.infer<typeof ToolErrorCode>;

/** Every tool returns this envelope. `rows` holds RequestRow objects or grouped count rows. */
export const ToolResult = z.object({
  scope: ReportScope.extend({ store: z.union([LogStore, z.literal("all")]) }),
  total: z.number().int().min(0),
  returned: z.number().int().min(0),
  truncated: z.boolean(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  error: z.object({ code: ToolErrorCode, hint: z.string().max(200) }).nullable(),
});
export type ToolResult = z.infer<typeof ToolResult>;

export const CaseFact = z.object({
  text: z.string().min(1).max(200),
  evidence: z.array(EvidenceId).min(1).max(5),
});
export type CaseFact = z.infer<typeof CaseFact>;

/** Forensic analyst output. */
export const CaseFile = z.object({
  verdict: ReportVerdict,
  confidence: Confidence,
  /** One sentence: attack type, endpoint, and the verdict. */
  summary: z.string().min(1).max(200),
  facts: z.array(CaseFact).max(REPORT_LIMITS.facts),
  /** The requests that show the attack succeeded. Empty unless the verdict is "exploited". The timeline marks only these. */
  exploitEvidence: z.array(EvidenceId).max(3),
  /** What the logs cannot show. */
  gaps: z.array(z.string().min(1).max(200)).max(REPORT_LIMITS.gaps),
});
export type CaseFile = z.infer<typeof CaseFile>;

/** AppSec engineer output. */
export const Hypothesis = z.object({
  rootCause: z.object({
    cwe: z.string().regex(/^CWE-\d{1,4}$/),
    /** OWASP Top 10:2025 category, for example "A05:2025". */
    owasp: z.string().regex(/^A(0[1-9]|10):2025$/),
    endpoint: z.string().min(1).max(200),
    parameter: z.string().max(100).nullable(),
    explanation: z.string().min(1).max(300),
  }),
  fix: z.object({
    /** The code-level change. */
    change: z.string().min(1).max(400),
    /** Layer, file or function where the change goes. */
    where: z.string().min(1).max(200),
    /** A request that must fail after the fix. */
    test: z.object({
      method: z.string().min(1).max(10),
      path: z.string().min(1).max(512),
      payload: z.string().max(500),
      expect: z.string().min(1).max(200),
    }),
  }),
  rejected: z.object({ option: z.string().min(1).max(200), reason: z.string().min(1).max(200) }),
  confidence: Confidence,
  /** Set on a revision: the engineer's restatement of the refusal reason. */
  restatedReason: z.string().max(300).nullable(),
  /** Set on a revision: what changed against the previous hypothesis. */
  changed: z.string().max(300).nullable(),
  /** Set on a revision: places where the refusal reason disagrees with the evidence. */
  conflicts: z
    .array(z.object({ claim: z.string().min(1).max(200), evidence: z.array(EvidenceId).min(1).max(5), note: z.string().min(1).max(200) }))
    .max(REPORT_LIMITS.conflicts),
});
export type Hypothesis = z.infer<typeof Hypothesis>;

export const Decision = z.object({
  kind: z.enum(["approve", "refuse"]),
  /** Required for a refusal, null for an approval. */
  reason: z.string().nullable(),
  at: z.number().int(),
});
export type Decision = z.infer<typeof Decision>;

/** Body of POST /v1/reports/:id/decision. A refusal without a reason gets 422 REASON_REQUIRED. */
export const DecisionRequest = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approve") }),
  z.object({ decision: z.literal("refuse"), reason: z.string().trim().min(3).max(1000) }),
]);
export type DecisionRequest = z.input<typeof DecisionRequest>;

export const TokenUsage = z.object({ input: z.number().int().min(0), output: z.number().int().min(0) });
export type TokenUsage = z.infer<typeof TokenUsage>;

export const Revision = z.object({
  n: z.number().int().min(1),
  hypothesis: Hypothesis,
  createdAt: z.number().int(),
  model: z.string(),
  tokens: TokenUsage,
  decision: Decision.nullable(),
});
export type Revision = z.infer<typeof Revision>;

/**
 * investigating: the analyst and the first engineer call run.
 * awaiting_decision: the latest revision waits for a human.
 * revising: a refusal is being answered.
 * approved: final. failed: an agent output did not pass its schema twice, or the model failed.
 */
export const ReportStatus = z.enum(["investigating", "awaiting_decision", "revising", "approved", "failed"]);
export type ReportStatus = z.infer<typeof ReportStatus>;

/** One mark on the attack timeline. Code builds it from the stores, not the model. */
export const TimelinePoint = z.object({
  id: EvidenceId,
  ts: z.string(),
  attack_type: AttackType.nullable(),
  http_status: z.number().int().nullable(),
  blocked: z.boolean().nullable(),
  /** True when the verdict is "exploited" and the case file lists this request in exploitEvidence. */
  damage: z.boolean(),
});
export type TimelinePoint = z.infer<typeof TimelinePoint>;

export const Report = z.object({
  id: z.string(),
  scope: ReportScope,
  status: ReportStatus,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  caseFile: CaseFile.nullable(),
  /** The rows that the case file and conflicts cite, for the evidence table. */
  evidence: z.array(RequestRow),
  timeline: z.array(TimelinePoint),
  revisions: z.array(Revision),
  analystModel: z.string().nullable(),
  analystTokens: TokenUsage.nullable(),
  error: z.string().nullable(),
});
export type Report = z.infer<typeof Report>;

export const ReportSummary = Report.pick({ id: true, scope: true, status: true, createdAt: true, updatedAt: true }).extend({
  verdict: ReportVerdict.nullable(),
  revisions: z.number().int().min(0),
});
export type ReportSummary = z.infer<typeof ReportSummary>;

/** Body of POST /v1/reports. */
export const CreateReportRequest = z.object({ ip: z.ipv4().or(z.ipv6()) });
export type CreateReportRequest = z.input<typeof CreateReportRequest>;

export * from "./ultimo-paso.ts";

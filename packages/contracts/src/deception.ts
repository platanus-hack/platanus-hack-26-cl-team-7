/**
 * Deception (attacker mirror lane). The router posts events to POST /v1/deception/events;
 * the UI reads /v1/tracks and /v1/findings. Python twin: agent-detection/mirror/contracts.py.
 * Both sides parse packages/contracts/test/fixtures/deception-batch.json.
 */
import { z } from "zod";
import { IpAddress, Range } from "./api.ts";

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
const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

/** 422 answer to an eventId sent again with a different body. */
export const IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED";

/** Detection rules of the Python engine (engine.models.RuleId). */
const RuleId = z.enum(["R1", "R2", "R3"]);
const TrackId = z.string().regex(/^trk_[0-9a-f]{16}$/);
const FindingId = z.string().regex(/^fnd_[0-9a-f]{16}$/);
const FindingKind = z.enum(["canary_read", "auth_flip", "signature_success"]);

/** A finding's fix proposal: being written, written, or given up on after every attempt. */
export const ProposalStatus = z.enum(["pending", "ready", "failed"]);
export type ProposalStatus = z.infer<typeof ProposalStatus>;

/** ip and ip_ua keys carry the value; twin_born keys carry the sha256 hex of the value the twin gave out. */
export const TrackKey = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("ip"), value: IpAddress }),
  z.strictObject({ kind: z.literal("ip_ua"), value: z.string().min(1).max(L.keyValue) }),
  z.strictObject({ kind: z.literal("twin_born"), value: z.string().regex(/^[0-9a-f]{64}$/) }),
]);
export type TrackKey = z.infer<typeof TrackKey>;

type DeceptionEventType = "track.opened" | "track.linked" | "track.action" | "finding.confirmed";

function envelope<T extends DeceptionEventType>(type: T) {
  const prefix = type.replace(".", "\\.");
  return {
    type: z.literal(type),
    /** `${type}:${requestId}` or `${type}:${requestId}:${part}`; requestId comes from Caddy's X-Request-Id. */
    eventId: z.string().regex(new RegExp(`^${prefix}:[A-Za-z0-9._-]{1,128}(?::[A-Za-z0-9._-]{1,64})?$`)),
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

const TrackOpenedEvent = z.strictObject({
  ...envelope("track.opened"),
  ip: IpAddress,
  userAgent: z.string().max(L.text),
  rule: RuleId,
  reason: z.string().min(1).max(L.text),
  keys: z.array(TrackKey).min(1).max(L.keys),
});
const TrackLinkedEvent = z.strictObject({ ...envelope("track.linked"), key: TrackKey });
const TrackActionEvent = z.strictObject({ ...envelope("track.action"), ...ActionFields });
const FindingConfirmedEvent = z.strictObject({ ...envelope("finding.confirmed"), ...FindingFields });

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
  /** "failed" once the AI gave up on it; a Reaper restart tries again. "pending" while AI is off. */
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

const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const TrackPage = page(Track);
export type TrackPage = z.infer<typeof TrackPage>;

export const FindingPage = page(Finding);
export type FindingPage = z.infer<typeof FindingPage>;

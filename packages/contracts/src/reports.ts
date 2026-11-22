/**
 * Reports: the forensic case file (analyst), the AppSec hypothesis (engineer) and the human
 * decision. Routes live under /v1/reports.
 */
import { z } from "zod";
import { IpAddress } from "./api.ts";
import { AttackType } from "./monitor.ts";

/** Log stores the analyst reads. Every evidence ID starts with one of these prefixes. */
export const LOG_STORES = ["sen", "acc", "eng"] as const;
export const LogStore = z.enum(LOG_STORES);
export type LogStore = z.infer<typeof LogStore>;
export const LOG_STORE_LABEL: Record<LogStore, string> = {
  sen: "Reaper events",
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

const Citations = z.array(EvidenceId).min(1).max(5);

const CaseFact = z.object({
  text: z.string().min(1).max(200),
  evidence: Citations,
});

const Conflict = z.object({
  claim: z.string().min(1).max(200),
  evidence: Citations,
  note: z.string().min(1).max(200),
});

/** The forensic analyst's output. */
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

/** The AppSec engineer's output. */
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
  conflicts: z.array(Conflict).max(REPORT_LIMITS.conflicts),
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
export const TimelinePoint = RequestRow.pick({ id: true, ts: true, attack_type: true, http_status: true, blocked: true }).extend({
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
export const CreateReportRequest = z.object({ ip: IpAddress });
export type CreateReportRequest = z.input<typeof CreateReportRequest>;

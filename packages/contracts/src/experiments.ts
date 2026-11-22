import { z } from "zod";

export const ExperimentProject = z.enum(["bruma", "litoral", "surco", "bank"]);
export type ExperimentProject = z.infer<typeof ExperimentProject>;
export const experimentNames = { bruma: "Bruma Remuneraciones", litoral: "Litoral Freight", surco: "Surco Rooms", bank: "Banco Estero" } as const;
const arm = z.enum(["A", "B"]);
const natural = z.int().nonnegative();
const header = z.tuple([z.string(), z.string()]);
/** One HTTP exchange as the client saw it: what it sent and what came back. Bodies are capped. */
export const RawExchange = z.object({
  request: z.object({ method: z.string(), target: z.string(), headers: z.array(header), body: z.string() }),
  response: z.object({ status: natural, headers: z.array(header), body: z.string(), truncated: z.boolean() }),
});
export type RawExchange = z.infer<typeof RawExchange>;
/** What Reaper's engine recorded for a protected transaction. */
export const EngineView = z.object({ level: z.string(), symbol: z.string(), decision: z.string(), rule: z.string().nullable().optional(),
  evidence: z.array(z.string()), reason: z.string() });
export type EngineView = z.infer<typeof EngineView>;
const receipt = z.object({ trace: z.string(), requestId: z.string().optional(), path: z.string().max(256).optional(),
  raw: RawExchange.optional(), engine: EngineView.optional(), status: natural,
  hits: natural, evidence: z.boolean(), detected: z.boolean().nullable(), decision: z.string().nullable(), rule: z.string().nullable(),
  operationId: z.string().nullable().optional(),
  approval: z.object({ requestedVersion: natural, approvedVersion: natural.nullable(), eligible: z.boolean() }).optional() });
const stage = z.enum(["inputs", "traffic", "fixtures", "detection", "containment", "research", "patch", "feedback"]);
export type ExperimentStage = z.infer<typeof stage>;
const status = z.enum(["running", "passed", "failed", "degraded", "skipped"]);
const count = z.object({ yes: natural, total: natural });
const project = { project: ExperimentProject };
export const PATCH_LIMITS = { attempts: 2, edits: 3, editChars: 2000, explanation: 600 } as const;
/** One exact text replacement in one lab target file. `old` must occur exactly once in that file. */
export const PatchEdit = z.object({ file: z.string().regex(/^targets\/businesses\/[a-z_]+\.py$/),
  old: z.string().min(1).max(PATCH_LIMITS.editChars), new: z.string().max(PATCH_LIMITS.editChars) });
const scored = z.object({ detected: z.boolean(), contained: z.boolean(), executed: z.boolean(), directEvidence: z.boolean(), proxyEvidence: z.boolean() });

export const ExperimentEvent = z.discriminatedUnion("kind", [
  /** `elapsedMs` (time since the same stage's `running` event) is set on terminal stage events of newer runs. */
  z.object({ kind: z.literal("stage"), ...project, stage, status, detail: z.string().optional(), elapsedMs: natural.optional() }),
  z.object({ kind: z.literal("inputs"), provider: z.enum(["openrouter", "fixed"]), first: z.string(), notes: z.array(z.string()).length(3) }),
  z.object({ kind: z.literal("control"), ...project, arm, receipt, passed: z.boolean() }),
  z.object({ kind: z.literal("fixture"), ...project, id: z.string(), weakness: z.string(), cve: z.string().optional(), proof: z.string().max(128).optional(),
    A: receipt, B: receipt, retry: receipt, rule: z.string().nullable(), actual: scored, expected: scored, passed: z.boolean() }),
  z.object({ kind: z.literal("baseline"), ...project, direct: count, protected: count, detected: count,
    installed: count, executed: count, legitimateA: count, legitimateB: count }),
  z.object({ kind: z.literal("research"), ...project, source: z.string().nullable(), cve: z.string().nullable(),
    status: z.enum(["retrieved", "unconfigured", "unavailable", "no_finding"]), fixes: z.array(z.string()), evidence: z.array(z.string()) }),
  /**
   * The AppSec engineer agent's patch for a confirmed case, applied to a throwaway copy of the lab
   * service and checked by replaying the same attack. The repository files never change.
   * `verified`: no replayed attack got the proof and every legitimate request passed.
   */
  z.object({ kind: z.literal("patch"), ...project,
    status: z.enum(["verified", "failed", "unconfigured", "unavailable", "no_finding"]),
    model: z.string().nullable(), attempts: z.int().min(0).max(PATCH_LIMITS.attempts),
    edits: z.array(PatchEdit).max(PATCH_LIMITS.edits), explanation: z.string().max(PATCH_LIMITS.explanation), cwe: z.string().nullable(),
    /** attacks.yes: replayed attacks whose response still carried the proof. legit.yes: legitimate requests that passed. */
    replay: z.object({ attacks: count, legit: count }).nullable(),
    timings: z.object({ agentMs: natural, verifyMs: natural }),
    tokens: z.object({ input: natural, output: natural }),
    error: z.string().max(300).nullable() }),
  z.object({ kind: z.literal("feedback"), ...project, arm, repetition: z.int().min(1).max(3), order: z.int().min(1).max(2),
    model: z.string(), budget: z.literal(4), status: z.enum(["completed", "failed", "unconfigured"]),
    actualEvidence: z.boolean(), seenEvidence: z.boolean(), reported: z.boolean(), unsupported: z.boolean(),
    observations: z.array(z.object({ status: natural, evidence: z.boolean() })),
    choices: z.array(z.enum(["next", "success", "stop"])).max(4) }),
]);
export type ExperimentEvent = z.infer<typeof ExperimentEvent>;
export type FixtureResult = Extract<ExperimentEvent, { kind: "fixture" }>;

export type PatchEdit = z.infer<typeof PatchEdit>;
export type PatchResult = Extract<ExperimentEvent, { kind: "patch" }>;

export const ExperimentRun = z.object({ id: z.string(), mode: z.enum(["recorded", "live"]),
  status: z.enum(["running", "completed", "failed", "interrupted"]), started: z.string().nullable(),
  finished: z.string().nullable(), source: z.string().nullable(), error: z.string().nullable(), project: ExperimentProject.nullable().optional(),
  /** True while the patch step runs on an already finished run (the recorded run at startup): its stream stays open. */
  patching: z.boolean().optional() });
export type ExperimentRun = z.infer<typeof ExperimentRun>;
export const ExperimentList = z.object({ items: z.array(ExperimentRun) });
export const ExperimentStarted = z.object({ id: z.string() });
export const ExperimentStartRequest = z.strictObject({ project: ExperimentProject.optional() });
export const ExperimentEntry = z.object({ seq: natural, at: z.string().nullable(), event: ExperimentEvent });
export type ExperimentEntry = z.infer<typeof ExperimentEntry>;
export const ExperimentDetail = z.object({ run: ExperimentRun, entries: z.array(ExperimentEntry) });
export type ExperimentDetail = z.infer<typeof ExperimentDetail>;

import { z } from "zod";

export const ExperimentProject = z.enum(["bruma", "litoral", "surco", "bank"]);
export type ExperimentProject = z.infer<typeof ExperimentProject>;
export const experimentNames = { bruma: "Bruma Print Works", litoral: "Litoral Freight", surco: "Surco Rooms", bank: "Banco Estero" } as const;
const arm = z.enum(["A", "B"]);
const natural = z.int().nonnegative();
const receipt = z.object({ trace: z.string(), requestId: z.string().optional(), status: natural,
  hits: natural, evidence: z.boolean(), detected: z.boolean().nullable(), decision: z.string().nullable(), rule: z.string().nullable(),
  operationId: z.string().nullable().optional(),
  approval: z.object({ requestedVersion: natural, approvedVersion: natural.nullable(), eligible: z.boolean() }).optional() });
const stage = z.enum(["inputs", "traffic", "fixtures", "detection", "containment", "research", "feedback"]);
const status = z.enum(["running", "passed", "failed", "degraded", "skipped"]);
const count = z.object({ yes: natural, total: natural });
const project = { project: ExperimentProject };
const scored = z.object({ detected: z.boolean(), contained: z.boolean(), executed: z.boolean(), directEvidence: z.boolean(), proxyEvidence: z.boolean() });

export const ExperimentEvent = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stage"), ...project, stage, status, detail: z.string().optional() }),
  z.object({ kind: z.literal("inputs"), provider: z.enum(["openrouter", "fixed"]), first: z.string(), notes: z.array(z.string()).length(3) }),
  z.object({ kind: z.literal("control"), ...project, arm, receipt, passed: z.boolean() }),
  z.object({ kind: z.literal("fixture"), ...project, id: z.string(), weakness: z.string(), cve: z.string().optional(),
    A: receipt, B: receipt, retry: receipt, rule: z.string().nullable(), actual: scored, expected: scored, passed: z.boolean() }),
  z.object({ kind: z.literal("baseline"), ...project, direct: count, protected: count, detected: count,
    installed: count, executed: count, legitimateA: count, legitimateB: count }),
  z.object({ kind: z.literal("research"), ...project, source: z.string().nullable(), cve: z.string().nullable(),
    status: z.enum(["retrieved", "unconfigured", "unavailable", "no_finding"]), fixes: z.array(z.string()), evidence: z.array(z.string()) }),
  z.object({ kind: z.literal("feedback"), ...project, arm, repetition: z.int().min(1).max(3), order: z.int().min(1).max(2),
    model: z.string(), budget: z.literal(4), status: z.enum(["completed", "failed", "unconfigured"]),
    actualEvidence: z.boolean(), seenEvidence: z.boolean(), reported: z.boolean(), unsupported: z.boolean(),
    observations: z.array(z.object({ status: natural, evidence: z.boolean() })),
    choices: z.array(z.enum(["next", "success", "stop"])).max(4) }),
]);
export type ExperimentEvent = z.infer<typeof ExperimentEvent>;
export type FixtureResult = Extract<ExperimentEvent, { kind: "fixture" }>;

export const ExperimentRun = z.object({ id: z.string(), mode: z.enum(["recorded", "live"]),
  status: z.enum(["running", "completed", "failed", "interrupted"]), started: z.string().nullable(),
  finished: z.string().nullable(), source: z.string().nullable(), error: z.string().nullable(), project: ExperimentProject.nullable().optional() });
export type ExperimentRun = z.infer<typeof ExperimentRun>;
export const ExperimentList = z.object({ items: z.array(ExperimentRun) });
export const ExperimentStarted = z.object({ id: z.string() });
export const ExperimentStartRequest = z.strictObject({ project: ExperimentProject.optional() });
export const ExperimentEntry = z.object({ seq: natural, at: z.string().nullable(), event: ExperimentEvent });
export type ExperimentEntry = z.infer<typeof ExperimentEntry>;
export const ExperimentDetail = z.object({ run: ExperimentRun, entries: z.array(ExperimentEntry) });
export type ExperimentDetail = z.infer<typeof ExperimentDetail>;

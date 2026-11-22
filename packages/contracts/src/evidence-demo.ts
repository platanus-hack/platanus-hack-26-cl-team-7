import { z } from "zod";

const ordinal = z.int().positive();
const id = z.string().min(1).max(160);
const observation = {
  id,
  runId: id,
  trialId: id,
  sequence: ordinal,
  requestId: id.optional(),
  traceId: id.optional(),
  timestamp: z.iso.datetime().nullable(),
};

const bankObservation = z.discriminatedUnion("kind", [
  z.strictObject({ ...observation, source: z.literal("client"), kind: z.literal("response"),
    ordinal, status: z.int().min(0).max(599), disclosed: z.boolean().nullable(), blocked: z.boolean().nullable() }),
  z.strictObject({ ...observation, source: z.literal("client"), kind: z.literal("disclosure"), disclosed: z.boolean() }),
  z.strictObject({ ...observation, source: z.literal("backend"), kind: z.literal("execution"), executed: z.boolean() }),
]);

const detectorObservation = z.discriminatedUnion("kind", [
  z.strictObject({ ...observation, source: z.literal("fixture"), kind: z.literal("route"),
    ordinal, method: z.literal("GET"), path: z.string().max(120), listed: z.boolean() }),
  z.strictObject({ ...observation, source: z.literal("agent-detection"), kind: z.literal("verdict"),
    ordinal, rule: z.enum(["R1", "R2", "R3"]), reason: z.string().min(1) }),
]);

const RecordedBankRun = z.strictObject({
  id,
  kind: z.literal("recorded-bank"),
  trials: z.array(z.strictObject({
    id, ordinal, profile: z.enum(["scripted", "benign"]), arm: z.enum(["direct", "protected"]),
    observations: z.array(bankObservation).min(1),
  })).min(1),
});

export const SyntheticDetectorRun = z.strictObject({
  id,
  kind: z.literal("synthetic-detector"),
  trials: z.array(z.strictObject({
    id, ordinal, profile: z.enum(["benign", "unlisted"]),
    observations: z.array(detectorObservation).min(1),
  })).min(1),
});

export const EvidenceDemoBundle = z.strictObject({
  version: z.literal(1),
  runs: z.tuple([RecordedBankRun, SyntheticDetectorRun]),
}).refine(({ runs }) => {
  const seen = new Set<string>();
  const unique = (value: string) => !seen.has(value) && Boolean(seen.add(value));
  return runs.every((run) => unique(run.id) && run.trials.every((trial) =>
    unique(trial.id) && trial.observations.every((event, index) =>
      unique(event.id) && event.runId === run.id && event.trialId === trial.id && event.sequence === index + 1,
    ),
  ));
}, "Run, trial, and event IDs must be unique, and observations must be ordered within their own trial");

export type EvidenceDemoBundle = z.infer<typeof EvidenceDemoBundle>;
export type RecordedBankRun = z.infer<typeof RecordedBankRun>;
export type SyntheticDetectorRun = z.infer<typeof SyntheticDetectorRun>;
export type DemoObservation = z.infer<typeof bankObservation> | z.infer<typeof detectorObservation>;

export const EvidenceDemoEvaluation = z.strictObject({
  planner: z.enum(["completed", "unconfigured", "failed"]),
  first: z.enum(["benign", "unlisted"]),
  detector: SyntheticDetectorRun.nullable(),
  research: z.strictObject({
    status: z.enum(["completed", "unconfigured", "failed", "no_finding"]),
    source: z.url().nullable(),
    evidenceIds: z.array(id),
    mitigations: z.array(z.string().max(400)).max(4),
  }),
});
export type EvidenceDemoEvaluation = z.infer<typeof EvidenceDemoEvaluation>;

export const services = {
  bruma: { name: "Bruma Print Works", sector: "Print studio", cve: "CVE-2026-118662", url: "https://github.com/advisories/GHSA-8g5g-mxqh-grgj", effect: "Internal document reference in a response body" },
  litoral: { name: "Litoral Freight", sector: "Coastal logistics", cve: "CVE-2025-55182", url: "https://react.dev/blog/2025/12/03/critical-security-vulnerability-in-react-server-components", effect: "Receipt reference in a response header" },
  surco: { name: "Surco Rooms", sector: "Rehearsal studios", cve: "CVE-2025-29927", url: "https://github.com/advisories/GHSA-f82v-jwr5-mffw", effect: "Sensitive record in an otherwise ordinary response" },
} as const;

export type Service = keyof typeof services | "other";
export type Plane = "extproc" | "revproxy";
export type Arm = "direct" | "original" | "patched" | "protected";
export type Traffic = "disclosure-fixture" | "request-indicator" | "legitimate" | "unlabelled-control";
export type ResearchStatus = "fixture-analogue" | "potential-match" | "verified-version" | "unresolved" | "pending" | "provider-error" | "not-configured";

export interface Observation {
  status: number;
  upstreamHits: number;
  bodyEvidence: boolean;
  headerEvidence: boolean;
}

export interface Research {
  status: ResearchStatus;
  source?: string;
  cve?: string;
  retrievedAt?: string;
  title?: string;
  note: string;
  cached?: boolean;
  fix?: string;
  affected?: string;
}

export interface EvidenceEvent {
  time?: string;
  kind: "request" | "response" | "contain" | "rule_installed" | "alert_created" | "alert_delivery" | "research" | "wire" | "historical-rule";
  route: string;
  actor?: string;
  method?: string;
  symbol?: string;
  pattern?: string;
  level?: string;
  action?: string;
  reason?: string;
  signals?: string[];
  rule?: string;
  expiresAt?: string;
  elapsedMs?: number;
  status?: number;
  incident?: string;
  research?: Research;
  payload?: { state: "recorded" | "partial" | "archive-full" | "write-failed"; bodyBytes: number; sha256?: string };
}

export interface TraceLink {
  trace: string;
  confidence: "rule-linked" | "inferred";
  reason: string;
  gapSeconds?: number;
}

export interface EvidenceTrace {
  id: string;
  run: string;
  time?: string;
  plane: Plane;
  service: Service;
  arm: Arm;
  route: string;
  case: string;
  label?: Traffic;
  observed?: Observation;
  events: EvidenceEvent[];
  legacy?: boolean;
  hasPayload?: boolean;
  related?: TraceLink[];
}

export interface EvidenceRun {
  id: string;
  title: string;
  mode: "replay" | "live";
  provenance: string;
  traces: EvidenceTrace[];
}

export const pipelineStages = ["inputs", "traffic", "fixtures", "scoring", "research", "ticket"] as const;
export const pipelineCases = ["receipt-body", "receipt-body-variant", "path-indicator", "receipt-header", "duplicate-header",
  "script-indicator", "receipt-record", "unlabelled-record", "middleware-indicator", "pipeline-customer"] as const;
export type Project = keyof typeof services;
export type PipelineStage = typeof pipelineStages[number];
export type StageStatus = "pending" | "running" | "passed" | "failed" | "degraded";

export interface PipelineObservation {
  trace: string;
  status: number;
  hits: number;
  evidence: boolean;
  detected: boolean | null;
  decision?: string | null;
  rule?: string | null;
}

export interface PipelineScore {
  detected: boolean;
  contained: boolean;
  executed: boolean;
  directEvidence: boolean;
  proxyEvidence: boolean;
}
export interface PipelineFixture {
  id: string;
  weakness: string;
  cve?: string;
  A: PipelineObservation;
  B: PipelineObservation;
  retry: PipelineObservation;
  rule: string | null;
  expected: PipelineScore;
  actual: PipelineScore;
  passed: boolean;
}

export interface PipelineIncident {
  id: string;
  cases: string[];
  cve?: string;
  advisory?: Research;
  draft?: string;
}

export interface PipelineProject {
  project: Project;
  evidenceRun?: string;
  stages: Record<PipelineStage, { status: StageStatus; time?: string; detail?: string }>;
  customers?: Record<"A" | "B", (PipelineObservation & { passed: boolean })[]>;
  fixtures?: PipelineFixture[];
  incidents: PipelineIncident[];
}

export interface PipelineRun {
  id: string;
  mode: "real" | "reproduce";
  status: "running" | "completed" | "failed";
  source?: string;
  started: string;
  finished?: string;
  projects: PipelineProject[];
  inputs?: { notes: string[]; first: string; provider: string };
  error?: string;
}

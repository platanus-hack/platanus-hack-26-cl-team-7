import type { CaseFile, Hypothesis, ReportScope, RequestRow, TokenUsage } from "@sentinel/contracts";
import type { createReportTools } from "./tools.ts";

export type ReportTools = ReturnType<typeof createReportTools>;

/** What one agent call returns. `output` is unchecked: the service validates it with the contract schema. */
export interface ModelCall {
  output: unknown;
  model: string;
  tokens: TokenUsage;
}

/** The seam between the report service and the language models. Tests use a fake; mastra.ts is the real one. */
export interface ReportModel {
  /** Forensic analyst: reads the logs through the scoped tools and returns a CaseFile. */
  analyze(input: { scope: ReportScope; tools: ReportTools }): Promise<ModelCall>;
  /** AppSec engineer: proposes one fix as a Hypothesis, or revises `previous` after a human refusal. */
  propose(input: { caseFile: CaseFile; evidence: RequestRow[]; previous: Hypothesis | null; refusal: string | null }): Promise<ModelCall>;
}

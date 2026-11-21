import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import {
  CaseFile,
  Hypothesis,
  REPORT_LIMITS,
  type DecisionRequest,
  type Report,
  type ReportScope,
  type ReportSummary,
  type RequestRow,
  type TokenUsage,
} from "@sentinel/contracts";
import type { Store } from "../store.ts";
import { checkCaseFile, checkConflicts } from "./evidence.ts";
import type { ModelCall, ReportModel } from "./model.ts";
import { ReportRepo, type RunRow } from "./repo.ts";
import { buildScope, listAll, scopedLookup } from "./scope.ts";
import { byTime, type LogSources } from "./sources.ts";
import { buildTimeline, capRows } from "./timeline.ts";
import { createReportTools } from "./tools.ts";

export interface ReportServiceOptions {
  store: Store;
  sources: LogSources;
  model: ReportModel;
  db: DatabaseSync;
  now?: () => number;
}

type Validated<T> = { value: T; model: string; tokens: TokenUsage };

const sum = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ input: a.input + b.input, output: a.output + b.output });
const merge = (...lists: RequestRow[][]): RequestRow[] => [...new Map(lists.flat().map((r) => [r.id, r])).values()].sort(byTime);

/** A failed agent run. `tokens` is what the calls before the failure used. */
class ModelRunError extends Error {
  readonly tokens: TokenUsage;

  constructor(message: string, tokens: TokenUsage) {
    super(message);
    this.name = "ModelRunError";
    this.tokens = tokens;
  }
}

/** A message that is safe to show in the dashboard: no URLs, short. */
function safeMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/https?:\/\/\S+/g, "<url>").slice(0, 200) || "The model call failed.";
}

/**
 * Runs the two agents and keeps the report. `create` and a refusal in `decide` return at once;
 * the agents run in the background and the report moves on in the database.
 */
export class ReportService {
  private readonly store: Store;
  private readonly sources: LogSources;
  private readonly model: ReportModel;
  private readonly repo: ReportRepo;
  private readonly now: () => number;
  private readonly runs = new Map<string, Promise<void>>();

  constructor({ store, sources, model, db, now = Date.now }: ReportServiceOptions) {
    this.store = store;
    this.sources = sources;
    this.model = model;
    this.now = now;
    this.repo = new ReportRepo(db);
    this.repo.failInterrupted(now());
  }

  get(id: string): Report | null {
    return this.repo.get(id);
  }

  list(opts: { ip?: string } = {}): ReportSummary[] {
    return this.repo.list(opts.ip);
  }

  /** Resolves when no background run is active for this report. */
  async idle(id: string): Promise<void> {
    for (let run = this.runs.get(id); run; run = this.runs.get(id)) await run;
  }

  /**
   * Starts a report for this IP, or returns the open one (`created: false`): running, or waiting for a
   * decision with revisions left. A report at the revision limit is not open, so a new one can start.
   */
  create(ip: string): { report: Report; created: boolean } | { error: "NOT_FOUND" } {
    const open = this.repo.findOpen(ip, REPORT_LIMITS.revisions);
    if (open) return { report: open, created: false };
    const scope = buildScope(this.store, ip);
    if (!scope) return { error: "NOT_FOUND" };
    const at = this.now();
    const run: RunRow = { id: randomUUID(), scope, status: "investigating", createdAt: at, updatedAt: at, caseFile: null, evidence: [], timeline: [], analystModel: null, analystTokens: null, error: null };
    this.repo.save(run);
    this.start(run.id, () => this.investigate(run.id, scope));
    return { report: { ...run, revisions: [] }, created: true };
  }

  decide(id: string, body: DecisionRequest): Report | { error: "NOT_FOUND" | "BAD_STATE" | "REVISION_LIMIT" } {
    const report = this.repo.get(id);
    if (!report) return { error: "NOT_FOUND" };
    const last = report.revisions.at(-1);
    if (report.status !== "awaiting_decision" || !last || !report.caseFile) return { error: "BAD_STATE" };
    const at = this.now();
    if (body.decision === "approve") {
      this.repo.setDecision(id, last.n, { kind: "approve", reason: null, at });
      this.update(id, { status: "approved" });
    } else {
      if (report.revisions.length >= REPORT_LIMITS.revisions) return { error: "REVISION_LIMIT" };
      this.repo.setDecision(id, last.n, { kind: "refuse", reason: body.reason, at });
      this.update(id, { status: "revising" });
      const { caseFile, evidence } = report;
      this.start(id, () => this.revise(id, { caseFile, evidence, previous: last.hypothesis, refusal: body.reason }, last.n + 1));
    }
    return this.repo.get(id) ?? { error: "NOT_FOUND" };
  }

  /* --------------------------- background work --------------------------- */

  private start(id: string, work: () => Promise<void>): void {
    const run: Promise<void> = work()
      .catch((err) => this.fail(id, err))
      .finally(() => {
        if (this.runs.get(id) === run) this.runs.delete(id);
      });
    this.runs.set(id, run);
  }

  private fail(id: string, err: unknown): void {
    const message = safeMessage(err);
    console.error(`[reports] ${id} failed: ${message}`);
    try {
      this.update(id, { status: "failed", error: message });
    } catch (writeErr) {
      console.error(`[reports] ${id} could not be marked failed: ${safeMessage(writeErr)}`);
    }
  }

  /** Writes the run row again with some fields changed. */
  private update(id: string, patch: Partial<RunRow>): void {
    const current = this.repo.get(id);
    if (!current) return;
    const { revisions: _revisions, ...run } = current;
    this.repo.save({ ...run, ...patch, updatedAt: this.now() });
  }

  /**
   * Calls an agent, checks its output with the contract schema and calls once more when it does not match.
   * Tokens of both calls are added. A failure carries the tokens spent so far (see ModelRunError).
   */
  private async validated<T>(schema: z.ZodType<T>, call: () => Promise<ModelCall>): Promise<Validated<T>> {
    let tokens: TokenUsage = { input: 0, output: 0 };
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const result = await call();
        tokens = sum(tokens, result.tokens);
        const parsed = schema.safeParse(result.output);
        if (parsed.success) return { value: parsed.data, model: result.model, tokens };
      }
    } catch (err) {
      throw new ModelRunError(err instanceof Error ? err.message : String(err), tokens);
    }
    throw new ModelRunError("The model answer did not match the report schema after two tries.", tokens);
  }

  private async investigate(id: string, scope: ReportScope): Promise<void> {
    const analysis = await this.validated(CaseFile, () => this.model.analyze({ scope, tools: createReportTools(this.sources, scope) })).catch((err: unknown) => {
      // A failed analyst run still cost tokens: keep them on the failed report. A failed engineer run has no
      // revision row to hold its tokens (a revision needs a hypothesis), so those are not stored.
      if (err instanceof ModelRunError && err.tokens.input + err.tokens.output > 0) this.update(id, { analystTokens: err.tokens });
      throw err;
    });
    const checked = checkCaseFile(analysis.value, scopedLookup(this.sources, scope));
    const rows = capRows(merge(listAll(this.sources, scope).rows, checked.rows), checked.rows.map((r) => r.id));
    this.update(id, {
      caseFile: checked.caseFile,
      evidence: checked.rows,
      timeline: buildTimeline(rows, checked.caseFile),
      analystModel: analysis.model,
      analystTokens: analysis.tokens,
    });
    await this.revise(id, { caseFile: checked.caseFile, evidence: checked.rows, previous: null, refusal: null }, 1);
  }

  /** One engineer call, saved as revision `n`. The report then waits for a human. */
  private async revise(id: string, input: Parameters<ReportModel["propose"]>[0], n: number): Promise<void> {
    const proposal = await this.validated(Hypothesis, () => this.model.propose(input));
    const report = this.repo.get(id);
    if (!report) return;
    const checked = checkConflicts(proposal.value, scopedLookup(this.sources, report.scope));
    this.repo.saveRevision(id, { n, hypothesis: checked.hypothesis, createdAt: this.now(), model: proposal.model, tokens: proposal.tokens, decision: null });
    this.update(id, { status: "awaiting_decision", evidence: merge(report.evidence, checked.rows) });
  }
}

import type { DatabaseSync } from "node:sqlite";
import {
  CaseFile,
  Decision,
  Hypothesis,
  ReportScope,
  ReportStatus,
  ReportVerdict,
  RequestRow,
  TimelinePoint,
  TokenUsage,
  type Report,
  type ReportSummary,
  type Revision,
} from "@sentinel/contracts";
import { z } from "zod";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS report_runs (
    id TEXT PRIMARY KEY, ip TEXT NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
    case_file TEXT, evidence TEXT NOT NULL, timeline TEXT NOT NULL,
    analyst_model TEXT, analyst_tokens TEXT, error TEXT
  );
  CREATE INDEX IF NOT EXISTS report_runs_ip ON report_runs (ip, created_at);
  CREATE TABLE IF NOT EXISTS report_revisions (
    report_id TEXT NOT NULL, n INTEGER NOT NULL, hypothesis TEXT NOT NULL, created_at INTEGER NOT NULL,
    model TEXT NOT NULL, tokens TEXT NOT NULL, decision TEXT,
    PRIMARY KEY (report_id, n)
  );
`;

/** A report without its revisions: the run row. */
export type RunRow = Omit<Report, "revisions">;

interface RunRecord {
  id: string;
  scope: string;
  status: string;
  created_at: number;
  updated_at: number;
  case_file: string | null;
  evidence: string;
  timeline: string;
  analyst_model: string | null;
  analyst_tokens: string | null;
  error: string | null;
}
interface RevisionRecord {
  n: number;
  hypothesis: string;
  created_at: number;
  model: string;
  tokens: string;
  decision: string | null;
}

const json = (v: unknown) => JSON.stringify(v);
const orNull = <T>(text: string | null, schema: z.ZodType<T>): T | null => (text === null ? null : schema.parse(JSON.parse(text)));

/** Reports live in their own tables in the Reaper database. Rows are parsed with the contract schemas on the way out. */
export class ReportRepo {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec(SCHEMA);
  }

  save(run: RunRow): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO report_runs (id, ip, scope, status, created_at, updated_at, case_file, evidence, timeline, analyst_model, analyst_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.scope.ip,
        json(run.scope),
        run.status,
        run.createdAt,
        run.updatedAt,
        run.caseFile ? json(run.caseFile) : null,
        json(run.evidence),
        json(run.timeline),
        run.analystModel,
        run.analystTokens ? json(run.analystTokens) : null,
        run.error,
      );
  }

  saveRevision(reportId: string, r: Revision): void {
    this.db
      .prepare("INSERT OR REPLACE INTO report_revisions (report_id, n, hypothesis, created_at, model, tokens, decision) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(reportId, r.n, json(r.hypothesis), r.createdAt, r.model, json(r.tokens), r.decision ? json(r.decision) : null);
  }

  setDecision(reportId: string, n: number, decision: Decision): void {
    this.db.prepare("UPDATE report_revisions SET decision = ? WHERE report_id = ? AND n = ?").run(json(decision), reportId, n);
  }

  get(id: string): Report | null {
    const run = this.db.prepare("SELECT * FROM report_runs WHERE id = ?").get(id) as unknown as RunRecord | undefined;
    if (!run) return null;
    const revisions = this.db.prepare("SELECT n, hypothesis, created_at, model, tokens, decision FROM report_revisions WHERE report_id = ? ORDER BY n").all(id) as unknown as RevisionRecord[];
    return {
      id: run.id,
      scope: ReportScope.parse(JSON.parse(run.scope)),
      status: ReportStatus.parse(run.status),
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      caseFile: orNull(run.case_file, CaseFile),
      evidence: z.array(RequestRow).parse(JSON.parse(run.evidence)),
      timeline: z.array(TimelinePoint).parse(JSON.parse(run.timeline)),
      revisions: revisions.map((r) => ({
        n: r.n,
        hypothesis: Hypothesis.parse(JSON.parse(r.hypothesis)),
        createdAt: r.created_at,
        model: r.model,
        tokens: TokenUsage.parse(JSON.parse(r.tokens)),
        decision: orNull(r.decision, Decision),
      })),
      analystModel: run.analyst_model,
      analystTokens: orNull(run.analyst_tokens, TokenUsage),
      error: run.error,
    };
  }

  /**
   * The report for this IP that still waits on an agent or a human, if any. A report awaiting a decision that
   * already holds `maxRevisions` revisions cannot go further (a refusal gets REVISION_LIMIT), so it is not open.
   * `approved` and `failed` reports are never open.
   */
  findOpen(ip: string, maxRevisions: number): Report | null {
    const row = this.db
      .prepare(
        `SELECT id FROM report_runs r
         WHERE ip = ?1 AND (status IN ('investigating', 'revising')
           OR (status = 'awaiting_decision' AND (SELECT COUNT(*) FROM report_revisions v WHERE v.report_id = r.id) < ?2))
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(ip, maxRevisions) as unknown as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  /** Newest first, at most 50. */
  list(ip?: string): ReportSummary[] {
    const rows = this.db
      .prepare(
        `SELECT id, scope, status, created_at, updated_at, json_extract(case_file, '$.verdict') AS verdict,
                (SELECT COUNT(*) FROM report_revisions v WHERE v.report_id = report_runs.id) AS revisions
         FROM report_runs WHERE (?1 IS NULL OR ip = ?1) ORDER BY created_at DESC, rowid DESC LIMIT 50`,
      )
      .all(ip ?? null) as unknown as (Pick<RunRecord, "id" | "scope" | "status" | "created_at" | "updated_at"> & { verdict: string | null; revisions: number })[];
    return rows.map((r) => ({
      id: r.id,
      scope: ReportScope.parse(JSON.parse(r.scope)),
      status: ReportStatus.parse(r.status),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      verdict: ReportVerdict.nullable().parse(r.verdict),
      revisions: r.revisions,
    }));
  }

  /** A run that was mid-flight when the process stopped cannot continue. */
  failInterrupted(now: number): void {
    this.db
      .prepare("UPDATE report_runs SET status = 'failed', error = 'Reaper restarted while this report was running.', updated_at = ? WHERE status IN ('investigating', 'revising')")
      .run(now);
  }
}

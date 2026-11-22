import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { ExperimentDetail, ExperimentEvent, ExperimentRun, type ExperimentEntry } from "@sentinel/contracts";

/** The aggregated baseline earlier versions seeded. It has no per-request traffic, so it is removed. */
const legacyBaselineId = "pipeline-6cc4c600c3cf4869be28b791";
/** A full live run of the four services, recorded with raw traffic: the panel works offline from it. */
const recording = new URL("./recorded-run.json", import.meta.url);
export const recordedSource = "apps/sentinel/src/experiments/recorded-run.json";

export class ExperimentStore {
  private readonly db: DatabaseSync;
  /** Finished runs that the patch step is still adding events to. */
  private readonly patching = new Set<string>();
  /** Emits a run id whenever that run's entries or status change, so event streams wake without polling. */
  readonly changes = new EventEmitter().setMaxListeners(0);

  constructor(db: DatabaseSync, readRecording = () => readFileSync(recording, "utf8")) {
    this.db = db;
    db.prepare("UPDATE experiment_runs SET status='interrupted', finished=?, error=? WHERE status='running'")
      .run(new Date().toISOString(), "Reaper se reinició durante la ejecución.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM experiment_entries WHERE run_id=?").run(legacyBaselineId);
      db.prepare("DELETE FROM experiment_runs WHERE id=?").run(legacyBaselineId);
      const { run, entries } = ExperimentDetail.parse(JSON.parse(readRecording()));
      const inserted = db.prepare("INSERT OR IGNORE INTO experiment_runs (id, mode, status, started, finished, source) VALUES (?, 'recorded', 'completed', ?, ?, ?)")
        .run(run.id, run.started, run.finished, recordedSource);
      if (inserted.changes) for (const entry of entries) db.prepare("INSERT INTO experiment_entries (run_id, seq, at, event) VALUES (?, ?, ?, ?)")
        .run(run.id, entry.seq, entry.at, JSON.stringify(entry.event));
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  list() {
    return this.db.prepare(`SELECT r.*, (SELECT CASE WHEN COUNT(DISTINCT json_extract(e.event, '$.project')) = 1
        THEN MIN(json_extract(e.event, '$.project')) END
      FROM experiment_entries AS e WHERE e.run_id = r.id) AS project
      FROM experiment_runs AS r ORDER BY r.rowid DESC LIMIT 100`).all().map((row) => this.withPatching(ExperimentRun.parse(row)));
  }

  get(id: string) {
    const row = this.db.prepare("SELECT * FROM experiment_runs WHERE id=?").get(id);
    return row && this.withPatching(ExperimentRun.parse(row));
  }

  setPatching(id: string, on: boolean) {
    if (on) this.patching.add(id);
    else this.patching.delete(id);
    this.changes.emit(id);
  }

  entries(id: string, after = 0): ExperimentEntry[] {
    const rows = this.db.prepare("SELECT seq, at, event FROM experiment_entries WHERE run_id=? AND seq>? ORDER BY seq").all(id, after);
    return rows.map((row) => ({ seq: Number(row.seq), at: row.at === null ? null : String(row.at),
      event: ExperimentEvent.parse(JSON.parse(String(row.event))) }));
  }

  start(id: string) {
    this.db.prepare("INSERT INTO experiment_runs (id, mode, status, started) VALUES (?, 'live', 'running', ?)")
      .run(id, new Date().toISOString());
  }

  append(id: string, event: ExperimentEvent) {
    if (this.patching.has(id) || this.get(id)?.status === "running") this.write(id, event, new Date().toISOString());
  }

  finish(id: string, status: "completed" | "failed" | "interrupted", error: string | null = null) {
    this.db.prepare("UPDATE experiment_runs SET status=?, finished=?, error=? WHERE id=? AND status='running'")
      .run(status, new Date().toISOString(), error, id);
    this.changes.emit(id);
  }

  private withPatching(run: ExperimentRun): ExperimentRun {
    return this.patching.has(run.id) ? { ...run, patching: true } : run;
  }

  private write(id: string, event: ExperimentEvent, at: string | null) {
    this.db.prepare(`INSERT INTO experiment_entries (run_id, seq, at, event)
      SELECT ?, COALESCE(MAX(seq), 0)+1, ?, ? FROM experiment_entries WHERE run_id=?`)
      .run(id, at, JSON.stringify(ExperimentEvent.parse(event)), id);
    this.changes.emit(id);
  }
}

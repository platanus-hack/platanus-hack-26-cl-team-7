import type { DatabaseSync } from "node:sqlite";
import { ExperimentEvent, ExperimentRun, type ExperimentEntry } from "@sentinel/contracts";

const baselineId = "pipeline-6cc4c600c3cf4869be28b791";
const tally = (yes: number, total = 3) => ({ yes, total });
const baseline = [
  { project: "bruma", disclosures: 0, detections: 3, containments: 2 },
  { project: "litoral", disclosures: 0, detections: 3, containments: 2 },
  { project: "surco", disclosures: 1, detections: 2, containments: 1 },
] as const;

export class ExperimentStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
    db.prepare("UPDATE experiment_runs SET status='interrupted', finished=?, error=? WHERE status='running'")
      .run(new Date().toISOString(), "Sentinel se reinició durante la ejecución.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const inserted = db.prepare("INSERT OR IGNORE INTO experiment_runs (id, mode, status, source) VALUES (?, 'recorded', 'completed', ?)")
        .run(baselineId, "related_experiments/ultimo-paso/scoreboard/evidence/PIPELINE.md");
      db.prepare("UPDATE experiment_runs SET source=? WHERE id=? AND source=?")
        .run("related_experiments/ultimo-paso/scoreboard/evidence/PIPELINE.md", baselineId, "ultimo-paso/scoreboard/evidence/PIPELINE.md");
      if (inserted.changes) {
        for (const item of baseline) this.write(baselineId, {
          kind: "baseline", project: item.project, direct: tally(2), protected: tally(item.disclosures),
          detected: tally(item.detections), installed: tally(item.containments), executed: tally(item.containments),
          legitimateA: tally(3), legitimateB: tally(3),
        }, null);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  list() {
    return this.db.prepare("SELECT * FROM experiment_runs ORDER BY rowid DESC LIMIT 100").all().map((row) => ExperimentRun.parse(row));
  }

  get(id: string) {
    const row = this.db.prepare("SELECT * FROM experiment_runs WHERE id=?").get(id);
    return row && ExperimentRun.parse(row);
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
    if (this.get(id)?.status === "running") this.write(id, event, new Date().toISOString());
  }

  finish(id: string, status: "completed" | "failed" | "interrupted", error: string | null = null) {
    this.db.prepare("UPDATE experiment_runs SET status=?, finished=?, error=? WHERE id=? AND status='running'")
      .run(status, new Date().toISOString(), error, id);
  }

  private write(id: string, event: ExperimentEvent, at: string | null) {
    this.db.prepare(`INSERT INTO experiment_entries (run_id, seq, at, event)
      SELECT ?, COALESCE(MAX(seq), 0)+1, ?, ? FROM experiment_entries WHERE run_id=?`)
      .run(id, at, JSON.stringify(ExperimentEvent.parse(event)), id);
  }
}

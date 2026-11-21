import type { DatabaseSync } from "node:sqlite";

/**
 * Versioned SQLite schema. `PRAGMA user_version` records the last step applied;
 * each step runs once, in order, inside one transaction with the version bump.
 */
interface Step {
  version: number;
  sql: string;
}

const STEPS: Step[] = [
  {
    // Version 1 kept no counters. Its rows cannot rebuild them, so start fresh.
    version: 2,
    sql: `
      DROP TABLE IF EXISTS events; DROP TABLE IF EXISTS attackers; DROP TABLE IF EXISTS buckets; DROP TABLE IF EXISTS reports;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, seq INTEGER NOT NULL, ts INTEGER NOT NULL, ip TEXT NOT NULL,
        method TEXT NOT NULL, path TEXT NOT NULL, payload TEXT NOT NULL, attack_type TEXT NOT NULL,
        status TEXT NOT NULL, source TEXT NOT NULL, confidence REAL NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_ts ON events (ts);
      CREATE INDEX IF NOT EXISTS events_seq ON events (seq);
      CREATE TABLE IF NOT EXISTS attackers (
        ip TEXT PRIMARY KEY, user_agent TEXT, country TEXT, country_code TEXT, city TEXT, network TEXT,
        first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL, events INTEGER NOT NULL, killed INTEGER NOT NULL,
        not_killed INTEGER NOT NULL, types TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS attackers_last_seen ON attackers (last_seen);
      CREATE TABLE IF NOT EXISTS buckets (t INTEGER PRIMARY KEY, received INTEGER NOT NULL, killed INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS blocks (ip TEXT PRIMARY KEY, blocked_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS reports (ip TEXT PRIMARY KEY, summary TEXT NOT NULL, generated_at INTEGER NOT NULL, model TEXT NOT NULL);
    `,
  },
  {
    // Deception: the append-only event log, keyed by the router's idempotency key, and two projections.
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS deception_events (
        event_id TEXT PRIMARY KEY, type TEXT NOT NULL, track_id TEXT NOT NULL, ts INTEGER NOT NULL,
        body_hash TEXT NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS deception_events_track ON deception_events (track_id, type, ts);
      CREATE INDEX IF NOT EXISTS deception_events_ts ON deception_events (ts);
      CREATE TABLE IF NOT EXISTS tracks (
        track_id TEXT PRIMARY KEY, ip TEXT, user_agent TEXT, rule TEXT, reason TEXT, keys TEXT NOT NULL,
        opened_at INTEGER, last_seen INTEGER NOT NULL, actions INTEGER NOT NULL, findings INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tracks_last_seen ON tracks (last_seen, track_id);
      CREATE TABLE IF NOT EXISTS findings (
        finding_id TEXT PRIMARY KEY, track_id TEXT NOT NULL, ts INTEGER NOT NULL, kind TEXT NOT NULL,
        endpoint TEXT NOT NULL, evidence TEXT NOT NULL,
        proposal_summary TEXT, proposal_model TEXT, proposal_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS findings_ts ON findings (ts, finding_id);
      CREATE INDEX IF NOT EXISTS findings_track ON findings (track_id, ts);
    `,
  },
  {
    // When the AI gave up on a finding's fix proposal, so the dashboard stops showing it as being written.
    version: 4,
    sql: "ALTER TABLE findings ADD COLUMN proposal_failed_at INTEGER;",
  },
];

export const SCHEMA_VERSION = STEPS[STEPS.length - 1]!.version;

/** Brings the database to SCHEMA_VERSION. Safe to call more than once. */
export function migrate(db: DatabaseSync): void {
  db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  const due = STEPS.filter((s) => s.version > current);
  if (due.length === 0) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const step of due) db.exec(step.sql);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

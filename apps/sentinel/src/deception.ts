import { createHash } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import {
  MAX_TRACK_ACTIONS,
  RANGE_MS,
  type DeceptionBatch,
  type DeceptionEvent,
  type Finding,
  type FindingPage,
  type FixProposal,
  type PageQuery,
  type Track,
  type TrackAction,
  type TrackDetail,
  type TrackKey,
  type TrackPage,
} from "@sentinel/contracts";
import type { Bus } from "./bus.ts";
import { migrate } from "./schema.ts";

const RETAIN_MS = RANGE_MS["24h"];
/** A router timestamp further ahead than this is replaced by the server clock, so it cannot pin a track to the top. */
const FUTURE_SKEW_MS = 30_000;
/** Keys kept on a track row. Later links stay in the event log; the first ones (ip, ip_ua) matter most. */
const MAX_TRACK_KEYS = 64;

export type IngestOutcome = { ok: true; accepted: number; duplicates: number } | { ok: false; reusedEventId: string };

/** A page cursor that this server did not write. */
export class CursorError extends Error {}

interface TrackRow {
  track_id: string;
  ip: string;
  user_agent: string;
  rule: Track["rule"];
  reason: string;
  keys: string;
  opened_at: number;
  last_seen: number;
  actions: number;
  findings: number;
}

interface FindingRow {
  finding_id: string;
  track_id: string;
  ts: number;
  kind: Finding["kind"];
  endpoint: string;
  evidence: string;
  proposal_summary: string | null;
  proposal_model: string | null;
  proposal_at: number | null;
}

type ActionBody = Omit<Extract<DeceptionEvent, { type: "track.action" }>, "type" | "eventId" | "trackId" | "ts">;

/**
 * Deception events from the mirror router. Every event lands once in the append-only
 * `deception_events` log (eventId is the idempotency key, the body hash tells a retry
 * from a reused key), and the same transaction updates the `tracks` and `findings`
 * projections the dashboard reads. Changes go to the bus after commit.
 */
export class DeceptionStore {
  private readonly db: DatabaseSync;
  private readonly bus: Bus;
  private readonly now: () => number;
  private readonly sql: ReturnType<typeof statements>;

  constructor(db: DatabaseSync, bus: Bus, { now = Date.now }: { now?: () => number } = {}) {
    migrate(db);
    this.db = db;
    this.bus = bus;
    this.now = now;
    this.sql = statements(db);
  }

  /* ----------------------------- writes ----------------------------- */

  /** All or nothing: one reused eventId rolls the whole batch back. */
  ingest(batch: DeceptionBatch): IngestOutcome {
    const now = this.now();
    const tracks = new Set<string>();
    const findings: string[] = [];
    let accepted = 0;
    let duplicates = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const event of batch) {
        // The parsed event has the schema's key order, so a retry hashes the same however it was spelled.
        const body = JSON.stringify(event);
        const hash = createHash("sha256").update(body).digest("hex");
        const prior = this.sql.hashOf.get(event.eventId) as { body_hash: string } | undefined;
        if (prior?.body_hash === hash) {
          duplicates++;
          continue;
        }
        if (prior) {
          this.db.exec("ROLLBACK");
          return { ok: false, reusedEventId: event.eventId };
        }
        const ts = event.ts > now + FUTURE_SKEW_MS ? now : event.ts;
        this.sql.insertEvent.run(event.eventId, event.type, event.trackId, ts, hash, body);
        const finding = this.project(event, ts);
        if (finding) findings.push(finding);
        tracks.add(event.trackId);
        accepted++;
      }
      this.db.exec("COMMIT");
    } catch (err) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw err;
    }
    for (const id of tracks) {
      const track = this.trackById(id);
      if (track) this.bus.publish({ kind: "track", track });
    }
    for (const id of findings) {
      const finding = this.finding(id);
      if (finding) this.bus.publish({ kind: "finding", finding });
    }
    return { ok: true, accepted, duplicates };
  }

  /** Updates the projections for one new event. Returns the id of a finding it created. */
  private project(event: DeceptionEvent, ts: number): string | null {
    const id = event.trackId;
    this.sql.touchTrack.run(id, ts);
    switch (event.type) {
      case "track.opened":
        // The earliest opening wins, whatever order the events arrive in.
        this.sql.openTrack.run(event.ip, event.userAgent, event.rule, event.reason, ts, id, ts);
        this.addKeys(id, event.keys);
        return null;
      case "track.linked":
        this.addKeys(id, [event.key]);
        return null;
      case "track.action":
        this.sql.countAction.run(id);
        return null;
      case "finding.confirmed": {
        const r = this.sql.insertFinding.run(event.findingId, id, ts, event.kind, event.endpoint, event.evidence);
        if (r.changes === 0) return null;
        this.sql.countFinding.run(id);
        return event.findingId;
      }
    }
  }

  private addKeys(trackId: string, add: TrackKey[]): void {
    const row = this.sql.keysOf.get(trackId) as { keys: string };
    const keys = JSON.parse(row.keys) as TrackKey[];
    const seen = new Set(keys.map((k) => `${k.kind}:${k.value}`));
    for (const k of add) {
      if (keys.length >= MAX_TRACK_KEYS) break;
      if (seen.has(`${k.kind}:${k.value}`)) continue;
      seen.add(`${k.kind}:${k.value}`);
      keys.push(k);
    }
    this.sql.setKeys.run(JSON.stringify(keys), trackId);
  }

  /** Stores the AI's fix proposal and streams the updated finding. False when the finding is gone. */
  setProposal(findingId: string, proposal: FixProposal): boolean {
    const r = this.sql.setProposal.run(proposal.summary, proposal.model, proposal.generatedAt, findingId);
    const finding = r.changes > 0 ? this.finding(findingId) : null;
    if (finding) this.bus.publish({ kind: "finding", finding });
    return !!finding;
  }

  /** Forgets rows older than the retention window. Store.prune() calls it every minute. */
  prune(now = this.now()): void {
    const cutoff = now - RETAIN_MS;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.sql.pruneEvents.run(cutoff);
      this.sql.pruneTracks.run(cutoff);
      this.sql.pruneFindings.run();
      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  /* ----------------------------- reads ------------------------------ */

  /** Tracks active in the range, most recently active first. */
  tracks(q: PageQuery): TrackPage {
    const rows = this.page(q, this.sql.tracksFirst, this.sql.tracksAfter) as unknown as TrackRow[];
    return paged(rows.map(toTrack), q.limit, (t) => [t.lastSeen, t.trackId]);
  }

  /** Findings confirmed in the range, newest first. */
  findings(q: PageQuery): FindingPage {
    const rows = this.page(q, this.sql.findingsFirst, this.sql.findingsAfter) as unknown as FindingRow[];
    return paged(rows.map(toFinding), q.limit, (f) => [f.ts, f.findingId]);
  }

  track(trackId: string): TrackDetail | null {
    const track = this.trackById(trackId);
    if (!track) return null;
    return { track, actions: this.actions(trackId, MAX_TRACK_ACTIONS), findings: this.trackFindings(trackId) };
  }

  /** Newest actions of a track first. */
  actions(trackId: string, limit: number): TrackAction[] {
    const rows = this.sql.actions.all(trackId, limit) as { event_id: string; track_id: string; ts: number; body: string }[];
    return rows.map((r) => {
      const { method, path, query, status, durationMs, requestBody, responseBody } = JSON.parse(r.body) as ActionBody;
      return { eventId: r.event_id, trackId: r.track_id, ts: r.ts, method, path, query, status, durationMs, requestBody, responseBody };
    });
  }

  finding(findingId: string): Finding | null {
    const row = this.sql.finding.get(findingId) as FindingRow | undefined;
    return row ? toFinding(row) : null;
  }

  /** Findings still waiting for a fix proposal, newest first. */
  unproposed(limit: number): Finding[] {
    return (this.sql.unproposed.all(this.now() - RETAIN_MS, limit) as unknown as FindingRow[]).map(toFinding);
  }

  private trackById(trackId: string): Track | null {
    const row = this.sql.track.get(trackId) as TrackRow | undefined;
    return row ? toTrack(row) : null;
  }

  private trackFindings(trackId: string): Finding[] {
    return (this.sql.trackFindings.all(trackId) as unknown as FindingRow[]).map(toFinding);
  }

  /** One extra row tells whether another page exists. */
  private page(q: PageQuery, first: StatementSync, after: StatementSync) {
    const since = this.now() - RANGE_MS[q.range];
    if (!q.cursor) return first.all(since, q.limit + 1);
    const [at, id] = decodeCursor(q.cursor);
    return after.all(since, at, id, q.limit + 1);
  }
}

/** Every query the store runs, prepared once. */
function statements(db: DatabaseSync) {
  const p = (sql: string) => db.prepare(sql);
  return {
    hashOf: p("SELECT body_hash FROM deception_events WHERE event_id = ?"),
    insertEvent: p("INSERT INTO deception_events (event_id, type, track_id, ts, body_hash, body) VALUES (?, ?, ?, ?, ?, ?)"),
    touchTrack: p(`INSERT INTO tracks (track_id, keys, last_seen, actions, findings) VALUES (?, '[]', ?, 0, 0)
      ON CONFLICT (track_id) DO UPDATE SET last_seen = max(last_seen, excluded.last_seen)`),
    openTrack: p(`UPDATE tracks SET ip = ?, user_agent = ?, rule = ?, reason = ?, opened_at = ?
      WHERE track_id = ? AND (opened_at IS NULL OR opened_at > ?)`),
    keysOf: p("SELECT keys FROM tracks WHERE track_id = ?"),
    setKeys: p("UPDATE tracks SET keys = ? WHERE track_id = ?"),
    countAction: p("UPDATE tracks SET actions = actions + 1 WHERE track_id = ?"),
    insertFinding: p(`INSERT INTO findings (finding_id, track_id, ts, kind, endpoint, evidence) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (finding_id) DO NOTHING`),
    countFinding: p("UPDATE tracks SET findings = findings + 1 WHERE track_id = ?"),
    track: p("SELECT * FROM tracks WHERE track_id = ? AND opened_at IS NOT NULL"),
    tracksFirst: p(`SELECT * FROM tracks WHERE opened_at IS NOT NULL AND last_seen >= ?
      ORDER BY last_seen DESC, track_id DESC LIMIT ?`),
    tracksAfter: p(`SELECT * FROM tracks WHERE opened_at IS NOT NULL AND last_seen >= ? AND (last_seen, track_id) < (?, ?)
      ORDER BY last_seen DESC, track_id DESC LIMIT ?`),
    actions: p(`SELECT event_id, track_id, ts, body FROM deception_events WHERE track_id = ? AND type = 'track.action'
      ORDER BY ts DESC, event_id DESC LIMIT ?`),
    finding: p("SELECT * FROM findings WHERE finding_id = ?"),
    trackFindings: p("SELECT * FROM findings WHERE track_id = ? ORDER BY ts DESC, finding_id DESC"),
    findingsFirst: p("SELECT * FROM findings WHERE ts >= ? ORDER BY ts DESC, finding_id DESC LIMIT ?"),
    findingsAfter: p(`SELECT * FROM findings WHERE ts >= ? AND (ts, finding_id) < (?, ?)
      ORDER BY ts DESC, finding_id DESC LIMIT ?`),
    unproposed: p("SELECT * FROM findings WHERE proposal_summary IS NULL AND ts >= ? ORDER BY ts DESC LIMIT ?"),
    pruneEvents: p("DELETE FROM deception_events WHERE ts < ?"),
    pruneTracks: p("DELETE FROM tracks WHERE last_seen < ?"),
    pruneFindings: p("DELETE FROM findings WHERE track_id NOT IN (SELECT track_id FROM tracks)"),
    setProposal: p("UPDATE findings SET proposal_summary = ?, proposal_model = ?, proposal_at = ? WHERE finding_id = ?"),
  };
}

function paged<T>(items: T[], limit: number, keyOf: (item: T) => [number, string]) {
  const more = items.length > limit;
  if (more) items.length = limit;
  const last = items[items.length - 1];
  return { items, nextCursor: more && last ? encodeCursor(keyOf(last)) : null };
}

function encodeCursor(key: [number, string]): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

function decodeCursor(cursor: string): [number, string] {
  try {
    const key: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (Array.isArray(key) && key.length === 2 && Number.isInteger(key[0]) && typeof key[1] === "string") return [key[0] as number, key[1]];
  } catch {
    // Falls through to the error below.
  }
  throw new CursorError("cursor is not one this server returned");
}

function toTrack(r: TrackRow): Track {
  return {
    trackId: r.track_id,
    ip: r.ip,
    userAgent: r.user_agent,
    rule: r.rule,
    reason: r.reason,
    keys: JSON.parse(r.keys) as TrackKey[],
    openedAt: r.opened_at,
    lastSeen: r.last_seen,
    actions: r.actions,
    findings: r.findings,
  };
}

function toFinding(r: FindingRow): Finding {
  const proposal =
    r.proposal_summary !== null && r.proposal_model !== null && r.proposal_at !== null
      ? { summary: r.proposal_summary, model: r.proposal_model, generatedAt: r.proposal_at }
      : null;
  return {
    findingId: r.finding_id,
    trackId: r.track_id,
    ts: r.ts,
    kind: r.kind,
    endpoint: r.endpoint,
    evidence: r.evidence,
    proposal,
  };
}

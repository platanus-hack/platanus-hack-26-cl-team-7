import { DatabaseSync } from "node:sqlite";
import {
  ATTACK_TYPES,
  MAX_ATTACKERS,
  BUCKET_MS,
  RANGE_MS,
  type AttackEvent,
  type Attacker,
  type AttackerDetail,
  type AttackerReport,
  type AttackType,
  type EventStatus,
  type IngestEventParsed,
  type Range,
  type SeriesPoint,
  type Snapshot,
  type VerdictSource,
} from "@sentinel/contracts";
import type { Bus } from "./bus.ts";
import { EMPTY_GEO, fingerprint, geoFromHint, parseClient, type ClientInfo, type Geo } from "./enrich.ts";
import { migrate } from "./schema.ts";

/* ------------------------------ detection ----------------------------- */

export interface RuleVerdict {
  attackType: AttackType;
  /** 0..1. At or above KILL_THRESHOLD the request is killed at once. */
  confidence: number;
}

export const KILL_THRESHOLD = 0.8;

interface Rule {
  type: AttackType;
  confidence: number;
  test: RegExp;
}

// Ordered by specificity. The first match wins.
const RULES: Rule[] = [
  { type: "sql_injection", confidence: 0.97, test: /(\bunion\b[\s\S]{0,40}\bselect\b|'\s*or\s+'?\d+'?\s*=\s*'?\d+|;\s*drop\s+table|\bsleep\s*\(\s*\d+\s*\)|--\s*$|\/\*!?\d*|\bxp_cmdshell\b)/i },
  { type: "xss", confidence: 0.95, test: /(<\s*script\b|javascript\s*:|\bon(error|load|mouseover)\s*=|<\s*img[^>]+src\s*=\s*x|<\s*svg[^>]*\bonload)/i },
  { type: "path_traversal", confidence: 0.96, test: /((\.\.|%2e%2e)(\/|\\|%2f|%5c)){2,}|\/etc\/passwd|\bboot\.ini\b|\/proc\/self/i },
  { type: "jailbreak", confidence: 0.9, test: /\b(DAN|do anything now|developer mode|jailbreak(ed)?|no (ethical|moral) (guidelines|restrictions)|pretend (you are|to be) (an? )?(unfiltered|evil))\b/i },
  { type: "prompt_injection", confidence: 0.92, test: /\b(ignore|disregard|forget) (all |any )?(the )?(previous|prior|above|earlier) (instructions|rules|prompts?)\b|\breveal (your|the) (system )?prompt\b|\bsystem prompt\b|<\/?(system|instructions?)>/i },
];

/** Weaker signals that only mark a request as suspicious. AI (or a human) decides. */
const SOFT: Rule[] = [
  { type: "prompt_injection", confidence: 0.55, test: /\b(other users?|all users?|every (user|employee))('s)? (data|records|salar(y|ies)|payroll|emails?)\b|\bact as (the )?admin\b|\bbase64\b.*\bdecode\b|\bdecode\b.*\bbase64\b/i },
  { type: "sql_injection", confidence: 0.5, test: /('|%27)\s*(or|and)\s|\bselect\b.+\bfrom\b/i },
];

export function classify(path: string, payload: string): RuleVerdict | null {
  const text = safeDecode(`${path}\n${payload}`);
  for (const r of RULES) if (r.test.test(text)) return { attackType: r.type, confidence: r.confidence };
  for (const r of SOFT) if (r.test.test(text)) return { attackType: r.type, confidence: r.confidence };
  return null;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Sliding window of failed logins per IP. Five failures in 60 s marks the IP as
 * credential stuffing; from then on every failed login from it is killed.
 */
export class LoginWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 5, windowMs = 60_000) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Forgets IPs with no failed login inside the window. */
  prune(now: number): void {
    for (const [ip, list] of this.hits) if (now - (list[list.length - 1] ?? 0) >= this.windowMs) this.hits.delete(ip);
  }

  record(ip: string, ts: number): RuleVerdict {
    const list = (this.hits.get(ip) ?? []).filter((t) => ts - t < this.windowMs);
    list.push(ts);
    this.hits.set(ip, list);
    const n = list.length;
    return n >= this.limit
      ? { attackType: "credential_stuffing", confidence: 0.98 }
      : { attackType: "credential_stuffing", confidence: 0.3 + n * 0.08 };
  }
}

/* -------------------------------- store ------------------------------- */

const RETAIN_MS = RANGE_MS["24h"];
const BASE_BUCKET = 10_000; // Smallest bucket. Larger buckets sum these.
const MAX_EVENTS = 50_000;
/** Trim in chunks: removing from the front of a 50k array on every event would cost O(n) each time. */
const TRIM_CHUNK = 5_000;
const FUTURE_SKEW_MS = 30_000;
const PAYLOAD_KEEP = 2048;

const SEVERITY: Record<AttackType, number> = {
  prompt_injection: 30,
  jailbreak: 25,
  sql_injection: 28,
  xss: 18,
  path_traversal: 22,
  credential_stuffing: 26,
  unknown: 10,
};

/** An attacker as the API shows it, plus the raw client data the AI layer reads. */
export interface Profile extends Attacker {
  userAgent: string;
  fingerprint: string;
}

export interface StoreOptions {
  db?: DatabaseSync | null;
  now?: () => number;
  /** When true, events the rules cannot settle wait as "analyzing" for an AI verdict. */
  aiVerdicts?: boolean;
  /** Other stores that keep 24 h of rows. prune() runs theirs on the same schedule. */
  retained?: { prune(now: number): void }[];
}

interface AttackerState extends ClientInfo, Geo {
  ip: string;
  userAgent: string;
  fingerprint: string;
  firstSeen: number;
  lastSeen: number;
  events: number;
  killed: number;
  notKilled: number;
  types: Partial<Record<AttackType, number>>;
}

export interface IngestResult {
  id: string;
  status: EventStatus;
  attackType: AttackType;
}

export class Store {
  private readonly events_: AttackEvent[] = [];
  private readonly byId = new Map<string, AttackEvent>();
  private readonly attackers_ = new Map<string, AttackerState>();
  private readonly blocks_ = new Map<string, number>();
  private readonly reports = new Map<string, AttackerReport>();
  private readonly buckets = new Map<number, { received: number; killed: number }>();
  private readonly logins = new LoginWindow();
  private eventSeq = 0;
  private dirtyEvents = new Map<string, AttackEvent>();
  private dirtyAttackers = new Set<string>();
  private dirtyBuckets = new Set<number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly pruneTimer: NodeJS.Timeout | null = null;
  private closed = false;

  private readonly bus: Bus;
  private readonly db: DatabaseSync | null;
  private readonly now: () => number;
  private readonly aiVerdicts: boolean;
  private readonly retained: { prune(now: number): void }[];

  /** Every change is published to `bus`. Subscribe there to react to new events or attackers. */
  constructor(bus: Bus, { db = null, now = Date.now, aiVerdicts = false, retained = [] }: StoreOptions = {}) {
    this.bus = bus;
    this.db = db;
    this.now = now;
    this.aiVerdicts = aiVerdicts;
    this.retained = retained;
    if (db) {
      migrate(db);
      this.load(db);
    }
    this.pruneTimer = setInterval(() => this.prune(), 60_000);
    this.pruneTimer.unref();
  }

  /* ----------------------------- writes ----------------------------- */

  ingest(items: IngestEventParsed[]): IngestResult[] {
    const out: IngestResult[] = [];
    for (const item of items) out.push(this.ingestOne(item));
    return out;
  }

  private ingestOne(item: IngestEventParsed): IngestResult {
    // Gateway clocks are not trusted: a timestamp out of range would hide the event or pin it to the top.
    const now = this.now();
    const ts = item.ts && item.ts >= now - RETAIN_MS && item.ts <= now + FUTURE_SKEW_MS ? Math.min(item.ts, now) : now;
    const a = this.touchAttacker(item, ts);

    let attackType: AttackType = "unknown";
    let confidence = 0.2;
    let status: EventStatus;
    let source: VerdictSource = "rules";

    if (this.blocks_.has(item.ip)) {
      const rule = classify(item.path, item.payload);
      attackType = rule?.attackType ?? (item.failedLogin ? "credential_stuffing" : "unknown");
      confidence = 1;
      status = "killed";
      source = "block";
    } else {
      // Payload rules always run; a failed login adds the stuffing window. The stronger signal wins.
      const fromPayload = classify(item.path, item.payload);
      const fromLogin = item.failedLogin ? this.logins.record(item.ip, ts) : null;
      const rule = fromLogin && (!fromPayload || fromLogin.confidence > fromPayload.confidence) ? fromLogin : fromPayload;
      if (rule) ({ attackType, confidence } = rule);
      status = confidence >= KILL_THRESHOLD ? "killed" : this.aiVerdicts ? "analyzing" : "active";
    }

    const event: AttackEvent = {
      id: `${ts.toString(36)}-${(++this.eventSeq).toString(36)}`,
      seq: this.eventSeq,
      ts,
      ip: item.ip,
      method: item.method.toUpperCase(),
      path: item.path,
      payload: item.payload.slice(0, PAYLOAD_KEEP),
      attackType,
      status,
      source,
      confidence,
    };

    this.events_.push(event);
    this.byId.set(event.id, event);
    if (this.events_.length > MAX_EVENTS + TRIM_CHUNK) this.dropOldest(this.events_.length - MAX_EVENTS);

    const bucket = this.bucket(ts);
    bucket.received++;
    if (status === "killed") bucket.killed++;

    a.events++;
    a.types[attackType] = (a.types[attackType] ?? 0) + 1;
    if (status === "killed") a.killed++;
    if (status === "active") a.notKilled++;

    this.markDirty(event, a.ip);
    this.bus.publish({ kind: "event", event });
    this.publishAttacker(a.ip);
    return { id: event.id, status, attackType };
  }

  /** Settles an event that was "analyzing". Ignored if the event is gone or already settled. */
  settle(id: string, verdict: { status: "killed" | "active"; attackType: AttackType; confidence: number; source: VerdictSource }): boolean {
    const e = this.byId.get(id);
    if (!e || e.status !== "analyzing") return false;
    const a = this.attackers_.get(e.ip);
    if (a) {
      a.types[e.attackType] = Math.max(0, (a.types[e.attackType] ?? 1) - 1);
      a.types[verdict.attackType] = (a.types[verdict.attackType] ?? 0) + 1;
      if (verdict.status === "killed") a.killed++;
      else a.notKilled++;
    }
    const updated: AttackEvent = { ...e, ...verdict };
    this.replaceEvent(updated);
    if (verdict.status === "killed") this.bucket(e.ts).killed++;
    this.markDirty(updated, e.ip);
    this.bus.publish({ kind: "event", event: updated, prev: e.status });
    if (a) this.publishAttacker(a.ip);
    return true;
  }

  /** Idempotent. Returns the time the block started. */
  block(ip: string): number {
    const existing = this.blocks_.get(ip);
    if (existing) return existing;
    const at = this.now();
    this.blocks_.set(ip, at);
    this.liveDb?.prepare("INSERT OR REPLACE INTO blocks (ip, blocked_at) VALUES (?, ?)").run(ip, at);
    this.bus.publish({ kind: "block", ip, blocked: true });
    if (this.attackers_.has(ip)) this.publishAttacker(ip);
    return at;
  }

  /** Idempotent. Returns true when a block existed. */
  unblock(ip: string): boolean {
    if (!this.blocks_.delete(ip)) return false;
    this.liveDb?.prepare("DELETE FROM blocks WHERE ip = ?").run(ip);
    this.bus.publish({ kind: "block", ip, blocked: false });
    if (this.attackers_.has(ip)) this.publishAttacker(ip);
    return true;
  }

  setReport(report: AttackerReport): void {
    this.reports.set(report.ip, report);
    this.liveDb
      ?.prepare("INSERT OR REPLACE INTO reports (ip, summary, generated_at, model) VALUES (?, ?, ?, ?)")
      .run(report.ip, report.summary, report.generatedAt, report.model);
    this.bus.publish({ kind: "report", report });
  }

  setGeo(ip: string, geo: Geo): void {
    const a = this.attackers_.get(ip);
    if (!a) return;
    Object.assign(a, geo);
    this.dirtyAttackers.add(ip);
    this.scheduleFlush();
    this.publishAttacker(ip);
  }

  /* ----------------------------- reads ------------------------------ */

  /** Flushes the bus first, so the snapshot holds exactly the changes up to its `seq`. */
  snapshot(range: Range): Snapshot {
    this.bus.flush();
    const now = this.now();
    return {
      range,
      now,
      bucketMs: BUCKET_MS[range],
      series: this.series(range, now),
      events: this.events(range, { limit: 200 }),
      attackers: this.attackers(range).slice(0, MAX_ATTACKERS),
      seq: this.bus.lastSeq,
      epoch: this.bus.epoch,
    };
  }

  series(range: Range, now = this.now()): SeriesPoint[] {
    const size = BUCKET_MS[range];
    const end = Math.floor(now / size) * size;
    const start = end - RANGE_MS[range] + size;
    const points: SeriesPoint[] = [];
    for (let t = start; t <= end; t += size) points.push({ t, received: 0, killed: 0 });
    for (const [t, c] of this.buckets) {
      if (t < start || t >= end + size) continue;
      const p = points[Math.floor((t - start) / size)];
      if (!p) continue;
      p.received += c.received;
      p.killed += c.killed;
    }
    return points;
  }

  /** Events in the range, newest first. */
  events(range: Range, { limit = Infinity, filter }: { limit?: number; filter?: (e: AttackEvent) => boolean } = {}): AttackEvent[] {
    const since = this.now() - RANGE_MS[range];
    const out: AttackEvent[] = [];
    for (let i = this.events_.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.events_[i]!;
      if (e.ts < since) continue;
      if (!filter || filter(e)) out.push(e);
    }
    return out;
  }

  /** Attackers seen in the range, highest risk first. */
  attackers(range: Range): Attacker[] {
    return this.profiles(range).map(({ userAgent: _u, fingerprint: _f, ...a }) => a);
  }

  attacker(ip: string): Attacker | null {
    const p = this.profile(ip);
    if (!p) return null;
    const { userAgent: _u, fingerprint: _f, ...a } = p;
    return a;
  }

  profiles(range: Range): Profile[] {
    const since = this.now() - RANGE_MS[range];
    const out: Profile[] = [];
    for (const a of this.attackers_.values()) if (a.lastSeen >= since) out.push(this.view(a));
    return out.sort((x, y) => y.risk - x.risk || y.lastSeen - x.lastSeen);
  }

  profile(ip: string): Profile | null {
    const a = this.attackers_.get(ip);
    return a ? this.view(a) : null;
  }

  detail(ip: string): AttackerDetail | null {
    const attacker = this.attacker(ip);
    if (!attacker) return null;
    return { attacker, report: this.reports.get(ip) ?? null, recent: this.events("24h", { limit: 50, filter: (e) => e.ip === ip }) };
  }

  blocks(): { ip: string; blockedAt: number }[] {
    return [...this.blocks_].map(([ip, blockedAt]) => ({ ip, blockedAt }));
  }

  /** The database while the store is open. Writes after close() are dropped instead of throwing. */
  private get liveDb(): DatabaseSync | null {
    return this.closed ? null : this.db;
  }

  /** Flushes pending writes. Call on shutdown. */
  close(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.flushWrites();
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.closed = true;
  }

  /** Forgets attackers and rows older than the retention window. Runs every minute. */
  prune(): void {
    const now = this.now();
    const cutoff = now - RETAIN_MS;
    for (const [ip, a] of this.attackers_) if (a.lastSeen < cutoff && !this.blocks_.has(ip)) this.attackers_.delete(ip);
    this.logins.prune(now);
    this.pruneBuckets();
    if (this.closed) return;
    for (const r of this.retained) r.prune(now);
    if (!this.db) return;
    this.flushWrites();
    // Event rows are capped for the feed; counters live in their own small tables and keep 24 h.
    this.db.prepare("DELETE FROM events WHERE seq <= ?").run(this.eventSeq - MAX_EVENTS);
    this.db.prepare("DELETE FROM events WHERE ts < ?").run(cutoff);
    this.db.prepare("DELETE FROM buckets WHERE t < ?").run(cutoff - BASE_BUCKET);
    this.db.prepare("DELETE FROM attackers WHERE last_seen < ? AND ip NOT IN (SELECT ip FROM blocks)").run(cutoff);
    this.db.exec("DELETE FROM reports WHERE ip NOT IN (SELECT ip FROM attackers)");
  }

  /* ---------------------------- internals --------------------------- */

  private view(a: AttackerState): Profile {
    let topType: AttackType = "unknown";
    let top = -1;
    for (const t of ATTACK_TYPES) {
      const n = a.types[t] ?? 0;
      if (n > top) {
        top = n;
        topType = t;
      }
    }
    const volume = Math.min(40, Math.round(13 * Math.log10(1 + a.events)));
    const leak = Math.round(30 * Math.min(1, a.notKilled / 3));
    const risk = Math.min(100, volume + leak + SEVERITY[topType]);
    return {
      ip: a.ip,
      country: a.country,
      countryCode: a.countryCode,
      city: a.city,
      network: a.network,
      device: a.device,
      os: a.os,
      browser: a.browser,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      events: a.events,
      killed: a.killed,
      notKilled: a.notKilled,
      topType,
      risk,
      blocked: this.blocks_.has(a.ip),
      userAgent: a.userAgent,
      fingerprint: a.fingerprint,
    };
  }

  private touchAttacker(item: IngestEventParsed, ts: number): AttackerState {
    let a = this.attackers_.get(item.ip);
    if (!a) {
      const geo = geoFromHint(item.geo) ?? EMPTY_GEO;
      a = {
        ip: item.ip,
        userAgent: item.userAgent,
        fingerprint: fingerprint(item.userAgent),
        ...parseClient(item.userAgent),
        ...geo,
        firstSeen: ts,
        lastSeen: ts,
        events: 0,
        killed: 0,
        notKilled: 0,
        types: {},
      };
      this.attackers_.set(item.ip, a);
    } else {
      a.lastSeen = Math.max(a.lastSeen, ts);
      if (item.userAgent && item.userAgent !== a.userAgent) {
        a.userAgent = item.userAgent;
        a.fingerprint = fingerprint(item.userAgent);
        Object.assign(a, parseClient(item.userAgent));
      }
      const hint = geoFromHint(item.geo);
      if (hint && !a.country) Object.assign(a, hint);
    }
    return a;
  }

  private publishAttacker(ip: string): void {
    const attacker = this.attacker(ip);
    if (attacker) this.bus.publish({ kind: "attacker", attacker });
  }

  private bucket(ts: number): { received: number; killed: number } {
    const t = Math.floor(ts / BASE_BUCKET) * BASE_BUCKET;
    let b = this.buckets.get(t);
    if (!b) {
      b = { received: 0, killed: 0 };
      this.buckets.set(t, b);
      if (this.buckets.size % 64 === 0) this.pruneBuckets();
    }
    if (this.db) {
      this.dirtyBuckets.add(t);
      this.scheduleFlush();
    }
    return b;
  }

  private pruneBuckets(): void {
    const cutoff = this.now() - RETAIN_MS - BASE_BUCKET;
    for (const t of this.buckets.keys()) if (t < cutoff) this.buckets.delete(t);
  }

  private replaceEvent(e: AttackEvent): void {
    this.byId.set(e.id, e);
    for (let i = this.events_.length - 1; i >= 0; i--) {
      if (this.events_[i]!.id === e.id) {
        this.events_[i] = e;
        return;
      }
    }
  }

  private dropOldest(n: number): void {
    for (const e of this.events_.splice(0, n)) this.byId.delete(e.id);
  }

  private markDirty(e: AttackEvent, ip: string): void {
    if (!this.db) return;
    this.dirtyEvents.set(e.id, e);
    this.dirtyAttackers.add(ip);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (!this.db || this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flushWrites(), 250);
  }

  /** One transaction for every write in the last 250 ms keeps ingest off the disk path. */
  private flushWrites(): void {
    this.flushTimer = null;
    const db = this.closed ? null : this.db;
    if (!db || (this.dirtyEvents.size === 0 && this.dirtyAttackers.size === 0 && this.dirtyBuckets.size === 0)) return;
    const evStmt = db.prepare(
      `INSERT OR REPLACE INTO events (id, seq, ts, ip, method, path, payload, attack_type, status, source, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const atStmt = db.prepare(
      `INSERT OR REPLACE INTO attackers (ip, user_agent, country, country_code, city, network, first_seen, last_seen, events, killed, not_killed, types)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const bkStmt = db.prepare("INSERT OR REPLACE INTO buckets (t, received, killed) VALUES (?, ?, ?)");
    db.exec("BEGIN");
    try {
      for (const e of this.dirtyEvents.values())
        evStmt.run(e.id, e.seq, e.ts, e.ip, e.method, e.path, e.payload, e.attackType, e.status, e.source, e.confidence);
      for (const ip of this.dirtyAttackers) {
        const a = this.attackers_.get(ip);
        if (a)
          atStmt.run(a.ip, a.userAgent, a.country, a.countryCode, a.city, a.network, a.firstSeen, a.lastSeen, a.events, a.killed, a.notKilled, JSON.stringify(a.types));
      }
      for (const t of this.dirtyBuckets) {
        const b = this.buckets.get(t);
        if (b) bkStmt.run(t, b.received, b.killed);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      console.error("[store] write failed", err);
    }
    this.dirtyEvents = new Map();
    this.dirtyAttackers = new Set();
    this.dirtyBuckets = new Set();
  }

  /** Rebuilds memory from disk: counters from their own tables, the feed from the newest event rows. */
  private load(db: DatabaseSync): void {
    const since = this.now() - RETAIN_MS;
    for (const r of db.prepare("SELECT ip, blocked_at FROM blocks").all() as { ip: string; blocked_at: number }[])
      this.blocks_.set(r.ip, r.blocked_at);
    for (const r of db.prepare("SELECT ip, summary, generated_at, model FROM reports").all() as {
      ip: string;
      summary: string;
      generated_at: number;
      model: string;
    }[])
      this.reports.set(r.ip, { ip: r.ip, summary: r.summary, generatedAt: r.generated_at, model: r.model });
    for (const r of db.prepare("SELECT t, received, killed FROM buckets WHERE t >= ?").all(since - BASE_BUCKET) as {
      t: number;
      received: number;
      killed: number;
    }[])
      this.buckets.set(r.t, { received: r.received, killed: r.killed });
    for (const r of db.prepare("SELECT * FROM attackers WHERE last_seen >= ? OR ip IN (SELECT ip FROM blocks)").all(since) as Record<
      string,
      string | number | null
    >[]) {
      const ua = String(r.user_agent ?? "");
      this.attackers_.set(String(r.ip), {
        ip: String(r.ip),
        userAgent: ua,
        fingerprint: fingerprint(ua),
        ...parseClient(ua),
        country: (r.country as string) ?? null,
        countryCode: (r.country_code as string) ?? null,
        city: (r.city as string) ?? null,
        network: (r.network as string) ?? null,
        firstSeen: Number(r.first_seen),
        lastSeen: Number(r.last_seen),
        events: Number(r.events),
        killed: Number(r.killed),
        notKilled: Number(r.not_killed),
        types: JSON.parse(String(r.types ?? "{}")) as Partial<Record<AttackType, number>>,
      });
    }
    const rows = db
      .prepare("SELECT * FROM (SELECT * FROM events WHERE ts >= ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC")
      .all(since, MAX_EVENTS) as Record<string, string | number>[];
    for (const r of rows) {
      const waiting = r.status === "analyzing";
      const e: AttackEvent = {
        id: String(r.id),
        seq: Number(r.seq),
        ts: Number(r.ts),
        ip: String(r.ip),
        method: String(r.method),
        path: String(r.path),
        payload: String(r.payload),
        attackType: r.attack_type as AttackType,
        // An event that was waiting for the AI when the process stopped stays visible as active.
        status: waiting ? "active" : (r.status as EventStatus),
        source: r.source as VerdictSource,
        confidence: Number(r.confidence),
      };
      this.events_.push(e);
      this.byId.set(e.id, e);
      this.eventSeq = Math.max(this.eventSeq, e.seq);
      const a = this.attackers_.get(e.ip);
      if (waiting && a) {
        a.notKilled++;
        this.markDirty(e, e.ip);
      }
    }
  }
}

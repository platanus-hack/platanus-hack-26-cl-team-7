import { closeSync, fstatSync, openSync, readdirSync, readSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type EvidenceRun, type EvidenceTrace, type Research } from "@sentinel/contracts";
import { hash, liveTrace, mergeTraces, row } from "./evidence.ts";
import { lookupAdvisory, researchKey, type Inventory } from "./research.ts";

type EventRow = { seq: number; data: string };
type ResearchJob = { trace: EvidenceTrace; incident: string };
const CHUNK = 256 * 1024;
const MAX_LINE = 64 * 1024;

export class EvidenceJournal {
  private readonly db: DatabaseSync;
  private readonly directory?: string;
  private readonly apiKey?: string;
  private readonly inventory?: Inventory;
  private readonly timer?: ReturnType<typeof setInterval>;
  private readonly offsets = new Map<string, { inode: number; offset: number; rest: Buffer; skip: boolean }>();
  private readonly jobs = new Map<string, ResearchJob>();
  private running = false;
  private closed = false;
  private error?: string;

  constructor(db: DatabaseSync, directory?: string, apiKey?: string, inventory?: Inventory) {
    this.db = db;
    this.directory = directory;
    this.apiKey = apiKey;
    this.inventory = inventory;
    db.exec(`
      CREATE TABLE IF NOT EXISTS up_evidence (
        seq INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, run TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS up_evidence_run ON up_evidence(run, seq);
      CREATE TABLE IF NOT EXISTS up_research_cache (
        key TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL
      );
    `);
    if (directory) {
      this.poll();
      this.timer = setInterval(() => this.poll(), 1000);
      this.timer.unref();
    }
  }

  stop() {
    this.closed = true;
    clearInterval(this.timer);
  }

  state() {
    return { configured: !!this.directory, error: this.error, researchEnabled: !!this.apiKey };
  }

  private insert(trace: EvidenceTrace, fingerprint: string) {
    return this.db.prepare("INSERT OR IGNORE INTO up_evidence(fingerprint,run,data) VALUES (?,?,?)")
      .run(fingerprint, trace.run, JSON.stringify(trace)).changes !== 0;
  }

  add(value: unknown) {
    const trace = liveTrace(row(value));
    if (!trace) return;
    const event = trace.events[0]!;
    const identity = JSON.stringify([trace.run, trace.plane, trace.id, event.kind, event.time, event.incident, event.rule]);
    if (!this.insert(trace, hash(identity))) return;
    if (event.kind === "rule_installed" && event.incident && !trace.run.startsWith("pipeline-")) this.queue({ trace, incident: event.incident });
  }

  private queue(job: ResearchJob) {
    if (this.jobs.size >= 128) {
      this.saveResearch(job, { status: "provider-error", note: "Research queue is full." });
      return;
    }
    this.jobs.set(job.incident, job);
    this.saveResearch(job, { status: "pending", note: "Advisory lookup queued." });
    if (!this.running) void this.research();
  }

  private saveResearch(job: ResearchJob, result: Research) {
    this.insert({
      ...job.trace, events: [{ kind: "research", time: new Date().toISOString(), route: job.trace.route,
        incident: job.incident, research: result }],
    }, hash([job.trace.run, job.trace.plane, job.incident, result.status].join(":")));
  }

  private async research() {
    this.running = true;
    try {
      for (const [incident, job] of this.jobs) {
        this.jobs.delete(incident);
        const key = researchKey(job.trace.service, this.inventory);
        const hit = this.db.prepare("SELECT data FROM up_research_cache WHERE key=? AND expires>?").get(key, Date.now()) as { data: string } | undefined;
        const result: Research = hit ? { ...JSON.parse(hit.data), cached: true }
          : await lookupAdvisory(job.trace.service, this.apiKey, this.inventory);
        if (this.closed) return;
        if (!hit && !["provider-error", "not-configured"].includes(result.status))
          this.db.prepare("INSERT OR REPLACE INTO up_research_cache VALUES (?,?,?)")
            .run(key, JSON.stringify(result), Date.now() + 24 * 3600_000);
        this.saveResearch(job, result);
      }
    } finally {
      this.running = false;
    }
  }

  poll() {
    if (!this.directory || this.closed) return;
    try {
      const files = readdirSync(this.directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"));
      for (const entry of files) this.readFile(join(this.directory, entry.name));
      this.error = undefined;
    } catch {
      this.error = "The live evidence journal is unavailable. Replay is still available.";
    }
  }

  private readFile(path: string) {
    const fd = openSync(path, "r");
    try {
      const file = fstatSync(fd);
      const previous = this.offsets.get(path);
      const cursor = previous && previous.inode === file.ino && previous.offset <= file.size
        ? previous : { inode: file.ino, offset: 0, rest: Buffer.alloc(0), skip: false };
      if (file.size === cursor.offset) return;
      const chunk = Buffer.alloc(Math.min(file.size - cursor.offset, CHUNK));
      const bytes = readSync(fd, chunk, 0, chunk.length, cursor.offset);
      cursor.offset += bytes;
      const input = Buffer.concat([cursor.rest, chunk.subarray(0, bytes)]);
      let start = 0;
      for (let i = 0; i < input.length; i++) {
        if (input[i] !== 10) continue;
        if (!cursor.skip && i - start <= MAX_LINE) {
          try { this.add(JSON.parse(input.toString("utf8", start, i))); }
          catch (error) { if (!(error instanceof SyntaxError)) throw error; }
        }
        cursor.skip = false;
        start = i + 1;
      }
      cursor.rest = input.subarray(start);
      if (cursor.rest.length > MAX_LINE) {
        cursor.rest = Buffer.alloc(0);
        cursor.skip = true;
      }
      this.offsets.set(path, cursor);
    } finally {
      closeSync(fd);
    }
  }

  revision(): number {
    return Number(this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM up_evidence").get()?.seq ?? 0);
  }

  runs() {
    return this.db.prepare(`SELECT run AS id FROM up_evidence GROUP BY run
      ORDER BY MAX(julianday(json_extract(data, '$.time'))) DESC, MAX(seq) DESC LIMIT 50`)
      .all().map((result) => ({ id: String(result.id), title: String(result.id).startsWith("evaluation-") ? "Fixture run · " + String(result.id).slice(11, 19) : "Proxy run · " + String(result.id).slice(0, 8) }));
  }

  run(id: string): EvidenceRun | undefined {
    const result = this.db.prepare("SELECT seq,data FROM up_evidence WHERE run=? ORDER BY seq DESC LIMIT 5000").all(id) as EventRow[];
    if (result.length === 0) return undefined;
    const traces = mergeTraces(result.reverse().map((r) => JSON.parse(r.data) as EvidenceTrace));
    return { id, title: this.runs().find((entry) => entry.id === id)?.title ?? "Proxy run", mode: "live",
      provenance: result.length === 5000 ? "Showing the latest 5,000 journal events for this run." : "Local proxy journal and any independent fixture measurements attached by transaction ID.", traces };
  }
}

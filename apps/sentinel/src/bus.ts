import { randomBytes } from "node:crypto";
import { MAX_EVENTS_PER_FRAME, type SeriesPoint, type StreamBatch, type StreamChange } from "@sentinel/contracts";

/** What the replay history keeps: the SSE id and the encoded batch. */
export interface EncodedFrame {
  seq: number;
  /** `${epoch}-${seq}`, the SSE event id. */
  id: string;
  /** The client batch, encoded once and shared by every connection. */
  json: string;
}

/** A flushed frame. In-process listeners read `changes`, which is never folded. */
export interface Frame extends EncodedFrame {
  batch: StreamBatch;
  changes: StreamChange[];
}

type Listener = (frame: Frame) => void;

function keyOf(c: StreamChange): string {
  switch (c.kind) {
    case "event":
      return `e:${c.event.id}`;
    case "attacker":
      return `a:${c.attacker.ip}`;
    case "report":
      return `r:${c.report.ip}`;
    case "block":
      return `b:${c.ip}`;
    case "counts":
      return "c";
  }
}

/**
 * Coalesces changes into one batch per frame. A burst of 500 events becomes a
 * few messages, and repeated updates to the same key collapse to the last one,
 * so clients render at most once per frame and never fall behind.
 *
 * Positions are `${epoch}-${seq}`. The epoch is new for every process, so a
 * client that reconnects after a restart is told to reload instead of waiting
 * for sequence numbers it will never see again.
 */
export class Bus {
  readonly epoch = randomBytes(4).toString("hex");
  private pending = new Map<string, StreamChange>();
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly history: EncodedFrame[] = [];
  private historyBytes = 0;
  private seq = 0;
  private readonly frameMs: number;
  private readonly historyFrames: number;
  private readonly historyMaxBytes: number;

  constructor(frameMs = 100, historyFrames = 600, historyMaxBytes = 8 * 1024 * 1024) {
    this.frameMs = frameMs;
    this.historyFrames = historyFrames;
    this.historyMaxBytes = historyMaxBytes;
  }

  get lastSeq(): number {
    return this.seq;
  }

  publish(change: StreamChange): void {
    const k = keyOf(change);
    const earlier = this.pending.get(k);
    // A new event and its verdict in the same frame stay "new" for clients: keep the earliest prev.
    if (earlier?.kind === "event" && change.kind === "event") change = { ...change, prev: earlier.prev };
    // Delete first so the latest change for a key keeps its arrival order.
    this.pending.delete(k);
    this.pending.set(k, change);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.frameMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const changes = [...this.pending.values()];
    this.pending = new Map();
    const batch: StreamBatch = { epoch: this.epoch, seq: ++this.seq, now: Date.now(), changes: foldEvents(changes) };
    const frame: Frame = { seq: batch.seq, id: `${this.epoch}-${batch.seq}`, json: JSON.stringify(batch), batch, changes };
    this.history.push({ seq: frame.seq, id: frame.id, json: frame.json });
    this.historyBytes += frame.json.length;
    while (this.history.length > this.historyFrames || this.historyBytes > this.historyMaxBytes) {
      this.historyBytes -= this.history.shift()!.json.length;
    }
    for (const l of this.listeners) l(frame);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /**
   * Frames after a position given as `${epoch}-${seq}` (or a bare seq from this
   * epoch). Returns null when the client must reload: another epoch, a position
   * ahead of this process, or a gap older than the kept history.
   */
  since(position: string): EncodedFrame[] | null {
    const dash = position.lastIndexOf("-");
    const epoch = dash >= 0 ? position.slice(0, dash) : this.epoch;
    const seq = Number(dash >= 0 ? position.slice(dash + 1) : position);
    if (epoch !== this.epoch || !Number.isInteger(seq) || seq < 0 || seq > this.seq) return null;
    if (seq === this.seq) return [];
    const first = this.history[0];
    if (!first || first.seq > seq + 1) return null;
    return this.history.filter((f) => f.seq > seq);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

const COUNT_BUCKET_MS = 10_000;

/**
 * Keeps at most MAX_EVENTS_PER_FRAME event changes (the newest) and turns the
 * rest into chart count deltas. Clients only show the newest 500 events, so a
 * flood costs a small frame instead of megabytes, and the chart stays exact.
 */
export function foldEvents(changes: StreamChange[]): StreamChange[] {
  let events = 0;
  for (const c of changes) if (c.kind === "event") events++;
  let fold = events - MAX_EVENTS_PER_FRAME;
  if (fold <= 0) return changes;
  const buckets = new Map<number, SeriesPoint>();
  const kept: StreamChange[] = [];
  for (const c of changes) {
    if (c.kind !== "event" || fold <= 0) {
      kept.push(c);
      continue;
    }
    fold--;
    const t = Math.floor(c.event.ts / COUNT_BUCKET_MS) * COUNT_BUCKET_MS;
    const b = buckets.get(t) ?? { t, received: 0, killed: 0 };
    const killed = c.event.status === "killed";
    if (c.prev === undefined) {
      b.received++;
      if (killed) b.killed++;
    } else if (c.prev !== "killed" && killed) b.killed++;
    buckets.set(t, b);
  }
  kept.push({ kind: "counts", buckets: [...buckets.values()] });
  return kept;
}

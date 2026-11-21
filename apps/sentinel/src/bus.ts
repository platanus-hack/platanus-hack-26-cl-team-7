import type { StreamBatch, StreamChange } from "@sentinel/contracts";

type Listener = (batch: StreamBatch) => void;

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
  }
}

/**
 * Coalesces changes into one batch per frame. A burst of 500 events becomes a
 * few messages, and repeated updates to the same attacker collapse to the last
 * one, so clients render at most once per frame and never fall behind.
 */
export class Bus {
  private pending = new Map<string, StreamChange>();
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly history: StreamBatch[] = [];
  private seq = 0;

  private readonly frameMs: number;
  private readonly historySize: number;

  constructor(frameMs = 100, historySize = 600) {
    this.frameMs = frameMs;
    this.historySize = historySize;
  }

  get lastSeq(): number {
    return this.seq;
  }

  publish(change: StreamChange): void {
    const k = keyOf(change);
    // Delete first so the latest change for a key keeps its arrival order.
    this.pending.delete(k);
    this.pending.set(k, change);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.frameMs);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const batch: StreamBatch = { seq: ++this.seq, now: Date.now(), changes: [...this.pending.values()] };
    this.pending = new Map();
    this.history.push(batch);
    if (this.history.length > this.historySize) this.history.shift();
    for (const l of this.listeners) l(batch);
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /**
   * Batches after `seq`, for reconnects. Returns null when the gap is older than
   * the kept history; the client must then reload the snapshot.
   */
  since(seq: number): StreamBatch[] | null {
    if (seq >= this.seq) return [];
    const first = this.history[0];
    if (!first || first.seq > seq + 1) return null;
    return this.history.filter((b) => b.seq > seq);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

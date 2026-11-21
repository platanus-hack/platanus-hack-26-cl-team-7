/**
 * Dashboard state. Interface: `useDashboard`, `connect`, `startClock`, `loadHealth`.
 * Behind it: snapshot + SSE stream applied once per animation frame, reconnects,
 * the attacker detail cache, and optimistic blocking. The pure reducer below is
 * exported only as a test seam.
 */
import { create } from "zustand";
import {
  BUCKET_MS,
  RANGE_MS,
  type AttackEvent,
  type Attacker,
  type AttackerReport,
  type Range,
  type SeriesPoint,
  type Snapshot,
  type AttackerDetail,
  type Health,
  type StreamBatch,
} from "@sentinel/contracts";
import { api } from "../sentinel";

/* ---------------- pure reducer (test seam) ---------------- */

export const MAX_EVENTS = 500;

export interface LiveData {
  range: Range;
  bucketMs: number;
  now: number;
  seq: number;
  series: SeriesPoint[];
  /** Newest first. */
  events: AttackEvent[];
  /** Sorted by risk, highest first. */
  attackers: Attacker[];
  reports: Record<string, AttackerReport>;
}

export function emptyData(range: Range): LiveData {
  return { range, bucketMs: BUCKET_MS[range], now: Date.now(), seq: 0, series: [], events: [], attackers: [], reports: {} };
}

export function fromSnapshot(s: Snapshot): LiveData {
  return {
    range: s.range,
    bucketMs: s.bucketMs,
    now: s.now,
    seq: s.seq,
    series: [...s.series].sort((a, b) => a.t - b.t),
    events: [...s.events].sort((a, b) => b.ts - a.ts || b.seq - a.seq).slice(0, MAX_EVENTS),
    attackers: sortAttackers(s.attackers),
    reports: {},
  };
}

export const bucketOf = (ts: number, bucketMs: number) => Math.floor(ts / bucketMs) * bucketMs;

function sortAttackers(list: Attacker[]): Attacker[] {
  return [...list].sort((a, b) => b.risk - a.risk || b.lastSeen - a.lastSeen);
}

/** Keeps buckets inside the range window and appends empty buckets up to `now`. */
export function advanceSeries(series: SeriesPoint[], now: number, range: Range, bucketMs: number): SeriesPoint[] {
  const start = bucketOf(now - RANGE_MS[range], bucketMs) + bucketMs;
  const end = bucketOf(now, bucketMs);
  const byT = new Map(series.map((p) => [p.t, p] as const));
  if (series.length && series[0]!.t >= start && series[series.length - 1]!.t === end) return series;
  const out: SeriesPoint[] = [];
  for (let t = start; t <= end; t += bucketMs) out.push(byT.get(t) ?? { t, received: 0, killed: 0 });
  return out;
}

function bump(series: SeriesPoint[], t: number, dReceived: number, dKilled: number): SeriesPoint[] {
  const i = series.findIndex((p) => p.t === t);
  if (i === -1) {
    if (series.length && t < series[0]!.t) return series; // older than the window
    const next = [...series, { t, received: Math.max(0, dReceived), killed: Math.max(0, dKilled) }];
    return next.sort((a, b) => a.t - b.t);
  }
  const p = series[i]!;
  const next = series.slice();
  next[i] = { t, received: Math.max(0, p.received + dReceived), killed: Math.max(0, p.killed + dKilled) };
  return next;
}

/** Applies one or more stream batches. Pure: returns a new object, or the same one when nothing changed. */
export function applyBatches(data: LiveData, batches: StreamBatch[]): LiveData {
  if (batches.length === 0) return data;
  let { series, events, attackers, reports } = data;
  let seq = data.seq;
  let now = data.now;
  let attackersDirty = false;
  let eventsDirty = false;
  const byId = new Map(events.map((e) => [e.id, e] as const));

  for (const batch of batches) {
    if (batch.seq <= seq && seq !== 0) continue; // replayed batch, already applied
    seq = Math.max(seq, batch.seq);
    now = Math.max(now, batch.now);
    for (const c of batch.changes) {
      switch (c.kind) {
        case "event": {
          const e = c.event;
          const t = bucketOf(e.ts, data.bucketMs);
          const prev = byId.get(e.id);
          byId.set(e.id, e);
          eventsDirty = true;
          if (!prev) {
            series = bump(series, t, 1, e.status === "killed" ? 1 : 0);
          } else {
            const wasKilled = prev.status === "killed";
            const isKilled = e.status === "killed";
            if (wasKilled !== isKilled) series = bump(series, t, 0, isKilled ? 1 : -1);
          }
          break;
        }
        case "attacker": {
          const i = attackers.findIndex((a) => a.ip === c.attacker.ip);
          attackers = i === -1 ? [...attackers, c.attacker] : attackers.map((a, j) => (j === i ? c.attacker : a));
          attackersDirty = true;
          break;
        }
        case "report":
          reports = { ...reports, [c.report.ip]: c.report };
          break;
        case "block":
          attackers = attackers.map((a) => (a.ip === c.ip ? { ...a, blocked: c.blocked } : a));
          break;
      }
    }
  }

  if (eventsDirty) {
    events = [...byId.values()].sort((a, b) => b.ts - a.ts || b.seq - a.seq);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  }
  if (attackersDirty) attackers = sortAttackers(attackers);
  if (series !== data.series) series = advanceSeries(series, now, data.range, data.bucketMs);
  return { ...data, seq, now, series, events, attackers, reports };
}

export function setBlocked(data: LiveData, ip: string, blocked: boolean): LiveData {
  return { ...data, attackers: data.attackers.map((a) => (a.ip === ip ? { ...a, blocked } : a)) };
}

/* ---------------- store ---------------- */

export type Conn = "loading" | "live" | "reconnecting" | "offline";

interface DashboardState {
  data: LiveData;
  conn: Conn;
  health: Health | null;
  selectedIp: string | null;
  copilotOpen: boolean;
  details: Record<string, AttackerDetail>;
  pendingBlock: Record<string, boolean>;
  error: string | null;
  setRange: (r: Range) => void;
  select: (ip: string) => void;
  toggleCopilot: (open?: boolean) => void;
  prefetch: (ip: string) => void;
  toggleBlock: (ip: string) => Promise<void>;
}

export const useDashboard = create<DashboardState>((set, get) => ({
  data: emptyData("1h"),
  conn: "loading",
  health: null,
  selectedIp: null,
  copilotOpen: false,
  details: {},
  pendingBlock: {},
  error: null,
  setRange: (r) => {
    if (r === get().data.range && get().conn !== "offline") return;
    connect(r);
  },
  select: (ip) => {
    set({ selectedIp: ip, copilotOpen: false });
    get().prefetch(ip);
  },
  toggleCopilot: (open) => set((s) => ({ copilotOpen: open ?? !s.copilotOpen })),
  prefetch: (ip) => {
    void loadDetail(ip);
  },
  toggleBlock: async (ip) => {
    const attacker = get().data.attackers.find((a) => a.ip === ip);
    if (!attacker || get().pendingBlock[ip]) return;
    const next = !attacker.blocked;
    // Optimistic: flip at once, roll back if the server says no.
    set((s) => ({ data: setBlocked(s.data, ip, next), pendingBlock: { ...s.pendingBlock, [ip]: true } }));
    try {
      if (next) await api.block(ip);
      else await api.unblock(ip);
    } catch (e) {
      set((s) => ({ data: setBlocked(s.data, ip, !next), error: e instanceof Error ? e.message : "Block failed" }));
      setTimeout(() => set({ error: null }), 4000);
    } finally {
      set((s) => {
        const { [ip]: _done, ...rest } = s.pendingBlock;
        return { pendingBlock: rest };
      });
    }
  },
}));

/* ---------------- attacker detail cache (prefetch on hover) ---------------- */

const DETAIL_TTL = 5000;
const detailAt = new Map<string, number>();
const inflight = new Map<string, Promise<void>>();

function loadDetail(ip: string): Promise<void> {
  const fresh = Date.now() - (detailAt.get(ip) ?? 0) < DETAIL_TTL;
  if (fresh) return Promise.resolve();
  const running = inflight.get(ip);
  if (running) return running;
  const p = api
    .attacker(ip)
    .then((d) => {
      detailAt.set(ip, Date.now());
      useDashboard.setState((s) => ({ details: { ...s.details, [ip]: d } }));
    })
    .catch(() => undefined)
    .finally(() => inflight.delete(ip));
  inflight.set(ip, p);
  return p;
}

/* ---------------- live connection: snapshot + SSE, applied once per frame ---------------- */

let source: EventSource | null = null;
let snapshotCtrl: AbortController | null = null;
let queue: StreamBatch[] = [];
let frame = 0;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  frame = 0;
  if (!queue.length) return;
  const batches = queue;
  queue = [];
  useDashboard.setState((s) => ({ data: applyBatches(s.data, batches) }));
}

function schedule() {
  if (frame) return;
  frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
}

function openStream(after: number) {
  source?.close();
  const es = new EventSource(api.streamUrl(after));
  source = es;
  es.addEventListener("open", () => {
    retry = 0;
    useDashboard.setState({ conn: "live" });
  });
  es.addEventListener("batch", (ev) => {
    try {
      queue.push(JSON.parse((ev as MessageEvent<string>).data) as StreamBatch);
      schedule();
    } catch {
      /* ignore malformed frame */
    }
  });
  es.addEventListener("error", () => {
    if (source !== es) return;
    // EventSource retries by itself and resends Last-Event-ID; we only reflect the state.
    useDashboard.setState({ conn: "reconnecting" });
    if (es.readyState === EventSource.CLOSED) scheduleReconnect();
  });
}

function scheduleReconnect() {
  clearTimeout(retryTimer);
  const wait = Math.min(8000, 500 * 2 ** retry++);
  retryTimer = setTimeout(() => connect(useDashboard.getState().data.range), wait);
}

export function connect(range: Range) {
  snapshotCtrl?.abort();
  source?.close();
  source = null;
  queue = [];
  clearTimeout(retryTimer);
  const ctrl = new AbortController();
  snapshotCtrl = ctrl;
  const prev = useDashboard.getState();
  useDashboard.setState({
    conn: prev.data.events.length ? "reconnecting" : "loading",
    // Keep old rows on screen while the new range loads: never a blank screen.
    data: prev.data.range === range ? prev.data : { ...prev.data, range },
  });
  api
    .snapshot(range, ctrl.signal)
    .then((snap) => {
      if (ctrl.signal.aborted) return;
      const data = fromSnapshot(snap);
      const s = useDashboard.getState();
      const selectedIp = s.selectedIp && data.attackers.some((a) => a.ip === s.selectedIp) ? s.selectedIp : (data.attackers[0]?.ip ?? null);
      useDashboard.setState({ data, selectedIp });
      if (selectedIp) void loadDetail(selectedIp);
      openStream(snap.seq);
    })
    .catch(() => {
      if (ctrl.signal.aborted) return;
      useDashboard.setState({ conn: useDashboard.getState().data.events.length ? "reconnecting" : "offline" });
      scheduleReconnect();
    });
}

/** Slides the chart window forward once a second, even when no attack arrives. */
export function startClock() {
  const id = setInterval(() => {
    useDashboard.setState((s) => {
      const now = Date.now();
      const series = advanceSeries(s.data.series, now, s.data.range, s.data.bucketMs);
      return series === s.data.series ? s : { data: { ...s.data, now, series } };
    });
  }, 1000);
  return () => clearInterval(id);
}

export async function loadHealth() {
  try {
    useDashboard.setState({ health: await api.health() });
  } catch {
    useDashboard.setState({ health: null });
  }
}

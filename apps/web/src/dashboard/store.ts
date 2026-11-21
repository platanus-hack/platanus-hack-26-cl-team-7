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
/** Stream batches waiting longer than this (for example in a hidden tab) are dropped for a fresh snapshot. */
export const MAX_QUEUE = 2000;

export interface LiveData {
  range: Range;
  bucketMs: number;
  now: number;
  /** Sentinel process identity. A different epoch means our state no longer matches the server. */
  epoch: string;
  seq: number;
  series: SeriesPoint[];
  /** Newest first. */
  events: AttackEvent[];
  /** Sorted by risk, highest first. Only attackers seen inside the range window. */
  attackers: Attacker[];
  reports: Record<string, AttackerReport>;
}

export function emptyData(range: Range): LiveData {
  return { range, bucketMs: BUCKET_MS[range], now: Date.now(), epoch: "", seq: 0, series: [], events: [], attackers: [], reports: {} };
}

export function fromSnapshot(s: Snapshot): LiveData {
  return {
    range: s.range,
    bucketMs: s.bucketMs,
    now: s.now,
    epoch: s.epoch,
    seq: s.seq,
    series: [...s.series].sort((a, b) => a.t - b.t),
    events: [...s.events].sort((a, b) => b.ts - a.ts || b.seq - a.seq).slice(0, MAX_EVENTS),
    attackers: sortAttackers(inWindow(s.attackers, s.now, s.range)),
    reports: {},
  };
}

export const bucketOf = (ts: number, bucketMs: number) => Math.floor(ts / bucketMs) * bucketMs;

function sortAttackers(list: Iterable<Attacker>): Attacker[] {
  return [...list].sort((a, b) => b.risk - a.risk || b.lastSeen - a.lastSeen);
}

function inWindow(list: Attacker[], now: number, range: Range): Attacker[] {
  const from = now - RANGE_MS[range];
  return list.every((a) => a.lastSeen >= from) ? list : list.filter((a) => a.lastSeen >= from);
}

/** Drops attackers whose last attack left the range window. Returns the same object when nothing left. */
export function pruneAttackers(data: LiveData, now: number): LiveData {
  const attackers = inWindow(data.attackers, now, data.range);
  return attackers === data.attackers ? data : { ...data, attackers };
}

/** True when the stream belongs to another Sentinel process than our snapshot: reload, do not apply. */
export const isStaleEpoch = (data: LiveData, epoch: string) => epoch !== data.epoch;

/** Splits batches into those we can apply and tells whether any came from another epoch (then reload). */
export function partitionBatches(data: LiveData, batches: StreamBatch[]): { apply: StreamBatch[]; reload: boolean } {
  const apply = batches.filter((b) => !isStaleEpoch(data, b.epoch));
  return { apply, reload: apply.length !== batches.length };
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

/**
 * Applies stream batches of the current epoch. Pure: returns a new object, or the same one when
 * nothing changed. Batches from another epoch are skipped (see `partitionBatches`).
 */
export function applyBatches(data: LiveData, batches: StreamBatch[]): LiveData {
  if (batches.length === 0) return data;
  let { series, events, reports } = data;
  let seq = data.seq;
  let now = data.now;
  let eventsDirty = false;
  let byIp: Map<string, Attacker> | null = null;
  const attackerMap = () => (byIp ??= new Map(data.attackers.map((a) => [a.ip, a] as const)));
  const byId = new Map(events.map((e) => [e.id, e] as const));

  for (const batch of batches) {
    if (isStaleEpoch(data, batch.epoch)) continue;
    if (batch.seq <= seq && seq !== 0) continue; // replayed batch, already applied
    seq = Math.max(seq, batch.seq);
    now = Math.max(now, batch.now);
    for (const c of batch.changes) {
      switch (c.kind) {
        case "event": {
          const e = c.event;
          const t = bucketOf(e.ts, data.bucketMs);
          const known = byId.get(e.id);
          byId.set(e.id, e);
          eventsDirty = true;
          const isKilled = e.status === "killed";
          if (known) {
            const wasKilled = known.status === "killed";
            if (wasKilled !== isKilled) series = bump(series, t, 0, isKilled ? 1 : -1);
          } else if (c.prev === undefined) {
            series = bump(series, t, 1, isKilled ? 1 : 0); // a new attack
          } else if (c.prev !== "killed" && isKilled) {
            series = bump(series, t, 0, 1); // an update to an attack counted before we held it
          }
          break;
        }
        case "attacker":
          attackerMap().set(c.attacker.ip, c.attacker);
          break;
        case "report":
          reports = { ...reports, [c.report.ip]: c.report };
          break;
        case "block": {
          const a = attackerMap().get(c.ip);
          if (a) attackerMap().set(c.ip, { ...a, blocked: c.blocked });
          break;
        }
      }
    }
  }

  if (eventsDirty) {
    events = [...byId.values()].sort((a, b) => b.ts - a.ts || b.seq - a.seq);
    if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  }
  const attackers = byIp ? sortAttackers(inWindow([...(byIp as Map<string, Attacker>).values()], now, data.range)) : inWindow(data.attackers, now, data.range);
  if (series !== data.series) series = advanceSeries(series, now, data.range, data.bucketMs);
  return { ...data, seq, now, series, events, attackers, reports };
}

export function setBlocked(data: LiveData, ip: string, blocked: boolean): LiveData {
  return { ...data, attackers: data.attackers.map((a) => (a.ip === ip ? { ...a, blocked } : a)) };
}

/** Re-applies optimistic block flags that the server has not confirmed yet, so stream updates cannot undo them. */
export function withBlockOverrides(data: LiveData, overrides: Record<string, boolean>): LiveData {
  const ips = Object.keys(overrides);
  if (ips.length === 0) return data;
  let changed = false;
  const attackers = data.attackers.map((a) => {
    const want = overrides[a.ip];
    if (want === undefined || a.blocked === want) return a;
    changed = true;
    return { ...a, blocked: want };
  });
  return changed ? { ...data, attackers } : data;
}

/** IPs whose block state the server confirmed in these batches. */
export function confirmedBlocks(batches: StreamBatch[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const b of batches) for (const c of b.changes) if (c.kind === "block") out.set(c.ip, c.blocked);
  return out;
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
  /** Optimistic block state per IP, held until the server confirms it. */
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
    if (!attacker || ip in get().pendingBlock) return;
    const before = attacker.blocked;
    const want = !before;
    // Optimistic: show the new state at once and hold it until the server confirms.
    set((s) => ({ pendingBlock: { ...s.pendingBlock, [ip]: want }, data: setBlocked(s.data, ip, want) }));
    try {
      if (want) await api.block(ip);
      else await api.unblock(ip);
      set((s) => ({ pendingBlock: without(s.pendingBlock, ip), data: setBlocked(s.data, ip, want) }));
    } catch (e) {
      set((s) => ({ pendingBlock: without(s.pendingBlock, ip), data: setBlocked(s.data, ip, before), error: e instanceof Error ? e.message : "Block failed" }));
      setTimeout(() => set({ error: null }), 4000);
    }
  },
}));

function without(rec: Record<string, boolean>, key: string): Record<string, boolean> {
  if (!(key in rec)) return rec;
  const { [key]: _gone, ...rest } = rec;
  return rest;
}

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
let rafId = 0;
let timerId: ReturnType<typeof setTimeout> | undefined;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;

const isHidden = () => typeof document !== "undefined" && document.hidden;

function flush() {
  rafId = 0;
  clearTimeout(timerId);
  timerId = undefined;
  if (!queue.length) return;
  const batches = queue;
  queue = [];
  const s = useDashboard.getState();
  const { apply, reload } = partitionBatches(s.data, batches);
  if (reload) return reloadSnapshot();
  const confirmed = confirmedBlocks(apply);
  let pendingBlock = s.pendingBlock;
  for (const ip of confirmed.keys()) pendingBlock = without(pendingBlock, ip);
  const data = withBlockOverrides(applyBatches(s.data, apply), pendingBlock);
  useDashboard.setState({ data, pendingBlock });
}

/** Visible tab: once per animation frame. Hidden tab (no rAF there): every 250 ms. */
function schedule() {
  if (queue.length > MAX_QUEUE) return reloadSnapshot();
  if (rafId || timerId !== undefined) return;
  if (isHidden() || typeof requestAnimationFrame !== "function") timerId = setTimeout(flush, 250);
  else rafId = requestAnimationFrame(flush);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
      schedule();
    }
  });
}

function reloadSnapshot() {
  connect(useDashboard.getState().data.range);
}

function openStream(epoch: string, seq: number) {
  source?.close();
  const es = new EventSource(api.streamUrl(`${epoch}-${seq}`));
  source = es;
  es.addEventListener("open", () => {
    retry = 0;
    useDashboard.setState({ conn: "live" });
  });
  es.addEventListener("ready", (ev) => {
    if (source !== es) return;
    try {
      const ready = JSON.parse((ev as MessageEvent<string>).data) as { epoch: string; seq: number };
      // Sentinel restarted: our snapshot belongs to the old process.
      if (isStaleEpoch(useDashboard.getState().data, ready.epoch)) reloadSnapshot();
    } catch {
      /* ignore malformed frame */
    }
  });
  es.addEventListener("reset", () => {
    if (source === es) reloadSnapshot();
  });
  es.addEventListener("batch", (ev) => {
    if (source !== es) return;
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
  retryTimer = setTimeout(reloadSnapshot, wait);
}

export function connect(range: Range) {
  snapshotCtrl?.abort();
  source?.close();
  source = null;
  queue = [];
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
  clearTimeout(timerId);
  timerId = undefined;
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
      const s = useDashboard.getState();
      const data = withBlockOverrides(fromSnapshot(snap), s.pendingBlock);
      const selectedIp = s.selectedIp && data.attackers.some((a) => a.ip === s.selectedIp) ? s.selectedIp : (data.attackers[0]?.ip ?? null);
      useDashboard.setState({ data, selectedIp });
      if (selectedIp) void loadDetail(selectedIp);
      openStream(snap.epoch, snap.seq);
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
      const pruned = pruneAttackers(s.data, now);
      return series === s.data.series && pruned === s.data ? s : { data: { ...pruned, now, series } };
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

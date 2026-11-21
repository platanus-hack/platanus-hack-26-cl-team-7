/**
 * Mirror lane state. Interface: `useMirror`, `startMirror`, `proposalState`.
 * Behind it: the first pages of /v1/tracks and /v1/findings, kept live by the
 * dashboard's stream (track and finding changes), and the selected track's detail,
 * refetched when the stream says that track changed. The pure merge functions are
 * exported as a test seam.
 */
import { create } from "zustand";
import { MAX_PAGE_LIMIT, type Finding, type StreamBatch, type Track, type TrackDetail } from "@sentinel/contracts";
import { tapStream } from "../dashboard/store";
import { api } from "../sentinel";

/* ---------------- pure merge (test seam) ---------------- */

/** Rows kept in memory. Older tracks stay reachable through "Load older". */
export const MAX_TRACKS = 1000;
export const MAX_FINDINGS = 500;
/** The stream only says a track changed; its actions are refetched at most this often. */
export const DETAIL_REFRESH_MS = 500;

export interface MirrorData {
  /** Most recently active first. */
  tracks: Track[];
  /** Newest first. */
  findings: Finding[];
}

export const emptyMirror = (): MirrorData => ({ tracks: [], findings: [] });

/** A snapshot page and stream changes can arrive in either order: the newer copy of a track wins. */
const newer = (a: Track, b: Track) => a.lastSeen > b.lastSeen || (a.lastSeen === b.lastSeen && a.actions + a.findings + a.keys.length >= b.actions + b.findings + b.keys.length);

export function mergeTracks(list: Track[], incoming: Track[]): Track[] {
  if (incoming.length === 0) return list;
  const byId = new Map(list.map((t) => [t.trackId, t] as const));
  for (const t of incoming) {
    const known = byId.get(t.trackId);
    if (!known || newer(t, known)) byId.set(t.trackId, t);
  }
  return [...byId.values()].sort((a, b) => b.lastSeen - a.lastSeen || (a.trackId < b.trackId ? 1 : -1)).slice(0, MAX_TRACKS);
}

/** A proposal never disappears: an older copy without one does not replace a copy with one. */
export function mergeFindings(list: Finding[], incoming: Finding[]): Finding[] {
  if (incoming.length === 0) return list;
  const byId = new Map(list.map((f) => [f.findingId, f] as const));
  for (const f of incoming) {
    const known = byId.get(f.findingId);
    if (!known || f.proposal || !known.proposal) byId.set(f.findingId, f);
  }
  return [...byId.values()].sort((a, b) => b.ts - a.ts || (a.findingId < b.findingId ? 1 : -1)).slice(0, MAX_FINDINGS);
}

/** The track and finding changes in stream batches, in arrival order. */
export function mirrorChanges(batches: StreamBatch[]): MirrorData {
  const out = emptyMirror();
  for (const b of batches)
    for (const c of b.changes) {
      if (c.kind === "track") out.tracks.push(c.track);
      else if (c.kind === "finding") out.findings.push(c.finding);
    }
  return out;
}

export function applyMirror(data: MirrorData, changes: MirrorData): MirrorData {
  const tracks = mergeTracks(data.tracks, changes.tracks);
  const findings = mergeFindings(data.findings, changes.findings);
  return tracks === data.tracks && findings === data.findings ? data : { tracks, findings };
}

/** Puts streamed findings of this track into its detail. Returns the same object when none belong to it. */
export function applyToDetail(detail: TrackDetail, changes: MirrorData): TrackDetail {
  const mine = changes.findings.filter((f) => f.trackId === detail.track.trackId);
  const track = changes.tracks.filter((t) => t.trackId === detail.track.trackId);
  if (mine.length === 0 && track.length === 0) return detail;
  return { ...detail, track: mergeTracks([detail.track], track)[0]!, findings: mergeFindings(detail.findings, mine) };
}

export type ProposalState = "ready" | "pending" | "unavailable";

/** `aiEnabled` is null while health is unknown: show the proposal as pending, not as missing. */
export function proposalState(f: Finding, aiEnabled: boolean | null): ProposalState {
  if (f.proposal) return "ready";
  return aiEnabled === false ? "unavailable" : "pending";
}

/* ---------------- store ---------------- */

interface MirrorState {
  open: boolean;
  data: MirrorData;
  /** nextCursor of the last tracks page; null when every track is loaded. */
  tracksCursor: string | null;
  loading: boolean;
  error: string | null;
  selected: string | null;
  detail: TrackDetail | null;
  toggle: (open?: boolean) => void;
  select: (trackId: string) => void;
  loadOlder: () => Promise<void>;
}

export const useMirror = create<MirrorState>((set, get) => ({
  open: false,
  data: emptyMirror(),
  tracksCursor: null,
  loading: true,
  error: null,
  selected: null,
  detail: null,
  toggle: (open) => set((s) => ({ open: open ?? !s.open })),
  select: (trackId) => {
    set((s) => ({ selected: trackId, detail: s.detail?.track.trackId === trackId ? s.detail : null }));
    void loadDetail(trackId);
  },
  loadOlder: async () => {
    const cursor = get().tracksCursor;
    if (!cursor) return;
    try {
      const page = await api.tracks({ range: "24h", limit: MAX_PAGE_LIMIT, cursor });
      set((s) => ({ data: { ...s.data, tracks: mergeTracks(s.data.tracks, page.items) }, tracksCursor: page.nextCursor }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Could not load older tracks" });
    }
  },
}));

let loadCtrl: AbortController | null = null;
let detailTimer: ReturnType<typeof setTimeout> | undefined;

async function loadDetail(trackId: string): Promise<void> {
  try {
    const detail = await api.track(trackId);
    if (useMirror.getState().selected === trackId) useMirror.setState({ detail, error: null });
  } catch {
    if (useMirror.getState().selected === trackId) useMirror.setState({ error: "Could not load this track" });
  }
}

/** First pages of tracks and findings. Stream changes that raced it are kept by the merge rules. */
export async function loadMirror(): Promise<void> {
  loadCtrl?.abort();
  const ctrl = new AbortController();
  loadCtrl = ctrl;
  try {
    const [tracks, findings] = await Promise.all([
      api.tracks({ range: "24h", limit: MAX_PAGE_LIMIT }, ctrl.signal),
      api.findings({ range: "24h", limit: MAX_PAGE_LIMIT }, ctrl.signal),
    ]);
    useMirror.setState((s) => {
      const data = applyMirror(s.data, { tracks: tracks.items, findings: findings.items });
      const selected = s.selected ?? data.tracks[0]?.trackId ?? null;
      return { data, tracksCursor: tracks.nextCursor, loading: false, error: null, selected };
    });
    const selected = useMirror.getState().selected;
    if (selected) void loadDetail(selected);
  } catch (e) {
    if (!ctrl.signal.aborted) useMirror.setState({ loading: false, error: e instanceof Error ? e.message : "Could not load the mirror lane" });
  }
}

function onBatches(batches: StreamBatch[]): void {
  const changes = mirrorChanges(batches);
  if (changes.tracks.length === 0 && changes.findings.length === 0) return;
  const s = useMirror.getState();
  const selected = s.selected ?? changes.tracks[0]?.trackId ?? null;
  useMirror.setState({ data: applyMirror(s.data, changes), selected, detail: s.detail && applyToDetail(s.detail, changes) });
  // New actions are not streamed one by one: refetch the open track, at most once per interval.
  if (selected && detailTimer === undefined && changes.tracks.some((t) => t.trackId === selected))
    detailTimer = setTimeout(() => {
      detailTimer = undefined;
      const now = useMirror.getState().selected;
      if (now) void loadDetail(now);
    }, DETAIL_REFRESH_MS);
}

/** Connects the mirror lane to the dashboard stream. Returns the disconnect. */
export function startMirror(): () => void {
  const untap = tapStream({ batches: onBatches, resync: () => void loadMirror() });
  return () => {
    untap();
    loadCtrl?.abort();
    clearTimeout(detailTimer);
    detailTimer = undefined;
  };
}

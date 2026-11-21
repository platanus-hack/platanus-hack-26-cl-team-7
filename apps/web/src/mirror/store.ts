/**
 * Caught agents state (the API calls them tracks; the decoy copy of the shop is the mirror lane).
 * Interface: `useMirror`, `startMirror`, `proposalState`. Behind it: the first pages of /v1/tracks and /v1/findings, kept live by the
 * dashboard's stream (track and finding changes), and the selected track's detail,
 * refetched when the stream says that track changed. The pure merge functions are
 * exported as a test seam.
 */
import { create } from "zustand";
import { MAX_PAGE_LIMIT, type Finding, type ProposalStatus, type StreamBatch, type Track, type TrackDetail } from "@sentinel/contracts";
import { tapStream } from "../dashboard/store";
import { defaultAgent } from "../caught/summary";
import { api } from "../sentinel";

/* ---------------- pure merge (test seam) ---------------- */

/** Rows kept in memory. Older tracks stay reachable through "Load older". */
export const MAX_TRACKS = 1000;
export const MAX_FINDINGS = 500;
/**
 * The stream only says a track changed; its actions (up to 200, with bodies) are refetched
 * at most this often, so a fast agent costs one detail request a second.
 */
export const DETAIL_REFRESH_MS = 1000;

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

/** How far a finding's proposal has come. It never goes back, so a later copy only moves it forward. */
const PROPOSAL_STAGE: Record<ProposalStatus, number> = { pending: 0, failed: 1, ready: 2 };

/** A proposal never disappears: an older copy does not replace a copy that is further along. */
export function mergeFindings(list: Finding[], incoming: Finding[]): Finding[] {
  if (incoming.length === 0) return list;
  const byId = new Map(list.map((f) => [f.findingId, f] as const));
  for (const f of incoming) {
    const known = byId.get(f.findingId);
    if (!known || PROPOSAL_STAGE[f.proposalStatus] >= PROPOSAL_STAGE[known.proposalStatus]) byId.set(f.findingId, f);
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

export type ProposalState = "ready" | "pending" | "failed" | "unavailable";

/** `aiEnabled` is null while health is unknown: show the proposal as pending, not as missing. */
export function proposalState(f: Finding, aiEnabled: boolean | null): ProposalState {
  if (f.proposal) return "ready";
  if (aiEnabled === false) return "unavailable";
  return f.proposalStatus === "failed" ? "failed" : "pending";
}

/* ---------------- store ---------------- */

interface MirrorState {
  data: MirrorData;
  /** nextCursor of the last tracks page; null when every track is loaded. */
  tracksCursor: string | null;
  loading: boolean;
  error: string | null;
  selected: string | null;
  detail: TrackDetail | null;
  select: (trackId: string) => void;
  loadOlder: () => Promise<void>;
}

export const useMirror = create<MirrorState>((set, get) => ({
  data: emptyMirror(),
  tracksCursor: null,
  loading: true,
  error: null,
  selected: null,
  detail: null,
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
      set({ error: e instanceof Error ? e.message : "Could not load older caught agents" });
    }
  },
}));

let loadCtrl: AbortController | null = null;
let detailTimer: ReturnType<typeof setTimeout> | undefined;
/** Detail requests can overlap on a slow link: only the answer to the latest one is shown. */
let detailSeq = 0;

async function loadDetail(trackId: string): Promise<void> {
  const seq = ++detailSeq;
  const current = () => seq === detailSeq && useMirror.getState().selected === trackId;
  try {
    const detail = await api.track(trackId);
    if (current()) useMirror.setState({ detail, error: null });
  } catch {
    if (current()) useMirror.setState({ error: "Could not load this caught agent" });
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
      const selected = s.selected ?? defaultAgent(data.tracks);
      return { data, tracksCursor: tracks.nextCursor, loading: false, error: null, selected };
    });
    const selected = useMirror.getState().selected;
    if (selected) void loadDetail(selected);
  } catch (e) {
    if (!ctrl.signal.aborted) useMirror.setState({ loading: false, error: e instanceof Error ? e.message : "Could not load the caught agents" });
  }
}

function onBatches(batches: StreamBatch[]): void {
  const changes = mirrorChanges(batches);
  if (changes.tracks.length === 0 && changes.findings.length === 0) return;
  const s = useMirror.getState();
  const selected = s.selected ?? defaultAgent(changes.tracks);
  useMirror.setState({ data: applyMirror(s.data, changes), selected, detail: s.detail && applyToDetail(s.detail, changes) });
  // New actions are not streamed one by one: refetch the open track, at most once per interval.
  if (selected && detailTimer === undefined && changes.tracks.some((t) => t.trackId === selected))
    detailTimer = setTimeout(() => {
      detailTimer = undefined;
      const now = useMirror.getState().selected;
      if (now) void loadDetail(now);
    }, DETAIL_REFRESH_MS);
}

/** Connects the mirror lane to the dashboard stream (`tap` is replaceable in tests). Returns the disconnect. */
export function startMirror(tap: typeof tapStream = tapStream): () => void {
  const untap = tap({ batches: onBatches, resync: () => void loadMirror() });
  return () => {
    untap();
    loadCtrl?.abort();
    clearTimeout(detailTimer);
    detailTimer = undefined;
  };
}

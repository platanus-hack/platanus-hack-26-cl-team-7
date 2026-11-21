import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, StreamBatch, Track, TrackDetail } from "@sentinel/contracts";
import type { StreamTap } from "../src/dashboard/store";
import {
  DETAIL_REFRESH_MS,
  MAX_TRACKS,
  applyMirror,
  applyToDetail,
  emptyMirror,
  loadMirror,
  mergeFindings,
  mergeTracks,
  mirrorChanges,
  proposalState,
  startMirror,
  useMirror,
} from "../src/mirror/store";

const NOW = 1_763_700_000_000;
const hex = (n: number) => n.toString(16).padStart(16, "0");

function track(p: Partial<Track> = {}): Track {
  return { trackId: `trk_${hex(1)}`, ip: "203.0.113.7", userAgent: "python-httpx/0.27.0", rule: "R3", reason: "sql injection", keys: [], openedAt: NOW, lastSeen: NOW, actions: 1, findings: 0, ...p };
}
function finding(p: Partial<Finding> = {}): Finding {
  return { findingId: `fnd_${hex(1)}`, trackId: `trk_${hex(1)}`, ts: NOW, kind: "auth_flip", endpoint: "POST /login", evidence: "401 then 200", proposal: null, proposalStatus: "pending", ...p };
}
const fix = { summary: "Bind the parameter.", generatedAt: NOW, model: "claude-opus-5-5" };
const fixed = (p: Partial<Finding> = {}) => finding({ proposal: fix, proposalStatus: "ready", ...p });
const failed = (p: Partial<Finding> = {}) => finding({ proposalStatus: "failed", ...p });
const batch = (changes: StreamBatch["changes"]): StreamBatch => ({ epoch: "E1", seq: 1, now: NOW, changes });

describe("mergeTracks", () => {
  it("keeps the newer copy of a track whatever order they arrive in", () => {
    const old = track({ actions: 1 });
    const fresh = track({ lastSeen: NOW + 5, actions: 4 });
    expect(mergeTracks([fresh], [old])[0]!.actions).toBe(4);
    expect(mergeTracks([old], [fresh])[0]!.actions).toBe(4);
    const sameTimeMore = track({ actions: 2 });
    expect(mergeTracks([old], [sameTimeMore])[0]!.actions).toBe(2);
    expect(mergeTracks([sameTimeMore], [old])[0]!.actions).toBe(2);
  });

  it("sorts by last activity and caps the list", () => {
    const many = Array.from({ length: MAX_TRACKS + 10 }, (_, i) => track({ trackId: `trk_${hex(i)}`, lastSeen: NOW + i }));
    const out = mergeTracks([], many);
    expect(out).toHaveLength(MAX_TRACKS);
    expect(out[0]!.lastSeen).toBe(NOW + MAX_TRACKS + 9);
    const list = [track()];
    expect(mergeTracks(list, [])).toBe(list);
  });
});

describe("mergeFindings", () => {
  it("never loses a proposal to an older copy without one", () => {
    const withFix = fixed();
    expect(mergeFindings([withFix], [finding()])[0]!.proposal).toEqual(fix);
    expect(mergeFindings([finding()], [withFix])[0]!.proposal).toEqual(fix);
  });

  it("keeps a failed proposal over an older pending copy, and a later proposal over both", () => {
    expect(mergeFindings([failed()], [finding()])[0]!.proposalStatus).toBe("failed");
    expect(mergeFindings([finding()], [failed()])[0]!.proposalStatus).toBe("failed");
    expect(mergeFindings([failed()], [fixed()])[0]!.proposal).toEqual(fix);
  });

  it("sorts newest first", () => {
    const out = mergeFindings([], [finding({ findingId: `fnd_${hex(1)}`, ts: NOW }), finding({ findingId: `fnd_${hex(2)}`, ts: NOW + 1 })]);
    expect(out.map((f) => f.ts)).toEqual([NOW + 1, NOW]);
  });
});

describe("stream changes", () => {
  it("picks track and finding changes out of batches and applies them", () => {
    const changes = mirrorChanges([batch([{ kind: "block", ip: "192.0.2.1", blocked: true }, { kind: "track", track: track() }, { kind: "finding", finding: finding() }])]);
    expect(changes.tracks).toHaveLength(1);
    expect(changes.findings).toHaveLength(1);
    const data = applyMirror(emptyMirror(), changes);
    expect(data.tracks[0]!.trackId).toBe(`trk_${hex(1)}`);
    expect(applyMirror(data, emptyMirror())).toBe(data);
  });

  it("updates the open track's findings and counters, and leaves other tracks' detail alone", () => {
    const detail: TrackDetail = { track: track(), actions: [], findings: [] };
    const next = applyToDetail(detail, { tracks: [track({ lastSeen: NOW + 1, findings: 1 })], findings: [fixed()] });
    expect(next.track.findings).toBe(1);
    expect(next.findings[0]!.proposal).toEqual(fix);
    expect(applyToDetail(detail, { tracks: [track({ trackId: `trk_${hex(9)}` })], findings: [] })).toBe(detail);
  });
});

describe("proposalState", () => {
  it("says ready, pending while AI works or health is unknown, and unavailable when AI is off", () => {
    expect(proposalState(fixed(), false)).toBe("ready");
    expect(proposalState(finding(), true)).toBe("pending");
    expect(proposalState(finding(), null)).toBe("pending");
    expect(proposalState(finding(), false)).toBe("unavailable");
  });

  it("says failed once the AI gave up, unless AI is off now", () => {
    expect(proposalState(failed(), true)).toBe("failed");
    expect(proposalState(failed(), null)).toBe("failed");
    expect(proposalState(failed(), false)).toBe("unavailable");
  });
});

describe("loadMirror", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the first pages, keeps a streamed newer copy, and selects the newest track", async () => {
    useMirror.setState({ data: { tracks: [track({ lastSeen: NOW + 9, actions: 7 })], findings: [] }, selected: null });
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const body = url.startsWith("/v1/tracks?")
        ? { items: [track(), track({ trackId: `trk_${hex(2)}`, lastSeen: NOW + 1 })], nextCursor: "c1" }
        : url.startsWith("/v1/findings?")
          ? { items: [finding()], nextCursor: null }
          : { track: track(), actions: [], findings: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    await loadMirror();
    const s = useMirror.getState();
    expect(s.data.tracks.map((t) => t.actions)).toEqual([7, 1]);
    expect(s.tracksCursor).toBe("c1");
    expect(s.selected).toBe(`trk_${hex(1)}`);
    expect(urls[0]).toBe("/v1/tracks?range=24h&limit=200");
  });

  it("shows an error when Sentinel cannot answer", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "internal", message: "boom" } }), { status: 500 }));
    await loadMirror();
    expect(useMirror.getState()).toMatchObject({ loading: false, error: "boom" });
  });

  it("loads older tracks from the cursor and the detail of a selected track", async () => {
    const urls: string[] = [];
    const detail: TrackDetail = { track: track({ trackId: `trk_${hex(3)}` }), actions: [], findings: [] };
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      const body = url.startsWith("/v1/tracks?") ? { items: [track({ trackId: `trk_${hex(3)}`, lastSeen: NOW - 1 })], nextCursor: null } : detail;
      return new Response(JSON.stringify(body), { status: 200 });
    });
    useMirror.setState({ tracksCursor: "c1" });
    await useMirror.getState().loadOlder();
    expect(urls[0]).toBe("/v1/tracks?range=24h&limit=200&cursor=c1");
    expect(useMirror.getState().tracksCursor).toBeNull();
    useMirror.getState().select(`trk_${hex(3)}`);
    await vi.waitFor(() => expect(useMirror.getState().detail).toEqual(detail));
    expect(urls[1]).toBe(`/v1/tracks/trk_${hex(3)}`);
  });
});

/** Answers each URL prefix with its body; records every URL asked. */
function stubFetch(routes: [prefix: string, body: (url: string) => unknown][]) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    const route = routes.find(([prefix]) => url.startsWith(prefix));
    return new Response(JSON.stringify(route ? route[1](url) : null), { status: route ? 200 : 404 });
  });
  return urls;
}

describe("startMirror", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function connect() {
    let tap: StreamTap | null = null;
    const stop = startMirror((t) => {
      tap = t;
      return () => (tap = null);
    });
    return { stop, tap: () => tap, batches: (b: StreamBatch[]) => tap!.batches(b) };
  }

  it("applies streamed tracks and findings and refetches the open track at most once per interval", async () => {
    vi.useFakeTimers();
    useMirror.setState({ data: emptyMirror(), selected: null, detail: null });
    const fresh: TrackDetail = { track: track({ lastSeen: NOW + 2, actions: 3 }), actions: [], findings: [] };
    const urls = stubFetch([["/v1/tracks/", () => fresh]]);
    const s = connect();
    s.batches([batch([{ kind: "track", track: track() }])]);
    s.batches([batch([{ kind: "track", track: track({ lastSeen: NOW + 1, actions: 2 }) }, { kind: "finding", finding: finding() }])]);
    s.batches([batch([{ kind: "block", ip: "192.0.2.1", blocked: true }])]);
    const state = useMirror.getState();
    expect(state.selected).toBe(`trk_${hex(1)}`);
    expect(state.data.tracks.map((t) => t.actions)).toEqual([2]);
    expect(state.data.findings).toHaveLength(1);
    expect(urls).toEqual([]);
    await vi.advanceTimersByTimeAsync(DETAIL_REFRESH_MS);
    expect(urls).toEqual([`/v1/tracks/trk_${hex(1)}`]);
    expect(useMirror.getState().detail).toEqual(fresh);
    s.stop();
    expect(s.tap()).toBeNull();
  });

  it("does not refetch the open track for changes to other tracks", async () => {
    vi.useFakeTimers();
    const urls = stubFetch([]);
    useMirror.setState({ data: emptyMirror(), selected: `trk_${hex(1)}`, detail: null });
    const s = connect();
    s.batches([batch([{ kind: "track", track: track({ trackId: `trk_${hex(5)}` }) }])]);
    await vi.advanceTimersByTimeAsync(DETAIL_REFRESH_MS * 2);
    expect(urls).toEqual([]);
    expect(useMirror.getState().data.tracks.map((t) => t.trackId)).toContain(`trk_${hex(5)}`);
    s.stop();
  });

  it("reloads the first pages when the dashboard resyncs after a new snapshot", async () => {
    const urls = stubFetch([
      ["/v1/tracks?", () => ({ items: [], nextCursor: null })],
      ["/v1/findings?", () => ({ items: [], nextCursor: null })],
    ]);
    const s = connect();
    s.tap()!.resync();
    await vi.waitFor(() => expect(urls).toHaveLength(2));
    expect(urls.map((u) => u.split("?")[0])).toEqual(["/v1/tracks", "/v1/findings"]);
    s.stop();
  });
});

describe("track detail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows only the answer to the latest request when two overlap", async () => {
    const id = `trk_${hex(1)}`;
    const answers: ((d: TrackDetail) => void)[] = [];
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => answers.push((d) => resolve(new Response(JSON.stringify(d), { status: 200 })))));
    useMirror.setState({ selected: null, detail: null });
    useMirror.getState().select(id);
    useMirror.getState().select(id);
    await vi.waitFor(() => expect(answers).toHaveLength(2));
    const older: TrackDetail = { track: track({ actions: 1 }), actions: [], findings: [] };
    const newer: TrackDetail = { track: track({ actions: 9 }), actions: [], findings: [] };
    answers[1]!(newer);
    await vi.waitFor(() => expect(useMirror.getState().detail).toEqual(newer));
    answers[0]!(older);
    await new Promise((r) => setTimeout(r, 10));
    expect(useMirror.getState().detail).toEqual(newer);
  });

  it("says the track could not load when Sentinel fails, and drops a late answer for a track no longer open", async () => {
    stubFetch([]);
    useMirror.setState({ selected: null, detail: null, error: null });
    useMirror.getState().select(`trk_${hex(7)}`);
    await vi.waitFor(() => expect(useMirror.getState().error).toBe("Could not load this track"));
    const late: TrackDetail = { track: track({ trackId: `trk_${hex(8)}` }), actions: [], findings: [] };
    let answer: (() => void) | undefined;
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (answer = () => resolve(new Response(JSON.stringify(late), { status: 200 })))));
    useMirror.getState().select(`trk_${hex(8)}`);
    useMirror.setState({ selected: `trk_${hex(9)}` });
    await vi.waitFor(() => expect(answer).toBeDefined());
    answer!();
    await new Promise((r) => setTimeout(r, 10));
    expect(useMirror.getState().detail).toBeNull();
  });
});

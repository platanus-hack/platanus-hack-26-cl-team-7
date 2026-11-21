import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, StreamBatch, Track, TrackDetail } from "@sentinel/contracts";
import {
  MAX_TRACKS,
  applyMirror,
  applyToDetail,
  emptyMirror,
  loadMirror,
  mergeFindings,
  mergeTracks,
  mirrorChanges,
  proposalState,
  useMirror,
} from "../src/mirror/store";

const NOW = 1_763_700_000_000;
const hex = (n: number) => n.toString(16).padStart(16, "0");

function track(p: Partial<Track> = {}): Track {
  return { trackId: `trk_${hex(1)}`, ip: "203.0.113.7", userAgent: "python-httpx/0.27.0", rule: "R3", reason: "sql injection", keys: [], openedAt: NOW, lastSeen: NOW, actions: 1, findings: 0, ...p };
}
function finding(p: Partial<Finding> = {}): Finding {
  return { findingId: `fnd_${hex(1)}`, trackId: `trk_${hex(1)}`, ts: NOW, kind: "auth_flip", endpoint: "POST /login", evidence: "401 then 200", proposal: null, ...p };
}
const fix = { summary: "Bind the parameter.", generatedAt: NOW, model: "claude-opus-5-5" };
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
    const withFix = finding({ proposal: fix });
    expect(mergeFindings([withFix], [finding()])[0]!.proposal).toEqual(fix);
    expect(mergeFindings([finding()], [withFix])[0]!.proposal).toEqual(fix);
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
    const next = applyToDetail(detail, { tracks: [track({ lastSeen: NOW + 1, findings: 1 })], findings: [finding({ proposal: fix })] });
    expect(next.track.findings).toBe(1);
    expect(next.findings[0]!.proposal).toEqual(fix);
    expect(applyToDetail(detail, { tracks: [track({ trackId: `trk_${hex(9)}` })], findings: [] })).toBe(detail);
  });
});

describe("proposalState", () => {
  it("says ready, pending while AI works or health is unknown, and unavailable when AI is off", () => {
    expect(proposalState(finding({ proposal: fix }), false)).toBe("ready");
    expect(proposalState(finding(), true)).toBe("pending");
    expect(proposalState(finding(), null)).toBe("pending");
    expect(proposalState(finding(), false)).toBe("unavailable");
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

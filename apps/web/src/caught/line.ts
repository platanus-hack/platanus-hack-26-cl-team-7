/**
 * Marks of the mirror line. Interface: `lineMarks(detail)` and `lineItems(geometry, bins)`.
 * The decoy side has two parts on one time axis. The API sends only the newest requests,
 * so the time from the catch to the oldest loaded request is one band that holds the count
 * of earlier requests; the loaded window gets the rest of the width, so its requests spread
 * out. Requests are grouped into bins (a density strip); proofs and fixes keep their own
 * marks at their true times. Pure, so it is tested.
 */
import type { TrackDetail } from "@sentinel/contracts";
import { PROOF_TITLE, proofDetail, requestLine } from "./plain";

export type MarkKind = "request" | "proof" | "fix";
/** "band": the stretch of earlier requests that are not loaded. "window": the loaded requests. */
export type Segment = "band" | "window";

export interface LineMark {
  id: string;
  kind: MarkKind;
  ts: number;
  seg: Segment;
  /** 0 at the start of its segment, 1 at the end. */
  at: number;
  /** What was proved or fixed, in plain words. Null for a request. */
  title: string | null;
  /** The literal request line (or endpoint) the readout shows in mono. */
  text: string;
  status: number | null;
}

export interface LineGeometry {
  /** The catch. */
  start: number;
  /** Where the band ends and the loaded window starts. Equal to `start` when every request is loaded. */
  breakAt: number;
  end: number;
  marks: LineMark[];
  /** Requests the API did not send: the band's count. */
  notLoaded: number;
}

export function lineMarks(detail: TrackDetail): LineGeometry {
  const { track, actions, findings } = detail;
  const raw: Omit<LineMark, "at" | "seg">[] = [];
  for (const a of actions) raw.push({ id: a.eventId, kind: "request", ts: a.ts, title: null, text: requestLine(a), status: a.status });
  for (const f of findings) {
    raw.push({ id: f.findingId, kind: "proof", ts: f.ts, title: `${PROOF_TITLE[f.kind]}:`, text: proofDetail(f).request ?? f.endpoint, status: null });
    if (f.proposal) raw.push({ id: `${f.findingId}:fix`, kind: "fix", ts: f.proposal.generatedAt, title: "Fix written for", text: f.endpoint, status: null });
  }
  const start = track.openedAt;
  const end = Math.max(start + 1000, track.lastSeen, ...raw.map((m) => m.ts));
  const notLoaded = Math.max(0, track.actions - actions.length);
  const oldest = actions.length ? Math.min(...actions.map((a) => a.ts)) : end;
  const breakAt = notLoaded > 0 ? Math.min(end - 1000, Math.max(start, oldest)) : start;
  const frac = (ts: number, from: number, to: number) => (to > from ? Math.min(1, Math.max(0, (ts - from) / (to - from))) : 0);
  const marks = raw
    .map((m): LineMark => {
      const seg: Segment = notLoaded > 0 && m.kind !== "request" && m.ts < breakAt ? "band" : "window";
      return { ...m, seg, at: seg === "band" ? frac(m.ts, start, breakAt) : frac(m.ts, breakAt, end) };
    })
    .sort((a, b) => a.ts - b.ts || order(a.kind) - order(b.kind));
  return { start, breakAt, end, marks, notLoaded };
}

const order = (k: MarkKind) => (k === "request" ? 0 : k === "proof" ? 1 : 2);

/** One stop on the line: a bin of requests, or one proof or fix. */
export interface LineItem {
  id: string;
  kind: MarkKind;
  seg: Segment;
  /** Centre of the item in its segment, 0 to 1. */
  at: number;
  /** Requests in a bin, oldest first; the one mark for a proof or fix. */
  marks: LineMark[];
  /** Index of a request bin, for its width; -1 for a proof or fix. */
  bin: number;
}

/**
 * Groups the window's requests into `bins` equal bins (each at least one hit area wide on
 * screen) and keeps proofs and fixes as they are. Items come in left-to-right order.
 */
export function lineItems(geo: LineGeometry, bins: number): LineItem[] {
  const n = Math.max(1, Math.floor(bins));
  const groups = new Map<number, LineMark[]>();
  const items: LineItem[] = [];
  for (const m of geo.marks) {
    if (m.kind !== "request") {
      items.push({ id: m.id, kind: m.kind, seg: m.seg, at: m.at, marks: [m], bin: -1 });
      continue;
    }
    const b = Math.min(n - 1, Math.floor(m.at * n));
    const g = groups.get(b);
    if (g) g.push(m);
    else groups.set(b, [m]);
  }
  for (const [b, marks] of groups) items.push({ id: `bin:${b}`, kind: "request", seg: "window", at: (b + 0.5) / n, marks, bin: b });
  const x = (i: LineItem) => (i.seg === "band" ? -1 : 0) + i.at;
  return items.sort((a, b) => x(a) - x(b) || order(a.kind) - order(b.kind));
}

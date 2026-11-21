/**
 * The mirror line. Interface: `<MirrorLine detail={…} />`.
 * One horizontal line of a caught agent's requests in time order. Left of the glass line
 * (the catch) is the real shop, drawn as a short dim stub: there is no per-request data
 * for it. Right of it the decoy: a band that holds the earlier requests the API did not
 * send, then the loaded requests as a density strip of narrow bars (taller bars hold more requests).
 * A proof is a Flare mark above the line and a fix a Mend mark below it, at their true times.
 * Marks are one tab stop; arrow keys, Home and End move between them.
 * Only a mark that arrives after the first render animates in.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import type { TrackDetail } from "@sentinel/contracts";
import { clock, cn, num } from "../ui";
import { lineItems, lineMarks, type LineItem, type LineMark } from "./line";
import { Readout, itemLabel } from "./LineReadout";
import "./mirror-line.css";

/** Narrowest bin on screen, so each one is a 24 px hit area. */
const BIN_PX = 24;

/** Ids seen on the first render of this agent's line, so only later marks animate in. */
function useNewIds(trackId: string, marks: LineMark[]): Set<string> {
  const seen = useRef<{ trackId: string; ids: Set<string> } | null>(null);
  if (seen.current?.trackId !== trackId) seen.current = { trackId, ids: new Set(marks.map((m) => m.id)) };
  const fresh = new Set<string>();
  for (const m of marks) if (!seen.current.ids.has(m.id)) fresh.add(m.id);
  useEffect(() => {
    for (const id of fresh) seen.current?.ids.add(id);
  });
  return fresh;
}

/** Width of an element in pixels, kept current. */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function binStyle(item: LineItem, bins: number, most: number): CSSProperties {
  const c = item.marks.length;
  const share = Math.sqrt(c / most);
  return {
    left: `${item.at * 100}%`,
    width: `${100 / bins}%`,
    ["--h" as string]: `${Math.round(4 + 18 * share)}px`,
    ["--w" as string]: c === 1 ? "2px" : "4px",
    ["--o" as string]: (0.55 + 0.45 * share).toFixed(2),
  };
}

export function MirrorLine({ detail }: { detail: TrackDetail }) {
  const geo = useMemo(() => lineMarks(detail), [detail]);
  const [windowRef, windowPx] = useWidth<HTMLDivElement>();
  const bins = Math.max(1, Math.floor((windowPx || 480) / BIN_PX));
  const items = useMemo(() => lineItems(geo, bins), [geo, bins]);
  const most = Math.max(1, ...items.map((i) => (i.kind === "request" ? i.marks.length : 1)));
  const trackId = detail.track.trackId;
  const fresh = useNewIds(trackId, geo.marks);
  const [hover, setHover] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const boxRef = useRef<HTMLDivElement>(null);

  // The tab stop starts on the newest mark and follows the arrow keys.
  const stop = items.find((m) => m.id === tabId) ?? items[items.length - 1];
  const active = items.find((m) => m.id === (hover ?? focusId));

  useEffect(() => {
    setTabId(null);
    setHover(null);
    // On a narrow screen the line scrolls. Open it at its start, so the real-shop stub and the
    // catch line (the point of the picture) are in view; newer requests are a scroll away.
    const box = boxRef.current;
    if (box) box.scrollLeft = 0;
  }, [trackId]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((m) => m.id === focusId);
    if (i === -1) return;
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const m = items[Math.max(0, Math.min(items.length - 1, next))]!;
    setTabId(m.id);
    refs.current.get(m.id)?.focus();
  };

  const mark = (item: LineItem) => (
    <button
      key={item.id}
      ref={(el) => {
        if (el) refs.current.set(item.id, el);
        else refs.current.delete(item.id);
      }}
      type="button"
      tabIndex={item.id === stop?.id ? 0 : -1}
      className={cn("ml-mark", `ml-${item.kind}`, item.marks.some((m) => fresh.has(m.id)) && "ml-new", active?.id === item.id && "ml-on")}
      style={item.kind === "request" ? binStyle(item, bins, most) : { left: `${item.at * 100}%` }}
      aria-label={itemLabel(item)}
      onMouseEnter={() => setHover(item.id)}
      onFocus={() => {
        setFocusId(item.id);
        setTabId(item.id);
      }}
      onBlur={() => setFocusId((id) => (id === item.id ? null : id))}
    >
      <span />
    </button>
  );

  const banded = geo.notLoaded > 0;
  const empty = items.length === 0;
  const after = empty ? "Nothing has reached the decoy copy of the shop since." : "Every request after the catch ran on the decoy copy of the shop.";
  return (
    <figure className="ml-fig">
      <figcaption className="sr-only">
        Requests in time order. Caught at {clock(geo.start)}; before that the agent was on the real shop. {after}
        {banded && ` The first ${num(geo.notLoaded)} decoy requests are not loaded and show as one band.`}
      </figcaption>
      <div className="ml-box" ref={boxRef}>
        <div className="ml">
          <div className="ml-real" aria-hidden>
            <span className="ml-label">Real shop</span>
            <span className="ml-stub" />
          </div>
          <div className={cn("ml-decoy", banded && "ml-banded")}>
            <span className="ml-label">Decoy copy of the shop</span>
            <span className="ml-catch" aria-hidden />
            <span className="ml-track" aria-hidden />
            <div
              className="ml-marks"
              role={empty ? undefined : "group"}
              aria-label={empty ? undefined : `${num(items.length)} ${items.length === 1 ? "mark" : "marks"} in time order. Use the arrow keys to move between them.`}
              onKeyDown={onKey}
              onMouseLeave={() => setHover(null)}
            >
              <div className="ml-seg ml-seg-band">
                {banded && (
                  <span className="ml-band">
                    <span>{num(geo.notLoaded)} earlier requests</span>
                  </span>
                )}
                {items.filter((i) => i.seg === "band").map(mark)}
              </div>
              <div className="ml-seg ml-seg-window" ref={windowRef}>
                {items.filter((i) => i.seg === "window").map(mark)}
              </div>
            </div>
            <span className="ml-axis tnum" aria-hidden>
              <span>Caught {clock(geo.start)}</span>
              {banded && <span className="ml-axis-break">{clock(geo.breakAt)}</span>}
              <span className="ml-axis-end">{clock(geo.end)}</span>
            </span>
          </div>
        </div>
      </div>
      <div className="ml-foot">
        <Readout item={active} empty={empty} />
        <ul className="ml-legend small fog" aria-label="Legend">
          <li>
            <span className="ml-key ml-key-request" aria-hidden />
            Decoy requests
          </li>
          <li>
            <span className="ml-key ml-key-proof" aria-hidden />
            Proof
          </li>
          <li>
            <span className="ml-key ml-key-fix" aria-hidden />
            Fix
          </li>
        </ul>
      </div>
    </figure>
  );
}

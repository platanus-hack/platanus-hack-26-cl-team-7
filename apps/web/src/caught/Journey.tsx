/**
 * The selected caught agent's journey. Interface: `<Journey />`.
 * Who it is and why it was caught, the mirror line, what it proved with each fix,
 * and the decoy request log. Every string from the agent renders as text only.
 */
import { useEffect, useRef } from "react";
import { useMirror } from "../mirror/store";
import { Skeleton, dayClock, num } from "../ui";
import { MirrorLine } from "./MirrorLine";
import { Proofs } from "./Proofs";
import { RequestLog } from "./RequestLog";
import { clientWords, knownBy, whyCaught } from "./plain";

/** Set when a row is picked; the journey scrolls into view once that agent has loaded. */
let scrollPending = false;

const narrow = () => window.matchMedia("(max-width: 900px)").matches;
const scrollTo = (el: Element | null) =>
  el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });

/** On a phone the journey sits below the list: after a row is picked, bring it into view once it has loaded. */
export function showJourneyWhenLoaded(alreadyShown: boolean) {
  if (!narrow()) return;
  if (alreadyShown) scrollTo(document.querySelector(".journey"));
  else scrollPending = true;
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

export function Journey() {
  const detail = useMirror((s) => s.detail);
  const selected = useMirror((s) => s.selected);
  const ref = useRef<HTMLElement>(null);
  const loaded = detail?.track.trackId === selected ? selected : null;

  useEffect(() => {
    if (!loaded || !scrollPending) return;
    scrollPending = false;
    scrollTo(ref.current);
  }, [loaded]);

  if (!detail || detail.track.trackId !== selected) {
    return (
      <section className="journey" aria-label="Caught agent" aria-busy>
        <Skeleton w={240} h={28} />
        <Skeleton w="70%" h={14} style={{ marginTop: 14 }} />
        <Skeleton w="100%" h={96} style={{ marginTop: 28 }} />
      </section>
    );
  }

  const t = detail.track;
  const n = t.actions;
  return (
    <section className="journey" aria-labelledby="journey-h" ref={ref}>
      <header className="j-head">
        <h2 id="journey-h">
          <span className="tnum">{t.ip}</span>
          <span className="j-browser">{clientWords(t)}</span>
        </h2>
        <p className="j-story">
          Caught at <span className="tnum">{dayClock(t.openedAt, Date.now(), true)}</span> because it {lower(whyCaught(t.rule, t.reason))}.{" "}
          {n === 0 ? "It has sent nothing since." : `Since then it sent ${num(n)} ${n === 1 ? "request" : "requests"}, and the decoy copy of the shop answered ${n === 1 ? "it" : "every one"}.`}
        </p>
        <p className="small fog">Known by: {knownBy(t.keys)}</p>
      </header>
      <MirrorLine detail={detail} />
      <Proofs findings={detail.findings} />
      <RequestLog key={t.trackId} actions={detail.actions} total={n} />
    </section>
  );
}

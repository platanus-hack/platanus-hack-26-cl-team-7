/**
 * The replay of one caught agent: key numbers, the attack path graph, and the moments bar.
 * Interface: `<Replay detail moments onFinding autoplay? legend? graph? />`; the parent keys it by trackId.
 * A lab agent passes the proxy story (`legend`, `graph`); `autoplay` plays it once from the start.
 * A click on a moment plays it on the graph; hovering shows its request. When new requests arrive
 * while the last moment is shown, the replay follows them. `onFinding` gets the findingId of the
 * shown moment (null when it is not a proof).
 */
import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Pause, Play } from "@phosphor-icons/react";
import type { TrackDetail } from "@sentinel/contracts";
import type { GraphStory } from "../experiments/labTrack";
import { cn } from "../ui";
import { AttackGraph, KIND_COLOR } from "./AttackGraph";
import { OUTCOME, kindOf, numEs, type Moment, type MomentKind } from "./moments";
import "./replay.css";

/** Time one moment stays on the graph while playing; the flight takes 1.6 s. */
const STEP_MS = 1800;

const MIRROR_LEGEND: Record<MomentKind, string> = { fooled: "Creyó encontrar algo", win: "Vulnerabilidad confirmada", none: "No encontró nada" };

export function Replay({ detail, moments, onFinding, autoplay = false, legend, graph }: {
  detail: TrackDetail;
  moments: Moment[];
  onFinding: (id: string | null) => void;
  autoplay?: boolean;
  legend?: Record<MomentKind, string>;
  graph?: GraphStory;
}) {
  const { track, actions } = detail;
  const lastId = moments[moments.length - 1]?.id ?? null;
  const firstId = moments[0]?.id ?? null;
  // The selection is a moment id: indexes shift when old requests drop off.
  const [selId, setSelId] = useState(autoplay ? firstId : lastId);
  const [shot, setShot] = useState(0);
  const [playing, setPlaying] = useState(false);
  const prevLast = useRef(lastId);

  useEffect(() => {
    if (!autoplay || firstId === null || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = setTimeout(() => {
      setShot((n) => n + 1);
      setPlaying(true);
    }, 300);
    return () => clearTimeout(start);
  }, [autoplay, firstId]);

  // Follow the newest moment while the last one is shown. Play it only when a new moment came after
  // the previous last one; a run whose oldest request dropped off the stored window just changes id.
  useEffect(() => {
    const prev = prevLast.current;
    prevLast.current = lastId;
    if (lastId === prev) return;
    const selGone = !moments.some((x) => x.id === selId);
    if (selId !== prev && !selGone) return;
    setSelId(lastId);
    if (moments.some((x) => x.id === prev)) setShot((s) => s + 1);
  }, [lastId, selId, moments]);

  // A selected moment that dropped off the stored window falls back to the last one.
  const m = moments.find((x) => x.id === selId) ?? moments[moments.length - 1];
  const findingId = m?.finding?.findingId ?? null;
  useEffect(() => onFinding(findingId), [findingId, onFinding]);

  // Play steps through the moments in order, one every STEP_MS, and stops at the last. The effect keys on
  // the next moment's id, not the array: a refetch makes a new array every second and would reset the timer.
  const at = m ? moments.findIndex((x) => x.id === m.id) : -1;
  const nextId = moments[at + 1]?.id ?? null;
  useEffect(() => {
    if (!playing) return;
    if (nextId === null) {
      setPlaying(false);
      return;
    }
    const t = setTimeout(() => {
      setSelId(nextId);
      setShot((n) => n + 1);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, nextId]);

  if (!m) return null;
  const togglePlay = () => {
    if (playing) return setPlaying(false);
    // From the last moment, play again from the first.
    const start = at >= moments.length - 1 ? moments[0] : m;
    if (start && start.id !== m.id) setSelId(start.id);
    setShot((n) => n + 1);
    setPlaying(true);
  };
  const fooled = actions.filter((a) => kindOf(a.status) !== "none").length;
  const labels = legend ?? MIRROR_LEGEND;

  return (
    <section className="rp" aria-label={graph ? "Recorrido de la prueba" : "Repetición del ataque"}>
      <div className="rp-box">
        <AttackGraph track={track} moment={m} shot={shot} decoys={fooled} story={graph} />
        <div className="rp-ctl">
          <button type="button" className="rp-play" onClick={togglePlay} aria-label={playing ? "Pausar" : "Reproducir"}>
            {playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
          </button>
          <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
            <div className={cn("rp-bar", moments.length > 60 && "dense")} role="group" aria-label="Momentos del ataque">
              {moments.map((mo) => (
                <Tooltip.Root key={mo.id}>
                  <Tooltip.Trigger asChild>
                    <button
                      type="button"
                      className={cn("rp-seg", mo.id === m.id && "on")}
                      style={{ background: KIND_COLOR[mo.kind], flexGrow: Math.sqrt(mo.count) }}
                      aria-label={`${mo.tried}, ${numEs(mo.count)} ${mo.count === 1 ? "intento" : "intentos"}, ${legend ? labels[mo.kind].toLowerCase() : OUTCOME[mo.kind]}: ${mo.hint}`}
                      aria-pressed={mo.id === m.id}
                      onClick={() => {
                        setSelId(mo.id);
                        setShot((s) => s + 1);
                      }}
                    />
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content className="rp-tip" side="top" sideOffset={8}>
                      <span className="mono">{mo.hint}</span>
                      {mo.count > 1 && <span className="dim"> +{numEs(mo.count - 1)}</span>}
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ))}
            </div>
          </Tooltip.Provider>
        </div>
        <div className="rp-legend">
          {(["fooled", "win", "none"] as const).map((kind) => (
            <span key={kind}>
              <i style={{ background: KIND_COLOR[kind] }} />
              {labels[kind]}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The replay of one caught agent: key numbers, the attack path graph, and the moments bar.
 * Interface: `<Replay detail moments onFinding />`; the parent keys it by trackId.
 * A click on a moment plays it on the graph; hovering shows its request. When new requests arrive
 * while the last moment is shown, the replay follows them. `onFinding` gets the findingId of the
 * shown moment (null when it is not a proof).
 */
import { useEffect, useRef, useState } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { TrackDetail } from "@sentinel/contracts";
import { cn } from "../ui";
import { AttackGraph, KIND_COLOR } from "./AttackGraph";
import { OUTCOME, kindOf, numEs, type Moment } from "./moments";
import "./replay.css";

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "ok" }) {
  return (
    <div className="kpi">
      <span className="kpi-l">{label}</span>
      <span className={cn("kpi-v tnum", tone)}>{value}</span>
      {sub && <span className="kpi-s">{sub}</span>}
    </div>
  );
}

export function Replay({ detail, moments, onFinding }: { detail: TrackDetail; moments: Moment[]; onFinding: (id: string | null) => void }) {
  const { track, actions, findings } = detail;
  const lastId = moments[moments.length - 1]?.id ?? null;
  // The selection is a moment id: indexes shift when old requests drop off.
  const [selId, setSelId] = useState(lastId);
  const [shot, setShot] = useState(0);
  const prevLast = useRef(lastId);

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

  if (!m) return null;
  const fooled = actions.filter((a) => kindOf(a.status) !== "none").length;
  const partial = track.actions > actions.length;

  return (
    <section className="rp" aria-label="Repetición del ataque">
      <div className="kpis">
        <Stat label="Intentos" value={numEs(track.actions)} sub={partial ? `${numEs(actions.length)} en esta vista` : undefined} />
        <Stat label="Respuestas falsas creídas" value={numEs(fooled)} sub={partial ? "en esta vista" : undefined} />
        <Stat label="Vulnerabilidades" value={numEs(findings.length)} tone={findings.length > 0 ? "danger" : undefined} />
        <Stat label="Tienda real" value="0 visitas" sub="desde la captura" tone="ok" />
      </div>
      <div className="rp-box">
        <AttackGraph track={track} moment={m} shot={shot} decoys={fooled} />
        <Tooltip.Provider delayDuration={0} skipDelayDuration={0}>
          <div className={cn("rp-bar", moments.length > 60 && "dense")} role="group" aria-label="Momentos del ataque">
            {moments.map((mo) => (
              <Tooltip.Root key={mo.id}>
                <Tooltip.Trigger asChild>
                  <button
                    type="button"
                    className={cn("rp-seg", mo.id === m.id && "on")}
                    style={{ background: KIND_COLOR[mo.kind], flexGrow: Math.sqrt(mo.count) }}
                    aria-label={`${mo.tried}, ${numEs(mo.count)} ${mo.count === 1 ? "intento" : "intentos"}, ${OUTCOME[mo.kind]}: ${mo.hint}`}
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
        <div className="rp-legend">
          <span>
            <i style={{ background: KIND_COLOR.fooled }} />
            Creyó encontrar algo
          </span>
          <span>
            <i style={{ background: KIND_COLOR.win }} />
            Vulnerabilidad confirmada
          </span>
          <span>
            <i style={{ background: KIND_COLOR.none }} />
            No encontró nada
          </span>
        </div>
      </div>
    </section>
  );
}

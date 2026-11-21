/**
 * The animated replay of one caught agent. Interface: `<Replay detail={trackDetail} moments={buildMoments(…)} />`;
 * the parent keys it by trackId. A click on a moment plays that moment: requests fly
 * from the agent to the fake copy and back, and the agent's thought bubble shows what it
 * believes. The real shop stays locked. When new requests arrive while the last moment
 * is shown, the replay follows them.
 */
import { useEffect, useRef, useState } from "react";
import type { TrackDetail } from "@sentinel/contracts";
import { cn } from "../ui";
import { ProofDetails } from "./ProofDetails";
import { BUBBLE, OUTCOME, disguises, headline, numEs, vulnOf, type Moment, type MomentKind } from "./moments";
import "./replay.css";

const AGENT = { x: 110, y: 120 };
const FAKE = { x: 560, y: 62 };
const REAL = { x: 560, y: 162 };
const P = [
  { x: AGENT.x + 30, y: AGENT.y },
  { x: 330, y: AGENT.y },
  { x: 340, y: FAKE.y },
  { x: FAKE.x - 96, y: FAKE.y },
] as const;
const toFake = `M${P[0].x} ${P[0].y} C ${P[1].x} ${P[1].y}, ${P[2].x} ${P[2].y}, ${P[3].x} ${P[3].y}`;
const toReal = `M${P[0].x} ${P[0].y} C 330 ${AGENT.y}, 340 ${REAL.y}, ${REAL.x - 96} ${REAL.y}`;
const DOTS = 5;
const FLIGHT_MS = 1500;
const COLOR: Record<MomentKind, string> = { fooled: "var(--color-green)", win: "var(--color-ember)", none: "var(--color-mid)" };

function bezier(t: number) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return { x: w[0] * P[0].x + w[1] * P[1].x + w[2] * P[2].x + w[3] * P[3].x, y: w[0] * P[0].y + w[1] * P[1].y + w[2] * P[2].y + w[3] * P[3].y };
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Flies up to 5 dots to the fake copy and back, then shows the bubble. Returns the cancel. */
function fly(m: Moment, dots: SVGCircleElement[], fake: SVGRectElement, bubble: SVGGElement): () => void {
  const n = Math.min(DOTS, m.count);
  const t0 = performance.now();
  let raf = 0;
  bubble.style.opacity = "0";
  const frame = (now: number) => {
    const e = (now - t0) / FLIGHT_MS;
    dots.forEach((d, j) => {
      const t = e - j * 0.08;
      if (j >= n || t < 0 || t > 1) return d.setAttribute("opacity", "0");
      const p = bezier(t < 0.5 ? t * 2 : 2 - t * 2);
      d.setAttribute("cx", String(p.x));
      d.setAttribute("cy", String(p.y));
      d.setAttribute("opacity", "1");
      d.setAttribute("fill", t < 0.5 ? "var(--color-text)" : COLOR[m.kind]);
    });
    fake.setAttribute("stroke-opacity", e > 0.45 && e < 0.7 ? "1" : "0.6");
    if (e > 0.9) bubble.style.opacity = "1";
    if (e < 1 + n * 0.08) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    dots.forEach((d) => d.setAttribute("opacity", "0"));
    fake.setAttribute("stroke-opacity", "0.6");
    bubble.style.opacity = "1";
  };
}

export function Replay({ detail, moments }: { detail: TrackDetail; moments: Moment[] }) {
  const { track, actions } = detail;
  const lastId = moments[moments.length - 1]?.id ?? null;
  // The selection and the hover are moment ids: indexes shift when old requests drop off.
  const [selId, setSelId] = useState(lastId);
  const [shot, setShot] = useState(0);
  const [hover, setHover] = useState<{ id: string; x: number } | null>(null);
  const prevLast = useRef(lastId);
  const dots = useRef<SVGCircleElement[]>([]);
  const fake = useRef<SVGRectElement>(null);
  const bubble = useRef<SVGGElement>(null);
  const bar = useRef<HTMLDivElement>(null);

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
  const shown = useRef(m);
  shown.current = m;
  // Only a click or a follow plays a moment; a refetch of the same moments does not.
  useEffect(() => {
    const now = shown.current;
    if (!now || shot === 0 || reducedMotion() || !fake.current || !bubble.current) return;
    return fly(now, dots.current, fake.current, bubble.current);
  }, [shot]);

  if (!m) return null;
  const play = (id: string) => {
    setSelId(id);
    setShot((s) => s + 1);
  };
  const showHint = (id: string, el: HTMLElement) => {
    const w = bar.current?.clientWidth ?? 0;
    const x = el.offsetLeft + el.offsetWidth / 2;
    setHover({ id, x: Math.min(Math.max(x, 90), Math.max(90, w - 90)) });
  };
  const hovered = hover && moments.find((x) => x.id === hover.id);
  const disguise = disguises(track);

  return (
    <section className="rp" aria-label="Repetición del ataque">
      <p className="rp-lead">
        {headline(track, actions)} <em>Desde que lo atrapamos, tu tienda real no recibió nada.</em>
      </p>
      <div className="rp-box">
        <svg className="rp-stage" viewBox="0 0 700 210" role="img" aria-label="El agente ataca una copia falsa de la tienda. La tienda real sigue cerrada.">
          <path d={toFake} stroke="var(--color-green)" strokeOpacity={0.35} fill="none" strokeWidth={2} />
          <path d={toReal} stroke="var(--color-iron)" fill="none" strokeWidth={2} strokeDasharray="4 6" />
          <g transform={`translate(398 ${REAL.y - 6})`} stroke="var(--color-mid)" strokeWidth={1.6} fill="none">
            <rect x={-9} y={-2} width={18} height={14} rx={3} fill="var(--color-surface)" />
            <path d="M-5 -2 v-4 a5 5 0 0 1 10 0 v4" />
          </g>
          <g stroke="var(--color-text)" strokeWidth={1.6} fill="none">
            <circle cx={AGENT.x} cy={AGENT.y} r={28} fill="var(--color-surface)" />
            <rect x={AGENT.x - 12} y={AGENT.y - 8} width={24} height={17} rx={4} />
            <path d={`M${AGENT.x} ${AGENT.y - 8} v-6`} />
          </g>
          <circle cx={AGENT.x - 5} cy={AGENT.y} r={2} fill="var(--color-text)" />
          <circle cx={AGENT.x + 5} cy={AGENT.y} r={2} fill="var(--color-text)" />
          <text x={AGENT.x} y={AGENT.y + 50} textAnchor="middle" className="rp-t1">
            Agente
          </text>
          {disguise && (
            <text x={AGENT.x} y={AGENT.y + 67} textAnchor="middle" className="rp-t2">
              {disguise}
            </text>
          )}
          <g ref={bubble} className="rp-bubble">
            <rect x={AGENT.x - 70} y={8} width={140} height={30} rx={15} fill="var(--color-surface)" stroke={COLOR[m.kind]} />
            <circle cx={AGENT.x - 6} cy={46} r={4} fill="var(--color-surface)" stroke="var(--color-line)" />
            <circle cx={AGENT.x - 12} cy={56} r={2.5} fill="var(--color-surface)" stroke="var(--color-line)" />
            <text x={AGENT.x} y={28} textAnchor="middle" className="rp-t1" fill={COLOR[m.kind]}>
              {BUBBLE[m.kind]}
            </text>
          </g>
          <rect ref={fake} x={FAKE.x - 96} y={FAKE.y - 30} width={192} height={60} rx={12} fill="var(--color-surface)" stroke="var(--color-green)" strokeOpacity={0.6} strokeWidth={1.5} />
          <text x={FAKE.x} y={FAKE.y - 5} textAnchor="middle" className="rp-t1">
            Copia falsa de tu tienda
          </text>
          <text x={FAKE.x} y={FAKE.y + 14} textAnchor="middle" className="rp-t2">
            donde está el agente en realidad
          </text>
          <rect x={REAL.x - 96} y={REAL.y - 30} width={192} height={60} rx={12} fill="none" stroke="var(--color-mid)" strokeOpacity={0.5} strokeDasharray="3 4" />
          <text x={REAL.x} y={REAL.y - 5} textAnchor="middle" className="rp-t1">
            Tu tienda real
          </text>
          <text x={REAL.x} y={REAL.y + 14} textAnchor="middle" className="rp-t2">
            intacta desde la captura
          </text>
          {Array.from({ length: DOTS }, (_, j) => (
            <circle
              key={j}
              ref={(el) => {
                if (el) dots.current[j] = el;
              }}
              r={5}
              opacity={0}
            />
          ))}
        </svg>
        {m.finding && (
          <div className="rp-proof">
            <p>
              <b>Gran logro, pero solo en la copia falsa.</b> Encontró: {vulnOf(m.finding).name}, en{" "}
              <span className="mono">{m.finding.endpoint}</span>. El mismo punto débil está en tu tienda real.
            </p>
            <ProofDetails key={m.finding.findingId} f={m.finding} track={track} moments={moments} />
          </div>
        )}
      </div>
      <div
        className={cn("rp-bar", moments.length > 60 && "dense")}
        ref={bar}
        onMouseLeave={() => setHover(null)}
        onKeyDown={(e) => e.key === "Escape" && setHover(null)}
      >
        {moments.map((mo) => (
          <button
            key={mo.id}
            type="button"
            className={cn("rp-seg", mo.id === m.id && "on")}
            style={{ background: COLOR[mo.kind], flexGrow: Math.sqrt(mo.count) }}
            aria-label={`${mo.tried}, ${numEs(mo.count)} ${mo.count === 1 ? "intento" : "intentos"}, ${OUTCOME[mo.kind]}: ${mo.hint}`}
            aria-pressed={mo.id === m.id}
            onClick={() => play(mo.id)}
            onMouseEnter={(e) => showHint(mo.id, e.currentTarget)}
            onFocus={(e) => showHint(mo.id, e.currentTarget)}
            onBlur={() => setHover(null)}
          />
        ))}
        {hovered && hover && (
          <div className="rp-hint" style={{ left: hover.x }} role="tooltip">
            <span className="mono">{hovered.hint}</span>
            {hovered.count > 1 && <span className="dim"> +{numEs(hovered.count - 1)}</span>}
          </div>
        )}
      </div>
      <div className="rp-legend">
        <span>
          <i style={{ background: COLOR.fooled }} />
          Engañado: cree que encontró algo
        </span>
        <span>
          <i style={{ background: COLOR.win }} />
          Gran logro, pero en la copia falsa
        </span>
        <span>
          <i style={{ background: COLOR.none }} />
          No encontró nada
        </span>
      </div>
    </section>
  );
}

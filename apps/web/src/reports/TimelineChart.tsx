/** The attack timeline: one mark per request, x is time. Hand-written SVG with a fixed pixel height. */
import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelinePoint } from "@sentinel/contracts";
import { timelineMarks, type Tone } from "./timeline";
import { timeOf } from "./parts";
import { clock } from "../ui";

const HEIGHT = 96;
const PAD_X = 14;
const LANE_Y = 34;
const AXIS_Y = 66;

const TONE_LABEL: Record<Tone, string> = {
  damage: "Damage",
  blocked: "Blocked",
  ok: "OK (2xx, 3xx)",
  error: "Error (4xx, 5xx)",
  unknown: "No status",
};
const TONES = Object.keys(TONE_LABEL) as Tone[];
const TICK = "fill-mid font-mono text-[11px]";

/** Shape and color both change with the tone, so the marks read without color. */
function Shape({ tone, x, y }: { tone: Tone; x: number; y: number }) {
  switch (tone) {
    case "damage":
      return (
        <>
          <circle cx={x} cy={y} r={10} className="fill-none stroke-ember/40 stroke-[1.5]" />
          <circle cx={x} cy={y} r={6} className="fill-ember" />
        </>
      );
    case "blocked":
      return <circle cx={x} cy={y} r={4.5} className="fill-green" />;
    case "ok":
      return <circle cx={x} cy={y} r={4.5} className="fill-ash" />;
    case "error":
      return <circle cx={x} cy={y} r={4} className="fill-none stroke-blue stroke-2" />;
    case "unknown":
      return <circle cx={x} cy={y} r={3.5} className="fill-none stroke-mid stroke-[1.5]" />;
  }
}

/** Width of an element, kept current. `initial` is used before the first measure (and on the server). */
function useWidth<T extends HTMLElement>(initial: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry!.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function describe(p: TimelinePoint): string {
  const parts = [p.id, timeOf(p.ts), p.http_status === null ? "no status" : String(p.http_status)];
  if (p.blocked) parts.push("blocked");
  if (p.damage) parts.push("damage");
  return parts.join(", ");
}

export function Timeline({ points }: { points: TimelinePoint[] }) {
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const inner = Math.max(1, width - PAD_X * 2);
  const marks = useMemo(() => timelineMarks(points, inner), [points, inner]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p] as const)), [points]);

  if (points.length === 0) return <p className="cap">No requests to draw.</p>;

  const times = points.map((p) => Date.parse(p.ts)).filter(Number.isFinite);
  const first = Math.min(...times);
  const last = Math.max(...times);
  const blocked = points.filter((p) => p.blocked === true).length;
  const damage = points.filter((p) => p.damage).length;
  const label = `Attack timeline: ${points.length} requests, ${blocked} blocked, ${damage} with damage`;
  // Damage last, so it sits on top of the other marks.
  const ordered = [...marks].sort((a, b) => Number(a.tone === "damage") - Number(b.tone === "damage"));

  return (
    <figure>
      <div ref={ref} className="w-full">
        <svg width={width} height={HEIGHT} role="img" aria-label={label}>
          <title>{label}</title>
          <line x1={PAD_X} x2={width - PAD_X} y1={AXIS_Y} y2={AXIS_Y} className="stroke-line" />
          {ordered.map((m) => (
            <g key={m.id} transform={`translate(${PAD_X} 0)`}>
              <line x1={m.x} x2={m.x} y1={LANE_Y} y2={AXIS_Y} className="stroke-line" />
              <Shape tone={m.tone} x={m.x} y={LANE_Y} />
              <title>{describe(byId.get(m.id)!)}</title>
            </g>
          ))}
          {Number.isFinite(first) && (
            <>
              <text x={first === last ? width / 2 : PAD_X} y={HEIGHT - 6} textAnchor={first === last ? "middle" : "start"} className={TICK}>
                {clock(first)}
              </text>
              {first !== last && (
                <text x={width - PAD_X} y={HEIGHT - 6} textAnchor="end" className={TICK}>
                  {clock(last)}
                </text>
              )}
            </>
          )}
        </svg>
      </div>
      <figcaption>
        <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ash" aria-label="Legend">
          {TONES.map((tone) => (
            <li key={tone} className="inline-flex items-center gap-0.5">
              <svg width={22} height={22} aria-hidden>
                <Shape tone={tone} x={11} y={11} />
              </svg>
              {TONE_LABEL[tone]}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

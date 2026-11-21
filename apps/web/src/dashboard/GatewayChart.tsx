/**
 * Gateway attacks chart. Interface: `<AttacksChart />`. A hand-written SVG (no chart library)
 * of received and killed attacks per bucket, reading the dashboard store.
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { SeriesPoint } from "@sentinel/contracts";
import { useDashboard } from "./store";
import { Skeleton, clock, num } from "../ui";

/* ---------------- attacks chart: hand-written SVG (no chart library) ---------------- */

const PAD = { top: 10, right: 8, bottom: 22, left: 4 };

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize((s) => (s.w === Math.round(r.width) && s.h === Math.round(r.height) ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Scales and SVG paths for the series. Pure, so the chart only recomputes when data or size change. */
function chartGeometry(series: SeriesPoint[], w: number, h: number) {
  const iw = Math.max(1, w - PAD.left - PAD.right);
  const ih = Math.max(1, h - PAD.top - PAD.bottom);
  const t0 = series[0]?.t ?? 0;
  const t1 = series[series.length - 1]?.t ?? 1;
  const span = Math.max(1, t1 - t0);
  const max = Math.max(4, ...series.map((p) => Math.max(p.received, p.killed))) * 1.12;
  const x = (t: number) => PAD.left + ((t - t0) / span) * iw;
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const line = (key: "received" | "killed") => series.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const killed = line("killed");
  const base = y(0).toFixed(1);
  const area = series.length ? `${killed}L${x(t1).toFixed(1)},${base}L${x(t0).toFixed(1)},${base}Z` : "";
  const labelCount = Math.max(2, Math.min(7, Math.floor(iw / 110)));
  const ticks = Array.from({ length: labelCount }, (_, i) => t0 + (span * i) / (labelCount - 1));
  // Ticks closer than a minute need seconds, or two labels would read the same.
  const tickSeconds = span / (labelCount - 1) < 60_000;
  return { x, y, received: line("received"), killed, area, ticks, tickSeconds, baseY: y(0), t0, span, iw };
}

const AttacksSvg = memo(function AttacksSvg({ series, w, h }: { series: SeriesPoint[]; w: number; h: number }) {
  const g = useMemo(() => chartGeometry(series, w, h), [series, w, h]);
  const [hover, setHover] = useState<number | null>(null);
  const point = hover === null ? undefined : series[hover];

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    if (series.length === 0) return;
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const ratio = Math.min(1, Math.max(0, (px - PAD.left) / g.iw));
    setHover(Math.round(ratio * (series.length - 1)));
  };

  return (
    <div className="relative h-full w-full">
      <svg width={w} height={h} role="img" aria-label="Received and killed attacks over time" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="killedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ede8dd" stopOpacity={0.18} />
            <stop offset="1" stopColor="#ede8dd" stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={w - PAD.right} y1={g.baseY} y2={g.baseY} stroke="rgba(237,232,221,.1)" />
        <path d={g.area} fill="url(#killedFill)" />
        <path d={g.received} fill="none" stroke="#9faeb9" strokeWidth={1.5} strokeDasharray="3 3" />
        <path d={g.killed} fill="none" stroke="#ede8dd" strokeWidth={2} strokeLinejoin="round" />
        {series.length > 0 && <circle cx={g.x(series[series.length - 1]!.t)} cy={g.y(series[series.length - 1]!.killed)} r={4} fill="#ede8dd" stroke="#1f2a33" strokeWidth={2} />}
        {g.ticks.map((t, i) => (
          <text key={i} x={g.x(t)} y={h - 4} textAnchor={i === 0 ? "start" : i === g.ticks.length - 1 ? "end" : "middle"} fill="#9faeb9" fontSize={11} fontFamily="Instrument Sans Variable, system-ui, sans-serif">
            {i === g.ticks.length - 1 ? "now" : clock(t, g.tickSeconds)}
          </text>
        ))}
        {point && (
          <g pointerEvents="none">
            <line x1={g.x(point.t)} x2={g.x(point.t)} y1={PAD.top} y2={g.baseY} stroke="rgba(237,232,221,.22)" />
            <circle cx={g.x(point.t)} cy={g.y(point.killed)} r={4} fill="#ede8dd" stroke="#1f2a33" strokeWidth={2} />
          </g>
        )}
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-line bg-shoal px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(w - 190, Math.max(0, g.x(point.t) + 12)) }}
        >
          <div className="mono mb-1 text-fog">{clock(point.t, false)}</div>
          <div className="flex gap-4 whitespace-nowrap">
            <span className="text-fog">
              Received <b className="mono font-normal text-paper">{num(point.received)}</b>
            </span>
            <span className="text-fog">
              Killed <b className="mono font-normal text-paper">{num(point.killed)}</b>
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

export function AttacksChart() {
  const series = useDashboard((s) => s.data.series);
  const loading = useDashboard((s) => s.conn === "loading");
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <section className="sect" aria-label="Attacks over time">
      <div className="hd">
        <h2>Attacks</h2>
        <div className="r legend">
          <span>
            <i style={{ background: "#9faeb9" }} />
            Received
          </span>
          <span>
            <i style={{ background: "#ede8dd" }} />
            Killed
          </span>
        </div>
      </div>
      <div ref={ref} className="min-h-0 flex-1 px-6 pb-3 pt-2">
        {loading && series.length === 0 ? <Skeleton w="100%" h={240} /> : size.w > 0 && <AttacksSvg series={series} w={size.w} h={size.h} />}
      </div>
    </section>
  );
}


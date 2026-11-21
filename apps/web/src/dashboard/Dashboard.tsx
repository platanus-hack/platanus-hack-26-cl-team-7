/**
 * The dashboard window. Interface: `<Dashboard sidebarOverlay={…} />`.
 * Inside: title bar, attacks chart (hand-written SVG), virtualized live feed,
 * attackers list and attacker panel, all reading the dashboard store.
 */
import { memo, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowRight, Sparkles } from "lucide-react";
import { ATTACK_LABEL, RANGES, type AttackEvent, type Attacker, type Range, type SeriesPoint } from "@sentinel/contracts";
import { useDashboard } from "./store";
import { Orb, Segmented, Skeleton, Status, clock, cn, joinDefined, num } from "../ui";

const RANGE_LABEL: Record<Range, string> = { "5m": "5 min", "1h": "1 h", "24h": "24 h" };
const preloadCopilot = () => void import("../copilot/CopilotPanel");

function TitleBar() {
  const range = useDashboard((s) => s.data.range);
  const conn = useDashboard((s) => s.conn);
  const open = useDashboard((s) => s.copilotOpen);
  const setRange = useDashboard((s) => s.setRange);
  const toggle = useDashboard((s) => s.toggleCopilot);

  return (
    <header className="bar">
      <div className="mark">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M10 2.5l6 2.3v4.6c0 4-2.6 6.9-6 8.1-3.4-1.2-6-4.1-6-8.1V4.8z" />
          <path d="M7.2 10.2l2 2 3.6-3.9" />
        </svg>
        Sentinel
      </div>
      {conn === "reconnecting" && (
        <span className="conn" role="status">
          <i />
          Reconnecting…
        </span>
      )}
      {conn === "offline" && (
        <span className="conn" role="status">
          <i />
          Sentinel is offline
        </span>
      )}
      <Segmented label="Time range" value={range} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} onChange={setRange} />
      <button type="button" className="ask" aria-pressed={open} onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
        <Orb size={20} />
        Copilot
        <kbd className="kbd">⌘K</kbd>
      </button>
    </header>
  );
}

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
            <stop offset="0" stopColor="#00f575" stopOpacity={0.18} />
            <stop offset="1" stopColor="#00f575" stopOpacity={0} />
          </linearGradient>
        </defs>
        <line x1={PAD.left} x2={w - PAD.right} y1={g.baseY} y2={g.baseY} stroke="rgba(255,255,255,.08)" />
        <path d={g.area} fill="url(#killedFill)" />
        <path d={g.received} fill="none" stroke="#c5c8d0" strokeWidth={1.5} strokeDasharray="3 3" />
        <path d={g.killed} fill="none" stroke="#00f575" strokeWidth={2} strokeLinejoin="round" />
        {series.length > 0 && <circle cx={g.x(series[series.length - 1]!.t)} cy={g.y(series[series.length - 1]!.killed)} r={4} fill="#00f575" stroke="#000" strokeWidth={2} />}
        {g.ticks.map((t, i) => (
          <text key={i} x={g.x(t)} y={h - 4} textAnchor={i === 0 ? "start" : i === g.ticks.length - 1 ? "end" : "middle"} fill="#8a8f9b" fontSize={11} fontFamily="ui-monospace, SF Mono, Menlo, monospace">
            {i === g.ticks.length - 1 ? "now" : clock(t, g.tickSeconds)}
          </text>
        ))}
        {point && (
          <g pointerEvents="none">
            <line x1={g.x(point.t)} x2={g.x(point.t)} y1={PAD.top} y2={g.baseY} stroke="rgba(255,255,255,.14)" />
            <circle cx={g.x(point.t)} cy={g.y(point.killed)} r={4} fill="#00f575" stroke="#000" strokeWidth={2} />
          </g>
        )}
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-1 rounded-lg border border-line bg-elev px-3 py-2 text-xs shadow-xl"
          style={{ left: Math.min(w - 190, Math.max(0, g.x(point.t) + 12)) }}
        >
          <div className="mono mb-1 text-mid">{clock(point.t, false)}</div>
          <div className="flex gap-4 whitespace-nowrap">
            <span className="text-ash">
              Received <b className="mono font-normal text-text">{num(point.received)}</b>
            </span>
            <span className="text-ash">
              Killed <b className="mono font-normal text-green">{num(point.killed)}</b>
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

function AttacksChart() {
  const series = useDashboard((s) => s.data.series);
  const loading = useDashboard((s) => s.conn === "loading");
  const [ref, size] = useSize<HTMLDivElement>();
  return (
    <section className="sect" aria-label="Attacks over time">
      <div className="hd">
        <h2>Attacks</h2>
        <div className="r legend">
          <span>
            <i style={{ background: "#c5c8d0" }} />
            Received
          </span>
          <span>
            <i style={{ background: "#00f575" }} />
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

const FEED_ROW = 47;

const FeedRow = memo(function FeedRow({ e, selected, fresh, onSelect, onHover }: { e: AttackEvent; selected: boolean; fresh: boolean; onSelect: (ip: string) => void; onHover: (ip: string) => void }) {
  return (
    <div role="row" className={cn("trow feed-cols", selected && "sel", fresh && "fresh")} onClick={() => onSelect(e.ip)} onMouseEnter={() => onHover(e.ip)}>
      <span className="mono dim tnum">{clock(e.ts)}</span>
      <span className="truncate pr-4">{ATTACK_LABEL[e.attackType]}</span>
      <span className="mono truncate">{e.ip}</span>
      <Status status={e.status} />
    </div>
  );
});

function LiveFeed() {
  const events = useDashboard((s) => s.data.events);
  const loading = useDashboard((s) => s.conn === "loading");
  const selectedIp = useDashboard((s) => (s.copilotOpen ? null : s.selectedIp));
  const select = useDashboard((s) => s.select);
  const prefetch = useDashboard((s) => s.prefetch);
  const parent = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: events.length, getScrollElement: () => parent.current, estimateSize: () => FEED_ROW, overscan: 8, getItemKey: (i) => events[i]!.id });
  const freshAfter = Date.now() - 1500;

  return (
    <section className="sect" aria-label="Live feed">
      <div className="hd">
        <h2>Live feed</h2>
      </div>
      <div className="thead feed-cols" role="row">
        <span>Time</span>
        <span>Attack</span>
        <span>Attacker</span>
        <span>Status</span>
      </div>
      <div ref={parent} className="scroll" role="rowgroup">
        {loading && events.length === 0 ? (
          Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="trow feed-cols">
              <Skeleton w={70} />
              <Skeleton w={120} />
              <Skeleton w={100} />
              <Skeleton w={56} />
            </div>
          ))
        ) : events.length === 0 ? (
          <p className="px-6 py-8 text-sm text-mid">No attacks in this time range. New attacks show here as they arrive.</p>
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((it) => {
              const e = events[it.index]!;
              return (
                <div key={it.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
                  <FeedRow e={e} selected={e.ip === selectedIp} fresh={e.ts > freshAfter} onSelect={select} onHover={prefetch} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

const AttackerRow = memo(function AttackerRow({ a, selected, onSelect, onHover }: { a: Attacker; selected: boolean; onSelect: (ip: string) => void; onHover: (ip: string) => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className="att-row" onClick={() => onSelect(a.ip)} onMouseEnter={() => onHover(a.ip)}>
      <span className="truncate">
        <span className={a.notKilled > 0 ? "dot hot" : "dot"} />
        <span className="mono">{a.ip}</span>
      </span>
      <span className="dim truncate">{a.country ?? "Unknown"}</span>
      <span className="mono tnum">{num(a.events)}</span>
    </button>
  );
});

function Attackers() {
  const attackers = useDashboard((s) => s.data.attackers);
  const loading = useDashboard((s) => s.conn === "loading");
  const selectedIp = useDashboard((s) => s.selectedIp);
  const select = useDashboard((s) => s.select);
  const prefetch = useDashboard((s) => s.prefetch);

  return (
    <section className="sect" aria-label="Attackers">
      <div className="hd pb-3">
        <h2>Attackers</h2>
        <span className="r cap">{attackers.length} active</span>
      </div>
      <div role="listbox" aria-label="Attackers by risk" className="scroll" style={{ maxHeight: 44 * 5 }}>
        {loading && attackers.length === 0
          ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="att-row">
                <Skeleton w={110} />
                <Skeleton w={60} />
                <Skeleton w={30} style={{ justifySelf: "end" }} />
              </div>
            ))
          : attackers.map((a) => <AttackerRow key={a.ip} a={a} selected={a.ip === selectedIp} onSelect={select} onHover={prefetch} />)}
        {!loading && attackers.length === 0 && <p className="px-6 py-6 text-sm text-mid">No attackers in this time range.</p>}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd title={value ?? undefined}>{value ?? <span className="text-mid">Unknown</span>}</dd>
    </div>
  );
}

function AttackerPanel() {
  const ip = useDashboard((s) => s.selectedIp);
  const attacker = useDashboard((s) => s.data.attackers.find((a) => a.ip === s.selectedIp) ?? null);
  const liveReport = useDashboard((s) => (s.selectedIp ? s.data.reports[s.selectedIp] : undefined));
  const detail = useDashboard((s) => (s.selectedIp ? s.details[s.selectedIp] : undefined));
  const aiEnabled = useDashboard((s) => s.health?.ai.enabled ?? null);
  const pending = useDashboard((s) => (s.selectedIp ? Boolean(s.pendingBlock[s.selectedIp]) : false));
  const toggleBlock = useDashboard((s) => s.toggleBlock);
  const loading = useDashboard((s) => s.conn === "loading");

  if (!attacker || !ip) {
    return (
      <section className="sect" aria-label="Attacker">
        <div className="dh">
          {loading ? <Skeleton w={180} h={26} /> : <p className="m-0 text-sm text-mid">Select an attacker to see who it is and what it tries to do.</p>}
        </div>
      </section>
    );
  }

  const report = liveReport ?? detail?.report ?? null;
  const location = joinDefined([attacker.city, attacker.country], ", ");
  const device = joinDefined([attacker.device, attacker.os]);

  return (
    <section className="sect" aria-label={`Attacker ${ip}`}>
      <div className="dh">
        <div className="ip">{ip}</div>
        <div className="sub tnum">
          {num(attacker.events)} attacks · {num(attacker.killed)} killed
          {attacker.blocked && <span className="text-mid"> · blocked</span>}
        </div>
      </div>
      <dl className="facts">
        <Fact label="Location" value={location} />
        <Fact label="Device" value={device} />
        <Fact label="Browser" value={attacker.browser} />
        <Fact label="Network" value={attacker.network} />
      </dl>
      <div className="rep">
        <div className="t">
          <Sparkles size={12} />
          AI report
        </div>
        {report ? (
          <p>{report.summary}</p>
        ) : aiEnabled === false ? (
          <p className="!text-mid">AI unavailable. Set ANTHROPIC_API_KEY for Sentinel to get reports.</p>
        ) : (
          <div className="flex flex-col gap-2 pt-1" aria-label="Writing report">
            <Skeleton w="92%" />
            <Skeleton w="80%" />
            <Skeleton w="54%" />
          </div>
        )}
      </div>
      <div className="foot">
        {attacker.blocked ? (
          <button type="button" className="btn-ghost" onClick={() => void toggleBlock(ip)} disabled={pending}>
            Unblock
          </button>
        ) : (
          <button type="button" className="btn-block" onClick={() => void toggleBlock(ip)} disabled={pending}>
            Block attacker <ArrowRight size={16} />
          </button>
        )}
      </div>
    </section>
  );
}

/* ---------------- public interface ---------------- */

/** The whole dashboard window. `sidebarOverlay` (the copilot) covers the right sidebar when given. */
export function Dashboard({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useDashboard((s) => s.error);
  return (
    <div className="shell">
      <TitleBar />
      <main className="main">
        <div className="left">
          <AttacksChart />
          <LiveFeed />
        </div>
        <div className="right">
          <Attackers />
          <AttackerPanel />
          {sidebarOverlay}
        </div>
      </main>
      {error && (
        <div role="alert" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-elev px-4 py-2 text-sm text-ash shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}

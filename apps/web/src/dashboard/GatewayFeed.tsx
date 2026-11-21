/**
 * The gateway feed tab. Interface: `<GatewayFeed />`.
 * The older /v1/events view: attacks chart, virtualized live feed, attackers list and
 * attacker panel, all reading the dashboard store. Shown only when that feed has data.
 */
import { memo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ATTACK_LABEL, type AttackEvent, type Attacker } from "@sentinel/contracts";
import { useDashboard } from "./store";
import { useReports } from "../reports/store";
import { AttacksChart } from "./GatewayChart";
import { Skeleton, Status, clock, cn, joinDefined, num } from "../ui";
import "./gateway.css";

const preloadReport = () => void import("../reports/ReportView");

const FEED_ROW = 47;

const FeedRow = memo(function FeedRow({ e, selected, onSelect, onHover }: { e: AttackEvent; selected: boolean; onSelect: (ip: string) => void; onHover: (ip: string) => void }) {
  return (
    <div role="row" className={cn("trow feed-cols", selected && "sel")} onClick={() => onSelect(e.ip)} onMouseEnter={() => onHover(e.ip)}>
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
          <p className="px-6 py-8 text-sm text-fog">No attacks in this time range. New attacks show here as they arrive.</p>
        ) : (
          <div style={{ height: v.getTotalSize(), position: "relative" }}>
            {v.getVirtualItems().map((it) => {
              const e = events[it.index]!;
              return (
                <div key={it.key} style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${it.start}px)` }}>
                  <FeedRow e={e} selected={e.ip === selectedIp} onSelect={select} onHover={prefetch} />
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

/** Rows rendered in the attackers list. The rest is summarized, so 10k attackers never mean 10k rows. */
const ATTACKER_ROWS = 100;

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
          : attackers.slice(0, ATTACKER_ROWS).map((a) => <AttackerRow key={a.ip} a={a} selected={a.ip === selectedIp} onSelect={select} onHover={prefetch} />)}
        {attackers.length > ATTACKER_ROWS && <p className="px-6 py-3 text-xs text-fog">{num(attackers.length - ATTACKER_ROWS)} more, lower risk</p>}
        {!loading && attackers.length === 0 && <p className="px-6 py-6 text-sm text-fog">No attackers in this time range.</p>}
      </div>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt>{label}</dt>
      <dd title={value ?? undefined}>{value ?? <span className="text-fog">Unknown</span>}</dd>
    </div>
  );
}

function AttackerPanel() {
  const ip = useDashboard((s) => s.selectedIp);
  const attacker = useDashboard((s) => s.data.attackers.find((a) => a.ip === s.selectedIp) ?? null);
  const liveReport = useDashboard((s) => (s.selectedIp ? s.data.reports[s.selectedIp] : undefined));
  const detail = useDashboard((s) => (s.selectedIp ? s.details[s.selectedIp] : undefined));
  const aiEnabled = useDashboard((s) => s.health?.ai.enabled ?? null);
  const pending = useDashboard((s) => (s.selectedIp ? s.selectedIp in s.pendingBlock : false));
  const toggleBlock = useDashboard((s) => s.toggleBlock);
  const investigate = useReports((s) => s.open);
  const loading = useDashboard((s) => s.conn === "loading");

  if (!attacker || !ip) {
    return (
      <section className="sect" aria-label="Attacker">
        <div className="dh">
          {loading ? <Skeleton w={180} h={26} /> : <p className="m-0 text-sm text-fog">Select an attacker to see who it is and what it tries to do.</p>}
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
          {num(attacker.events)} attacks, {num(attacker.killed)} killed.
          {attacker.blocked && " Blocked."}
        </div>
      </div>
      <dl className="facts">
        <Fact label="Location" value={location} />
        <Fact label="Device" value={device} />
        <Fact label="Browser" value={attacker.browser} />
        <Fact label="Network" value={attacker.network} />
      </dl>
      <div className="rep">
        <div className="t">AI report</div>
        {report ? (
          <p>{report.summary}</p>
        ) : aiEnabled === false ? (
          <p className="!text-fog">AI unavailable. Set ANTHROPIC_API_KEY for Sentinel to get reports.</p>
        ) : (
          <div className="flex flex-col gap-2 pt-1" aria-label="Writing report">
            <Skeleton w="92%" />
            <Skeleton w="80%" />
            <Skeleton w="54%" />
          </div>
        )}
      </div>
      <div className="foot">
        <button type="button" className="btn btn-wide" onClick={() => investigate(ip)} onMouseEnter={preloadReport} onFocus={preloadReport}>
          Investigate
        </button>
        {attacker.blocked ? (
          <button type="button" className="btn btn-wide" onClick={() => void toggleBlock(ip)} disabled={pending}>
            Unblock
          </button>
        ) : (
          <button type="button" className="btn btn-solid btn-wide" onClick={() => void toggleBlock(ip)} disabled={pending}>
            Block attacker
          </button>
        )}
      </div>
    </section>
  );
}

/** The whole gateway tab. */
export function GatewayFeed() {
  return (
    <div className="gw">
      <div className="gw-left">
        <AttacksChart />
        <LiveFeed />
      </div>
      <div className="gw-right">
        <Attackers />
        <AttackerPanel />
      </div>
    </div>
  );
}

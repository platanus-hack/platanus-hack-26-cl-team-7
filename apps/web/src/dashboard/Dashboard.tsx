/**
 * The dashboard window. Interface: `<Dashboard sidebarOverlay={…} />`.
 * Title bar (range switch, copilot), the status sentence, and the main area: the caught
 * agents screen, or the older gateway feed in a second tab when that feed has data.
 */
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { RANGES, type Range } from "@sentinel/contracts";
import { useDashboard } from "./store";
import { GatewayFeed } from "./GatewayFeed";
import { CaughtScreen, StatusLine } from "../caught/CaughtScreen";
import { hasGatewayFeed, visibleTab, type Tab } from "../caught/summary";
import { Orb, Segmented } from "../ui";

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
        </svg>
        Sentinel
      </div>
      {conn === "reconnecting" && (
        <span className="conn" role="status">
          Reconnecting…
        </span>
      )}
      {conn === "offline" && (
        <span className="conn" role="status">
          Sentinel is offline
        </span>
      )}
      <div className="bar-end">
        <Segmented label="Time range" value={range} options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))} onChange={setRange} />
        <button type="button" className="btn" aria-pressed={open} aria-keyshortcuts="Meta+K" onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
          <Orb size={14} state={open ? "talking" : "idle"} />
          <span className="btn-text">Copilot</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}

const TABS: { id: Tab; label: string }[] = [
  { id: "caught", label: "Caught agents" },
  { id: "gateway", label: "Gateway feed" },
];

function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const next = TABS[(TABS.findIndex((t) => t.id === tab) + 1) % TABS.length]!.id;
    onChange(next);
    document.getElementById(`tab-${next}`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label="Views" onKeyDown={onKey}>
      {TABS.map((t) => (
        <button
          key={t.id}
          id={`tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={t.id === tab}
          aria-controls="view"
          tabIndex={t.id === tab ? 0 : -1}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The whole dashboard window. `sidebarOverlay` (the copilot) covers the right side of the main area. */
export function Dashboard({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useDashboard((s) => s.error);
  const gateway = useDashboard((s) => hasGatewayFeed(s.data));
  const [chosen, setChosen] = useState<Tab>("caught");
  const tab = visibleTab(chosen, gateway);
  return (
    <div className="shell">
      <TitleBar />
      <div className="head">
        <StatusLine />
        {gateway && <Tabs tab={tab} onChange={setChosen} />}
      </div>
      <main className="main" id="view" role={gateway ? "tabpanel" : undefined} aria-labelledby={gateway ? `tab-${tab}` : undefined}>
        {tab === "gateway" ? <GatewayFeed /> : <CaughtScreen />}
        {sidebarOverlay}
      </main>
      {error && (
        <div role="alert" className="toast">
          {error}
        </div>
      )}
    </div>
  );
}

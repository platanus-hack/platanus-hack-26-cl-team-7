/**
 * The dashboard window. Interface: `<Dashboard sidebarOverlay={…} />`.
 * One screen: the title bar and the caught agents (../mirror/MirrorPanel).
 */
import type { ReactNode } from "react";
import { useDashboard } from "./store";
import { MirrorPanel } from "../mirror/MirrorPanel";
import { Orb } from "../ui";

const preloadCopilot = () => void import("../copilot/CopilotPanel");

function TitleBar() {
  const conn = useDashboard((s) => s.conn);
  const open = useDashboard((s) => s.copilotOpen);
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
          Reconectando…
        </span>
      )}
      {conn === "offline" && (
        <span className="conn" role="status">
          <i />
          Sentinel está desconectado
        </span>
      )}
      <a className="ml-auto text-xs underline" href="/ultimo-paso">Último Paso</a>
      <button type="button" className="ask" aria-pressed={open} onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
        <Orb size={20} />
        Copilot
        <kbd className="kbd">⌘K</kbd>
      </button>
    </header>
  );
}

/** The whole dashboard window. `sidebarOverlay` (the copilot) covers the right column when given. */
export function Dashboard({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useDashboard((s) => s.error);
  return (
    <div className="shell">
      <TitleBar />
      <MirrorPanel sidebarOverlay={sidebarOverlay} />
      {error && (
        <div role="alert" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-elev px-4 py-2 text-sm text-ash shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}

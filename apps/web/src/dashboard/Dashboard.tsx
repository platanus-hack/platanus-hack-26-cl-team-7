/**
 * The dashboard window. Interface: `<Dashboard sidebarOverlay={…} />`.
 * One screen: the title bar and the caught agents (../mirror/MirrorPanel).
 */
import { useState, type ReactNode } from "react";
import { useDashboard } from "./store";
import { MirrorPanel } from "../mirror/MirrorPanel";
import { EvidenceDemo } from "../evidence-demo/EvidenceDemo";
import { Experiments } from "../experiments/Experiments";
import { Orb } from "../ui";

const preloadCopilot = () => void import("../copilot/CopilotPanel");

type View = "experiments" | "mirror" | "evidence";

function TitleBar({ view, select }: { view: View; select: (view: View) => void }) {
  const conn = useDashboard((s) => s.conn);
  const open = useDashboard((s) => s.copilotOpen);
  const toggle = useDashboard((s) => s.toggleCopilot);

  return (
    <header className="bar sentinel-bar">
      <div className="mark">
        <img src="/presentacion/logo.svg" width={24} height={24} alt="" />
        Centinela
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
      <nav className="sentinel-views" aria-label="Vistas de Centinela">
        <a className="ask" href="/presentacion/">Presentación</a>
        <button type="button" className="ask" aria-pressed={view === "experiments"} onClick={() => select("experiments")}>Experimentos</button>
        <button type="button" className="ask" aria-pressed={view === "mirror"} onClick={() => select("mirror")}>Mirror</button>
        <button type="button" className="ask" aria-pressed={view === "evidence"} onClick={() => select("evidence")}>Demo de evidencia</button>
      </nav>
      {view === "mirror" && <button type="button" className="ask sentinel-copilot" aria-pressed={open} onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
        <Orb size={20} />
        Copilot
        <kbd className="kbd">⌘K</kbd>
      </button>}
    </header>
  );
}

/** The whole dashboard window. `sidebarOverlay` (the copilot) covers the right column when given. */
export function Dashboard({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useDashboard((s) => s.error);
  const [view, setView] = useState<View>("experiments");
  return (
    <div className="shell">
      <TitleBar view={view} select={setView} />
      {view === "experiments" && <Experiments />}
      {view === "evidence" && <EvidenceDemo />}
      {view === "mirror" && <MirrorPanel sidebarOverlay={sidebarOverlay} />}
      {error && view === "mirror" && (
        <div role="alert" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-elev px-4 py-2 text-sm text-ash shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}

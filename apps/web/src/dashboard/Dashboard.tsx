/**
 * One workspace: caught agents, the agents of the latest A/B run, and the experiment recordings.
 * The presentation is not part of it; Sentinel serves it on its own at /presentacion/.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ExperimentProject } from "@sentinel/contracts";
import { useDashboard } from "./store";
import { MirrorPanel } from "../mirror/MirrorPanel";
import { Experiments } from "../experiments/Experiments";
import { startLab, useLab } from "../experiments/lab";
import { Orb } from "../ui";

const preloadCopilot = () => void import("../copilot/CopilotPanel");

type View = "experiments" | "activity";

function currentView(): View {
  const query = new URLSearchParams(window.location.search);
  const view = query.get("view");
  if (view === "activity" || view === "mirror") return "activity";
  if (view === "experiments" || view === "evidence") return "experiments";
  return query.has("run") || query.has("project") || query.has("replay") ? "experiments" : "activity";
}

function TitleBar() {
  const conn = useDashboard((s) => s.conn);
  const open = useDashboard((s) => s.copilotOpen);
  const toggle = useDashboard((s) => s.toggleCopilot);

  return (
    <header className="bar sentinel-bar">
      <div className="mark">
        <img src="/presentacion/logo.svg" width={24} height={24} alt="" />
        Reaper
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
          Reaper está desconectado
        </span>
      )}
      <button type="button" className="ask sentinel-copilot ml-auto" aria-pressed={open} onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
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
  const [location, setLocation] = useState(() => window.location.search);
  const view = currentView();
  useEffect(() => {
    const restore = () => setLocation(window.location.search);
    window.addEventListener("popstate", restore);
    const stopLab = startLab();
    return () => {
      window.removeEventListener("popstate", restore);
      stopLab();
    };
  }, []);

  const select = useCallback((target: View, run?: string, project?: ExperimentProject) => {
    if (target === currentView() && !run) return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", target);
    if (run) {
      url.searchParams.set("run", run);
      if (project) url.searchParams.set("project", project);
      else url.searchParams.delete("project");
      url.searchParams.delete("replay");
    }
    window.history.pushState(null, "", url);
    setLocation(url.search);
  }, []);
  const openResults = useCallback((run: string, project?: ExperimentProject) => select("experiments", run, project), [select]);
  const openAgent = useCallback((run: string, project: ExperimentProject) => {
    useLab.getState().show(run, project);
    select("activity");
  }, [select]);
  const onActivity = useCallback(() => select("activity"), [select]);
  const onExperiments = useCallback(() => select("experiments"), [select]);

  return (
    <div className="shell">
      <TitleBar />
      <MirrorPanel sidebarOverlay={sidebarOverlay}
        experiments={view === "experiments" ? <Experiments key={location} openAgent={openAgent} /> : undefined}
        openResults={openResults} onActivity={onActivity} onExperiments={onExperiments} />
      {error && view === "activity" && (
        <div role="alert" className="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-line bg-elev px-4 py-2 text-sm text-ash shadow-2xl">
          {error}
        </div>
      )}
    </div>
  );
}

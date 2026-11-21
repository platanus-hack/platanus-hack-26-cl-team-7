import { lazy, Suspense, useEffect } from "react";
import { Dashboard } from "./dashboard/Dashboard";
import { connect, loadHealth, startClock, useDashboard } from "./dashboard/store";
import { useReports } from "./reports/store";
import { startMirror } from "./mirror/store";
import { Skeleton } from "./ui";

// Vite replaces the flag at build time, so a build without it does not ship these pages at all.
const ULTIMO_PASO = import.meta.env.VITE_ULTIMO_PASO === "1";
const PipelineDashboard = ULTIMO_PASO ? lazy(() => import("./ultimo-paso/PipelineDashboard").then((m) => ({ default: m.PipelineDashboard }))) : () => null;
const EvidenceDashboard = ULTIMO_PASO ? lazy(() => import("./ultimo-paso/EvidenceDashboard").then((m) => ({ default: m.EvidenceDashboard }))) : () => null;
const CopilotPanel = lazy(() => import("./copilot/CopilotPanel"));
const ReportView = lazy(() => import("./reports/ReportView").then((m) => ({ default: m.ReportView })));

function CopilotFallback() {
  return (
    <aside className="cp" aria-busy>
      <div className="cph">
        <Skeleton w={32} h={32} style={{ borderRadius: 999 }} />
        <Skeleton w={120} h={14} />
      </div>
    </aside>
  );
}

/** App lifecycle: connect to Sentinel, keep the chart clock and health fresh, ⌘K / Esc for the copilot. */
export function App() {
  // Último Paso replays recorded fixtures: only in a build made with VITE_ULTIMO_PASO=1 (Sentinel also needs ULTIMO_PASO=1).
  if (ULTIMO_PASO && (location.pathname === "/ultimo-paso" || location.pathname === "/ultimo-paso/")) {
    const search = new URLSearchParams(location.search);
    return <Suspense fallback={<p role="status">Cargando…</p>}>
      {(search.get("view") === "traces" || search.has("mode") || search.has("trace")) ? <EvidenceDashboard /> : <PipelineDashboard />}
    </Suspense>;
  }
  return <SentinelApp />;
}

function SentinelApp() {
  const copilotOpen = useDashboard((s) => s.copilotOpen);
  const reportIp = useReports((s) => s.ip);

  useEffect(() => {
    // The mirror taps the stream before the first snapshot, so that snapshot's resync loads it.
    const stopMirror = startMirror();
    connect(useDashboard.getState().data.range);
    void loadHealth();
    const stopClock = startClock();
    const healthTimer = setInterval(() => void loadHealth(), 15000);
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useDashboard.getState().toggleCopilot();
      } else if (e.key === "Escape" && useDashboard.getState().copilotOpen) {
        useDashboard.getState().toggleCopilot(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      stopClock();
      stopMirror();
      clearInterval(healthTimer);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <>
      <Dashboard
        sidebarOverlay={
          copilotOpen && (
            <Suspense fallback={<CopilotFallback />}>
              <CopilotPanel />
            </Suspense>
          )
        }
      />
      {reportIp && (
        <Suspense fallback={null}>
          <ReportView key={reportIp} ip={reportIp} />
        </Suspense>
      )}
    </>
  );
}

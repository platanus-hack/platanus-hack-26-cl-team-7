import { lazy, Suspense, useEffect } from "react";
import { Dashboard } from "./dashboard/Dashboard";
import { connect, loadHealth, startClock, useDashboard } from "./dashboard/store";
import { useReports } from "./reports/store";
import { Skeleton } from "./ui";

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

/** App lifecycle: connect to Reaper for the copilot, keep health fresh, ⌘K / Esc for the copilot. */
export function App() {
  return <SentinelApp />;
}

function SentinelApp() {
  const copilotOpen = useDashboard((s) => s.copilotOpen);
  const reportIp = useReports((s) => s.ip);

  useEffect(() => {
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

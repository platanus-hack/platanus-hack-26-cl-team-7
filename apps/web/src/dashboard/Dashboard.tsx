/**
 * The panel: one page per protected site. Interface: `<Dashboard sidebarOverlay={…} />`.
 * Left: the sites and the run shown (../site/Sidebar). Middle: the open site's analysis
 * (../site/SitePage). Right: the copilot, when open. `?site=bruma` opens a site; `?demo=1`
 * starts the guided demo. The presentation lives on its own at /presentacion/.
 */
import { useEffect, type ReactNode } from "react";
import { ExperimentProject } from "@sentinel/contracts";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { useDashboard } from "./store";
import { SitePage } from "../site/SitePage";
import { DemoBar, Sidebar } from "../site/Sidebar";
import { startSite, useSite } from "../site/store";
import { Orb, cn } from "../ui";
import "../site/site.css";

const preloadCopilot = () => void import("../copilot/CopilotPanel");

function TitleBar() {
  const open = useDashboard((s) => s.copilotOpen);
  const toggle = useDashboard((s) => s.toggleCopilot);
  const error = useSite((s) => s.error);
  return (
    <header className="bar sentinel-bar">
      <div className="mark">
        <img src="/presentacion/logo.svg" width={24} height={24} alt="" />
        Reaper
      </div>
      {error && <span className="conn" role="status"><i />{error}</span>}
      <a className="ask ml-auto" href="/presentacion/" target="_blank" rel="noreferrer">Presentación <ArrowSquareOut size={12} aria-hidden /></a>
      <button type="button" className="ask sentinel-copilot" aria-pressed={open} onClick={() => toggle()} onMouseEnter={preloadCopilot} onFocus={preloadCopilot}>
        <Orb size={20} />
        Copilot
        <kbd className="kbd">⌘K</kbd>
      </button>
    </header>
  );
}

export function Dashboard({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const sites = useSite((s) => s.sites);
  const site = useSite((s) => s.sites.find((x) => x.project === s.site) ?? null);
  const run = useSite((s) => s.runs.find((r) => r.id === s.detail?.run.id) ?? s.detail?.run ?? null);
  const demo = useSite((s) => s.demo);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const wanted = ExperimentProject.safeParse(query.get("site"));
    if (wanted.success) useSite.getState().selectSite(wanted.data);
    return startSite();
  }, []);

  // Start the demo from ?demo=1 once there is a site to show.
  useEffect(() => {
    if (sites.length && new URLSearchParams(window.location.search).get("demo") === "1" && useSite.getState().demo === null) useSite.getState().setDemo(0);
  }, [sites.length]);

  // Keep the open site in the address, so a link opens the same page.
  useEffect(() => {
    if (!site) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("site") === site.project) return;
    url.searchParams.set("site", site.project);
    window.history.replaceState(null, "", url);
  }, [site]);

  return (
    <div className="shell">
      <TitleBar />
      <main className={cn("main site-main", sidebarOverlay && "with-copilot")}>
        <Sidebar />
        <div className="site-scroll">
          {site ? <SitePage key={site.project} site={site} run={run} demoStep={demo} />
            : <p className="st-empty">{sites.length === 0 ? "Cargando la prueba A/B…" : "Elige un sitio."}</p>}
        </div>
        {sidebarOverlay && <div className="copilot-col">{sidebarOverlay}</div>}
      </main>
      <DemoBar />
    </div>
  );
}

/**
 * The panel's navigation. Interface: `<Sidebar />` and `<DemoBar />`.
 * Sidebar: the four sites with their CVE and whether the proof stayed behind, then the run shown,
 * "Ejecutar prueba A/B" and "Modo demo". DemoBar: the guided demo's words and controls (←/→, Esc).
 */
import { useEffect } from "react";
import { ArrowLeft, ArrowRight, Play, X } from "@phosphor-icons/react";
import { cn } from "../ui";
import { DEMO_STEPS } from "./demo";
import { runLabel } from "./SitePage";
import { useSite } from "./store";

export function Sidebar() {
  const sites = useSite((s) => s.sites);
  const site = useSite((s) => s.site);
  const runs = useSite((s) => s.runs);
  const detail = useSite((s) => s.detail);
  const starting = useSite((s) => s.starting);
  const selectSite = useSite((s) => s.selectSite);
  const showRun = useSite((s) => s.showRun);
  const start = useSite((s) => s.start);
  const setDemo = useSite((s) => s.setDemo);
  const live = runs.some((r) => r.status === "running") || starting;
  return (
    <aside className="sd" aria-label="Sitios">
      <h2 className="sd-h">Sitios protegidos</h2>
      <div role="listbox" aria-label="Sitios" className="sd-list">
        {sites.map((x) => (
          <button key={x.project} type="button" role="option" aria-selected={site === x.project} className="sd-row" onClick={() => selectSite(x.project)}>
            <span className={cn("sd-dot", x.live ? "live" : x.outcome.protected > 0 ? "bad" : "ok")} aria-hidden />
            <span className="sd-name">{x.name}<code>{x.cve?.id}</code></span>
            <span className="sd-score tnum" aria-label={`${x.outcome.direct} de ${x.outcome.total} sin Reaper, ${x.outcome.protected} con Reaper`}>
              {x.outcome.direct}→{x.outcome.protected}
            </span>
          </button>
        ))}
        {sites.length === 0 && <p className="sd-empty">Cargando la prueba…</p>}
      </div>
      <div className="sd-foot">
        <label className="sd-run">
          <span className="cap">Prueba</span>
          <select value={detail?.run.id ?? ""} onChange={(e) => showRun(e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
          </select>
        </label>
        <button type="button" className="ask" disabled={live} onClick={() => void start()}>
          {starting ? "Preparando…" : live ? "Prueba en curso…" : "Ejecutar prueba A/B"}
        </button>
        <button type="button" className="ask sd-demo" disabled={sites.length === 0} onClick={() => setDemo(0)}>
          <Play size={12} weight="fill" aria-hidden /> Modo demo
        </button>
      </div>
    </aside>
  );
}

export function DemoBar() {
  const demo = useSite((s) => s.demo);
  const setDemo = useSite((s) => s.setDemo);
  const site = useSite((s) => s.sites.find((x) => x.project === s.site));
  useEffect(() => {
    if (demo === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight") setDemo(Math.min(DEMO_STEPS.length - 1, demo + 1));
      else if (e.key === "ArrowLeft") setDemo(Math.max(0, demo - 1));
      else if (e.key === "Escape") setDemo(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demo, setDemo]);
  if (demo === null || !site) return null;
  const step = DEMO_STEPS[demo]!;
  return (
    <div className="db" role="region" aria-label="Modo demo" aria-live="polite">
      <span className="db-count tnum">{demo + 1}/{DEMO_STEPS.length}</span>
      <div className="db-text">
        <strong>{step.title}</strong>
        <span>{step.text(site)}</span>
      </div>
      <div className="db-ctl">
        <button type="button" className="ask" aria-label="Paso anterior" disabled={demo === 0} onClick={() => setDemo(demo - 1)}><ArrowLeft size={14} aria-hidden /></button>
        <button type="button" className="ask" aria-label="Paso siguiente" disabled={demo === DEMO_STEPS.length - 1} onClick={() => setDemo(demo + 1)}><ArrowRight size={14} aria-hidden /></button>
        <button type="button" className="ask" aria-label="Salir del modo demo" onClick={() => setDemo(null)}><X size={14} aria-hidden /></button>
      </div>
    </div>
  );
}

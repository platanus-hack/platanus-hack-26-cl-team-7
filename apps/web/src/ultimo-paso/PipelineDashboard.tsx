import { useEffect, useState } from "react";
import { pipelineStages, services, type PipelineFixture, type PipelineRun, type PipelineStage, type Project, type StageStatus } from "@sentinel/contracts";
import { BASE_URL } from "../sentinel";
import "./pipeline.css";

const API = `${BASE_URL}/v1/ultimo-paso`;
const projects = Object.keys(services) as Project[];
const stages: Record<PipelineStage, string> = {
  inputs: "Preparar entradas", traffic: "Tráfico legítimo", fixtures: "Fixtures A/B",
  scoring: "Medir eficacia", research: "Firecrawl", ticket: "Borrador GitHub",
};
const statusLabels: Record<StageStatus, string> = {
  pending: "Pendiente", running: "En curso", passed: "Listo", failed: "Falló", degraded: "Parcial",
};
const weaknessNames: Record<string, string> = {
  "file-disclosure": "Divulgación en el body", "header-disclosure": "Divulgación en un header",
  "record-disclosure": "Divulgación de registro", "unlabelled-record": "Control sin marcador",
  "path-grammar": "Indicador de path traversal", "script-grammar": "Indicador de script", "middleware-indicator": "Indicador de middleware",
};
type RunSummary = Pick<PipelineRun, "id" | "mode" | "status" | "started" | "finished" | "source">;
const stamp = (value: string) => new Date(value).toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
const runLabel = (r: RunSummary) => `${r.mode === "real" ? "Real" : "Reproducción"} · ${stamp(r.started)}`;
const runStatus = { running: "En curso", completed: "Completado", failed: "Falló" };
const yes = (b: boolean) => b ? "Sí" : "No";
const difference = (a: number, b: number) => b > a ? `+${b-a}` : b < a ? `−${a-b}` : "0";

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(API + path, { signal });
  if (!r.ok) throw new Error(`El servidor respondió HTTP ${r.status}.`);
  return r.json() as Promise<T>;
}

function TraceLink({ run, trace, children }: { run?: string; trace: string; children: string }) {
  if (!run) return null;
  const p = new URLSearchParams({ mode: "live", run, trace: `${run}/extproc/${trace}`, view: "traces" });
  return <a href={`/ultimo-paso?${p}`}>{children}</a>;
}

function FixtureTable({ fixtures, evidenceRun }: { fixtures: PipelineFixture[]; evidenceRun?: string }) {
  if (!fixtures.length) return null;
  return <div className="pp-table-wrap"><table className="pp-table">
    <thead><tr><th scope="col">Fixture</th><th scope="col">Evidencia en A</th><th scope="col">Evidencia en B</th><th scope="col">Detectado en B</th><th scope="col">Regla instalada</th><th scope="col">Acción ejecutada</th></tr></thead>
    <tbody>{fixtures.map((f) => <tr key={f.id}>
      <th scope="row"><code>{f.id}</code><small data-failed={!f.passed || undefined}>{f.passed ? "Resultado esperado" : "Resultado distinto al esperado"}</small></th>
      <td>{yes(f.actual.directEvidence)} <TraceLink run={evidenceRun} trace={f.A.trace}>Traza A</TraceLink></td>
      <td><span data-failed={f.actual.proxyEvidence || undefined}>{yes(f.actual.proxyEvidence)}</span> <TraceLink run={evidenceRun} trace={f.B.trace}>Traza B</TraceLink></td>
      <td>{yes(f.actual.detected)}</td><td>{yes(f.actual.contained)}{f.rule && <small>{f.rule}</small>}</td>
      <td>{yes(f.actual.executed)}<small>{f.retry.hits} solicitudes al upstream</small><TraceLink run={evidenceRun} trace={f.retry.trace}>Reintento</TraceLink></td>
    </tr>)}</tbody>
  </table></div>;
}

export function PipelineDashboard() {
  const [index, setIndex] = useState<RunSummary[]>([]);
  const [selection, setSelection] = useState(() => new URLSearchParams(location.search).get("pipeline") ?? "");
  const [run, setRun] = useState<PipelineRun>();
  const [project, setProject] = useState<Project>("bruma");
  const [connected, setConnected] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const items = await get<{ runs: RunSummary[] }>("/pipeline/runs", controller.signal);
        const id = selection || items.runs[0]?.id;
        const currentRun = id ? await get<PipelineRun>(`/pipeline/runs/${encodeURIComponent(id)}`, controller.signal) : undefined;
        if (!controller.signal.aborted && current === revision) {
          setIndex(items.runs); setRun(currentRun); setError("");
        }
      } catch (e) {
        if (!controller.signal.aborted && current === revision) setError(e instanceof Error ? e.message : "No se pudo cargar el pipeline.");
      } finally {
        if (!controller.signal.aborted && current === revision) setLoading(false);
      }
    };
    void refresh();
    const events = new EventSource(API + "/stream");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener("revision", () => void refresh());
    return () => { controller.abort(); events.close(); };
  }, [selection]);

  const choose = (id: string) => {
    setSelection(id);
    history.replaceState(null, "", id ? `/ultimo-paso?pipeline=${encodeURIComponent(id)}` : "/ultimo-paso");
  };
  const runDemo = async (mode: PipelineRun["mode"]) => {
    if (launching) return;
    setLaunching(true);
    setError("");
    try {
      const response = await fetch(API + "/pipeline/runs", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "real" ? { mode } : { mode, source: run?.id }),
      });
      const value = await response.json() as { id?: string; error?: string };
      if (!response.ok || !value.id) throw Error(value.error ?? "No se pudo iniciar la demo.");
      choose(value.id);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo iniciar la demo."); }
    finally { setLaunching(false); }
  };

  const current = run?.projects.find((s) => s.project === project);
  const cases = current?.fixtures ?? [];
  const count = (field: keyof PipelineFixture["actual"]) => cases.filter((f) => f.actual[field]).length;
  const ab = current?.customers;
  const legit = (arm: "A" | "B") => ab?.[arm].filter((item) => item.passed).length ?? 0;
  const upstream = (arm: "A" | "B") => cases.filter((f) => f[arm].hits > 0).length;
  const active = launching || index.some((r) => r.status === "running");
  const readOnly = run?.mode === "reproduce";

  return <div className="pp-shell">
    <header className="pp-bar"><a href="/ultimo-paso">Último Paso / <strong>Eficacia de detección</strong></a>
      <a href="/ultimo-paso?view=traces">Explorador de trazas ↗</a></header>
    <main className="pp-main">
      <section className="pp-heading">
        <div><h1>Pipeline de detección</h1><p>Mide qué observa el proxy, qué llega al cliente y qué solicitudes detiene la contención.</p></div>
        <div className="pp-actions">
          <button className="pp-primary" disabled={active} onClick={() => void runDemo("real")}>Ejecutar demo real</button>
          <button disabled={active || !run?.finished || !run.projects.some((p) => p.fixtures?.length)} onClick={() => void runDemo("reproduce")}>Reproducir</button>
        </div>
      </section>
      <div className="pp-run">
        <label>Ejecución <select value={selection || run?.id || ""} onChange={(e) => choose(e.target.value)}>
          <option value="">Última ejecución</option>{index.map((r) => <option key={r.id} value={r.id}>{runLabel(r)}</option>)}
        </select></label>
        <span role="status" className="pp-connection">{connected ? "Feed conectado" : "Reconectando al feed"}{run && ` · ${runStatus[run.status]}`}</span>
      </div>
      {error && <p className="pp-error" role="alert">{error}</p>}
      {run?.error && <p className="pp-error" role="alert">{run.error}</p>}
      {readOnly && <p className="pp-note">Reproducción de <button className="pp-link" onClick={() => choose(run.source!)}>{run.source}</button>. Se muestran los resultados grabados.</p>}
      {!run && !error && <p className="pp-note">{loading ? "Cargando…" : "Ejecuta la demo para generar el primer informe A/B. Las mediciones anteriores están en el explorador de trazas."}</p>}
      {current && <>
        <nav className="pp-projects" aria-label="Proyectos">
          {projects.map((id) => <button key={id} aria-pressed={project === id} onClick={() => setProject(id)}>
            <strong>{services[id].name}</strong><small>{run?.projects.find((p) => p.project === id)?.incidents.length ?? 0} incidentes</small>
          </button>)}
        </nav>
        <section className="pp-card" aria-label="Etapas del pipeline">
          <h2>Etapas</h2>
          <ol className="pp-graph">{pipelineStages.map((stage) => {
            const result = current.stages[stage];
            return <li key={stage} data-status={result.status}>
              <span className="pp-point" aria-hidden="true">{result.status === "passed" ? "✓" : result.status === "failed" ? "!" : result.status === "degraded" ? "–" : ""}</span>
              <strong>{stages[stage]}</strong><small title={result.time && stamp(result.time)}>{statusLabels[result.status]}</small>
              {result.detail && <small title={result.detail}>{result.detail}</small>}
            </li>;
          })}</ol>
        </section>
        {cases.length > 0 && <section className="pp-card" aria-label="Comparación A/B">
          <div className="pp-card-head"><div><h2>Comparación A/B</h2><p>A directo · B a través de Envoy</p></div><span>{cases.length} fixtures</span></div>
          <div className="pp-metrics">
            <Metric title="Evidencia entregada" a={count("directEvidence")} b={count("proxyEvidence")} total={cases.length} />
            <Metric title="Primeras solicitudes al upstream" a={upstream("A")} b={upstream("B")} total={cases.length} />
            <Metric title="Tráfico legítimo exitoso" a={legit("A")} b={legit("B")} total={ab?.A.length ?? 0} />
            <div className="pp-summary"><strong>Decisiones del proxy</strong><small>B exclusivamente · A no aplicable</small>
              <ul><li>Detectadas <b>{count("detected")}/{cases.length}</b></li>
                <li>Reglas instaladas <b>{count("contained")}/{cases.length}</b></li>
                <li>Acciones ejecutadas <b>{count("executed")}/{cases.length}</b></li></ul></div>
          </div>
          <FixtureTable fixtures={cases} evidenceRun={current.evidenceRun} />
        </section>}
        {current.incidents.length > 0 && <section className="pp-card">
          <h2>Incidentes por debilidad</h2>
          <div className="pp-incidents">{current.incidents.map((i) => <article key={i.id}>
            <div className="pp-card-head"><h3>{weaknessNames[i.id] ?? i.id}</h3>
              {i.draft && <a href={`${API}/pipeline/runs/${run!.id}/tickets/${project}/${i.id}`}>Descargar borrador .md ↓</a>}</div>
            <p>Fixtures <code>{i.cases.join(", ")}</code></p>
            {i.cve && <p>{i.advisory?.source ? <a href={i.advisory.source} target="_blank" rel="noreferrer">{i.cve} ↗</a> : i.cve}
              {" · "}{i.advisory?.retrievedAt ? `Consultado con Firecrawl el ${stamp(i.advisory.retrievedAt)}` : "Referencia de la fixture"}</p>}
            {i.advisory?.affected && <p>{i.advisory.affected}</p>}
            {i.advisory?.fix && <p><strong>Corrección</strong> · {i.advisory.fix}</p>}
          </article>)}</div>
        </section>}
      </>}
    </main>
  </div>;
}

function Metric({ title, a, b, total }: { title: string; a: number; b: number; total: number }) {
  return <div className="pp-metric"><strong>{title}</strong><div><b>{a}/{total} → {b}/{total}</b><small>Δ {difference(a, b)}</small></div>
    <div className="pp-bars" aria-hidden="true"><i style={{ width: `${total ? a/total*100 : 0}%` }} /><i style={{ width: `${total ? b/total*100 : 0}%` }} /></div>
  </div>;
}

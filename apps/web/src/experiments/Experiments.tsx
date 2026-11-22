import { useEffect, useRef, useState } from "react";
import { ExperimentEntry, ExperimentProject, ExperimentRun, type ExperimentDetail } from "@sentinel/contracts";
import { api } from "../sentinel";
import { ProjectEvidence } from "./ProjectEvidence";
import "./experiments.css";

const runLabel = { running: "En vivo", completed: "Completa", failed: "Con fallos", interrupted: "Interrumpida" } as const;
const summaries = { stage: "Etapa", inputs: "Entradas", control: "Tráfico legítimo", fixture: "Fixture", baseline: "Resultado grabado", research: "Investigación", feedback: "Decisión del modelo" } as const;
const initial = (key: string) => new URLSearchParams(window.location.search).get(key);

function exportRun(detail: ExperimentDetail) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${detail.run.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Experiments() {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [selected, setSelected] = useState(() => initial("run") ?? "");
  const [replay, setReplay] = useState(() => initial("replay") === "1");
  const [detail, setDetail] = useState<ExperimentDetail>();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const desired = useRef(selected);

  function select(id: string, reproducing = false) {
    desired.current = id;
    if (id !== selected) setDetail(undefined);
    setPlaying(false);
    setCursor(detail?.run.id === id ? detail.entries.length : 0);
    setSelected(id);
    setReplay(reproducing);
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.set("run", id);
    if (reproducing) url.searchParams.set("replay", "1"); else url.searchParams.delete("replay");
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    const controller = new AbortController();
    const load = () => void api.experiments(controller.signal).then(({ items }) => {
      if (controller.signal.aborted) return;
      setRuns(items);
      if (!desired.current || !items.some((item) => item.id === desired.current)) {
        const defaultRun = items[0];
        if (defaultRun) {
          desired.current = defaultRun.id;
          setSelected(defaultRun.id);
          setReplay(false);
        }
      }
    }).catch(() => { if (!controller.signal.aborted) setError("No se pudo cargar la lista de ejecuciones."); });
    load();
    const timer = setInterval(load, 8000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    let stream: EventSource | undefined;
    void api.experiment(selected, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setDetail(result);
      setCursor(result.entries.length);
      if (result.run.status !== "running") return;
      stream = new EventSource(api.experimentStream(selected, result.entries.at(-1)?.seq ?? 0));
      stream.addEventListener("entry", (message: MessageEvent<string>) => {
        const entry = ExperimentEntry.safeParse(JSON.parse(message.data));
        if (!entry.success) return;
        setDetail((state) => state && state.run.id === selected && (state.entries.at(-1)?.seq ?? 0) < entry.data.seq
          ? { ...state, entries: [...state.entries, entry.data] } : state);
      });
      stream.addEventListener("done", (message: MessageEvent<string>) => {
        const run = ExperimentRun.safeParse(JSON.parse(message.data));
        if (run.success) {
          setDetail((state) => state && state.run.id === selected ? { ...state, run: run.data } : state);
          setRuns((items) => items.map((item) => item.id === selected ? run.data : item));
        }
        stream?.close();
      });
    }).catch(() => { if (!controller.signal.aborted) setError("No se pudo abrir la ejecución."); });
    return () => { controller.abort(); stream?.close(); };
  }, [selected]);

  const length = detail?.entries.length ?? 0;
  useEffect(() => {
    if (!playing || cursor >= length) return;
    const id = setTimeout(() => setCursor(cursor + 1), 180);
    return () => clearTimeout(id);
  }, [cursor, length, playing]);

  async function start(project?: ExperimentProject) {
    setStarting(true);
    setError("");
    try {
      const { id } = await api.startExperiment(project);
      select(id);
      setRuns((items) => [{ id, mode: "live", status: "running", started: null, finished: null, source: null, error: null }, ...items]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar la ejecución.");
    } finally {
      setStarting(false);
    }
  }

  const visible = detail?.entries.slice(0, replay ? cursor : undefined) ?? [];
  const events = visible.map((entry) => entry.event);
  const projects = ExperimentProject.options.filter((project) => detail?.entries.some(({ event }) => "project" in event && event.project === project));
  const baseline = events.filter((event) => event.kind === "baseline");
  const fixtures = events.filter((event) => event.kind === "fixture");
  const controls = events.filter((event) => event.kind === "control");
  const total = (key: "direct" | "protected" | "legitimateA" | "legitimateB") =>
    `${baseline.reduce((sum, event) => sum + event[key].yes, 0)}/${baseline.reduce((sum, event) => sum + event[key].total, 0)}`;
  const observed = (arm: "A" | "B") => `${fixtures.filter((fixture) => fixture[arm].evidence).length}/${fixtures.length}`;
  const legitimate = (arm: "A" | "B") => {
    const results = controls.filter((control) => control.arm === arm);
    return `${results.filter((control) => control.passed).length}/${results.length}`;
  };
  const isLive = runs.some((run) => run.status === "running");
  return <main className="xp-main" aria-labelledby="xp-title">
    <div className="xp-content">
      <header className="xp-head">
        <div><h1 id="xp-title">Experimentos</h1><p className="xp-muted">Tráfico directo y a través del proxy, con evidencia por proyecto.</p></div>
        <div className="xp-actions">
          <a className="xp-button" href="http://127.0.0.1:9120" target="_blank" rel="noreferrer">Abrir servicios</a>
          <button type="button" className="xp-button" disabled={starting || isLive} onClick={() => void start("bank")}>Ejecutar banca A/B</button>
          <button type="button" className="xp-button xp-primary" disabled={starting || isLive} onClick={() => void start()}>{starting ? "Comprobando entorno…" : "Iniciar ejecución A/B"}</button>
        </div>
      </header>
      {error && <p className="xp-alert" role="alert">{error}</p>}
      {runs.length > 0 && <label className="xp-picker">Ejecución
        <select value={selected} onChange={(event) => select(event.target.value)}>{runs.map((run) => <option key={run.id} value={run.id}>
          {run.mode === "recorded" ? "Resultados grabados" : `${runLabel[run.status]} · ${run.started?.slice(0, 16).replace("T", " ") ?? run.id}`}
        </option>)}</select>
      </label>}
      {detail && <>
        <div className="xp-run"><strong>{replay ? "Replay" : detail.run.mode === "recorded" ? "Resultados grabados" : runLabel[detail.run.status]}</strong>
          <code>{detail.run.id}</code>
          {detail.run.status !== "running" && <button type="button" className="xp-button" onClick={() => select(detail.run.id, !replay)}>{replay ? "Salir del replay" : "Reproducir"}</button>}
          <button type="button" className="xp-button" onClick={() => exportRun(detail)}>Exportar JSON</button>
        </div>
        {detail.run.error && <p className="xp-alert" role="status">{detail.run.error}</p>}
        {detail.run.source && <p className="xp-muted">Resumen del informe grabado <code>{detail.run.source}</code>. No hay trazas individuales en esta grabación.</p>}
        {baseline.length > 0 && <p className="xp-run">Evidencia recibida <strong>{total("direct")} → {total("protected")}</strong> · Tráfico legítimo <strong>{total("legitimateA")} → {total("legitimateB")}</strong></p>}
        {fixtures.length > 0 && <p className="xp-run">Evidencia recibida <strong>{observed("A")} → {observed("B")}</strong> · Tráfico legítimo <strong>{legitimate("A")} → {legitimate("B")}</strong></p>}
        {replay && <div className="xp-playback">
          <button type="button" className="xp-button" onClick={() => { if (cursor >= length) { setCursor(0); setPlaying(true); } else setPlaying(!playing); }}>{playing && cursor < length ? "Pausar" : "Reproducir secuencia"}</button>
          <input aria-label="Posición en la grabación" type="range" min={0} max={length} value={cursor} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} />
          <output>{cursor}/{length}</output>
        </div>}
      </>}
      {detail && <div className="xp-projects">{projects.map((project) => <ProjectEvidence key={project} project={project} events={events} />)}</div>}
      {visible.length > 0 && detail?.run.mode === "live" && <details className="xp-detail xp-journal">
        <summary>Registro de la ejecución · {visible.length} eventos</summary>
        <ol className="xp-choices">{visible.map(({ seq, at, event }) => <li key={seq}><code>#{seq} {at ?? ""}</code> {summaries[event.kind]} {"project" in event ? `· ${event.project}` : ""}</li>)}</ol>
      </details>}
    </div>
  </main>;
}

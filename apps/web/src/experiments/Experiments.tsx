import { useEffect, useRef, useState } from "react";
import { ExperimentEntry, ExperimentProject, ExperimentRun, experimentNames, type ExperimentDetail } from "@sentinel/contracts";
import { api } from "../sentinel";
import { EvidenceDemo } from "../evidence-demo/EvidenceDemo";
import { ProjectEvidence } from "./ProjectEvidence";
import { useLab } from "./lab";
import "./experiments.css";

const runLabel = { running: "En vivo", completed: "Completa", failed: "Con fallos", interrupted: "Interrumpida" } as const;
const summaries = { stage: "Etapa", inputs: "Entradas", control: "Tráfico legítimo", fixture: "Fixture", baseline: "Resultado grabado", research: "Investigación", feedback: "Decisión del modelo" } as const;
const initial = (key: string) => new URLSearchParams(window.location.search).get(key);
const mockBank = "mock-bank-replay";

function exportRun(detail: ExperimentDetail) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(detail, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${detail.run.id}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `openAgent` shows a project's run as its agent, with the replay, in the activity. */
export function Experiments({ openAgent }: { openAgent: (runId: string, project: ExperimentProject) => void }) {
  const [runs, setRuns] = useState<ExperimentRun[]>([]);
  const [selected, setSelected] = useState(() => initial("view") === "evidence" ? mockBank : initial("run") ?? "");
  const [replay, setReplay] = useState(() => initial("replay") === "1");
  const [focus, setFocus] = useState(() => ExperimentProject.safeParse(initial("project")).data);
  const [detail, setDetail] = useState<ExperimentDetail>();
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const desired = useRef(selected);

  function select(id: string, reproducing = false, project = id === selected ? focus : undefined) {
    desired.current = id;
    if (id !== selected) setDetail(undefined);
    setPlaying(false);
    setCursor(detail?.run.id === id ? detail.entries.length : 0);
    setSelected(id);
    setReplay(reproducing);
    setFocus(project);
    setError("");
    const url = new URL(window.location.href);
    url.searchParams.set("view", "experiments");
    url.searchParams.set("run", id);
    if (project) url.searchParams.set("project", project); else url.searchParams.delete("project");
    if (reproducing) url.searchParams.set("replay", "1"); else url.searchParams.delete("replay");
    window.history.replaceState(null, "", url);
  }

  function selectProject(project: ExperimentProject) {
    setFocus(project);
    const url = new URL(window.location.href);
    url.searchParams.set("project", project);
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    const controller = new AbortController();
    const load = () => void api.experiments(controller.signal).then(({ items }) => {
      if (controller.signal.aborted) return;
      setRuns(items);
      if (desired.current === mockBank) return;
      if (!desired.current || !items.some((item) => item.id === desired.current)) {
        const defaultRun = items.find((item) => item.status === "running")
          ?? items.find((item) => item.mode === "live" && !item.project)
          ?? items[0];
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
    if (!selected || selected === mockBank) return;
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
          setRuns((items) => items.map((item) => item.id === selected ? { ...item, ...run.data } : item));
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
      useLab.getState().refresh();
      select(id, false, project);
      setRuns((items) => [{ id, mode: "live", status: "running", started: null, finished: null, source: null, error: null, project }, ...items]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar la ejecución.");
    } finally {
      setStarting(false);
    }
  }

  const visible = detail?.entries.slice(0, replay ? cursor : undefined) ?? [];
  const events = visible.map((entry) => entry.event);
  const projects = ExperimentProject.options.filter((project) => detail?.entries.some(({ event }) => "project" in event && event.project === project));
  const project = focus ?? projects[0] ?? "bruma";
  const isLive = starting || runs.some((run) => run.status === "running");
  const journal = visible.filter(({ event }) => !("project" in event) || event.project === project);
  const archived = selected === mockBank;
  return <section className="xp-main" aria-labelledby="xp-title">
    <div className="xp-content">
      <header className="xp-head">
        <h1 id="xp-title">Pruebas y replays</h1>
        <div className="xp-actions">
          <a className="xp-button" href="http://127.0.0.1:9120" target="_blank" rel="noreferrer">Abrir servicios</a>
          <button type="button" className="xp-button" disabled={isLive} onClick={() => void start()}>{starting ? "Comprobando entorno…" : "Ejecutar todos"}</button>
        </div>
      </header>
      {error && <p className="xp-alert" role="alert">{error}</p>}
      <div className="xp-runbar">
      <label className="xp-picker">Ejecución o replay
        <select value={selected} onChange={(event) => select(event.target.value)}>
          {!selected && <option value="" disabled>Selecciona una grabación</option>}
          {runs.length > 0 && <optgroup label="Corridas A/B">{runs.map((run) => <option key={run.id} value={run.id}>
          {run.mode === "recorded" ? "Resultados grabados" : `${run.project ? experimentNames[run.project] : "Varios proyectos"} · ${runLabel[run.status]} · ${run.started?.slice(0, 16).replace("T", " ") ?? run.id}`}
          </option>)}</optgroup>}
          <optgroup label="Pruebas guardadas"><option value={mockBank}>Mock bank · Replay de referencia</option></optgroup>
        </select>
      </label>
      {detail && <>
        <div className="xp-run"><strong>{replay ? "Replay" : detail.run.mode === "recorded" ? "Resultados grabados" : runLabel[detail.run.status]}</strong>
          {detail.run.status !== "running" && <button type="button" className="xp-button" onClick={() => select(detail.run.id, !replay)}>{replay ? "Salir del replay" : "Reproducir"}</button>}
          <button type="button" className="xp-button" onClick={() => exportRun(detail)}>Exportar JSON</button>
        </div>
      </>}
      </div>
      {archived && <EvidenceDemo embedded />}
      {detail && <>
        {detail.run.error && <p className="xp-alert" role="status">{detail.run.error}</p>}
        {replay && <div className="xp-playback">
          <button type="button" className="xp-button" onClick={() => { if (cursor >= length) { setCursor(0); setPlaying(true); } else setPlaying(!playing); }}>{playing && cursor < length ? "Pausar" : "Reproducir secuencia"}</button>
          <input aria-label="Posición en la grabación" type="range" min={0} max={length} value={cursor} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} />
          <output>{cursor}/{length}</output>
        </div>}
      </>}
      {!archived && <div>
        {detail && <label className="xp-picker xp-project-picker">Proyecto
          <select value={project} onChange={(event) => selectProject(ExperimentProject.parse(event.target.value))}>
            {ExperimentProject.options.map((item) => <option key={item} value={item}>
              {experimentNames[item]}{!projects.includes(item) ? " · Sin datos en esta ejecución" : ""}
            </option>)}
          </select>
        </label>}
        <div className="xp-workbench-main">
          {detail ? <ProjectEvidence key={`${detail.run.id}:${project}`} project={project} events={events} running={isLive}
            live={detail.run.status === "running"} runProject={() => void start(project)}
            openAgent={detail.run.mode === "live" ? () => openAgent(detail.run.id, project) : undefined} />
            : <p className="xp-empty" role="status">{error ? "Selecciona una ejecución para ver los resultados." : "Cargando resultados…"}</p>}
          {detail && <details className="xp-detail xp-journal">
            <summary>Registro de la ejecución</summary>
            <p><code>{detail.run.id}</code>{detail.run.source && <> · <code>{detail.run.source}</code></>}</p>
            {journal.length > 0 && detail.run.mode === "live" && <ol className="xp-choices">{journal.map(({ seq, at, event }) => <li key={seq}><code>#{seq} {at ?? ""}</code> {summaries[event.kind]} {"project" in event ? `· ${event.project}` : ""}</li>)}</ol>}
          </details>}
        </div>
      </div>}
    </div>
  </section>;
}

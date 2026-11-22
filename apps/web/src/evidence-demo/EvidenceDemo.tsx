import { useEffect, useState } from "react";
import type { DemoObservation, EvidenceDemoBundle, EvidenceDemoEvaluation, RecordedBankRun, SyntheticDetectorRun } from "@sentinel/contracts";
import { api } from "../sentinel";
import { Section } from "../reports/parts";
import "./evidence-demo.css";

const unavailable = "No disponible";
const armLabel = { direct: "A · Directo", protected: "B · Con proxy" } as const;
const sourceLabel = {
  client: "Cliente", backend: "Servicio", fixture: "Entrada sintética", "agent-detection": "agent-detection",
} as const;

function yesNo(value: boolean | null) {
  return value === null ? unavailable : value ? "Sí" : "No";
}

function describe(event: DemoObservation): string {
  switch (event.kind) {
    case "response": return `Solicitud ${event.ordinal} · ${event.status ? `HTTP ${event.status}` : unavailable}`;
    case "execution": return `Ejecución en el backend · ${yesNo(event.executed)}`;
    case "disclosure": return `Evidencia recibida por el cliente · ${yesNo(event.disclosed)}`;
    case "route": return `${event.method} ${event.path} · ${event.listed ? "Ruta reconocida" : "Fuera del contrato"}`;
    case "verdict": return `${event.rule} · Veredicto en la solicitud ${event.ordinal}`;
  }
}

function Timeline({ events }: { events: readonly DemoObservation[] }) {
  return (
    <ol className="ed-timeline" aria-label="Observaciones de la prueba">
      {events.map((event) => (
        <li key={event.id} id={event.id}>
          <details>
            <summary className={event.kind === "verdict" || (event.kind === "disclosure" && event.disclosed) ? "ed-alert" : undefined}>
              <span>{describe(event)}</span><small>{sourceLabel[event.source]}</small>
            </summary>
            <dl className="ed-fields">
              <dt>ID de evidencia</dt><dd className="mono"><a href={`#${event.id}`}>{event.id}</a></dd>
              <dt>ID de solicitud</dt><dd>{event.requestId ?? unavailable}</dd>
              <dt>Trace ID</dt><dd>{event.traceId ?? unavailable}</dd>
              <dt>Fecha y hora</dt><dd>{event.timestamp ?? unavailable}</dd>
              {event.kind === "response" && <>
                <dt>Ruta</dt><dd>{unavailable}</dd>
                <dt>Evidencia recibida</dt><dd>{yesNo(event.disclosed)}</dd>
                <dt>Bloqueo observado</dt><dd>{yesNo(event.blocked)}</dd>
              </>}
              {event.kind === "verdict" && <><dt>Motivo del detector</dt><dd>{event.reason}</dd></>}
            </dl>
          </details>
        </li>
      ))}
    </ol>
  );
}

function ArmEvidence({ run, arm }: { run: RecordedBankRun; arm: keyof typeof armLabel }) {
  const trials = run.trials.filter((trial) => trial.arm === arm);
  const scripted = trials.filter((trial) => trial.profile === "scripted");
  const benign = trials.filter((trial) => trial.profile === "benign");
  const disclosure = scripted.flatMap((trial) => trial.observations.filter((event) => event.kind === "disclosure"));
  const execution = scripted.flatMap((trial) => trial.observations.filter((event) => event.kind === "execution"));
  const blocks = benign.flatMap((trial) => trial.observations.filter((event) => event.kind === "response"))
    .filter((event) => event.blocked !== null);
  const fraction = (count: number, total: number) => total ? `${count}/${total}` : unavailable;
  return (
    <article className="ed-card" aria-label={armLabel[arm]}>
      <h3>{armLabel[arm]}</h3>
      <dl className="ed-metrics">
        <div><dt>Evidencia recibida</dt><dd>{fraction(disclosure.filter((event) => event.disclosed).length, disclosure.length)}</dd></div>
        <div><dt>Ejecución en el backend</dt><dd>{fraction(execution.filter((event) => event.executed).length, execution.length)}</dd></div>
        <div><dt>Solicitudes legítimas bloqueadas</dt><dd>{fraction(blocks.filter((event) => event.blocked).length, blocks.length)}</dd></div>
      </dl>
      <div className="ed-trials">
        {trials.map((trial) => (
          <details className="ed-trial" key={trial.id} id={trial.id}>
            <summary>{trial.profile === "benign" ? "Tráfico legítimo" : "Prueba de exposición"} {trial.ordinal}</summary>
            <Timeline events={trial.observations} />
          </details>
        ))}
      </div>
    </article>
  );
}

export function RecordedEvidence({ run }: { run: RecordedBankRun }) {
  return (
    <Section title="A/B grabado de Último Paso">
      <p className="ed-note">Las respuestas se muestran en el orden guardado. El registro no incluye rutas, IDs de solicitud, horas por solicitud ni decisiones individuales del proxy.</p>
      <div className="ed-columns"><ArmEvidence run={run} arm="direct" /><ArmEvidence run={run} arm="protected" /></div>
      <p className="ed-source">Fuente <code>ultimo-paso/scoreboard/results/mock-bank.json</code></p>
    </Section>
  );
}

export function DetectorEvidence({ run }: { run: SyntheticDetectorRun }) {
  return (
    <Section title="Replay sintético de agent-detection">
      <p className="ed-note">El detector procesó estas solicitudes inertes en memoria con el contrato de rutas de mock bank. Los tiempos son sintéticos.</p>
      <div className="ed-columns">
        {run.trials.map((trial) => {
          const verdict = trial.observations.find((event) => event.kind === "verdict");
          return (
            <article className="ed-card" key={trial.id} id={trial.id}>
              <h3>{trial.profile === "benign" ? "Rutas legítimas" : "Solicitudes fuera del contrato"}</h3>
              <p className={verdict ? "ed-alert" : "ed-note"}>{verdict ? <a href={`#${verdict.id}`}>{verdict.rule} en la solicitud {verdict.ordinal}</a> : "Sin veredicto"}</p>
              <Timeline events={trial.observations} />
            </article>
          );
        })}
      </div>
    </Section>
  );
}

const providerStatus = { completed: "Completado", unconfigured: "Sin configurar", failed: "No disponible", no_finding: "Sin hallazgo confirmado" } as const;

function Evaluation({ result, openEvidence }: { result: EvidenceDemoEvaluation; openEvidence: (id: string) => void }) {
  const { research } = result;
  return (
    <Section title="Evaluación asistida">
      <p>OpenRouter · {providerStatus[result.planner]} · {result.first === "benign" ? "Tráfico legítimo primero" : "Rutas fuera del contrato primero"}</p>
      {!result.detector && <p role="status">El detector local no pudo ejecutarse. El replay guardado sigue disponible.</p>}
      <p>Firecrawl · {providerStatus[research.status]} {research.source && <a className="underline" href={research.source} target="_blank" rel="noreferrer">MITRE CWE-22</a>}</p>
      {research.mitigations.length > 0 && <ul className="list-disc pl-5">{research.mitigations.map((item) => <li key={item}>{item}</li>)}</ul>}
      {research.evidenceIds.length > 0 && <div className="ed-nav" aria-label="Evidencia del hallazgo">
        {research.evidenceIds.map((id, index) => <button type="button" className="ed-button" key={id} onClick={() => openEvidence(id)}>
          {index === 0 ? "Evidencia del cliente" : "Evidencia del servicio"}
        </button>)}
      </div>}
    </Section>
  );
}

export function EvidenceDemo() {
  const [bundle, setBundle] = useState<EvidenceDemoBundle>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [view, setView] = useState<"bank" | "detector">("bank");
  const [evaluation, setEvaluation] = useState<EvidenceDemoEvaluation>();
  const [evaluating, setEvaluating] = useState(false);
  const [evaluationFailed, setEvaluationFailed] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string>();
  useEffect(() => {
    const ctrl = new AbortController();
    void api.evidenceDemo(ctrl.signal).then((value) => {
      if (!ctrl.signal.aborted) setBundle(value);
    }).catch(() => {
      if (!ctrl.signal.aborted) setFailed(true);
    });
    return () => ctrl.abort();
  }, [retry]);
  useEffect(() => {
    if (view !== "bank" || !evidenceId) return;
    const row = document.getElementById(evidenceId);
    if (row) {
      row.closest<HTMLDetailsElement>("details")?.setAttribute("open", "");
      row.querySelector("details")?.setAttribute("open", "");
      row.scrollIntoView({ block: "center" });
      row.querySelector("summary")?.focus({ preventScroll: true });
    }
    setEvidenceId(undefined);
  }, [view, evidenceId]);

  async function runEvaluation() {
    setEvaluating(true);
    setEvaluationFailed(false);
    try {
      setEvaluation(await api.evaluateEvidence());
      setView("detector");
    } catch {
      setEvaluationFailed(true);
    } finally {
      setEvaluating(false);
    }
  }
  return (
    <main className="ed-main" aria-labelledby="evidence-demo-title">
      <div className="ed-content">
        <h1 id="evidence-demo-title">Evidencia de mock bank</h1>
        {failed && <p role="alert">No se pudo cargar el replay. <button type="button" className="ed-button" onClick={() => { setFailed(false); setRetry(retry + 1); }}>Reintentar</button></p>}
        {!bundle && !failed && <p role="status">Cargando replay…</p>}
        {bundle && <>
          <nav className="ed-nav" aria-label="Corridas de evidencia">
            <button type="button" className="ed-button" aria-pressed={view === "bank"} onClick={() => setView("bank")}>A/B grabado</button>
            <button type="button" className="ed-button" aria-pressed={view === "detector"} onClick={() => setView("detector")}>Replay sintético</button>
            <button type="button" className="ed-button" disabled={evaluating} onClick={() => void runEvaluation()}>{evaluating ? "Evaluando…" : "Ejecutar evaluación asistida"}</button>
          </nav>
          {evaluationFailed && <p role="alert">No se pudo ejecutar la evaluación asistida.</p>}
          {evaluation && <Evaluation result={evaluation} openEvidence={(id) => { setView("bank"); setEvidenceId(id); }} />}
          {view === "bank" ? <RecordedEvidence run={bundle.runs[0]} /> : <DetectorEvidence run={evaluation?.detector ?? bundle.runs[1]} />}
        </>}
      </div>
    </main>
  );
}

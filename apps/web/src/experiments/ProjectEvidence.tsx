import { useState } from "react";
import { experimentNames, type ExperimentEvent, type ExperimentProject, type FixtureResult } from "@sentinel/contracts";
import { ProjectFlow } from "./ProjectFlow";

const count = (events: readonly unknown[], total: number) => total ? `${events.length}/${total}` : "—";
const yes = (value: boolean | null) => value === null ? "No aplica" : value ? "Sí" : "No";
const stages = { inputs: "Entradas", traffic: "Tráfico legítimo", fixtures: "Fixtures", detection: "Detección", containment: "Contención", research: "Firecrawl", feedback: "OpenRouter A/B" } as const;
const researchLabel = { retrieved: "Guía consultada", unavailable: "Consulta no disponible", unconfigured: "Sin configurar", no_finding: "Sin hallazgo confirmado" } as const;

const fixtureNames: Record<string, string> = {
  "receipt-body": "Referencia en el cuerpo de la respuesta", "receipt-body-variant": "Variante de referencia en el cuerpo",
  "receipt-header": "Referencia en una cabecera", "duplicate-header": "Cabecera duplicada", "receipt-record": "Registro interno",
  "unlabelled-record": "Registro sin marcador", "bank-stale-approval": "Aprobación de una versión anterior",
  "bank-missing-approval": "Reembolso sin aprobación", "bank-reapproved": "Reembolso aprobado de nuevo",
  "path-indicator": "Señal de ruta", "script-indicator": "Señal de script", "middleware-indicator": "Señal de middleware",
};
const fixtureName = (id: string) => fixtureNames[id] ?? id;

function Fixture({ fixture: f }: { fixture: FixtureResult }) {
  return (
    <details className="xp-detail">
      <summary>Pasos y trazas · {fixtureName(f.id)}{!f.passed && <span className="xp-alert"> · Fuera de lo esperado</span>}</summary>
      <div className="xp-table-scroll"><table className="xp-table">
        <thead><tr><th>Observación</th><th>HTTP</th><th>Evidencia</th><th>Recibidas por el servicio</th><th>Detección</th></tr></thead>
        <tbody>{([ ["A · Directo", f.A], ["B · Con proxy", f.B], ["B · Reintento", f.retry] ] as const).map(([label, wire]) => (
          <tr key={label} id={wire.trace}><th>{label}</th><td>{wire.status}</td><td>{yes(wire.evidence)}</td><td>{wire.hits}</td><td>{yes(wire.detected)}</td></tr>
        ))}</tbody>
      </table></div>
      <p>Regla instalada {yes(f.actual.contained)} · Contención ejecutada {yes(f.actual.executed)}</p>
      {f.cve && <p className="xp-muted">Referencia defensiva del caso <code>{f.cve}</code></p>}
      {f.project === "bank" && <dl className="xp-ids" aria-label="Registro de aprobación del banco">
        {([ ["A · Directo", f.A], ["B · Con proxy", f.B], ["B · Reintento", f.retry] ] as const).map(([label, wire]) => (
          <div key={label}><dt>{label} · Decisión del banco</dt><dd>{wire.approval
            ? `Versión solicitada ${wire.approval.requestedVersion} · Aprobada ${wire.approval.approvedVersion ?? "ninguna"} · ${wire.approval.eligible ? "Elegible" : "No elegible"}`
            : "Sin registro de aprobación para esta solicitud"}</dd></div>
        ))}
      </dl>}
      <dl className="xp-ids">{([ ["A", f.A], ["B", f.B], ["Reintento", f.retry] ] as const).map(([label, wire]) => (
        <div key={label}><dt>{label}</dt><dd>Trace <code>{wire.trace}</code> · Request <code>{wire.requestId ?? "No disponible"}</code> · Decisión {wire.decision ?? "No aplica"} · Regla {wire.rule ?? "—"}</dd></div>
      ))}</dl>
      {f.rule && <p>Regla asociada <code>{f.rule}</code></p>}
    </details>
  );
}

type Feedback = Extract<ExperimentEvent, { kind: "feedback" }>;

function FeedbackEvidence({ feedback }: { feedback: Feedback[] }) {
  if (!feedback.length) return null;
  const pairs = [1, 2, 3].filter((repetition) => feedback.filter((item) => item.repetition === repetition && item.status === "completed").length === 2);
  return <div className="xp-model">
    <h3>Respuesta del modelo a la evidencia</h3>
    <p className="xp-muted"><code>{feedback[0]!.model}</code> · {pairs.length}/3 pares completos · 4 decisiones por sesión</p>
    <table className="xp-table"><thead><tr><th>Sesiones de pares completos</th><th>A · Directo</th><th>B · Con proxy</th></tr></thead>
      <tbody>{([
        ["Evidencia disponible", (x: Feedback) => x.actualEvidence],
        ["Éxito declarado", (x: Feedback) => x.reported],
        ["Éxito sin evidencia observada", (x: Feedback) => x.unsupported],
      ] as const).map(([label, test]) => <tr key={label}><th>{label}</th>{(["A", "B"] as const).map((arm) =>
        <td key={arm}>{count(feedback.filter((x) => x.arm === arm && pairs.includes(x.repetition) && test(x)), pairs.length)}</td>)}</tr>)}</tbody>
    </table>
    {pairs.length > 0 && <p className="xp-muted">Decisiones totales en pares completos {(["A", "B"] as const).map((arm) =>
      `${arm} ${feedback.filter((x) => x.arm === arm && pairs.includes(x.repetition)).reduce((sum, x) => sum + x.choices.length, 0)}`).join(" · ")}</p>}
    <details className="xp-detail"><summary>Decisiones por sesión</summary><ol className="xp-choices">
      {feedback.map((f) => <li key={`${f.repetition}-${f.arm}`}><strong>Par {f.repetition} · {f.arm} · Orden {f.order}</strong> · {f.status === "completed" ? `${f.choices.length} decisiones` : f.status === "failed" ? "Error del proveedor" : "Sin configurar"}
        {f.choices.length > 0 && <code>{f.choices.join(" → ")}</code>}
        {f.observations.length > 0 && <small>{f.observations.map((o) => `HTTP ${o.status}, evidencia ${yes(o.evidence)}`).join(" · ")}</small>}
      </li>)}
    </ol></details>
  </div>;
}

export function ProjectEvidence({ project, events, running, live, runProject }: {
  project: ExperimentProject;
  events: ExperimentEvent[];
  running: boolean;
  live: boolean;
  runProject: () => void;
}) {
  const [selected, setSelected] = useState("");
  const records = events.filter((event) => "project" in event && event.project === project);
  const baseline = records.find((event) => event.kind === "baseline");
  const fixtures = records.filter((event) => event.kind === "fixture");
  const controls = records.filter((event) => event.kind === "control");
  const feedback = records.filter((event) => event.kind === "feedback");
  const research = records.find((event) => event.kind === "research");
  const phases = new Map(records.filter((event) => event.kind === "stage").map((event) => [event.stage, event.status] as const));
  const inProgress = live ? [...phases].filter(([, status]) => status === "running").map(([stage]) => stages[stage]).join(" · ") : "";
  const fixture = fixtures.find((f) => f.id === selected) ?? fixtures.find((f) => f.B.evidence) ?? fixtures.find((f) => f.actual.executed) ?? fixtures[0];
  const direct = baseline?.direct ?? { yes: fixtures.filter((f) => f.A.evidence).length, total: fixtures.length };
  const protectedEvidence = baseline?.protected ?? { yes: fixtures.filter((f) => f.B.evidence).length, total: fixtures.length };
  const format = (x: { yes: number; total: number }) => `${x.yes}/${x.total}`;
  const good = (arm: "A" | "B") => {
    const observations = controls.filter((c) => c.arm === arm);
    const recorded = arm === "A" ? baseline?.legitimateA : baseline?.legitimateB;
    return recorded ? format(recorded) : count(observations.filter((c) => c.passed), observations.length);
  };
  const contained = baseline?.executed.yes ?? fixtures.filter((f) => f.actual.executed).length;
  const change = direct.yes - protectedEvidence.yes;
  const outcome = change > 0 ? "El proxy redujo la evidencia visible" : change < 0 ? "La evidencia visible aumentó" : "La evidencia visible se mantuvo";
  return <article className="xp-card">
    <header className="xp-project-head"><h2>{experimentNames[project]}</h2><div className="xp-actions">
      <a className="xp-service-link" href={`http://127.0.0.1:9120/${project}/`} target="_blank" rel="noreferrer">Abrir el servicio <span aria-hidden="true">↗</span></a>
      <button type="button" className="xp-button xp-primary" disabled={running} onClick={runProject}>Ejecutar proyecto A/B</button>
    </div></header>
    {inProgress && <p className="xp-progress" role="status">En curso · {inProgress}</p>}
    {direct.total > 0 ? <section className="xp-outcome" aria-label="Resultado principal">
      <h3>{outcome}</h3>
      <p><strong>{format(direct)} <span aria-label="a">→</span> {format(protectedEvidence)}</strong> <span>casos con evidencia visible</span></p>
      <p className="xp-muted">Legítimos {good("A")} directos y {good("B")} con proxy · {contained} reintentos contenidos</p>
      {protectedEvidence.yes > 0 && <p className="xp-alert">{protectedEvidence.yes === 1 ? "En un caso siguió llegando evidencia." : `En ${protectedEvidence.yes} casos siguió llegando evidencia.`}</p>}
    </section> : <p className="xp-empty">{inProgress ? "Los resultados aparecerán al recibir las primeras observaciones." : "Esta ejecución no contiene resultados de este proyecto."}</p>}
    {baseline && <p className="xp-muted xp-recorded">Esta grabación contiene resultados agregados.</p>}
    {fixture && <label className="xp-picker xp-case">Caso del recorrido
      <select value={fixture.id} onChange={(event) => setSelected(event.target.value)}>
        {fixtures.map((f) => <option key={f.id} value={f.id}>{fixtureName(f.id)}</option>)}
      </select>
    </label>}
    <ProjectFlow fixture={fixture} recorded={baseline ? { A: baseline.direct, B: baseline.protected } : undefined} />
    {fixture && <Fixture key={fixture.id} fixture={fixture} />}
    {direct.total > 0 && <details className="xp-detail"><summary>Indicadores de detección</summary>
      <p>Detectados {baseline ? format(baseline.detected) : count(fixtures.filter((f) => f.actual.detected), fixtures.length)} · Reglas instaladas {baseline ? format(baseline.installed) : count(fixtures.filter((f) => f.actual.contained), fixtures.length)} · Contención ejecutada {contained}/{direct.total}</p>
    </details>}
    {controls.length > 0 && <details className="xp-detail"><summary>Observaciones del tráfico legítimo</summary><ul className="xp-choices">
      {controls.map((c) => <li key={c.receipt.trace}>{c.arm} · HTTP {c.receipt.status} · {c.passed ? "Pasó" : "Falló"}
        {c.receipt.operationId && <> · Registro <code>{c.receipt.operationId}</code></>}<code>{c.receipt.trace}</code></li>)}
    </ul></details>}
    {research && <details className="xp-detail"><summary>Investigación defensiva · {researchLabel[research.status]}</summary><div className="xp-model"><p>{research.source && <>
      {" · "}<a href={research.source} target="_blank" rel="noreferrer">{research.cve}</a></>}</p>
      {research.source && <p className="xp-muted">Referencia asociada al fixture simulado.</p>}
      {research.fixes.length > 0 && <ul className="xp-choices">{research.fixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>}
      {research.evidence.length > 0 && <ul className="xp-choices" aria-label="Trazas del hallazgo">{research.evidence.map((trace) =>
        <li key={trace}><button type="button" className="xp-trace-link" onClick={() => {
          const found = fixtures.find((f) => f.A.trace === trace || f.B.trace === trace);
          if (!found) return;
          setSelected(found.id);
          requestAnimationFrame(() => {
            const row = document.getElementById(trace);
            row?.closest("details")?.setAttribute("open", "");
            row?.scrollIntoView({ block: "nearest" });
          });
        }}><code>{trace}</code></button></li>)}</ul>}
    </div></details>}
    {feedback.length > 0 && <details className="xp-detail"><summary>Comparación de OpenRouter</summary><FeedbackEvidence feedback={feedback} /></details>}
  </article>;
}

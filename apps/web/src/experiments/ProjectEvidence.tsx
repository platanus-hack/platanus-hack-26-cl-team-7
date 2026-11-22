import { ExperimentProject, experimentNames, type ExperimentEvent, type FixtureResult } from "@sentinel/contracts";

const count = (events: readonly unknown[], total: number) => total ? `${events.length}/${total}` : "—";
const yes = (value: boolean | null) => value === null ? "No aplica" : value ? "Sí" : "No";
const stages = { inputs: "Entradas", traffic: "Tráfico legítimo", fixtures: "Fixtures", detection: "Detección", containment: "Contención", research: "Firecrawl", feedback: "OpenRouter A/B" } as const;
const statusLabel = { running: "En curso", passed: "Listo", failed: "Falló", degraded: "Parcial", skipped: "Sin hallazgo" } as const;
const researchLabel = { retrieved: "Guía consultada", unavailable: "Consulta no disponible", unconfigured: "Sin configurar", no_finding: "Sin hallazgo confirmado" } as const;

function Fixture({ fixture: f }: { fixture: FixtureResult }) {
  return (
    <details className="xp-detail">
      <summary>{f.id}{!f.passed && <span className="xp-alert"> · Fuera de lo esperado</span>}</summary>
      <table className="xp-table">
        <thead><tr><th>Observación</th><th>HTTP</th><th>Evidencia</th><th>Recibidas por el servicio</th><th>Detección</th></tr></thead>
        <tbody>{([ ["A · Directo", f.A], ["B · Con proxy", f.B], ["B · Reintento", f.retry] ] as const).map(([label, wire]) => (
          <tr key={label} id={wire.trace}><th>{label}</th><td>{wire.status}</td><td>{yes(wire.evidence)}</td><td>{wire.hits}</td><td>{yes(wire.detected)}</td></tr>
        ))}</tbody>
      </table>
      <p>Regla instalada {yes(f.actual.contained)} · Contención ejecutada {yes(f.actual.executed)}</p>
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

export function ProjectEvidence({ project, events }: { project: ExperimentProject; events: ExperimentEvent[] }) {
  const records = events.filter((event) => "project" in event && event.project === project);
  const baseline = records.find((event) => event.kind === "baseline");
  const fixtures = records.filter((event) => event.kind === "fixture");
  const controls = records.filter((event) => event.kind === "control");
  const feedback = records.filter((event) => event.kind === "feedback");
  const research = records.find((event) => event.kind === "research");
  const steps = new Map(records.filter((event) => event.kind === "stage").map((event) => [event.stage, event.status] as const));
  const measure = (key: "directEvidence" | "proxyEvidence" | "detected" | "contained" | "executed") => count(fixtures.filter((f) => f.actual[key]), fixtures.length);
  const good = (arm: "A" | "B") => count(controls.filter((c) => c.arm === arm && c.passed), controls.filter((c) => c.arm === arm).length);
  const format = (x: { yes: number; total: number }) => `${x.yes}/${x.total}`;
  const direct = baseline ? format(baseline.direct) : measure("directEvidence");
  const protectedEvidence = baseline ? format(baseline.protected) : measure("proxyEvidence");
  return <article className="xp-card">
    <h2>{experimentNames[project]}</h2>
    <a className="xp-service-link" href={`http://127.0.0.1:9120/${project}/`} target="_blank" rel="noreferrer">Abrir el servicio <span aria-hidden="true">↗</span></a>
    {project === "bank" && <p className="xp-muted">Reembolsos simulados. CVE-2026-129289 es una referencia defensiva de PHP-FPM. La corrida evalúa decisiones del banco y exposición de evidencia.</p>}
    <table className="xp-table">
      <thead><tr><th>Medición</th><th>A · Directo</th><th>B · Con proxy</th></tr></thead>
      <tbody>
        <tr><th>Evidencia recibida</th><td>{direct}</td><td>{protectedEvidence}</td></tr>
        <tr><th>Tráfico legítimo</th><td>{baseline ? format(baseline.legitimateA) : good("A")}</td><td>{baseline ? format(baseline.legitimateB) : good("B")}</td></tr>
        <tr><th>Detectado</th><td>No aplica</td><td>{baseline ? format(baseline.detected) : measure("detected")}</td></tr>
        <tr><th>Regla instalada</th><td>No aplica</td><td>{baseline ? format(baseline.installed) : measure("contained")}</td></tr>
        <tr><th>Contención ejecutada</th><td>No aplica</td><td>{baseline ? format(baseline.executed) : measure("executed")}</td></tr>
      </tbody>
    </table>
    {!baseline && <ul className="xp-stages" aria-label="Etapas">{Object.entries(stages).map(([key, label]) => {
      const value = steps.get(key as keyof typeof stages);
      return <li key={key} data-phase={value ?? "pending"}>{label}<small>{value ? statusLabel[value] : "Pendiente"}</small></li>;
    })}</ul>}
    {fixtures.map((fixture) => <Fixture key={fixture.id} fixture={fixture} />)}
    {controls.length > 0 && <details className="xp-detail"><summary>Observaciones del tráfico legítimo</summary><ul className="xp-choices">
      {controls.map((c) => <li key={c.receipt.trace}>{c.arm} · HTTP {c.receipt.status} · {c.passed ? "Pasó" : "Falló"}
        {c.receipt.operationId && <> · Registro <code>{c.receipt.operationId}</code></>}<code>{c.receipt.trace}</code></li>)}
    </ul></details>}
    {research && <div className="xp-model"><h3>Investigación defensiva</h3><p>{researchLabel[research.status]}{research.source && <>
      {" · "}<a href={research.source} target="_blank" rel="noreferrer">{research.cve}</a></>}</p>
      {research.source && <p className="xp-muted">Referencia asociada al fixture simulado.</p>}
      {research.fixes.length > 0 && <ul className="xp-choices">{research.fixes.map((fix) => <li key={fix}>{fix}</li>)}</ul>}
      {research.evidence.length > 0 && <ul className="xp-choices" aria-label="Trazas del hallazgo">{research.evidence.map((trace) =>
        <li key={trace}><a href={`#${trace}`} onClick={() => document.getElementById(trace)?.closest("details")?.setAttribute("open", "")}><code>{trace}</code></a></li>)}</ul>}
    </div>}
    <FeedbackEvidence feedback={feedback} />
  </article>;
}

import { useEffect, useState, type ReactNode } from "react";
import { services, type EvidenceEvent, type EvidenceRun, type EvidenceTrace, type Service, type TraceLink } from "@sentinel/contracts";
import { BASE_URL } from "../sentinel";
import "./evidence.css";

const API = `${BASE_URL}/v1/ultimo-paso`;
const serviceIds = ["bruma", "litoral", "surco"] as const;
const titles: Record<string, string> = {
  direct: "Recibo directo", first_protected: "Primer recibo con proxy", repeat: "Reintento contenido",
  other_route: "Registro público del servicio", other_actor: "Misma ruta, otro actor", repeated_header: "Header duplicado en respuesta",
  unlabelled_record: "Registro sin marcador", "known-indicator": "Indicador de middleware conocido", "script-indicator": "Texto con patrón de script",
  "query-indicator": "Texto con patrón SQL", "path-indicator": "Indicador de path traversal", "clean-control": "Solicitud legítima de catálogo",
  "progression-fingerprint": "Señal de fingerprinting", "progression-probe": "Seguimiento sospechoso", "progression-repeat": "Patrón de detección repetido",
  request: "Solicitud observada", response: "Decisión sobre la respuesta", contain: "Contención activada", rule_installed: "Regla instalada",
  historical_rule: "Regla observada por el runner", alert_created: "Alerta creada", alert_delivery: "Entrega por webhook",
  research: "Consulta de advisory", wire: "Observación HTTP independiente",
};
const labels: Record<string, string> = {
  "disclosure-fixture": "Fixture de divulgación", "request-indicator": "Indicador sospechoso", legitimate: "Tarea legítima",
  "unlabelled-control": "Control sin marcador", "fixture-analogue": "Fixture análoga", "verified-version": "Coincidencia de versión verificada",
  "potential-match": "Coincidencia parcial", "not-configured": "Firecrawl sin configurar", "provider-error": "Error del proveedor",
};
const armLabels = { direct: "Direct", original: "Original", patched: "Patched", protected: "Protected" };
const caseOrder = ["first_protected", "direct", "repeat", "repeated_header", "known-indicator",
  "script-indicator", "query-indicator", "path-indicator", "unlabelled_record", "other_actor", "other_route", "clean-control"];

const nameOf = (s: Service) => s === "other" ? "Otras rutas" : services[s].name;
const key = (t: EvidenceTrace) => `${t.run}/${t.plane}/${t.id}`;
const plane = (t: EvidenceTrace) => t.plane === "extproc" ? "Envoy" : "Go fallback";
const formatTime = (s: string) => new Date(s).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 });
const standard = (value: string) => titles[value] ?? labels[value] ?? value.replaceAll("_", " ");

type LiveIndex = { configured: boolean; researchEnabled: boolean; error?: string; runs: { id: string; title: string }[] };

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const result = await fetch(`${API}${path}`, { signal });
  if (!result.ok) throw new Error(`Evidence request failed (HTTP ${result.status}).`);
  return result.json() as Promise<T>;
}

function exposure(trace: EvidenceTrace) {
  const seen = trace.observed;
  if (!seen) return undefined;
  return seen.headerEvidence || seen.bodyEvidence;
}

function metric(traces: EvidenceTrace[], test: (t: EvidenceTrace) => boolean) {
  return traces.length ? `${traces.filter(test).length}/${traces.length}` : "—";
}

function Metrics({ traces, live }: { traces: EvidenceTrace[]; live: boolean }) {
  const first = traces.filter((t) => t.case === "first_protected" && t.observed);
  const retries = traces.filter((t) => t.case === "repeat" && t.observed);
  const legitimate = traces.filter((t) => t.label === "legitimate" && t.observed);
  return <div className="up-metrics">
    <Metric title="Divulgaciones en la primera solicitud protegida" caption={live ? "Evidencia recibida por el cliente" : "Original / corregido"}>
      {live ? metric(first, (t) => !!exposure(t)) : <>{metric(first.filter((t) => t.arm === "original"), (t) => !!exposure(t))}
        <span aria-hidden="true"> → </span>{metric(first.filter((t) => t.arm === "patched"), (t) => !!exposure(t))}</>}
    </Metric>
    <Metric title="Reintentos contenidos que llegaron al upstream" caption="Conteo independiente del upstream">
      {metric(retries.filter((t) => live || t.arm === "patched"), (t) => t.observed!.upstreamHits > 0)}
    </Metric>
    <Metric title="Solicitudes legítimas exitosas" caption={live ? "Tráfico legítimo medido" : "Tráfico con el proxy corregido"}>
      {metric(legitimate.filter((t) => live || t.arm === "patched"), (t) => t.observed!.status === 200)}
    </Metric>
  </div>;
}

function Metric({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return <div className="up-metric"><div>{title}</div><strong>{children}</strong><small>{caption}</small></div>;
}

function Event({ event }: { event: EvidenceEvent }) {
  const research = event.research;
  const kind = event.kind === "historical-rule" ? "historical_rule" : event.kind;
  return <li className="up-event">
    <div className="up-event-head"><strong>{standard(kind)}</strong>{event.time && <time dateTime={event.time}>{formatTime(event.time)}</time>}</div>
    {(event.symbol || event.action || event.level) && <div className="up-tags">{[event.symbol, event.action, event.level].filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div>}
    {event.pattern && <p>Pattern <code>{event.pattern}</code></p>}
    {event.reason && <p>{event.reason === "canary" ? "Registered response marker" : event.reason === "actor-and-route" ? "Scoped to this actor and route" : event.reason}</p>}
    {!!event.signals?.length && <p>Evidence <code>{event.signals.join(", ")}</code></p>}
    {(event.status || event.rule || event.expiresAt || event.elapsedMs !== undefined) && <dl className="up-facts">
      {event.status && <><dt>HTTP status</dt><dd>{event.status}</dd></>}
      {event.rule && <><dt>Rule</dt><dd>{event.rule}</dd></>}
      {event.expiresAt && <><dt>Expires</dt><dd>{new Date(event.expiresAt).toLocaleString()}</dd></>}
      {event.elapsedMs !== undefined && <><dt>{event.kind === "wire" ? "Tiempo de respuesta" : event.kind === "historical-rule" ? "Observado en" : "Instalado en"}</dt><dd>{event.elapsedMs.toFixed(2)} ms</dd></>}
    </dl>}
    {research && <div className="up-advisory"><strong>{standard(research.status)}</strong><p>{research.note}</p>
      {research.source && <a href={research.source} target="_blank" rel="noreferrer">{research.cve ?? "Public advisory"} ↗</a>}
      {research.retrievedAt && <small>Retrieved {new Date(research.retrievedAt).toLocaleString()}{research.cached ? " · Cached" : ""}</small>}
    </div>}
  </li>;
}

function Trace({ trace, related, comparison, select, shareUrl }: {
  trace: EvidenceTrace; related: { target: EvidenceTrace; link: TraceLink }[]; comparison: EvidenceTrace[];
  select: (t: EvidenceTrace) => void; shareUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => { setCopied(false); }, [trace.id]);
  const observed = trace.observed;
  const reference = trace.service === "other" ? undefined : services[trace.service];
  const request = trace.events.find((e) => e.kind === "request");
  const evidenceLabel = !observed ? "Sin verificar" : trace.label === "legitimate"
    ? exposure(trace) ? "Referencia pública presente" : "Referencia pública ausente"
    : observed.headerEvidence ? "Recibida en headers" : observed.bodyEvidence ? "Recibida en el body" : "Sin evidencia observada";
  return <section className="up-trace" id="evidence-trace" aria-labelledby="up-trace-title">
    <header><div><p className="up-eyebrow">{nameOf(trace.service)} · {plane(trace)} · {trace.arm}</p>
      <h2 id="up-trace-title">{standard(trace.case)}</h2><code>{trace.route}</code></div>
      <button className="up-button" onClick={async () => {
        try { await navigator.clipboard.writeText(shareUrl); setCopied(true); }
        catch { window.prompt("Trace link", shareUrl); }
      }}>{copied ? "Copiado" : "Copiar enlace"}</button>
    </header>
    <dl className="up-facts up-outcomes">
      <dt>Etiqueta de la fixture</dt><dd>{trace.label ? standard(trace.label) : "Sin datos"}</dd>
      <dt>Observación del engine</dt><dd>{request?.symbol ?? "Sin datos"}</dd>
      <dt>Estado HTTP del cliente</dt><dd>{observed?.status ?? "Sin verificar"}</dd>
      <dt>Evidencia en cliente</dt><dd>{evidenceLabel}</dd>
      <dt>Solicitudes al upstream</dt><dd>{observed?.upstreamHits ?? "Sin verificar"}</dd>
      {request?.actor && <><dt>Referencia del actor</dt><dd><code>{request.actor}</code></dd></>}
    </dl>
    {request?.payload && <div className="up-advisory"><strong>Payload original</strong>
      <p>{request.payload.state === "recorded" ? "Guardado en el archivo local" : request.payload.state === "partial"
        ? "El archivo conserva los bytes disponibles. El body estaba incompleto." : standard(request.payload.state)}
        {" · "}{request.payload.bodyBytes} bytes en el body</p>
      {request.payload.sha256 && <small>Body SHA-256 <code>{request.payload.sha256}</code></small>}
    </div>}
    {reference && <div className="up-advisory"><strong>Advisory de referencia</strong>
      <p>{reference.effect}. This business uses synthetic responses.</p>
      <a href={reference.url} target="_blank" rel="noreferrer">{reference.cve} ↗</a>
    </div>}
    {trace.legacy && <p className="up-note">Fixture grabada. Los eventos del proxy se vinculan por actor y ruta cuando hay datos. Estas trazas históricas carecen de registros de entrega y consultas de Firecrawl.</p>}
    {comparison.length > 1 && <div className="up-compare">
      <h3>Same case through {plane(trace)}</h3>
      <div>{comparison.map((t) => <button key={key(t)} onClick={() => select(t)} aria-pressed={key(trace) === key(t)}>
        <strong>{armLabels[t.arm]}</strong>
        <small>{t.observed?.headerEvidence ? "Header reached client" : t.observed?.bodyEvidence ? "Body reached client" : "No evidence observed"}</small>
      </button>)}</div>
    </div>}
    {related.length > 0 && <div className="up-related"><h3>Solicitudes relacionadas</h3>
      {related.map(({ target, link }) => <div className="up-related-row" key={key(target)}>
        <button className="up-link" onClick={() => select(target)}>{standard(target.case)} · {target.route} →</button>
        <small>{link.confidence === "rule-linked" ? "Misma regla" : "Inferida"} · {link.reason}{link.gapSeconds === undefined ? "" : ` · ${link.gapSeconds}s apart`}</small>
      </div>)}
    </div>}
    <h3>Cronología de la traza</h3>
    {trace.events.length ? <ol className="up-timeline">{trace.events.map((e, i) => <Event key={i} event={e} />)}</ol>
      : <p className="up-note">Esta solicitud grabada no tiene eventos del proxy.</p>}
  </section>;
}

export function EvidenceDashboard() {
  const initial = new URLSearchParams(location.search);
  const [live, setLive] = useState(initial.get("mode") === "live");
  const [runId, setRunId] = useState(initial.get("run") ?? "");
  const [selection, setSelection] = useState(initial.get("trace") ?? "");
  const [service, setService] = useState<Service | "all">("all");
  const [path, setPath] = useState("all");
  const [traffic, setTraffic] = useState("all");
  const [arm, setArm] = useState("all");
  const [stage, setStage] = useState("all");
  const [run, setRun] = useState<EvidenceRun>();
  const [index, setIndex] = useState<LiveIndex>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let sequence = 0;
    setBusy(true);
    setError("");
    const refresh = async () => {
      const id = ++sequence;
      try {
        const list = live ? await get<LiveIndex>("/runs", controller.signal) : undefined;
        const selected = live ? runId || list?.runs[0]?.id : "recorded";
        const result = selected ? await get<EvidenceRun>(`/runs/${encodeURIComponent(selected)}`, controller.signal) : undefined;
        if (!active || id !== sequence) return;
        setRun(result);
        setIndex(list);
        setError("");
      } catch (e) {
        if (active && id === sequence) setError(e instanceof Error ? e.message : "Evidence is unavailable.");
      } finally {
        if (active && id === sequence) setBusy(false);
      }
    };
    void refresh();
    const stream = live ? new EventSource(`${API}/stream`) : undefined;
    if (stream) {
      stream.onopen = () => setConnected(true);
      stream.onerror = () => setConnected(false);
      stream.addEventListener("revision", () => void refresh());
    }
    return () => {
      active = false;
      controller.abort();
      stream?.close();
      setConnected(false);
    };
  }, [live, runId]);

  const evidenceUrl = (nextLive: boolean, id = "", trace = "") => {
    const query = new URLSearchParams({ view: "traces" });
    if (nextLive) query.set("mode", "live");
    if (id) query.set("run", id);
    if (trace) query.set("trace", trace);
    return `/ultimo-paso${query.size ? `?${query}` : ""}`;
  };
  const navigate = (nextLive: boolean, id?: string, trace?: string) => history.replaceState(null, "", evidenceUrl(nextLive, id, trace));
  const toggle = (value: boolean) => {
    if (value === live) return;
    setRun(undefined);
    setLive(value);
    setRunId("");
    setSelection("");
    setArm("all");
    setStage("all");
    navigate(value);
  };
  const traces = run?.traces ?? [];
  const scoped = traces.filter((t) => service === "all" || t.service === service);
  const sorted = [...scoped].sort((a, b) => live ? (Date.parse(b.time ?? "") || 0) - (Date.parse(a.time ?? "") || 0)
    : caseOrder.indexOf(a.case) - caseOrder.indexOf(b.case) || a.service.localeCompare(b.service)
      || a.plane.localeCompare(b.plane));
  const filtered = sorted.filter((t) => t.hasPayload && (path === "all" || path === t.plane) && (traffic === "all" || traffic === t.label) &&
    (arm === "all" || arm === t.arm) && (stage === "all" || t.events.some((e) => e.kind === stage)));
  const selected = traces.find((t) => t.hasPayload && key(t) === selection) ?? filtered.find((t) =>
    t.service === "litoral" && t.arm === "original" && t.plane === "extproc" && t.case === "first_protected") ?? filtered[0];
  const related = (selected?.related ?? []).flatMap((link) => {
    const target = traces.find((t) => key(t) === link.trace);
    return target ? [{ target, link }] : [];
  });
  const comparison = !live && selected?.case === "first_protected" ? (["direct", "original", "patched"] as const).flatMap((arm) =>
    traces.find((t) => t.arm === arm && t.service === selected.service && t.plane === selected.plane && t.hasPayload &&
      t.case === (arm === "direct" ? "direct" : "first_protected")) ?? []) : [];

  const choose = (trace: EvidenceTrace) => {
    setSelection(key(trace));
    navigate(live, live ? run?.id : undefined, key(trace));
    if (matchMedia("(max-width: 960px)").matches) requestAnimationFrame(() => document.querySelector("#evidence-trace")?.scrollIntoView({ block: "start" }));
  };
  const filterService = (value: Service | "all") => {
    setService(value);
    setSelection("");
    navigate(live, live ? run?.id : undefined);
  };

  return <div className="up-shell">
    <nav className="up-nav"><a className="up-brand" href="/ultimo-paso">Último Paso <span> / </span> Evidencia</a><a href="/ultimo-paso">Pipeline de detección ↗</a></nav>
    <main className="up-main">
      <header className="up-header">
        <div><p className="up-eyebrow">Estudio de defensa del proxy</p><h1>Explorador de trazas</h1>
          <p>Sigue cada solicitud desde la detección hasta su resultado, contención y aviso.</p></div>
        <div className="up-switch" aria-label="Modo de evidencia">
          <button aria-pressed={!live} onClick={() => toggle(false)}>Histórico</button>
          <button aria-pressed={live} onClick={() => toggle(true)}>En directo</button>
        </div>
      </header>
      <div className="up-runbar">
        <div className="up-run-title">{live ? <label>Run <select value={runId || run?.id || ""} onChange={(e) => {
          setRunId(e.target.value); setSelection(""); navigate(true, e.target.value);
        }}><option value="">Latest live run</option>{index?.runs.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          : <strong>{run?.title ?? "Evaluación grabada"}</strong>}
          {live && <small>{connected ? "Feed conectado" : "Reconectando al feed"} · {index?.researchEnabled ? "Firecrawl activo" : "Firecrawl sin configurar"}</small>}
        </div>
        {run && <div className="up-exports"><a className="up-button" href={`${API}/runs/${run.id}/export/json`}>Trace JSON ↓</a><a className="up-button" href={`${API}/runs/${run.id}/export/html`}>HTML report ↓</a></div>}
      </div>
      {error && <p className="up-note" role="alert">{error}</p>}
      {index?.error && <p className="up-note" role="status">{index.error}</p>}
      {busy && !run && <p className="up-note" role="status">Cargando evidencia…</p>}
      {!error && !busy && live && !run && <p className="up-note">Aún no hay solicitudes en directo. El histórico sigue disponible.</p>}
      {run && <>
        <div className="up-services" aria-label="Filter by service">
          <button aria-pressed={service === "all"} onClick={() => filterService("all")}><strong>Todos los proyectos</strong><small>{traces.length} traces</small></button>
          {[...serviceIds, ...(traces.some((t) => t.service === "other") ? ["other" as const] : [])].map((item) => (
            <button key={item} aria-pressed={service === item} onClick={() => filterService(item)}>
              <strong>{nameOf(item)}</strong><small>{item === "other" ? "Proyecto sin identificar" : services[item].sector}</small>
            </button>
          ))}
        </div>
        <Metrics traces={scoped} live={live} />
        <div className="up-workspace">
          <section className="up-ledger" aria-label="Solicitudes">
            <div className="up-ledger-head"><h2>Solicitudes <span>{filtered.length}</span></h2></div>
            <div className="up-filters">
              <label>Proxy path <select value={path} onChange={(e) => { setSelection(""); setPath(e.target.value); }}>
                <option value="all">Todos los proxy paths</option><option value="extproc">Envoy</option><option value="revproxy">Go fallback</option>
              </select></label>
              <label>Tráfico <select value={traffic} onChange={(e) => { setSelection(""); setTraffic(e.target.value); }}>
                <option value="all">Todo el tráfico</option>{["disclosure-fixture", "request-indicator", "legitimate", "unlabelled-control"].map((value) => <option key={value} value={value}>{standard(value)}</option>)}
              </select></label>
              <label>Brazo <select value={arm} onChange={(e) => { setSelection(""); setArm(e.target.value); }}>
                <option value="all">Todos los brazos</option><option value="direct">Direct</option>
                {live ? <option value="protected">Protected</option> : <><option value="original">Original</option><option value="patched">Patched</option></>}
              </select></label>
              <label>Evento <select value={stage} onChange={(e) => { setSelection(""); setStage(e.target.value); }}>
                <option value="all">Todos los eventos</option><option value="contain">Contención</option>
                <option value="alert_created">Alertas</option><option value="research">Investigación</option>
              </select></label>
            </div>
            <div className="up-table-wrap">
              <table className="up-table"><thead><tr><th>Solicitud</th><th>Arm</th><th>Decisión</th><th>HTTP</th><th>Evidencia en cliente</th></tr></thead>
                <tbody>{filtered.slice(0, 150).map((t) => {
                  const seen = exposure(t);
                  const outcome = seen === undefined ? "Sin verificar" : t.label === "legitimate" ? "Registro público" : seen ? "Observada" : "Ninguna";
                  const request = t.events.find((e) => e.kind === "request");
                  const response = t.events.find((e) => e.kind === "response");
                  const action = response?.action === "replace" ? "replace" : request?.action;
                  return <tr key={key(t)} data-selected={selected && key(t) === key(selected) ? "true" : undefined}>
                    <td><button className="up-row" onClick={() => choose(t)}>{standard(t.case)}</button><small>{nameOf(t.service)} · {plane(t)}</small></td>
                    <td>{armLabels[t.arm]}</td><td>{action ?? "—"}{request?.symbol && request.symbol !== "browse" && <small>{request.symbol}</small>}</td>
                    <td className="up-numeric">{t.observed?.status ?? "—"}</td>
                    <td><span className="up-result" data-seen={outcome === "Observada" ? "true" : undefined}>{outcome}</span></td>
                  </tr>;
                })}</tbody></table>
              {!filtered.length && <p className="up-note">No hay solicitudes con payload que coincidan con estos filtros.</p>}
              {filtered.length > 150 && <p className="up-note">Showing 150 requests. Use the filters or export the run for more.</p>}
            </div>
          </section>
          {selected && <Trace trace={selected} related={related} comparison={comparison} select={choose}
            shareUrl={new URL(evidenceUrl(live, live ? run.id : undefined, key(selected)), location.origin).href} />}
        </div>
        <footer className="up-foot">{run.provenance}</footer>
      </>}
    </main>
  </div>;
}

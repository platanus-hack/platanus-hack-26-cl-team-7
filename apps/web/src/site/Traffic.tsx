/**
 * Every request of a site's run, as raw HTTP. Interface: `<Traffic site focus />`.
 * One row per case or legitimate customer; opening it shows the same request side by side:
 * without Reaper | with Reaper | the retry. Each column has the request and the response exactly as
 * the client saw them, the proof highlighted where it appears, and, behind Reaper, what its engine
 * recorded. `focus` (from the guided demo) opens a row and marks one column.
 * Headers and bodies come from the fictional services and are rendered as text only.
 */
import { useEffect, useState } from "react";
import type { RawExchange } from "@sentinel/contracts";
import { cn } from "../ui";
import { curlOf, type LabAgent, type TrafficCell, type TrafficRow } from "../experiments/labTrack";

export interface TrafficFocus {
  row: string;
  cell?: TrafficCell["role"];
}

type Filter = "all" | "attack" | "legit";
const FILTERS: [Filter, string][] = [["all", "Todo"], ["attack", "Ataques"], ["legit", "Tráfico legítimo"]];

/** The text with every occurrence of the proof marked. */
function Marked({ text, proof }: { text: string; proof: string | null }) {
  if (!proof || !text.includes(proof)) return <>{text}</>;
  const parts = text.split(proof);
  return <>{parts.map((part, i) => <span key={i}>{part}{i < parts.length - 1 && <mark className="tr-proof">{proof}</mark>}</span>)}</>;
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function RawBlock({ raw, proof }: { raw: RawExchange; proof: string | null }) {
  const { request: rq, response: rs } = raw;
  return <>
    <div className="tr-label">Solicitud</div>
    <pre className="tr-raw"><span className="tr-line">{rq.method} {rq.target} HTTP/1.1</span>{"\n"}
      {rq.headers.map(([k, v]) => <span key={k + v} className={cn(k.toLowerCase() === "x-up-fixture-id" && "dim")}>{k}: {v}{"\n"}</span>)}
      {rq.body && <>{"\n"}{rq.body}</>}
    </pre>
    <div className="tr-label">Respuesta</div>
    <pre className="tr-raw"><span className="tr-line">HTTP/1.1 {rs.status}</span>{"\n"}
      {rs.headers.map(([k, v], i) => <span key={`${k}${i}`}>{k}: <Marked text={v} proof={proof} />{"\n"}</span>)}
      {"\n"}<Marked text={pretty(rs.body)} proof={proof} />{rs.truncated && <span className="dim">{"\n"}… (cuerpo recortado a 8 KB)</span>}
    </pre>
  </>;
}

function Cell({ cell, proof, focused }: { cell: TrafficCell; proof: string | null; focused: boolean }) {
  const r = cell.receipt;
  const e = r.engine;
  return (
    <div className={cn("tr-cell", `tr-${cell.role}`, focused && "tr-focus")} data-role={cell.role}>
      <header className="tr-cell-head">
        <strong>{cell.label}</strong>
        <span className={cn("tr-chip", r.evidence ? "bad" : "ok")}>{r.evidence ? "La prueba llegó" : "Sin prueba"}</span>
      </header>
      <p className="tr-meta mono">HTTP {r.status} · el servicio recibió {r.hits} {r.hits === 1 ? "solicitud" : "solicitudes"}</p>
      {e && (
        <p className="tr-engine">
          Reaper: actor <b>{e.level || "normal"}</b> · decisión <b>{e.decision || "pass"}</b>
          {e.rule ? <> · regla <code>{e.rule}</code></> : null}
          {e.evidence.length > 0 && <> · evidencia <code>{e.evidence.join(", ")}</code></>}
        </p>
      )}
      {r.raw ? <RawBlock raw={r.raw} proof={proof} /> : <p className="dim">Esta corrida no guardó el tráfico crudo.</p>}
    </div>
  );
}

function Row({ row, open, toggle, focus }: { row: TrafficRow; open: boolean; toggle: () => void; focus?: TrafficFocus }) {
  const [copied, setCopied] = useState(false);
  const request = row.cells[0]?.receipt.raw?.request;
  const copy = () => {
    if (!request) return;
    void navigator.clipboard?.writeText(curlOf(request)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <li className={cn("tr-row", open && "open")} id={`row-${row.id}`}>
      <button type="button" className="tr-summary" aria-expanded={open} onClick={toggle}>
        <span className={cn("tr-kind", row.kind)}>{row.kind === "attack" ? "Ataque" : "Legítimo"}</span>
        <code className="tr-target">{row.method} {row.target}</code>
        <span className="tr-title">{row.title}</span>
        <span className={cn("tr-verdict", row.tone)}>{row.verdict}</span>
      </button>
      {open && (
        <div className="tr-detail">
          <div className="tr-tools">
            {request && <button type="button" className="ask" onClick={copy}>{copied ? "Copiado" : "Copiar como curl"}</button>}
          </div>
          <div className={cn("tr-grid", row.cells.length === 3 && "three")}>
            {row.cells.map((cell) => <Cell key={cell.role} cell={cell} proof={row.proof} focused={focus?.row === row.id && focus.cell === cell.role} />)}
          </div>
        </div>
      )}
    </li>
  );
}

export function Traffic({ site, focus }: { site: LabAgent; focus?: TrafficFocus }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(site.traffic[0] ? [site.traffic[0].id] : []));
  useEffect(() => {
    if (!focus) return;
    setFilter("all");
    setOpen((s) => (s.has(focus.row) ? s : new Set([...s, focus.row])));
  }, [focus]);
  const rows = site.traffic.filter((r) => filter === "all" || r.kind === filter);
  const toggle = (id: string) => setOpen((s) => {
    const next = new Set(s);
    if (!next.delete(id)) next.add(id);
    return next;
  });
  return (
    <div className="tr">
      <div className="tr-filters" role="group" aria-label="Filtrar tráfico">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" className="ask" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="dim tnum">{key === "all" ? site.traffic.length : site.traffic.filter((r) => r.kind === key).length}</span>
          </button>
        ))}
      </div>
      <ol className="tr-list">
        {rows.map((row) => <Row key={row.id} row={row} open={open.has(row.id)} toggle={() => toggle(row.id)} focus={focus} />)}
      </ol>
    </div>
  );
}

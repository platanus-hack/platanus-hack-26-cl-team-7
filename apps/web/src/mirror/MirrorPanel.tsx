/**
 * Sentinel's one screen. Interface: `<MirrorPanel sidebarOverlay={…} />`.
 * Left: the selected caught agent (who, why, the replay, its vulnerabilities, its requests).
 * Right: the live list of caught agents.
 * Every string from a track is attacker-controlled; React renders it as text only.
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Track, TrackAction } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { Skeleton, clock, cn } from "../ui";
import { FindingCard } from "./FindingCard";
import { Replay } from "./Replay";
import { agentName, buildMoments, caughtFor, numEs as num } from "./moments";
import { useMirror } from "./store";
import "./mirror.css";

/** Rows shown before "Ver todas las solicitudes". */
const FIRST_ROWS = 25;

const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const statusClass = (status: number) => (status >= 500 ? "s5" : status >= 400 ? "s4" : status >= 300 ? "s3" : "s2");

const RequestRow = memo(function RequestRow({ a }: { a: TrackAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="trow ma-cols w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mono dim tnum">{clock(a.ts, false)}</span>
        <span className="mono truncate pr-4">
          {a.method} {a.query ? `${a.path}?${a.query}` : a.path}
        </span>
        <span className={cn("mstatus mono tnum", statusClass(a.status))}>{a.status}</span>
      </button>
      {open && (
        <div className="ma-bodies">
          <div>
            <div className="cap">Lo que envió</div>
            <pre>{a.requestBody || "(vacío)"}</pre>
          </div>
          <div>
            <div className="cap">Lo que respondió la copia falsa</div>
            <pre>{a.responseBody || "(vacío)"}</pre>
          </div>
        </div>
      )}
    </>
  );
});

function AgentView() {
  const detail = useMirror((s) => s.detail);
  const selected = useMirror((s) => s.selected);
  const loading = useMirror((s) => s.loading);
  const [all, setAll] = useState(false);
  const moments = useMemo(() => (detail ? buildMoments(detail.actions, detail.findings) : []), [detail]);
  const [activeFinding, setActiveFinding] = useState<string | null>(null);
  const onFinding = useCallback((id: string | null) => setActiveFinding(id), []);
  if (!detail || detail.track.trackId !== selected) {
    return (
      <section className="sect" aria-label="Agente atrapado">
        <div className="dh">
          {loading || selected ? (
            <Skeleton w={220} h={26} />
          ) : (
            <p className="m-0 text-mid">Ningún agente atrapado en las últimas 24 horas. Un agente atrapado aparece aquí en menos de 2 segundos.</p>
          )}
        </div>
      </section>
    );
  }
  const t = detail.track;
  const rows = all ? detail.actions : detail.actions.slice(0, FIRST_ROWS);
  return (
    <section className="sect" aria-label={`Agente atrapado ${agentName(t.userAgent)}`}>
      <div className="dh mv-head">
        <div className="mv-name">{agentName(t.userAgent)}</div>
      </div>
      <div className="scroll">
        <Replay key={t.trackId} detail={detail} moments={moments} onFinding={onFinding} />
        {detail.findings.length > 0 && (
          <div className="fcs">
            <h3 className="fcs-h">
              Vulnerabilidades <span className="dim tnum">{num(detail.findings.length)}</span>
            </h3>
            {detail.findings.map((f) => (
              <FindingCard key={f.findingId} f={f} track={t} moments={moments} active={f.findingId === activeFinding} />
            ))}
          </div>
        )}
        <h3 className="mv-h">Solicitudes en la copia falsa</h3>
        {rows.map((a) => (
          <RequestRow key={a.eventId} a={a} />
        ))}
        {detail.actions.length === 0 && <p className="px-8 py-6 text-mid">Todavía no hay solicitudes.</p>}
        {!all && detail.actions.length > FIRST_ROWS && (
          <button type="button" className="mf-open px-8 py-4" onClick={() => setAll(true)}>
            Ver las {num(detail.actions.length)} solicitudes
          </button>
        )}
      </div>
    </section>
  );
}

const AgentRow = memo(function AgentRow({ t, selected, onSelect }: { t: Track; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${agentName(t.userAgent)}, ${caughtFor(t)}, ${count(t.findings, "vulnerabilidad", "vulnerabilidades")}, ${clock(t.lastSeen, false)}`}
      className="att-row mt-row"
      onClick={() => onSelect(t.trackId)}
    >
      <span className={t.findings > 0 ? "dot hot" : "dot"} />
      <span className="truncate">{agentName(t.userAgent)}</span>
      <span className="mono dim tnum ml-auto">{clock(t.lastSeen, false)}</span>
    </button>
  );
});

function Agents() {
  const tracks = useMirror((s) => s.data.tracks);
  const selected = useMirror((s) => s.selected);
  const select = useMirror((s) => s.select);
  const more = useMirror((s) => s.tracksCursor !== null);
  const loadOlder = useMirror((s) => s.loadOlder);
  return (
    <section className="sect" aria-label="Agentes atrapados">
      <div className="hd mt-hd">
        <h2>Agentes atrapados</h2>
        <span className="r cap">{num(tracks.length)}</span>
      </div>
      <div className="scroll">
        <div role="listbox" aria-label="Agentes atrapados, los más recientes primero">
          {tracks.map((t) => (
            <AgentRow key={t.trackId} t={t} selected={t.trackId === selected} onSelect={select} />
          ))}
        </div>
        {more && (
          <button type="button" className="mf-open px-6 py-3" onClick={() => void loadOlder()}>
            Cargar agentes anteriores
          </button>
        )}
      </div>
    </section>
  );
}

/** The main area. `sidebarOverlay` (the copilot) covers the right column. */
export function MirrorPanel({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useMirror((s) => s.error);
  // The agents list is narrow; the copilot needs the full column when it covers it.
  const copilot = useDashboard((s) => s.copilotOpen);
  return (
    <main className={cn("main mirror-main", copilot && "wide")}>
      <div className="mirror-left">
        {error && (
          <p role="alert" className="mv-err m-0 px-8 py-2 text-sm">
            {error}
          </p>
        )}
        <AgentView />
      </div>
      <div className="right mirror-right">
        <Agents />
        {sidebarOverlay}
      </div>
    </main>
  );
}

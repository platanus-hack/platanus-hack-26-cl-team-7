/**
 * Reaper's one screen. Interface: `<MirrorPanel sidebarOverlay={…} />`.
 * Left: the Dashboard link and the live list of caught agents, always open.
 * Middle: the Dashboard (all vulnerabilities) or the selected agent (graph, vulnerabilities, requests).
 * Right: the copilot, when open.
 * Every string from a track is attacker-controlled; React renders it as text only.
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Track } from "@sentinel/contracts";
import { Skeleton, clock, cn } from "../ui";
import { FindingCard } from "./FindingCard";
import { Replay } from "./Replay";
import { RequestList } from "./RequestList";
import { SquaresFour } from "@phosphor-icons/react";
import { agentName, buildMoments, caughtFor, contained, numEs as num, vulnOf } from "./moments";
import { useMirror } from "./store";
import "./mirror.css";

const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

function AgentView() {
  const detail = useMirror((s) => s.detail);
  const selected = useMirror((s) => s.selected);
  const loading = useMirror((s) => s.loading);
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
        {t.actions === 0 ? (
          <p className="mv-empty">Atrapado a las {clock(t.openedAt, false)}. Desde entonces no ha hecho ninguna solicitud; aparecerán aquí en cuanto vuelva.</p>
        ) : (
          <RequestList actions={detail.actions} />
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
  const view = useMirror((s) => s.view);
  return (
    <section className="sect" aria-label="Agentes atrapados">
      <div className="hd mt-hd">
        <h2>Agentes atrapados</h2>
        <span className="r cap">{num(tracks.length)}</span>
      </div>
      <div className="scroll">
        <div role="listbox" aria-label="Agentes atrapados, los más recientes primero">
          {tracks.map((t) => (
            <AgentRow key={t.trackId} t={t} selected={view === "agent" && t.trackId === selected} onSelect={select} />
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

/** Every confirmed vulnerability of the last 24 hours, newest first; a click opens its agent. */
function Overview() {
  const findings = useMirror((s) => s.data.findings);
  const tracks = useMirror((s) => s.data.tracks);
  const select = useMirror((s) => s.select);
  const more = useMirror((s) => s.tracksCursor !== null);
  const byId = useMemo(() => new Map(tracks.map((t) => [t.trackId, t])), [tracks]);
  return (
    <section className="sect" aria-label="Dashboard">
      <div className="dh mv-head">
        <div className="mv-name">Dashboard</div>
      </div>
      <div className="scroll">
        <div className="ov">
          {findings.length === 0 ? (
            <p className="ov-empty">
              Ninguna vulnerabilidad confirmada en las últimas 24 horas.
              {tracks.length > 0 &&
                ` ${more ? "Al menos " : ""}${count(tracks.length, "agente atrapado", "agentes atrapados")}; ninguno llegó a la tienda real desde que lo atrapamos.`}
            </p>
          ) : (
            <h3 className="fcs-h">
              Vulnerabilidades <span className="dim tnum">{num(findings.length)}</span>
            </h3>
          )}
          {findings.length > 0 && (
            <ul className="ov-list">
              {findings.map((f) => {
                const v = vulnOf(f);
                const t = byId.get(f.trackId);
                return (
                  <li key={f.findingId}>
                    <button type="button" className={cn("ov-row", v.severity === "Crítica" ? "crit" : "high")} onClick={() => select(f.trackId)}>
                      <span className="vc-sev">{v.severity}</span>
                      <span className="ov-name">{v.name}</span>
                      <code className="ov-ep">{f.endpoint}</code>
                      <span className="ov-agent">{t ? agentName(t.userAgent) : ""}</span>
                      <span className={cn("ov-state", contained(f) && "ok")}>{contained(f) ? "Neutralizada" : "Sin contener"}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/** Dashboard and agents on the left, always open; the selected view in the middle; the copilot on the right when open. */
export function MirrorPanel({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useMirror((s) => s.error);
  const view = useMirror((s) => s.view);
  const showDashboard = useMirror((s) => s.showDashboard);
  return (
    <main className={cn("main mirror-main", sidebarOverlay && "with-copilot")}>
      <aside className="mirror-side" aria-label="Navegación">
        <nav className="side-nav">
          <button type="button" className="side-link" aria-current={view === "dashboard" ? "page" : undefined} onClick={showDashboard}>
            <SquaresFour size={16} weight="duotone" aria-hidden />
            Dashboard
          </button>
        </nav>
        <Agents />
      </aside>
      <div className="mirror-left">
        {error && (
          <p role="alert" className="mv-err m-0 px-8 py-2 text-sm">
            {error}
          </p>
        )}
        {view === "dashboard" ? <Overview /> : <AgentView />}
      </div>
      {sidebarOverlay && <div className="copilot-col">{sidebarOverlay}</div>}
    </main>
  );
}

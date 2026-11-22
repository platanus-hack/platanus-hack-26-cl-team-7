/**
 * Sentinel's one screen. Interface: `<MirrorPanel sidebarOverlay experiments openResults onActivity onExperiments />`.
 * Left: Actividad, Pruebas y replays, the live list of caught agents, and the agents of the latest A/B run.
 * Middle: the activity (every vulnerability, caught or measured), a caught agent, a lab agent, or the experiments.
 * Right: the copilot, when open.
 * Caught agents and lab agents share the replay, graph and finding cards; a lab agent is built from the
 * measured fixtures of a run (../experiments/labTrack), never from synthetic data.
 * Every string from a track is attacker-controlled; React renders it as text only.
 */
import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import type { ExperimentProject, Track } from "@sentinel/contracts";
import { Skeleton, clock, cn } from "../ui";
import { FindingCard } from "./FindingCard";
import { Replay } from "./Replay";
import { RequestList } from "./RequestList";
import { SquaresFour } from "@phosphor-icons/react";
import { agentName, buildMoments, caughtFor, contained, numEs as num, vulnOf, type Severity } from "./moments";
import { useMirror } from "./store";
import { useLab } from "../experiments/lab";
import { LabAgentList, LabAgentView, LabSpotlight, LabSummary, type OpenResults } from "../experiments/LabAgent";
import "./mirror.css";

const count = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

function AgentView({ openResults }: { openResults: OpenResults }) {
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
        {!loading && !selected && <div className="scroll ov"><LabSpotlight openResults={openResults} /></div>}
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

function Agents({ highlight, onSelect }: { highlight: boolean; onSelect: (id: string) => void }) {
  const tracks = useMirror((s) => s.data.tracks);
  const selected = useMirror((s) => s.selected);
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
            <AgentRow key={t.trackId} t={t} selected={highlight && view === "agent" && t.trackId === selected} onSelect={onSelect} />
          ))}
        </div>
        {tracks.length === 0 && <p className="side-empty">Ninguno en las últimas 24 horas.</p>}
        {more && (
          <button type="button" className="mf-open px-6 py-3" onClick={() => void loadOlder()}>
            Cargar agentes anteriores
          </button>
        )}
      </div>
    </section>
  );
}

/** One vulnerability row of the activity: from a caught agent or from the latest A/B run. */
interface Row {
  id: string;
  ts: number;
  severity: Severity;
  name: string;
  endpoint: string;
  agent: string;
  lab: boolean;
  ok: boolean;
  state: string;
  open: () => void;
}

/** Every vulnerability of the last 24 hours and of the latest A/B run, newest first; a click opens its agent. */
function Overview({ openResults, openLab }: { openResults: OpenResults; openLab: (project: ExperimentProject) => void }) {
  const findings = useMirror((s) => s.data.findings);
  const tracks = useMirror((s) => s.data.tracks);
  const select = useMirror((s) => s.select);
  const more = useMirror((s) => s.tracksCursor !== null);
  const agents = useLab((s) => s.agents);
  const rows = useMemo<Row[]>(() => {
    const byId = new Map(tracks.map((t) => [t.trackId, t]));
    const live = findings.map((f): Row => {
      const v = vulnOf(f);
      const t = byId.get(f.trackId);
      return { id: f.findingId, ts: f.ts, severity: v.severity, name: v.name, endpoint: f.endpoint, agent: t ? agentName(t.userAgent) : "", lab: false,
        ok: contained(f), state: contained(f) ? "Neutralizada" : "Sin contener", open: () => select(f.trackId) };
    });
    const lab = agents.flatMap((a) => a.findings.map((x): Row => ({
      id: x.finding.findingId, ts: x.finding.ts, severity: x.vuln.severity, name: x.vuln.name, endpoint: x.finding.endpoint, agent: a.name, lab: true,
      ok: x.ok, state: x.state, open: () => openLab(a.project),
    })));
    return [...live, ...lab].sort((x, y) => y.ts - x.ts);
  }, [findings, tracks, agents, select, openLab]);
  return (
    <section className="sect" aria-label="Actividad">
      <div className="dh mv-head">
        <div className="mv-name">Actividad</div>
      </div>
      <div className="scroll">
        <div className="ov">
          <LabSummary openResults={openResults} />
          {rows.length === 0 ? (
            <p className="ov-empty">
              Ninguna vulnerabilidad confirmada en las últimas 24 horas.
              {tracks.length > 0 &&
                ` ${more ? "Al menos " : ""}${count(tracks.length, "agente atrapado", "agentes atrapados")}; ninguno llegó a la tienda real desde que lo atrapamos.`}
            </p>
          ) : (
            <h3 className="fcs-h">
              Vulnerabilidades <span className="dim tnum">{num(rows.length)}</span>
            </h3>
          )}
          {rows.length > 0 && (
            <ul className="ov-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className={cn("ov-row", r.severity === "Crítica" ? "crit" : "high")} onClick={r.open}>
                    <span className="vc-sev">{r.severity}</span>
                    <span className="ov-name">{r.name}</span>
                    <code className="ov-ep">{r.endpoint}</code>
                    <span className="ov-agent">{r.lab && <span className="ov-tag">Prueba A/B</span>}{r.agent}</span>
                    <span className={cn("ov-state", r.ok && "ok")}>{r.state}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tracks.length === 0 && <LabSpotlight openResults={openResults} />}
        </div>
      </div>
    </section>
  );
}

/** Navigation and agents on the left, always open; the selected view in the middle; the copilot on the right when open. */
export function MirrorPanel({ sidebarOverlay, experiments, openResults, onActivity, onExperiments }: {
  sidebarOverlay?: ReactNode;
  experiments?: ReactNode;
  openResults: OpenResults;
  onActivity: () => void;
  onExperiments: () => void;
}) {
  const error = useMirror((s) => s.error);
  const view = useMirror((s) => s.view);
  const showDashboard = useMirror((s) => s.showDashboard);
  const selectTrack = useMirror((s) => s.select);
  const labSelected = useLab((s) => s.selected);
  const labAgent = useLab((s) => s.agents.find((a) => a.project === s.selected));
  const selectLab = useLab((s) => s.select);
  const openLab = useCallback((project: ExperimentProject) => { selectLab(project); onActivity(); }, [selectLab, onActivity]);
  const openTrack = useCallback((id: string) => { selectLab(null); selectTrack(id); onActivity(); }, [selectLab, selectTrack, onActivity]);
  const inActivity = !experiments;
  return (
    <main className={cn("main mirror-main", sidebarOverlay && "with-copilot")}>
      <aside className="mirror-side" aria-label="Navegación">
        <nav className="side-nav">
          <button type="button" className="side-link" aria-current={inActivity && !labAgent && view === "dashboard" ? "page" : undefined}
            onClick={() => { selectLab(null); showDashboard(); onActivity(); }}>
            <SquaresFour size={16} weight="duotone" aria-hidden />
            Actividad
          </button>
          <button type="button" className="side-link" aria-current={experiments ? "page" : undefined} onClick={onExperiments}>
            <span className="side-replay-mark" aria-hidden="true">▶</span>
            Pruebas y replays
          </button>
        </nav>
        <Agents highlight={inActivity && !labSelected} onSelect={openTrack} />
        <LabAgentList onOpen={openLab} />
      </aside>
      <div className="mirror-left">
        {error && (
          <p role="alert" className="mv-err m-0 px-8 py-2 text-sm">
            {error}
          </p>
        )}
        {experiments ?? (labAgent ? <LabAgentView key={labAgent.project} agent={labAgent} openResults={openResults} />
          : view === "dashboard" ? <Overview openResults={openResults} openLab={openLab} /> : <AgentView openResults={openResults} />)}
      </div>
      {sidebarOverlay && <div className="copilot-col">{sidebarOverlay}</div>}
    </main>
  );
}

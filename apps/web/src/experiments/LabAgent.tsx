/**
 * Lab agents inside the caught-agents screen, drawn with the same replay, graph, finding cards and
 * request list, from the measured fixtures of an A/B run (./labTrack). Interface:
 * - `<LabAgentView agent openResults />`: one project's agent, in the main area.
 * - `<LabSpotlight openResults />`: the latest run replayed, where no caught agent is open.
 * - `<LabSummary openResults />`: one line with the run's result, above the activity.
 * - `<LabAgentList onOpen />`: the lab agents in the sidebar, under the caught agents.
 */
import { useCallback, useState } from "react";
import type { ExperimentProject } from "@sentinel/contracts";
import { FindingCard } from "../mirror/FindingCard";
import { Replay } from "../mirror/Replay";
import { RequestList } from "../mirror/RequestList";
import { cn } from "../ui";
import { useLab } from "./lab";
import { LAB_LEGEND, type LabAgent, type LabOutcome } from "./labTrack";

export type OpenResults = (runId: string, project?: ExperimentProject) => void;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const noop = () => {};

function total(agents: LabAgent[]): LabOutcome {
  return agents.reduce((sum, a) => ({
    direct: sum.direct + a.outcome.direct, protected: sum.protected + a.outcome.protected, total: sum.total + a.outcome.total,
    contained: sum.contained + a.outcome.contained, served: sum.served + a.outcome.served,
  }), { direct: 0, protected: 0, total: 0, contained: 0, served: 0 });
}

function Outcome({ o }: { o: LabOutcome }) {
  return (
    <p className="lab-outcome">
      <strong className="tnum">{o.direct}/{o.total} → {o.protected}/{o.total}</strong>
      <span> casos con la prueba visible, sin y con Centinela · {plural(o.contained, "reintento contenido", "reintentos contenidos")} · el servicio recibió {plural(o.served, "solicitud", "solicitudes")}</span>
    </p>
  );
}

export function LabAgentView({ agent, openResults }: { agent: LabAgent; openResults: OpenResults }) {
  const [active, setActive] = useState<string | null>(null);
  const onFinding = useCallback((id: string | null) => setActive(id), []);
  const label = `${agent.name} · prueba A/B`;
  return (
    <section className="sect" aria-label={`Agente de prueba ${agent.name}`}>
      <div className="dh mv-head">
        <div>
          <div className="mv-name">{agent.name}</div>
          <p className="sub m-0 text-mid">Agente de prueba · {agent.live ? <span className="lab-live">en vivo</span> : "última prueba A/B"}</p>
        </div>
        <button type="button" className="ask" onClick={() => openResults(agent.runId, agent.project)}>Ver la prueba completa</button>
      </div>
      <div className="scroll">
        <div className="lab-body"><Outcome o={agent.outcome} /></div>
        <Replay key={agent.detail.track.trackId} detail={agent.detail} moments={agent.moments} onFinding={onFinding} legend={LAB_LEGEND} graph={agent.graph} />
        {agent.findings.length > 0 && (
          <div className="fcs">
            <h3 className="fcs-h">
              Vulnerabilidades <span className="dim tnum">{agent.findings.length}</span>
            </h3>
            {agent.findings.map((x) => (
              <FindingCard key={x.finding.findingId} f={x.finding} track={agent.detail.track} moments={agent.moments}
                active={x.finding.findingId === active} lab={{ ...x, agent: label }} />
            ))}
          </div>
        )}
        <RequestList actions={[...agent.detail.actions].reverse()} answered="Lo que recibió el agente" />
      </div>
    </section>
  );
}

/** The run's agent worth watching: the one measuring now, else one with a finding. */
const featured = (agents: LabAgent[]) => agents.find((a) => a.live) ?? agents.find((a) => a.findings.length > 0) ?? agents[0];

export function LabSpotlight({ openResults }: { openResults: OpenResults }) {
  const agents = useLab((s) => s.agents);
  const select = useLab((s) => s.select);
  const agent = featured(agents);
  if (!agent) return <p className="lab-empty">Todavía no hay una prueba A/B. Ejecútala en «Pruebas y replays» y aquí verás cómo Centinela retiene la prueba de un ataque.</p>;
  return (
    <section className="lab-spot" aria-labelledby="lab-spot-title">
      <header className="lab-spot-head">
        <div>
          <h2 id="lab-spot-title">{agent.live ? "Prueba A/B en vivo" : "Última prueba A/B"} · {agent.name}</h2>
          <p className="cap">Medido en el laboratorio, con servicios ficticios</p>
        </div>
        <div className="lab-actions">
          <button type="button" className="ask" onClick={() => select(agent.project)}>Ver el recorrido</button>
          <button type="button" className="ask" onClick={() => openResults(agent.runId)}>Abrir resultados</button>
        </div>
      </header>
      <Outcome o={agent.outcome} />
      <Replay key={agent.detail.track.trackId} detail={agent.detail} moments={agent.moments} onFinding={noop} autoplay legend={LAB_LEGEND} graph={agent.graph} />
    </section>
  );
}

export function LabSummary({ openResults }: { openResults: OpenResults }) {
  const agents = useLab((s) => s.agents);
  if (agents.length === 0) return null;
  const live = agents.some((a) => a.live);
  return (
    <section className="lab-summary" aria-label="Última prueba A/B">
      <div>
        <h2>{live ? "Prueba A/B en vivo" : "Última prueba A/B"} · {plural(agents.length, "servicio", "servicios")}</h2>
        <Outcome o={total(agents)} />
      </div>
      <button type="button" className="ask" onClick={() => openResults(agents[0]!.runId)}>Abrir resultados</button>
    </section>
  );
}

export function LabAgentList({ onOpen }: { onOpen: (project: ExperimentProject) => void }) {
  const agents = useLab((s) => s.agents);
  const selected = useLab((s) => s.selected);
  if (agents.length === 0) return null;
  return (
    <section className="sect lab-side" aria-label="Agentes de prueba">
      <div className="hd mt-hd">
        <h2>Agentes de prueba</h2>
        <span className="r cap">{agents.some((a) => a.live) ? "en vivo" : "A/B"}</span>
      </div>
      <div role="listbox" aria-label="Agentes de la última prueba A/B">
        {agents.map((a) => (
          <button key={a.project} type="button" role="option" aria-selected={selected === a.project} className="att-row mt-row"
            aria-label={`${a.name}: ${a.outcome.direct} de ${a.outcome.total} casos con la prueba sin Centinela, ${a.outcome.protected} con Centinela`}
            onClick={() => onOpen(a.project)}>
            <span className={cn("dot", a.live ? "live" : a.outcome.protected > 0 ? "hot" : "ok")} />
            <span className="truncate">{a.name}</span>
            <span className="mono dim tnum ml-auto">{a.outcome.direct}→{a.outcome.protected}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

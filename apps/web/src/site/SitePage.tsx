/**
 * One site's analysis, top to bottom: the site and its CVE case with the run's stages, the result, the
 * replay of the attack, the raw traffic, the vulnerability with its proposed fix, the agent's patch,
 * and the honest limit.
 * Interface: `<SitePage site run demoStep />`. During the guided demo, the step's section is marked
 * and scrolled into view, and the traffic opens the step's row and column.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ExperimentRun } from "@sentinel/contracts";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { FindingCard } from "../mirror/FindingCard";
import { Replay } from "../mirror/Replay";
import { cn } from "../ui";
import { LAB_LEGEND, type LabAgent } from "../experiments/labTrack";
import { DEMO_STEPS, type SectionId } from "./demo";
import { PatchBlock } from "./PatchBlock";
import { StepStrip } from "./StepStrip";
import { Traffic } from "./Traffic";
import "../mirror/replay.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-CL", { dateStyle: "short", timeStyle: "short" }) : "");

export function runLabel(run: ExperimentRun): string {
  if (run.status === "running") return "Prueba en vivo";
  if (run.mode === "recorded") return `Grabación incluida · ${when(run.started)}`;
  return `${run.project ? "Un sitio" : "Prueba A/B"} · ${when(run.started)}`;
}

/** Text with `code` spans, as the researched fixes come from Markdown. */
function Inline({ text }: { text: string }) {
  return <>{text.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : <span key={i}>{part}</span>))}</>;
}

function Section({ id, active, title, children }: { id: SectionId; active: boolean; title?: string; children: React.ReactNode }) {
  return (
    <section id={`s-${id}`} className={cn("st-sect", active && "demo-on")} aria-label={title}>
      {title && <h2 className="st-h">{title}</h2>}
      {children}
    </section>
  );
}

export function SitePage({ site, run, demoStep }: { site: LabAgent; run: ExperimentRun | null; demoStep: number | null }) {
  const step = demoStep === null ? null : DEMO_STEPS[demoStep] ?? null;
  const focus = useMemo(() => step?.focus?.(site), [step, site]);
  const [active, setActive] = useState<string | null>(null);
  const onFinding = useCallback((id: string | null) => setActive(id), []);

  useEffect(() => {
    if (!step) return;
    const target = focus ? document.getElementById(`row-${focus.row}`) : document.getElementById(`s-${step.section}`);
    // The traffic row opens in this render; scroll once it is laid out.
    requestAnimationFrame(() => target?.scrollIntoView({ behavior: "smooth", block: focus ? "start" : "center" }));
  }, [step, focus]);

  const o = site.outcome;
  const on = (id: SectionId) => step?.section === id;
  // One card for the site's CVE, measured over every case of it.
  const lead = site.findings[0];
  const held = site.findings.filter((x) => x.ok).length;
  const card = lead && { ...lead, ok: held === site.findings.length, agent: `${site.name} · prueba A/B`,
    state: `${held === site.findings.length ? "Prueba retenida" : "La prueba llegó"} en ${site.findings.length - held === 0 ? held : site.findings.length - held} de ${site.findings.length} ${site.findings.length === 1 ? "caso" : "casos"}` };
  return (
    <div className="st-page">
      <Section id="header" active={on("header")}>
        <div className="st-head">
          <div>
            <p className="cap">{run ? runLabel(run) : ""}{site.live && <span className="st-live"> · midiendo ahora</span>}</p>
            <h1>{site.name}</h1>
            {site.cve && (
              <p className="st-cve">
                Caso simulado inspirado en{" "}
                {site.cve.source
                  ? <a href={site.cve.source} target="_blank" rel="noreferrer"><code>{site.cve.id}</code> <ArrowSquareOut size={12} aria-hidden /></a>
                  : <code>{site.cve.id}</code>}
                {site.findings[0] && <> · {site.findings[0].vuln.name}</>}
              </p>
            )}
          </div>
          <a className="ask" href={`http://127.0.0.1:9120/${site.project}/`} target="_blank" rel="noreferrer">Abrir el sitio <ArrowSquareOut size={12} aria-hidden /></a>
        </div>
        <StepStrip steps={site.steps} />
      </Section>

      <Section id="result" active={on("result")} title="Resultado">
        <div className="st-result">
          <div className="st-arm bad">
            <span className="cap">Sin Reaper</span>
            <strong className="tnum">{o.direct}/{o.total}</strong>
            <span>casos donde la prueba llegó al atacante</span>
          </div>
          <span className="st-arrow" aria-hidden>→</span>
          <div className={cn("st-arm", o.protected === 0 ? "ok" : "bad")}>
            <span className="cap">Con Reaper</span>
            <strong className="tnum">{o.protected}/{o.total}</strong>
            <span>casos donde la prueba llegó al atacante</span>
          </div>
          <ul className="st-facts">
            <li><b className="tnum">{o.contained}/{o.total}</b> reintentos contenidos por una regla temporal</li>
            <li><b className="tnum">{site.legit.B.passed}/{site.legit.B.total}</b> clientes legítimos pasaron con Reaper ({site.legit.A.passed}/{site.legit.A.total} sin él)</li>
            <li>El servicio recibió <b className="tnum">{plural(o.served, "solicitud", "solicitudes")}</b> de ataque a través de Reaper y las ejecutó</li>
          </ul>
        </div>
      </Section>

      <Section id="replay" active={on("replay")} title="El ataque, paso a paso">
        <Replay key={`${site.detail.track.trackId}:${on("replay")}`} detail={site.detail} moments={site.moments} onFinding={onFinding}
          autoplay={on("replay")} legend={LAB_LEGEND} graph={site.graph} />
      </Section>

      <Section id="traffic" active={on("traffic")} title="Tráfico">
        <p className="st-note">Cada solicitud tal como la vio el cliente, directa al sitio y a través de Reaper. El dato privado aparece resaltado donde llegó.</p>
        <Traffic key={site.project + site.runId} site={site} focus={focus} />
      </Section>

      <Section id="cve" active={on("cve")} title="Vulnerabilidad">
        {card && (
          <div className="fcs">
            <FindingCard f={card.finding} track={site.detail.track} moments={site.moments}
              active={site.findings.some((x) => x.finding.findingId === active)} lab={card} />
          </div>
        )}
        <div className="st-fix">
          <h3>Arreglo propuesto</h3>
          {site.research?.fixes.length
            ? <ul>{site.research.fixes.map((fix) => <li key={fix}><Inline text={fix} /></li>)}</ul>
            : <p className="dim">{site.research?.status === "unconfigured" ? "La consulta del aviso necesita FIRECRAWL_API_KEY." : "Esta corrida no trae un arreglo consultado."}</p>}
          {site.cve?.source && <p className="cap">Fuente: <a href={site.cve.source} target="_blank" rel="noreferrer">aviso de {site.cve.id}</a>. Una persona revisa y aplica el arreglo.</p>}
        </div>
      </Section>

      <Section id="patch" active={on("patch")} title="Parche del agente">
        <PatchBlock site={site} />
      </Section>

      <p className="st-limit">
        {site.patch?.status === "verified"
          ? "El agente parchó una copia del servicio y repitió el ataque: el dato ya no sale. Llevar el parche al servicio real sigue siendo una decisión humana."
          : "Retener la prueba no evita el daño: en estas pruebas el servicio igual ejecutó cada solicitud. Parchar es lo único que lo evita."}
      </p>
    </div>
  );
}

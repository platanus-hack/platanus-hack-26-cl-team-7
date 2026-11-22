/**
 * One confirmed vulnerability: severity, name, endpoint, weak point, and the trace from the catch to
 * the proof as a log, always open, and whether Reaper already keeps the attack out of the real shop.
 * "Preguntar a la IA" asks the copilot about it.
 * Interface: `<FindingCard f track moments active />`.
 * Request lines and evidence are attacker controlled; React renders them as text only.
 */
import type { Finding, Track } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { Orb, cn } from "../ui";
import { useState } from "react";
import { CaretDown, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { agentName, chainTo, contained, vulnOf, type Moment, type Step, type Vuln } from "./moments";

/** The finding as plain text, for the copilot question. */
export function findingText(f: Finding, track: Track, v: Vuln, steps: Step[]): string {
  const lines = [
    `${v.severity.toUpperCase()} · ${v.name}`,
    `Endpoint: ${f.endpoint}`,
    `Punto débil: ${v.gap}`,
    `Agente: ${agentName(track.userAgent)}`,
    `Confirmada: ${new Date(f.ts).toISOString()}`,
    "",
    "Traza:",
    ...steps.flatMap((s) => [`- ${s.text}${s.note ? ` — ${s.note}` : ""}`, ...(s.code ? [`  ${s.code}`] : [])]),
    "",
    `Evidencia: ${f.evidence}`,
  ];
  return lines.join("\n");
}

/** Opens the copilot and asks it about this finding. The copilot code loads on first use. */
function AskCopilot({ text }: { text: string }) {
  const toggle = useDashboard((s) => s.toggleCopilot);
  const range = useDashboard((s) => s.data.range);
  const ask = () => {
    toggle(true);
    void import("../copilot/store").then(({ useCopilot }) =>
      // A copilot message holds 8000 characters at most (CopilotTurn in @sentinel/contracts); long evidence is cut.
      useCopilot.getState().send(`Explícame esta vulnerabilidad y qué debo arreglar en la tienda real:\n\n${text}`.slice(0, 8000), range),
    );
  };
  return (
    <button type="button" className="vc-ai" onClick={ask}>
      <Orb size={16} state="idle" />
      Preguntar a la IA
    </button>
  );
}

export function FindingCard({ f, track, moments, active }: { f: Finding; track: Track; moments: Moment[]; active: boolean }) {
  const v = vulnOf(f);
  const steps = chainTo(track, moments, f.findingId);
  const [open, setOpen] = useState(false);
  return (
    <article className={cn("vc", v.severity === "Crítica" ? "crit" : "high", active && "on")} aria-label={`${v.severity}: ${v.name} en ${f.endpoint}`}>
      <div className="vc-body">
        <div className="vc-top">
          <span className="vc-sev">
            <i aria-hidden />
            {v.severity}
          </span>
          {contained(f) ? (
            <span className="vc-state ok">
              <CheckCircle size={14} weight="fill" aria-hidden />
              Neutralizada
            </span>
          ) : (
            <span className="vc-state">
              <WarningCircle size={14} weight="fill" aria-hidden />
              Sin contener
            </span>
          )}
        </div>
        <h4>{v.name}</h4>
        <code className="vc-ep">{f.endpoint}</code>
        <p className="vc-gap">{v.gap}</p>
      </div>
      <div className="vc-foot">
        {steps.length > 0 ? (
          <button type="button" className="vc-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Ocultar detalle" : "Ver detalle"}
            <CaretDown size={12} weight="bold" className={open ? "up" : undefined} aria-hidden />
          </button>
        ) : (
          <span />
        )}
        <AskCopilot text={findingText(f, track, v, steps)} />
      </div>
      {open && steps.length > 0 && (
        <ol className="log">
          {steps.map((s, i) => (
            <li key={`${s.kind}-${s.ts ?? "gap"}-${i}`} className={cn("log-row", s.kind)}>
              <span className="log-dot" aria-hidden />
              <div className="log-body">
                <div className="log-line">
                  <span className="log-t">{s.text}</span>
                  {s.note && <span className="log-n">{s.note}</span>}
                </div>
                {s.code && (
                  <div className="log-req">
                    <code>{s.code}</code>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

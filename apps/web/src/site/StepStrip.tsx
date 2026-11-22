/**
 * The stages of one site's run as a strip that moves with the event stream. Interface: `<StepStrip steps />`.
 * Each step is one element keyed by its stage and styled from `data-status`, so an event changes
 * attributes and CSS transitions animate it; nothing here keeps time or invents progress.
 * A connector fills when the step before it has left "running". A polite live region says what changed.
 */
import { useEffect, useRef, useState } from "react";
import { seconds, type LabStep } from "../experiments/labTrack";

const STATE: Record<LabStep["status"], string> = {
  pending: "Pendiente", running: "En curso", passed: "Listo", failed: "Falló", degraded: "Parcial", skipped: "Omitido",
};
const over = (status: LabStep["status"]) => status !== "pending" && status !== "running";

/** "<etapa>: <estado>" for each step whose status changed since the last render; the first render says nothing. */
function useChanges(steps: LabStep[]): string {
  const before = useRef<Map<string, LabStep["status"]> | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const previous = before.current;
    before.current = new Map(steps.map((s) => [s.stage, s.status]));
    if (!previous) return;
    const changed = steps.filter((s) => (previous.get(s.stage) ?? "pending") !== s.status);
    if (changed.length > 0) setSaid(changed.map((s) => `${s.label}: ${STATE[s.status].toLowerCase()}`).join(". "));
  }, [steps]);
  return said;
}

export function StepStrip({ steps }: { steps: LabStep[] }) {
  const said = useChanges(steps);
  return (
    <div className="ss">
      <ol className="ss-list" aria-label="Etapas de la prueba">
        {steps.map((step, i) => {
          const left = steps[i - 1];
          return (
            <li key={step.stage} className="ss-step" data-status={step.status} data-link={left && over(left.status) ? left.status : undefined}>
              {left && <span className="ss-link" aria-hidden><i /></span>}
              <span className="ss-node" aria-hidden />
              <span className="ss-text">
                <span className="ss-label">{step.label}</span>
                <span className="ss-meta">
                  <span className="ss-state">{STATE[step.status]}</span>
                  <span className="ss-time tnum">{step.elapsedMs === null ? "" : seconds(step.elapsedMs)}</span>
                </span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="ss-sr" role="status" aria-live="polite">{said}</p>
    </div>
  );
}

/**
 * One confirmed vulnerability: severity, name, endpoint, weak point, and the trace from the catch to
 * the proof as a log, always open. "Copiar detalles" puts the whole finding on the clipboard as text.
 * Interface: `<FindingCard f track moments active />`.
 * Request lines and evidence are attacker controlled; React renders them as text only.
 */
import { useState } from "react";
import type { Finding, Track } from "@sentinel/contracts";
import { cn } from "../ui";
import { agentName, chainTo, vulnOf, type Moment, type Step, type Vuln } from "./moments";

/** The finding as plain text for a ticket or a chat. */
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

function CopyDetails({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  if (typeof navigator === "undefined" || !navigator.clipboard) return null;
  const copy = () => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => undefined);
  };
  return (
    <button type="button" className="vc-copy" onClick={copy}>
      {done ? "Copiado" : "Copiar detalles"}
    </button>
  );
}

export function FindingCard({ f, track, moments, active }: { f: Finding; track: Track; moments: Moment[]; active: boolean }) {
  const v = vulnOf(f);
  const steps = chainTo(track, moments, f.findingId);
  return (
    <article className={cn("vc", v.severity === "Crítica" ? "crit" : "high", active && "on")} aria-label={`${v.severity}: ${v.name} en ${f.endpoint}`}>
      <header className="vc-h">
        <span className="vc-sev">{v.severity}</span>
        <h4>{v.name}</h4>
        <CopyDetails text={findingText(f, track, v, steps)} />
      </header>
      <p className="vc-meta">
        <code>{f.endpoint}</code>
        <span>{v.gap}</span>
      </p>
      {steps.length > 0 && (
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

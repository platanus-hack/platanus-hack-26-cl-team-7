/**
 * One confirmed vulnerability: severity, name, endpoint, weak point, and the trace from the catch to
 * the proof as a log, always open. Interface: `<FindingCard f track moments active />`.
 * Request lines are attacker controlled; React renders them as text only.
 */
import { useState } from "react";
import type { Finding, Track } from "@sentinel/contracts";
import { clock, cn } from "../ui";
import { chainTo, vulnOf, type Moment } from "./moments";

function CopyRequest({ text }: { text: string }) {
  const [done, setDone] = useState(false);
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
    <div className="log-req">
      <code>{text}</code>
      {typeof navigator !== "undefined" && navigator.clipboard && (
        <button type="button" onClick={copy}>
          {done ? "Copiado" : "Copiar"}
        </button>
      )}
    </div>
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
        <time className="vc-time mono tnum">{clock(f.ts)}</time>
      </header>
      <p className="vc-meta">
        <code>{f.endpoint}</code>
        <span>{v.gap}</span>
      </p>
      {steps.length > 0 && (
        <ol className="log">
          {steps.map((s, i) => (
            <li key={`${s.kind}-${s.ts ?? "gap"}-${i}`} className={cn("log-row", s.kind)}>
              <time className="mono tnum">{s.ts === null ? "" : clock(s.ts)}</time>
              <span className="log-dot" aria-hidden />
              <div className="log-body">
                <div className="log-line">
                  <span className="log-t">{s.text}</span>
                  {s.note && <span className="log-n">{s.note}</span>}
                </div>
                {s.code && <CopyRequest text={s.code} />}
              </div>
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}

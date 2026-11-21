/**
 * A proof explained, closed until "Ver más detalles": the vulnerability, the weakness behind it
 * and the steps the agent took from the catch to the proof.
 * Interface: `<ProofDetails f={finding} track={track} moments={moments} />`.
 * Evidence and request lines are attacker controlled; React renders them as text only.
 */
import { useState } from "react";
import type { Finding, Track } from "@sentinel/contracts";
import { clock, cn } from "../ui";
import { chainTo, vulnOf, type Moment } from "./moments";

export function ProofDetails({ f, track, moments }: { f: Finding; track: Track; moments: Moment[] }) {
  const [open, setOpen] = useState(false);
  const v = vulnOf(f);
  const steps = open ? chainTo(track, moments, f.findingId) : [];
  return (
    <>
      <button type="button" className="mf-open" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Ocultar detalles" : "Ver más detalles"}
      </button>
      {open && (
        <div className="pd">
          <div className="pd-v">
            <span className={cn("pd-sev", v.severity === "Crítica" && "crit")}>{v.severity}</span>
            <b>{v.name}</b>
            <span className="mono dim">{f.endpoint}</span>
          </div>
          <p className="pd-gap">
            <span className="dim">Punto débil: </span>
            {v.gap}
          </p>
          {steps.length > 0 && (
            <>
              <div className="pd-h">Cómo llegó</div>
              <ol className="pd-chain">
                {steps.map((s, i) => (
                  <li key={i} className={s.kind}>
                    <span className="pd-when mono tnum">{s.ts === null ? "" : clock(s.ts)}</span>
                    <span className="pd-what">
                      <span className={s.kind === "win" ? "mono" : undefined}>{s.text}</span>
                      {s.note && <span className="pd-note">{s.note}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
          <div className="pd-h">Evidencia</div>
          <p className="pd-ev mono">{f.evidence}</p>
        </div>
      )}
    </>
  );
}

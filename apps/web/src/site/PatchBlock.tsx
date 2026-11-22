/**
 * The AppSec agent's patch for one site. Interface: `<PatchBlock site />`.
 * It shows what the run recorded and nothing more: the status, the agent's own explanation, each edit
 * as a plain diff, and the replay of the attack against the patched copy. The service the panel
 * protects never changes. Every string, including the model's, is rendered as React text.
 */
import type { PatchResult } from "@sentinel/contracts";
import { diffLines, patchErrorText, seconds, type LabAgent } from "../experiments/labTrack";

type Tone = "ok" | "bad" | "warn" | "info" | "idle";

const CHIP: Record<PatchResult["status"], [string, Tone]> = {
  verified: ["Parche verificado", "ok"],
  failed: ["El parche no cerró la falla", "bad"],
  unavailable: ["No se pudo verificar", "warn"],
  unconfigured: ["El agente necesita ANTHROPIC_API_KEY", "warn"],
  no_finding: ["Sin falla confirmada", "idle"],
};
/** For the results where the agent wrote nothing to show. */
const NOTE: Partial<Record<PatchResult["status"], string>> = {
  unconfigured: "Sin la llave del modelo en Reaper, el agente no escribe parches.",
  no_finding: "No hubo un caso confirmado, así que el agente no escribió un parche.",
};

function ReplayFacts({ replay }: { replay: NonNullable<PatchResult["replay"]> }) {
  const { attacks, legit } = replay;
  return (
    <ul className="st-facts pb-facts">
      <li data-tone={attacks.yes === 0 ? "ok" : "bad"}>
        Ataque repetido: <b className="tnum">{attacks.yes} de {attacks.total}</b> {attacks.total === 1 ? "caso" : "casos"} trajo el dato
      </li>
      <li data-tone={legit.yes === legit.total ? "ok" : "bad"}>
        Clientes legítimos: <b className="tnum">{legit.yes} de {legit.total}</b> {legit.total === 1 ? "pasó" : "pasaron"}
      </li>
    </ul>
  );
}

function Result({ patch }: { patch: PatchResult }) {
  const note = NOTE[patch.status];
  return (
    <div className="pb-body">
      {note && <p className="pb-note">{note}</p>}
      {patch.explanation && <p className="pb-why">{patch.explanation}</p>}
      {patch.cwe && <p className="cap">Debilidad: <code>{patch.cwe}</code></p>}
      {patch.edits.map((edit, i) => (
        <figure key={`${edit.file}:${i}`} className="pb-edit">
          <figcaption><code>{edit.file}</code></figcaption>
          <pre className="pb-diff">{diffLines(edit).map((line, j) => (
            <span key={j} className={line.sign === "-" ? "pb-del" : "pb-add"}>{line.sign} {line.text}</span>
          ))}</pre>
        </figure>
      ))}
      {patch.replay && <ReplayFacts replay={patch.replay} />}
      {patch.error && <p className="pb-note">{patchErrorText(patch.error)}</p>}
      {patch.attempts > 0 && (
        <p className="cap pb-caption">
          Aplicado en una copia del servicio, no en el servicio real. Intentos: {patch.attempts}.
          {patch.model && ` Modelo: ${patch.model}.`} Agente {seconds(patch.timings.agentMs)} · verificación {seconds(patch.timings.verifyMs)}.
        </p>
      )}
    </div>
  );
}

export function PatchBlock({ site }: { site: LabAgent }) {
  const { patch } = site;
  const step = site.steps.find((s) => s.stage === "patch");
  const [label, tone, note]: [string, Tone, string | null] = patch
    ? [...CHIP[patch.status], null]
    : step?.status === "running"
      ? ["El agente está escribiendo el parche…", "info", "Propone como máximo tres reemplazos exactos y los prueba en una copia del servicio."]
      : step?.status === "pending"
        ? ["Parche pendiente", "idle", "Empieza cuando termina la consulta del aviso."]
        : step
          ? ["Parche interrumpido", "warn", "Reaper se detuvo antes de terminar el parche. Se reintenta al iniciar de nuevo con ANTHROPIC_API_KEY."]
          : ["Sin parche en esta prueba", "idle", "Esta prueba no incluye el paso del parche."];
  return (
    <div className="pb">
      <span className="pb-chip" data-tone={tone}>{label}</span>
      {patch ? <Result patch={patch} /> : <p className="pb-note">{note}</p>}
    </div>
  );
}

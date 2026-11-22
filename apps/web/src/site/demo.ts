/**
 * The guided demo: steps over the sections of one site page, in the order the story is told.
 * Interface: `DEMO_STEPS`, `SectionId`. Each step names the section to show, its words, and,
 * for the traffic steps, the request row and column to open.
 */
import type { LabAgent } from "../experiments/labTrack";
import type { TrafficFocus } from "./Traffic";

export type SectionId = "header" | "result" | "replay" | "traffic" | "cve" | "patch";

export interface DemoStep {
  section: SectionId;
  title: string;
  text: (site: LabAgent) => string;
  focus?: (site: LabAgent) => TrafficFocus | undefined;
}

const firstAttack = (site: LabAgent) => site.traffic.find((row) => row.kind === "attack")?.id;
const at = (cell: TrafficFocus["cell"]) => (site: LabAgent) => {
  const row = firstAttack(site);
  return row ? { row, cell } : undefined;
};

export const DEMO_STEPS: DemoStep[] = [
  {
    section: "header", title: "El sitio y su falla",
    text: (s) => `${s.name} tiene una falla modelada en ${s.cve?.id ?? "una CVE publicada"}. ${s.findings[0]?.vuln.gap ?? ""}`,
  },
  {
    section: "replay", title: "El ataque",
    text: () => "Un agente envía la solicitud que alcanza la falla y la repite. Cada barra es una solicitud; el color dice qué recibió el atacante.",
  },
  {
    section: "traffic", title: "Sin Reaper", focus: at("direct"),
    text: () => "Directo al servicio, la respuesta trae el dato privado, resaltado. Con eso el atacante confirma que su ataque funcionó.",
  },
  {
    section: "traffic", title: "Con Reaper", focus: at("protected"),
    text: () => "La misma solicitud pasando por Reaper. Ve la prueba en la respuesta y la cambia por un error creíble. El servicio igual ejecutó la solicitud.",
  },
  {
    section: "traffic", title: "El reintento", focus: at("retry"),
    text: () => "Reaper instaló una regla temporal para ese actor y esa ruta: el reintento ya no llega al servicio.",
  },
  {
    section: "result", title: "El resultado",
    text: (s) => `La prueba llegó al atacante en ${s.outcome.direct} de ${s.outcome.total} casos sin Reaper y en ${s.outcome.protected} con Reaper. Los clientes legítimos pasaron ${s.legit.B.passed} de ${s.legit.B.total}.`,
  },
  {
    section: "cve", title: "La falla y su arreglo",
    text: () => "Reaper consultó el aviso de la CVE con Firecrawl y el agente usa ese arreglo como punto de partida.",
  },
  {
    section: "patch", title: "El parche",
    text: (s) => {
      const replay = s.patch?.replay;
      if (s.patch?.status === "verified" && replay) return `El agente escribió un parche, lo aplicó en una copia y repitió el ataque: ${replay.attacks.yes} de ${replay.attacks.total} casos traen el dato.`;
      return s.patch ? "El agente intentó parchar; el panel muestra el resultado tal cual." : "El panel muestra el paso del parche cuando el agente lo entrega.";
    },
  },
];

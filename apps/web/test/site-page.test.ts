/**
 * The site page with the bundled Vulhub recording: the stage strip, the analyst's reading, the fix and the patch block,
 * rendered to markup. No effect runs, so the replay and the demo scroll stay idle.
 */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperimentDetail, type ExperimentEvent, type PatchResult } from "@sentinel/contracts";
import { labAgents } from "../src/experiments/labTrack";
import { SitePage } from "../src/site/SitePage";

const recorded = ExperimentDetail.parse(JSON.parse(readFileSync(new URL("../../sentinel/src/experiments/recorded-run.json", import.meta.url), "utf8")));

const stage = (name: Extract<ExperimentEvent, { kind: "stage" }>["stage"], status: Extract<ExperimentEvent, { kind: "stage" }>["status"], elapsedMs?: number): ExperimentEvent =>
  ({ kind: "stage", project: "nextjs", stage: name, status, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
const analysis: ExperimentEvent = { kind: "analysis", project: "nextjs", model: "test-model", status: "completed", cve: "CVE-2025-29927", confirmed: true,
  summary: "La cabecera `x-middleware-subrequest` saltó el middleware y la página protegida salió sin credenciales." };
const patch: PatchResult = {
  kind: "patch", project: "nextjs", status: "verified", model: "claude-test", attempts: 1,
  edits: [{ file: "targets/businesses/service.py", old: "return secret\n", new: "return None\n" }],
  explanation: "Deja de devolver la referencia privada.", cwe: "CWE-200",
  replay: { attacks: { yes: 0, total: 3 }, legit: { yes: 2, total: 2 } }, timings: { agentMs: 3400, verifyMs: 800 }, tokens: { input: 10, output: 5 }, error: null,
};

/** The recording with `events` after its last entry. */
function withEvents(events: ExperimentEvent[]): ExperimentDetail {
  const last = Math.max(...recorded.entries.map((e) => e.seq));
  return { run: recorded.run, entries: [...recorded.entries, ...events.map((event, i) => ({ seq: last + 1 + i, at: null, event }))] };
}

function page(detail: ExperimentDetail, project: "nextjs" | "vite" = "nextjs") {
  const site = labAgents(detail).find((s) => s.project === project)!;
  return renderToStaticMarkup(createElement(SitePage, { site, run: detail.run, demoStep: null }));
}

const before = (html: string, first: string, second: string) => {
  const at = [html.indexOf(first), html.indexOf(second)];
  return at[0]! >= 0 && at[1]! >= 0 && at[0]! < at[1]!;
};

describe("SitePage with the Vulhub recording", () => {
  it("renders the recording as it is: its stage strip, the researched fix, no analysis reading and no patch", () => {
    for (const project of ["nextjs", "vite"] as const) {
      const html = page(recorded, project);
      expect(html).toContain('aria-label="Etapas de la prueba"');
      expect(before(html, "Detección", "Contención")).toBe(true);
      expect(html).not.toContain("Análisis");
      expect(html).not.toContain("Lectura del agente");
      expect(html).toContain("Arreglo propuesto");
      expect(html).toContain("Sin parche en esta prueba");
      expect(html).toContain("Retener la prueba no evita el daño");
    }
  });

  it("shows the analysis step between containment and research, with the analyst's reading as text and code", () => {
    const html = page(withEvents([stage("analysis", "running"), analysis, stage("analysis", "passed", 800), stage("research", "running"), stage("research", "passed", 1200)]));
    expect(before(html, "Contención", "Análisis")).toBe(true);
    expect(before(html, "Análisis", "Aviso")).toBe(true);
    expect(html).toContain("0,8 s");
    expect(html).toContain("Lectura del agente sobre la prueba medida:");
    expect(html).toContain("<code>x-middleware-subrequest</code>");
    expect(html).toContain("saltó el middleware");
    expect(html).not.toContain("Parche verificado");
  });

  it("shows the patch step, the diff and the replay once the run carries a patch", () => {
    const html = page(withEvents([stage("patch", "running"), patch, stage("patch", "passed", 3400)]));
    expect(before(html, "Contención", "Parche")).toBe(true);
    expect(html).toContain("Parche verificado");
    expect(html).toContain("Deja de devolver la referencia privada.");
    expect(html).toContain("3,4 s");
    expect(html).toContain("el dato ya no sale");
    expect(html).not.toContain("Retener la prueba no evita el daño");
  });
});

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceDemoBundle } from "@sentinel/contracts";
import { DetectorEvidence, RecordedEvidence } from "../src/evidence-demo/EvidenceDemo";

const fixture = new URL("../../sentinel/src/evidence-demo/bundle.json", import.meta.url);
const { runs: [bank, detector] } = EvidenceDemoBundle.parse(JSON.parse(readFileSync(fixture, "utf8")));

describe("evidence demo UI", () => {
  it("renders the two historical arms and labels gaps in the request evidence", () => {
    const html = renderToStaticMarkup(createElement(RecordedEvidence, { run: bank }));
    expect(html).toContain("A · Directo");
    expect(html).toContain("B · Con proxy");
    expect(html).toContain("0/5");
    expect(html).toContain("5/5");
    expect(html).toContain("0/25");
    expect(html).toContain("No disponible");
    expect(html).not.toContain("Veredicto");
  });

  it("renders the separate detector replay with a link to its verdict", () => {
    const html = renderToStaticMarkup(createElement(DetectorEvidence, { run: detector }));
    expect(html).toContain("Replay sintético de agent-detection");
    expect(html).toContain("R1 en la solicitud 5");
    expect(html).toContain("Sin veredicto");
    expect(html).toContain(`href="#${detector.id}:unlisted:6"`);
    expect(html).toContain(`id="${detector.id}:unlisted:6"`);
    expect(html).not.toContain("A/B grabado");
  });
});

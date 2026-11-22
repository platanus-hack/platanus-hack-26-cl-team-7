import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExperimentDetail, TrackDetail } from "@sentinel/contracts";
import { fixturePath, hex16, labAgents } from "../src/experiments/labTrack";

// A recorded live run of all four services (stage and fixture entries only), exported from Sentinel.
const run = ExperimentDetail.parse(JSON.parse(readFileSync(new URL("./fixtures/lab-run.json", import.meta.url), "utf8")));

describe("labAgents", () => {
  const agents = labAgents(run);

  it("makes one agent per measured project, in run order", () => {
    expect(agents.map((a) => a.project)).toEqual(["bruma", "litoral", "surco", "bank"]);
    expect(agents.every((a) => !a.live)).toBe(true);
  });

  it("builds a track detail the caught-agent views accept", () => {
    for (const a of agents) {
      expect(TrackDetail.safeParse(a.detail).success).toBe(true);
      expect(a.detail.actions).toHaveLength(a.outcome.total * 2);
      expect(a.moments).toHaveLength(a.detail.actions.length);
      expect(a.detail.track.findings).toBe(a.findings.length);
    }
  });

  it("counts the proof that reached the client without and with Centinela", () => {
    const sum = (key: "direct" | "protected" | "total" | "contained") => agents.reduce((n, a) => n + a.outcome[key], 0);
    expect([sum("direct"), sum("protected"), sum("total"), sum("contained")]).toEqual([8, 1, 12, 7]);
  });

  it("reports the unlabelled record as a proof that still reached the client", () => {
    const surco = agents.find((a) => a.project === "surco")!;
    const leaked = surco.findings.find((x) => !x.ok)!;
    expect(leaked.state).toBe("La prueba llegó");
    expect(leaked.vuln.name).toBe("Registro privado sin marcador");
    expect(surco.moments.find((m) => m.finding?.findingId === leaked.finding.findingId)?.kind).toBe("win");
  });

  it("marks a withheld proof and its contained retry as Centinela's", () => {
    const bruma = agents.find((a) => a.project === "bruma")!;
    const held = bruma.findings[0]!;
    expect(held.ok).toBe(true);
    expect(held.steps.map((s) => s.text)).toEqual([
      "Sin Centinela, la prueba llegó",
      "Con Centinela, la respuesta no salió",
      "Reintento contenido",
      "El servicio sí ejecutó la solicitud",
    ]);
    expect(bruma.moments.slice(0, 2).map((m) => m.kind)).toEqual(["fooled", "fooled"]);
    // A request indicator without a proof is neither a finding nor a win.
    expect(bruma.moments.slice(4).map((m) => m.kind)).toEqual(["none", "none"]);
    expect(bruma.graph.bottom.sub).toBe("2 de 2 retenidas");
  });

  it("uses the request target the pipeline builds, and the receipt's own when present", () => {
    expect(agents.find((a) => a.project === "bank")!.detail.actions[0]!.path).toBe("/bank/refunds/stale-approval");
    const f = run.entries.flatMap(({ event }) => (event.kind === "fixture" ? [event] : []))[0]!;
    expect(fixturePath({ ...f, B: { ...f.B, path: "/bruma/elsewhere" } })).toBe("/bruma/elsewhere");
  });

  it("follows a run in progress", () => {
    const stage = run.entries.find(({ event }) => event.kind === "stage" && event.project === "bank")!;
    const live = { ...run, run: { ...run.run, status: "running" as const },
      entries: [...run.entries, { seq: 9999, at: null, event: { ...stage.event, stage: "feedback", status: "running" } as typeof stage.event }] };
    expect(labAgents(live).map((a) => a.live)).toEqual([false, false, false, true]);
  });

  it("is empty without a run, and keeps ids stable", () => {
    expect(labAgents(null)).toEqual([]);
    expect(hex16("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(labAgents(run)[0]!.detail.track.trackId).toBe(agents[0]!.detail.track.trackId);
  });
});

import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExperimentDetail, type ExperimentEvent, type ExperimentRun, type PatchResult } from "@sentinel/contracts";
import { diffLines, labAgents, patchErrorText, seconds } from "../src/experiments/labTrack";
import { PatchBlock } from "../src/site/PatchBlock";

const recorded = ExperimentDetail.parse(JSON.parse(readFileSync(new URL("../../sentinel/src/experiments/recorded-run.json", import.meta.url), "utf8")));

type Stage = Extract<ExperimentEvent, { kind: "stage" }>;
const stage = (s: Stage["stage"], status: Stage["status"], elapsedMs?: number): ExperimentEvent => ({ kind: "stage", project: "bruma", stage: s, status, ...(elapsedMs === undefined ? {} : { elapsedMs }) });
const patchEvent = (status: PatchResult["status"]): PatchResult => ({
  kind: "patch", project: "bruma", status, model: "claude-test", attempts: 1,
  edits: [{ file: "targets/businesses/service.py", old: "return secret\n", new: "return None\n" }],
  explanation: "Deja de devolver la referencia privada.", cwe: "CWE-200",
  replay: { attacks: { yes: 0, total: 3 }, legit: { yes: 2, total: 2 } }, timings: { agentMs: 3400, verifyMs: 800 }, tokens: { input: 10, output: 5 }, error: null,
});

/** The recording with bruma's stage events replaced by `stages`, so each test says exactly what the run emitted. */
function detailWith(stages: ExperimentEvent[], run: Partial<ExperimentRun> = { status: "running" }): ExperimentDetail {
  const kept = recorded.entries.filter(({ event }) => !(event.kind === "stage" && event.project === "bruma" && ["detection", "containment", "research", "feedback"].includes(event.stage)));
  const last = Math.max(...kept.map((e) => e.seq));
  const entries = [...kept, ...stages.map((event, i) => ({ seq: last + 1 + i, at: null, event }))];
  return ExperimentDetail.parse({ run: { ...recorded.run, ...run }, entries });
}
const bruma = (detail: ExperimentDetail) => labAgents(detail).find((s) => s.project === "bruma")!;
const summary = (detail: ExperimentDetail) => bruma(detail).steps.map((s) => [s.stage, s.status, s.elapsedMs]);

describe("labAgents steps", () => {
  it("shows the stages of a run without a patch step as they were recorded, with no patch", () => {
    for (const site of labAgents(recorded)) {
      expect(site.steps.map((s) => [s.label, s.status, s.elapsedMs])).toEqual([["Detección", "passed", null], ["Contención", "passed", null], ["Aviso", "passed", null]]);
      expect(site.patch).toBeNull();
    }
  });

  it("waits on every step while the run has emitted nothing, patch included", () => {
    expect(summary(detailWith([]))).toEqual([["detection", "pending", null], ["containment", "pending", null], ["research", "pending", null], ["patch", "pending", null]]);
  });

  it("follows the events of one project in order, with each elapsed time", () => {
    const events = [stage("detection", "passed", 120), stage("containment", "passed", 250), stage("research", "running")];
    expect(summary(detailWith(events))).toEqual([["detection", "passed", 120], ["containment", "passed", 250], ["research", "running", null], ["patch", "pending", null]]);
    events.push(stage("research", "passed", 1700), stage("patch", "running"));
    expect(summary(detailWith(events))).toEqual([["detection", "passed", 120], ["containment", "passed", 250], ["research", "passed", 1700], ["patch", "running", null]]);
    events.push(patchEvent("verified"), stage("patch", "passed", 4200));
    const done = bruma(detailWith(events));
    expect(done.steps.map((s) => [s.stage, s.status, s.elapsedMs])).toEqual([["detection", "passed", 120], ["containment", "passed", 250], ["research", "passed", 1700], ["patch", "passed", 4200]]);
    expect(done.patch).toMatchObject({ status: "verified", cwe: "CWE-200" });
  });

  it("lets the latest stage event win and keeps other projects out of the strip", () => {
    const events = [stage("research", "running"), stage("research", "degraded", 900), { ...stage("patch", "failed", 10), project: "litoral" as const }];
    const detail = detailWith(events);
    expect(summary(detail).find(([name]) => name === "research")).toEqual(["research", "degraded", 900]);
    expect(bruma(detail).steps.find((s) => s.stage === "patch")?.status).toBe("pending");
    expect(labAgents(detail).find((s) => s.project === "litoral")?.steps.find((s) => s.stage === "patch")?.status).toBe("failed");
  });

  it("keeps the latest patch event of the project", () => {
    const detail = detailWith([stage("patch", "running"), patchEvent("failed"), patchEvent("verified"), stage("patch", "passed", 5)]);
    expect(bruma(detail).patch?.status).toBe("verified");
    expect(labAgents(detail).filter((s) => s.project !== "bruma").every((s) => s.patch === null)).toBe(true);
  });

  it("keeps a patch step that ran, and drops one that never started, once the run is over", () => {
    const patched = detailWith([stage("patch", "running"), patchEvent("unavailable"), stage("patch", "degraded", 30)], { status: "completed" });
    expect(bruma(patched).steps.map((s) => s.stage)).toEqual(["detection", "containment", "research", "patch"]);
    expect(bruma(patched).steps.at(-1)).toMatchObject({ stage: "patch", status: "degraded", elapsedMs: 30 });
    expect(bruma(detailWith([], { status: "completed" })).steps.map((s) => s.stage)).toEqual(["detection", "containment", "research"]);
    expect(bruma(detailWith([], { status: "failed" })).steps.some((s) => s.stage === "patch")).toBe(false);
  });
});

describe("labAgents worker stages", () => {
  it("shows detection and containment running, then passed with the time the worker took", () => {
    const events = [stage("detection", "running")];
    expect(summary(detailWith(events))).toEqual([["detection", "running", null], ["containment", "pending", null], ["research", "pending", null], ["patch", "pending", null]]);
    expect(bruma(detailWith(events)).live).toBe(true);
    events.push(stage("detection", "passed", 3400), stage("containment", "running"));
    expect(summary(detailWith(events))).toEqual([["detection", "passed", 3400], ["containment", "running", null], ["research", "pending", null], ["patch", "pending", null]]);
    events.push(stage("containment", "passed", 150_000));
    expect(summary(detailWith(events)).slice(0, 2)).toEqual([["detection", "passed", 3400], ["containment", "passed", 150_000]]);
  });
});

describe("labAgents while patching a finished run", () => {
  const base = [stage("detection", "passed"), stage("containment", "passed"), stage("research", "passed", 1500)];
  const patching = { status: "completed", patching: true } as const;

  it("waits for the patch step, then runs it, then settles when the server says done", () => {
    const waiting = bruma(detailWith(base, patching));
    expect(waiting.steps.at(-1)).toMatchObject({ stage: "patch", status: "pending" });
    expect(waiting.live).toBe(false);

    const running = bruma(detailWith([...base, stage("patch", "running")], patching));
    expect(running.steps.at(-1)).toMatchObject({ stage: "patch", status: "running" });
    expect(running.live).toBe(true);

    const events = [...base, stage("patch", "running"), patchEvent("verified"), stage("patch", "passed", 2000)];
    expect(bruma(detailWith(events, patching)).live).toBe(false);
    expect(bruma(detailWith(events, { status: "completed" })).live).toBe(false);
  });

  it("is not live for a finished run whose patch step still reads running", () => {
    expect(bruma(detailWith([...base, stage("patch", "running")], { status: "completed" })).live).toBe(false);
  });

  it("is live for a run in progress while any stage runs", () => {
    expect(bruma(detailWith([stage("research", "running")])).live).toBe(true);
    expect(bruma(detailWith(base)).live).toBe(false);
  });
});

describe("PatchBlock without a patch event", () => {
  const base = [stage("detection", "passed"), stage("containment", "passed"), stage("research", "passed", 1500)];
  const html = (events: ExperimentEvent[], run: Partial<ExperimentRun>) => renderToStaticMarkup(createElement(PatchBlock, { site: bruma(detailWith([...base, ...events], run)) }));

  it("says the patch is pending only while the run is in progress", () => {
    expect(html([], { status: "running" })).toContain("Parche pendiente");
    expect(html([], { status: "completed", patching: true })).toContain("Parche pendiente");
  });

  it("says the patch was interrupted when a finished run cut it off, with no pending words", () => {
    const out = html([stage("patch", "running")], { status: "completed" });
    expect(out).toContain("Parche interrumpido");
    expect(out).toContain("Reaper se detuvo antes de terminar el parche. Se reintenta al iniciar de nuevo con ANTHROPIC_API_KEY.");
    expect(out).not.toContain("Parche pendiente");
    expect(out).not.toContain("Empieza cuando termina");
  });

  it("says the agent is writing while the step runs", () => {
    expect(html([stage("patch", "running")], { status: "running" })).toContain("El agente está escribiendo el parche…");
  });

  it("shows the Spanish words for a recorded error, never the server's text", () => {
    const failed: PatchResult = { ...patchEvent("unavailable"), error: "verifier exited with code 1: Traceback (most recent call last)" };
    const out = renderToStaticMarkup(createElement(PatchBlock, { site: bruma(detailWith([...base, stage("patch", "running"), failed, stage("patch", "degraded", 40)], { status: "completed" })) }));
    expect(out).toContain("El verificador falló.");
    expect(out).not.toContain("Traceback");
    expect(out).not.toContain("verifier");
  });
});

describe("patchErrorText", () => {
  it("maps each error the server records to Spanish", () => {
    expect([
      "verifier stopped", "verifier timed out after 45 s", "uv not found", "verifier exited with code 2", "invalid model output: edits.0.file: Invalid",
      "the patch changed the canary", "the patch adds a forbidden construct",
    ].map(patchErrorText)).toEqual([
      "Reaper se detuvo durante la verificación.", "La verificación tardó más de 45 s.", "Falta uv para verificar el parche.", "El verificador falló.",
      "La respuesta del agente no tenía el formato pedido.", "El parche cambió el dato de prueba en vez de cerrar la falla.", "El parche usaba una construcción no permitida.",
    ]);
  });

  it("hides anything else behind one sentence", () => {
    expect(patchErrorText("ECONNRESET at /Users/someone/key=sk-ant-123")).toBe("El intento no se pudo verificar.");
    expect(patchErrorText("")).toBe("El intento no se pudo verificar.");
  });
});

describe("patch text helpers", () => {
  it("writes seconds with a decimal comma", () => {
    expect([0, 1234, 1250, 59_999, 150_000].map(seconds)).toEqual(["0,0 s", "1,2 s", "1,3 s", "60,0 s", "150,0 s"]);
  });

  it("lists the removed lines, then the added lines, without the unchanged lines around them", () => {
    expect(diffLines({ old: "a = 1\nb = 2\n", new: "a = 1\nb = safe(2)\nc = 3" })).toEqual([
      { sign: "-", text: "b = 2" }, { sign: "+", text: "b = safe(2)" }, { sign: "+", text: "c = 3" },
    ]);
    expect(diffLines({ old: "if x:\n    return private\nend", new: "if x:\n    return public\nend" })).toEqual([
      { sign: "-", text: "    return private" }, { sign: "+", text: "    return public" },
    ]);
  });

  it("keeps a one-line edit whole even when it repeats", () => {
    expect(diffLines({ old: "x = 1", new: "x = 1" })).toEqual([{ sign: "-", text: "x = 1" }, { sign: "+", text: "x = 1" }]);
  });

  it("shows a step that a stop left running as cut off once the run is over, and running while patching", () => {
    const events = [stage("research", "passed", 10), stage("patch", "running")];
    const patchStep = (run: Partial<ExperimentRun>) => bruma(detailWith(events, run)).steps.find((s) => s.stage === "patch")?.status;
    expect(patchStep({ status: "completed" })).toBe("degraded");
    expect(patchStep({ status: "completed", patching: true })).toBe("running");
    expect(patchStep({ status: "running" })).toBe("running");
  });

  it("adds nothing when an edit only removes", () => {
    expect(diffLines({ old: "return secret", new: "" })).toEqual([{ sign: "-", text: "return secret" }]);
  });
});

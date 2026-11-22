import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExperimentDetail, TrackDetail } from "@sentinel/contracts";
import { curlOf, fixturePath, hex16, labAgents } from "../src/experiments/labTrack";

const read = (url: URL) => ExperimentDetail.parse(JSON.parse(readFileSync(url, "utf8")));
// The recording Sentinel bundles: a full live run of the four sites, with raw traffic.
const run = read(new URL("../../sentinel/src/experiments/recorded-run.json", import.meta.url));
// An older run that still measured the deliberate controls next to the CVE cases.
const older = read(new URL("./fixtures/lab-run.json", import.meta.url));

describe("labAgents", () => {
  const sites = labAgents(run);

  it("makes one site per measured project, each with its CVE", () => {
    expect(sites.map((s) => [s.project, s.cve?.id])).toEqual([
      ["bruma", "CVE-2026-118662"], ["litoral", "CVE-2025-55182"], ["surco", "CVE-2025-29927"], ["bank", "CVE-2026-129289"],
    ]);
    expect(sites.every((s) => !s.live && s.cve?.source?.startsWith("https://"))).toBe(true);
  });

  it("builds a track detail the replay components accept", () => {
    for (const s of sites) {
      expect(TrackDetail.safeParse(s.detail).success).toBe(true);
      expect(s.detail.actions).toHaveLength(s.outcome.total * 2);
      expect(s.moments).toHaveLength(s.detail.actions.length);
    }
  });

  it("counts the proof that reached the client without and with Reaper", () => {
    const sum = (key: "direct" | "protected" | "total" | "contained") => sites.reduce((n, s) => n + s.outcome[key], 0);
    expect([sum("direct"), sum("protected"), sum("total"), sum("contained")]).toEqual([7, 0, 7, 7]);
    expect(sites.every((s) => s.legit.A.passed === s.legit.A.total && s.legit.B.passed === s.legit.B.total && s.legit.B.total > 0)).toBe(true);
  });

  it("pairs every request as raw HTTP, with the proof only in the direct response", () => {
    const bruma = sites[0]!;
    const row = bruma.traffic.find((r) => r.kind === "attack")!;
    expect(row.cells.map((c) => c.label)).toEqual(["Sin Reaper", "Con Reaper", "Reintento con Reaper"]);
    const [direct, protectedCell, retry] = row.cells.map((c) => c.receipt);
    expect(row.proof).toBe("PROOF-6408");
    expect(direct!.raw!.response.body).toContain(row.proof!);
    expect(JSON.stringify(protectedCell!.raw)).not.toContain(row.proof!);
    expect(protectedCell!.engine).toMatchObject({ decision: "replace", evidence: ["canary:bruma"] });
    expect(retry!.engine).toMatchObject({ decision: "divert" });
    expect(row.verdict).toBe("Reaper retuvo la prueba y contuvo el reintento");
    expect(bruma.traffic.filter((r) => r.kind === "legit").every((r) => r.cells.length === 2 && r.tone === "none")).toBe(true);
  });

  it("finds the header proof where the service put it", () => {
    const litoral = sites.find((s) => s.project === "litoral")!;
    const direct = litoral.traffic[0]!.cells[0]!.receipt.raw!;
    expect(direct.response.headers.some(([, v]) => v.includes(litoral.traffic[0]!.proof!))).toBe(true);
  });

  it("explains a withheld proof step by step, with the honest limit", () => {
    const held = sites[0]!.findings[0]!;
    expect(held.ok).toBe(true);
    expect(held.steps.map((s) => s.text)).toEqual([
      "Sin Reaper, la prueba llegó", "Con Reaper, la respuesta no salió", "Reintento contenido", "El servicio sí ejecutó la solicitud",
    ]);
  });

  it("carries the researched fix of each CVE", () => {
    expect(sites.every((s) => s.research?.status === "retrieved" && s.research.fixes.length > 0)).toBe(true);
  });

  it("leaves out the deliberate controls of older runs", () => {
    const old = labAgents(older);
    expect(old.reduce((n, s) => n + s.outcome.total, 0)).toBe(7);
    expect(old.flatMap((s) => s.traffic).filter((r) => r.kind === "attack").map((r) => r.title)).not.toContain("Registro sin marcador");
    expect(old[0]!.traffic[0]!.cells[0]!.receipt.raw).toBeUndefined();
  });

  it("uses the request target the pipeline builds when a receipt has none", () => {
    const f = older.entries.flatMap(({ event }) => (event.kind === "fixture" ? [event] : []))[0]!;
    expect(fixturePath(f)).toBe("/bruma/receipt");
    expect(fixturePath({ ...f, B: { ...f.B, path: "/bruma/elsewhere" } })).toBe("/bruma/elsewhere");
  });

  it("copies a request as curl without the harness correlation header", () => {
    const raw = sites[0]!.traffic[0]!.cells[0]!.receipt.raw!.request;
    const cmd = curlOf(raw);
    expect(cmd).toMatch(/^curl -i -H 'User-Agent: [^']+' -H 'X-Catalog-Note: receipt-fixture' 'http:\/\/127\.0\.0\.1:9120\/bruma\/receipt'$/);
  });

  it("follows a run in progress and keeps ids stable", () => {
    const stage = run.entries.find(({ event }) => event.kind === "stage" && event.project === "bank")!;
    const live = { ...run, run: { ...run.run, status: "running" as const },
      entries: [...run.entries, { seq: 9999, at: null, event: { ...stage.event, stage: "feedback", status: "running" } as typeof stage.event }] };
    expect(labAgents(live).map((s) => s.live)).toEqual([false, false, false, true]);
    expect(labAgents(null)).toEqual([]);
    expect(hex16("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(labAgents(run)[0]!.detail.track.trackId).toBe(sites[0]!.detail.track.trackId);
  });
});

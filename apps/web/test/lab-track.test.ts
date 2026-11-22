import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExperimentDetail, TrackDetail } from "@sentinel/contracts";
import { curlOf, hex16, labAgents } from "../src/experiments/labTrack";

const read = (url: URL) => ExperimentDetail.parse(JSON.parse(readFileSync(url, "utf8")));
// The recording Sentinel bundles: real Vulhub CVEs exploited through Reaper, with raw traffic.
const run = read(new URL("../../sentinel/src/experiments/recorded-run.json", import.meta.url));

describe("labAgents", () => {
  const sites = labAgents(run);

  it("makes one site per real CVE, with its advisory", () => {
    expect(sites.map((s) => [s.project, s.cve?.id])).toEqual([
      ["nextjs", "CVE-2025-29927"], ["vite", "CVE-2025-30208"],
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
    expect([sum("direct"), sum("protected"), sum("total"), sum("contained")]).toEqual([2, 0, 2, 2]);
    expect(sites.every((s) => s.legit.A.passed === s.legit.A.total && s.legit.B.passed === s.legit.B.total && s.legit.B.total > 0)).toBe(true);
  });

  it("pairs the real exploit as raw HTTP, with the proof only in the direct response", () => {
    const nextjs = sites[0]!;
    const row = nextjs.traffic.find((r) => r.kind === "attack")!;
    expect(row.cells.map((c) => c.label)).toEqual(["Sin Reaper", "Con Reaper", "Reintento con Reaper"]);
    const [direct, protectedCell, retry] = row.cells.map((c) => c.receipt);
    expect(row.proof).toBe("System Settings");
    expect(direct!.raw!.response.body).toContain(row.proof!);
    expect(JSON.stringify(protectedCell!.raw)).not.toContain(row.proof!);
    expect(protectedCell!.engine?.decision).toBe("replace");
    expect(retry!.engine?.decision).toBe("divert");
    expect(row.verdict).toBe("Reaper retuvo la prueba y contuvo el reintento");
    expect(nextjs.traffic.filter((r) => r.kind === "legit").every((r) => r.tone === "none")).toBe(true);
  });

  it("reads /etc/passwd on the Vite site through the real file-read bypass", () => {
    const vite = sites.find((s) => s.project === "vite")!;
    const direct = vite.traffic[0]!.cells[0]!.receipt.raw!;
    expect(direct.request.target).toBe("/@fs/etc/passwd?raw??");
    expect(direct.response.body).toMatch(/root:.*:0:0:/);
  });

  it("explains a withheld proof step by step, with the honest limit", () => {
    const held = sites[0]!.findings[0]!;
    expect(held.ok).toBe(true);
    expect(held.steps.map((s) => s.text)).toContain("El servicio sí ejecutó la solicitud");
  });

  it("carries the researched fix tied to the exploited CVE", () => {
    expect(sites.every((s) => s.research?.status === "retrieved" && s.research.fixes.length > 0)).toBe(true);
    expect(sites[0]!.research!.fixes[0]).toMatch(/Next\.js/);
  });


  it("copies the exploit request as curl with its real header", () => {
    const raw = sites[0]!.traffic[0]!.cells[0]!.receipt.raw!.request;
    const cmd = curlOf(raw);
    expect(cmd).toContain("-H 'x-middleware-subrequest: middleware:middleware:middleware:middleware:middleware'");
    expect(cmd).toMatch(/'http:\/\/127\.0\.0\.1:9120\/'$/);
  });

  it("follows a run in progress and keeps ids stable", () => {
    const stage = run.entries.find(({ event }) => event.kind === "stage" && event.project === "vite")!;
    const live = { ...run, run: { ...run.run, status: "running" as const },
      entries: [...run.entries, { seq: 9999, at: null, event: { ...stage.event, stage: "feedback", status: "running" } as typeof stage.event }] };
    expect(labAgents(live).map((s) => s.live)).toEqual([false, true]);
    expect(labAgents(null)).toEqual([]);
    expect(hex16("a")).toMatch(/^[0-9a-f]{16}$/);
    expect(labAgents(run)[0]!.detail.track.trackId).toBe(sites[0]!.detail.track.trackId);
  });
});

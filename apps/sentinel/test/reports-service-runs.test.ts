import { afterEach, describe, expect, it } from "vitest";
import { REPORT_LIMITS } from "@sentinel/contracts";
import { HYPOTHESIS, IP, awaiting, caseFile, cleanupTemp, fakeModel, made, ok, reportsSetup } from "./reports-helpers.ts";

afterEach(cleanupTemp);

const REFUSAL = "We cannot change the ORM this sprint, use a WAF rule instead";
const BAD = { verdict: "pwned" };

type Service = Awaited<ReturnType<typeof awaiting>>["service"];

/** Refuses the latest revision until the report holds `count` revisions. */
async function refuseUntil(service: Service, id: string, count: number) {
  for (let n = service.get(id)!.revisions.length; n < count; n++) {
    ok(service.decide(id, { decision: "refuse", reason: `${REFUSAL} (${n})` }));
    await service.idle(id);
  }
}

describe("ReportService.create and the revision limit", () => {
  it("returns the same report one revision below the limit", async () => {
    const { service, id } = await awaiting();
    await refuseUntil(service, id, REPORT_LIMITS.revisions - 1);
    expect(service.create(IP)).toMatchObject({ created: false, report: { id } });
  });

  it("starts a new report when the open one waits at the revision limit", async () => {
    const { service, id } = await awaiting();
    await refuseUntil(service, id, REPORT_LIMITS.revisions);
    expect(service.get(id)).toMatchObject({ status: "awaiting_decision" });
    expect(service.get(id)!.revisions).toHaveLength(REPORT_LIMITS.revisions);
    const next = service.create(IP);
    expect(next).toMatchObject({ created: true });
    const report = made(next);
    expect(report.id).not.toBe(id);
    expect(report.status).toBe("investigating");
    await service.idle(report.id);
    // The old report stays readable and keeps its limit.
    expect(service.get(id)).toMatchObject({ status: "awaiting_decision" });
    expect(service.list({ ip: IP }).map((s) => s.id)).toEqual([report.id, id]);
    expect(service.decide(id, { decision: "refuse", reason: REFUSAL })).toEqual({ error: "REVISION_LIMIT" });
  });

  it("never treats an approved report as open", async () => {
    const { service, id } = await awaiting();
    ok(service.decide(id, { decision: "approve" }));
    expect(service.create(IP)).toMatchObject({ created: true });
    expect(made(service.create(IP)).id).not.toBe(id);
  });

  it("never treats a failed report as open", async () => {
    const { model } = fakeModel({ analyze: [new Error("upstream 529")] });
    const { service } = reportsSetup(model);
    const failed = made(service.create(IP));
    await service.idle(failed.id);
    expect(service.get(failed.id)!.status).toBe("failed");
    const next = service.create(IP);
    expect(next).toMatchObject({ created: true });
    expect(made(next).id).not.toBe(failed.id);
  });
});

describe("ReportService tokens", () => {
  it("adds the tokens of both analyst attempts when the first answer is invalid", async () => {
    const { model } = fakeModel({ analyze: [BAD, caseFile([])] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)!.analystTokens).toEqual({ input: 2400, output: 600 });
  });

  it("adds the tokens of both engineer attempts into the revision", async () => {
    const { model } = fakeModel({ propose: [BAD, HYPOTHESIS] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)!.revisions[0]!.tokens).toEqual({ input: 1600, output: 800 });
  });

  it("keeps the tokens of two invalid analyst answers on the failed report", async () => {
    const { model } = fakeModel({ analyze: [BAD, { facts: "none" }] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)).toMatchObject({ status: "failed", analystTokens: { input: 2400, output: 600 } });
  });

  it("keeps the first attempt's tokens when the second attempt throws", async () => {
    const { model } = fakeModel({ analyze: [BAD, new Error("upstream 529")] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)).toMatchObject({ status: "failed", analystTokens: { input: 1200, output: 300 }, error: expect.stringContaining("upstream 529") });
  });

  it("stores no tokens when the first attempt throws", async () => {
    const { model } = fakeModel({ analyze: [new Error("upstream 529")] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)).toMatchObject({ status: "failed", analystTokens: null });
  });

  it("keeps the analyst's tokens when the engineer fails twice, and saves no revision", async () => {
    const { model } = fakeModel({ propose: [BAD, BAD] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)).toMatchObject({ status: "failed", analystTokens: { input: 1200, output: 300 }, revisions: [] });
  });
});

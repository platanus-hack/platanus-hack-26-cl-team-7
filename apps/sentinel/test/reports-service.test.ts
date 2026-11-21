import { afterEach, describe, expect, it } from "vitest";
import { REPORT_LIMITS, Report } from "@sentinel/contracts";
import { ReportService } from "../src/reports/service.ts";
import { HANG, HYPOTHESIS, INJECTION, IP, NOW, OTHER_IP, SCOPE, awaiting, caseFile, cleanupTemp, fakeModel, made, ok, reportsSetup } from "./reports-helpers.ts";

afterEach(cleanupTemp);

const REFUSAL = "We cannot change the ORM this sprint, use a WAF rule instead";

describe("ReportService.create", () => {
  it("returns investigating at once, then awaits a decision with case file, evidence, timeline and tokens", async () => {
    const { model } = fakeModel();
    const { service } = reportsSetup(model);
    const first = made(service.create(IP));
    expect(first).toMatchObject({ status: "investigating", scope: SCOPE, caseFile: null, revisions: [], error: null, createdAt: NOW });
    await service.idle(first.id);
    const r = Report.parse(service.get(first.id));
    expect(r.status).toBe("awaiting_decision");
    expect(r.analystModel).toBe("fake-analyst");
    expect(r.analystTokens).toEqual({ input: 1200, output: 300 });
    expect(r.revisions).toHaveLength(1);
    expect(r.revisions[0]).toMatchObject({ n: 1, hypothesis: HYPOTHESIS, model: "fake-engineer", tokens: { input: 800, output: 400 }, decision: null, createdAt: NOW });
  });

  it("stores the checked case file, its cited rows oldest first, and a timeline", async () => {
    const { service, ids, cf, id } = await awaiting();
    const r = service.get(id)!;
    expect(r.caseFile).toEqual(cf);
    expect(r.evidence.map((e) => e.id)).toEqual([ids.sqli1, ids.sqli2, ids.xss]);
    // Every row of the scope, oldest first. Only the exploit evidence is damage; rows that facts cite are not.
    expect(r.timeline.map((p) => [p.id, p.damage])).toEqual([
      [ids.sqli1, false],
      ["eng:1", false],
      ["acc:1", false],
      [ids.sqli2, true],
      [ids.xss, false],
      ["acc:6", false],
      [ids.clean, false],
    ]);
  });

  it("keeps exploit evidence that no fact cites and shows it to the engineer", async () => {
    const { model, service, id, ids } = await awaiting((x) => [[x.sqli1]], (x) => [x.sqli2]);
    expect(service.get(id)!.caseFile!.exploitEvidence).toEqual([ids.sqli2]);
    expect(service.get(id)!.evidence.map((e) => e.id)).toEqual([ids.sqli1, ids.sqli2]);
    expect(model.calls.propose[0]!.evidence.map((e) => e.id)).toEqual([ids.sqli1, ids.sqli2]);
    expect(service.get(id)!.timeline.filter((p) => p.damage).map((p) => p.id)).toEqual([ids.sqli2]);
  });

  it("drops exploit evidence from another IP or outside the window, so no row is damage", async () => {
    const { service, id, ids } = await awaiting(
      (x) => [[x.sqli1]],
      (x) => [x.other, "acc:5", "sen:doesnotexist"],
    );
    const r = service.get(id)!;
    expect(r.caseFile!.exploitEvidence).toEqual([]);
    expect(r.timeline.some((p) => p.damage)).toBe(false);
    expect(r.evidence.map((e) => e.id)).toEqual([ids.sqli1]);
  });

  it("gives the analyst the locked scope and the scoped tools", async () => {
    const { model } = await awaiting();
    expect(model.calls.analyze).toHaveLength(1);
    expect(model.calls.analyze[0]!.scope).toEqual(SCOPE);
    expect(model.calls.analyze[0]!.tools).toBeTruthy();
  });

  it("gives the engineer the checked case file and only the cited rows", async () => {
    const { model, cf, ids } = await awaiting();
    expect(model.calls.propose).toHaveLength(1);
    const input = model.calls.propose[0]!;
    expect(input.caseFile).toEqual(cf);
    expect(input.evidence.map((e) => e.id)).toEqual([ids.sqli1, ids.sqli2, ids.xss]);
    expect(input).toMatchObject({ previous: null, refusal: null });
  });

  it("removes a fact that cites another IP's request before the engineer sees it", async () => {
    const { model, service, id, ids } = await awaiting((x) => [[x.sqli1, x.other], [x.other]], () => []);
    expect(model.calls.propose[0]!.caseFile.facts).toEqual([expect.objectContaining({ evidence: [ids.sqli1] })]);
    expect(model.calls.propose[0]!.evidence.map((e) => e.id)).toEqual([ids.sqli1]);
    expect(service.get(id)!.caseFile!.facts).toHaveLength(1);
  });

  it("retries an invalid output once and then succeeds", async () => {
    const { model, calls } = fakeModel({ analyze: [{ verdict: "pwned" }, caseFile([])] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(calls.analyze).toHaveLength(2);
    expect(service.get(r.id)!.status).toBe("awaiting_decision");
  });

  it("fails the report after two invalid outputs and never calls the engineer", async () => {
    const { model, calls } = fakeModel({ analyze: [{ verdict: "pwned" }, { facts: "none" }] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(calls.analyze).toHaveLength(2);
    expect(calls.propose).toHaveLength(0);
    expect(service.get(r.id)).toMatchObject({ status: "failed", caseFile: null, revisions: [] });
    expect(service.get(r.id)!.error).toEqual(expect.any(String));
  });

  it("fails the report when the model throws", async () => {
    const { model } = fakeModel({ analyze: [new Error("upstream 529")] });
    const { service } = reportsSetup(model);
    const r = made(service.create(IP));
    await service.idle(r.id);
    expect(service.get(r.id)!.status).toBe("failed");
  });

  it("returns NOT_FOUND for an unknown attacker", () => {
    const { service } = reportsSetup(fakeModel().model);
    expect(service.create("192.0.2.200")).toEqual({ error: "NOT_FOUND" });
  });

  it("returns the open report with created false for a second create on the same IP", () => {
    const { service } = reportsSetup(fakeModel({ analyze: [HANG] }).model);
    const first = service.create(IP);
    expect(first).toMatchObject({ created: true });
    const again = service.create(IP);
    expect(again).toMatchObject({ created: false });
    expect(made(again).id).toBe(made(first).id);
    expect(service.list()).toHaveLength(1);
  });

  it("lists summaries newest first and filters by IP", async () => {
    let t = NOW;
    const { service } = reportsSetup(fakeModel().model, () => t);
    const a = made(service.create(IP));
    t += 1000;
    const b = made(service.create(OTHER_IP));
    await Promise.all([service.idle(a.id), service.idle(b.id)]);
    expect(service.list().map((s) => s.id)).toEqual([b.id, a.id]);
    expect(service.list({ ip: IP })).toEqual([expect.objectContaining({ id: a.id, status: "awaiting_decision", verdict: "exploited", revisions: 1 })]);
  });
});

describe("ReportService.decide", () => {
  it("approves without another model call", async () => {
    const { service, model, id } = await awaiting();
    const r = ok(service.decide(id, { decision: "approve" }));
    await service.idle(id);
    expect(r.status).toBe("approved");
    expect(r.revisions[0]!.decision).toEqual({ kind: "approve", reason: null, at: NOW });
    expect(model.calls.analyze).toHaveLength(1);
    expect(model.calls.propose).toHaveLength(1);
  });

  it("answers a refusal with a new revision built from the previous hypothesis and the exact reason", async () => {
    const { service, model, id, cf } = await awaiting();
    const revising = ok(service.decide(id, { decision: "refuse", reason: REFUSAL }));
    expect(revising.status).toBe("revising");
    await service.idle(id);
    const r = service.get(id)!;
    expect(r.status).toBe("awaiting_decision");
    expect(r.revisions.map((v) => v.n)).toEqual([1, 2]);
    expect(r.revisions[0]!.decision).toEqual({ kind: "refuse", reason: REFUSAL, at: NOW });
    expect(r.revisions[1]!.decision).toBeNull();
    expect(model.calls.analyze).toHaveLength(1);
    expect(model.calls.propose[1]).toMatchObject({ previous: HYPOTHESIS, refusal: REFUSAL, caseFile: cf });
  });

  it("refuses a decision on a report that is not awaiting one", async () => {
    const { service, id } = await awaiting();
    ok(service.decide(id, { decision: "approve" }));
    expect(service.decide(id, { decision: "approve" })).toEqual({ error: "BAD_STATE" });
    const { service: busy } = reportsSetup(fakeModel({ analyze: [HANG] }).model);
    expect(busy.decide(made(busy.create(IP)).id, { decision: "approve" })).toEqual({ error: "BAD_STATE" });
  });

  it(`stops at ${REPORT_LIMITS.revisions} revisions`, async () => {
    const { service, id } = await awaiting();
    for (let n = 1; n < REPORT_LIMITS.revisions; n++) {
      ok(service.decide(id, { decision: "refuse", reason: `${REFUSAL} (${n})` }));
      await service.idle(id);
    }
    expect(service.get(id)!.revisions).toHaveLength(REPORT_LIMITS.revisions);
    expect(service.decide(id, { decision: "refuse", reason: REFUSAL })).toEqual({ error: "REVISION_LIMIT" });
    expect(service.get(id)!.revisions).toHaveLength(REPORT_LIMITS.revisions);
  });

  it("returns NOT_FOUND for an unknown report", () => {
    const { service } = reportsSetup(fakeModel().model);
    expect(service.decide("nope", { decision: "approve" })).toEqual({ error: "NOT_FOUND" });
    expect(service.get("nope")).toBeNull();
  });
});

describe("ReportService persistence", () => {
  it("shows a finished report to a new service on the same db", async () => {
    const { service, store, sources, db, id } = await awaiting();
    const restarted = new ReportService({ store, sources, model: fakeModel().model, db, now: () => NOW });
    expect(restarted.get(id)).toEqual(service.get(id));
    expect(restarted.list().map((s) => s.id)).toEqual([id]);
  });

  it("fails a report that was still investigating at restart", () => {
    const { service, store, sources, db } = reportsSetup(fakeModel({ analyze: [HANG] }).model);
    const r = made(service.create(IP));
    const restarted = new ReportService({ store, sources, model: fakeModel().model, db, now: () => NOW });
    expect(restarted.get(r.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/restart/i) });
  });
});

describe("prompt injection in a payload", () => {
  it("reaches the models only inside evidence rows", async () => {
    const { service, model, id, ids } = await awaiting((x) => [[x.xss]]);
    ok(service.decide(id, { decision: "refuse", reason: REFUSAL }));
    await service.idle(id);
    const marker = "ignore your instructions";
    expect(INJECTION).toContain(marker);
    const { tools: _tools, ...analyst } = model.calls.analyze[0]!;
    expect(JSON.stringify(analyst)).not.toContain(marker);
    for (const p of model.calls.propose) {
      expect(p.evidence.find((e) => e.id === ids.xss)?.payload).toBe(INJECTION);
      expect(JSON.stringify(p.caseFile)).not.toContain(marker);
      expect(JSON.stringify(p.previous)).not.toContain(marker);
      expect(p.refusal ?? "").not.toContain(marker);
    }
    expect(model.calls.propose[1]!.refusal).toBe(REFUSAL);
  });
});

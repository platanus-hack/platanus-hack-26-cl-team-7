// Assumes createApp takes an optional AppDeps field `reports: ReportService | null`; absent means null (503 AI_DISABLED).
import { afterEach, describe, expect, it } from "vitest";
import { ApiError, REPORT_LIMITS, Report, ReportSummary } from "@sentinel/contracts";
import { HANG, IP, OTHER_IP, cleanupTemp, fakeModel, newStore, reportsApp, reportsSetup, seedStore } from "./reports-helpers.ts";

afterEach(cleanupTemp);

const json = (body: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

async function expectError(res: Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(ApiError.parse(await res.json()).error.code).toBe(code);
}

function withService(steps: Parameters<typeof fakeModel>[0] = {}) {
  const { model } = fakeModel(steps);
  const s = reportsSetup(model);
  return { ...s, app: reportsApp(s.bus, s.store, s.service) };
}

/** A report for IP that waits for a decision. */
async function awaitingReport() {
  const s = withService();
  const created = Report.parse(await (await s.app.request("/v1/reports", json({ ip: IP }))).json());
  await s.service.idle(created.id);
  return { ...s, id: created.id };
}

const REFUSAL = "use a WAF rule instead";

/** Refuses over HTTP and waits for the new revision. */
async function refuseOverHttp(s: Awaited<ReturnType<typeof awaitingReport>>, reason: string) {
  const res = await s.app.request(`/v1/reports/${s.id}/decision`, json({ decision: "refuse", reason }));
  await s.service.idle(s.id);
  return res;
}

describe("reports routes without AI", () => {
  it("answer 503 AI_DISABLED when the service is null", async () => {
    const { bus, store } = newStore();
    seedStore(store);
    const app = reportsApp(bus, store, null);
    await expectError(await app.request("/v1/reports", json({ ip: IP })), 503, "AI_DISABLED");
    await expectError(await app.request(`/v1/reports?ip=${IP}`), 503, "AI_DISABLED");
    await expectError(await app.request("/v1/reports/r1"), 503, "AI_DISABLED");
  });
});

describe("POST /v1/reports", () => {
  it("rejects a bad ip with 400 BAD_INPUT", async () => {
    const { app } = withService();
    await expectError(await app.request("/v1/reports", json({ ip: "not-an-ip" })), 400, "BAD_INPUT");
    await expectError(await app.request("/v1/reports", json({})), 400, "BAD_INPUT");
  });

  it("answers 404 NOT_FOUND for an attacker Reaper has not seen", async () => {
    const { app } = withService();
    await expectError(await app.request("/v1/reports", json({ ip: "192.0.2.200" })), 404, "NOT_FOUND");
  });

  it("answers 202 with an investigating report, then GET shows it awaiting a decision", async () => {
    const { app, service } = withService();
    const res = await app.request("/v1/reports", json({ ip: IP }));
    expect(res.status).toBe(202);
    const created = Report.parse(await res.json());
    expect(created.status).toBe("investigating");
    await service.idle(created.id);
    const got = await app.request(`/v1/reports/${created.id}`);
    expect(got.status).toBe(200);
    expect(Report.parse(await got.json())).toMatchObject({ id: created.id, status: "awaiting_decision" });
  });

  it("answers 200 with the open report on a second create for the same IP", async () => {
    const { app } = withService({ analyze: [HANG] });
    const first = Report.parse(await (await app.request("/v1/reports", json({ ip: IP }))).json());
    const again = await app.request("/v1/reports", json({ ip: IP }));
    expect(again.status).toBe(200);
    expect(Report.parse(await again.json()).id).toBe(first.id);
  });

  it("starts a new report with 202 when the open one waits at the revision limit", async () => {
    const s = await awaitingReport();
    for (let n = 1; n < REPORT_LIMITS.revisions; n++) expect((await refuseOverHttp(s, `${REFUSAL} ${n}`)).status).toBe(200);
    const stuck = Report.parse(await (await s.app.request(`/v1/reports/${s.id}`)).json());
    expect(stuck).toMatchObject({ status: "awaiting_decision" });
    expect(stuck.revisions).toHaveLength(REPORT_LIMITS.revisions);
    await expectError(await s.app.request(`/v1/reports/${s.id}/decision`, json({ decision: "refuse", reason: REFUSAL })), 409, "REVISION_LIMIT");
    const res = await s.app.request("/v1/reports", json({ ip: IP }));
    expect(res.status).toBe(202);
    const next = Report.parse(await res.json());
    expect(next.id).not.toBe(s.id);
    expect(next.status).toBe("investigating");
    await s.service.idle(next.id);
  });

  it("keeps the JSON and same-origin guards", async () => {
    const { app } = withService();
    const text = await app.request("/v1/reports", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ ip: IP }) });
    expect(text.status).toBe(415);
    const cross = await app.request("/v1/reports", json({ ip: IP }, { Origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
  });
});

describe("GET /v1/reports", () => {
  it("lists summaries for one IP", async () => {
    const { app, id } = await awaitingReport();
    const res = await app.request(`/v1/reports?ip=${IP}`);
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: unknown[] };
    expect(items.map((i) => ReportSummary.parse(i))).toEqual([expect.objectContaining({ id, status: "awaiting_decision", revisions: 1 })]);
    const none = (await (await app.request(`/v1/reports?ip=${OTHER_IP}`)).json()) as { items: unknown[] };
    expect(none.items).toEqual([]);
  });

  it("answers 404 NOT_FOUND for an unknown report", async () => {
    const { app } = withService();
    await expectError(await app.request("/v1/reports/nope"), 404, "NOT_FOUND");
  });
});

describe("POST /v1/reports/:id/decision", () => {
  it.each([
    ["missing", { decision: "refuse" }],
    ["blank", { decision: "refuse", reason: "   " }],
    ["too short", { decision: "refuse", reason: "ok" }],
    ["not text", { decision: "refuse", reason: 5 }],
  ])("answers 422 REASON_REQUIRED for a %s refusal reason", async (_label, body) => {
    const { app, id } = await awaitingReport();
    await expectError(await app.request(`/v1/reports/${id}/decision`, json(body)), 422, "REASON_REQUIRED");
  });

  it.each([
    ["an unknown decision", { decision: "maybe" }],
    ["a reason over 1000 characters", { decision: "refuse", reason: "x".repeat(1001) }],
    ["no decision", {}],
    ["a body that is not an object", null],
  ])("answers 400 BAD_INPUT for %s", async (_label, body) => {
    const { app, id } = await awaitingReport();
    await expectError(await app.request(`/v1/reports/${id}/decision`, json(body)), 400, "BAD_INPUT");
  });

  it("approves with 200, then a second decision gets 409 BAD_STATE", async () => {
    const { app, id } = await awaitingReport();
    const res = await app.request(`/v1/reports/${id}/decision`, json({ decision: "approve" }));
    expect(res.status).toBe(200);
    expect(Report.parse(await res.json()).status).toBe("approved");
    await expectError(await app.request(`/v1/reports/${id}/decision`, json({ decision: "approve" })), 409, "BAD_STATE");
  });

  it("accepts a refusal with a reason and starts a revision", async () => {
    const s = await awaitingReport();
    const res = await s.app.request(`/v1/reports/${s.id}/decision`, json({ decision: "refuse", reason: REFUSAL }));
    expect(res.status).toBe(200);
    expect(Report.parse(await res.json()).status).toBe("revising");
    await s.service.idle(s.id);
  });

  it("shows the second revision after a refusal, with the first one's decision stored", async () => {
    const s = await awaitingReport();
    expect((await refuseOverHttp(s, REFUSAL)).status).toBe(200);
    const got = await s.app.request(`/v1/reports/${s.id}`);
    expect(got.status).toBe(200);
    const report = Report.parse(await got.json());
    expect(report.status).toBe("awaiting_decision");
    expect(report.revisions.map((r) => r.n)).toEqual([1, 2]);
    expect(report.revisions[0]!.decision).toMatchObject({ kind: "refuse", reason: REFUSAL });
    expect(report.revisions[1]!.decision).toBeNull();
  });

  it("answers 404 NOT_FOUND for an unknown report", async () => {
    const { app } = withService();
    await expectError(await app.request("/v1/reports/nope/decision", json({ decision: "approve" })), 404, "NOT_FOUND");
  });

  it("keeps the JSON and same-origin guards", async () => {
    const { app, id } = await awaitingReport();
    const text = await app.request(`/v1/reports/${id}/decision`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: '{"decision":"approve"}' });
    expect(text.status).toBe(415);
    const cross = await app.request(`/v1/reports/${id}/decision`, json({ decision: "approve" }, { Origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    const still = Report.parse(await (await app.request(`/v1/reports/${id}`)).json());
    expect(still.status).toBe("awaiting_decision");
  });
});

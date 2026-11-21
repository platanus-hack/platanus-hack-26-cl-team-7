import { afterEach, describe, expect, it, vi } from "vitest";
import type { Report } from "@sentinel/contracts";
import { ApiRequestError, createReport, decideReport, getReport, listReports } from "../src/sentinel";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

const REPORT: Report = {
  id: "r1",
  scope: { ip: "203.0.113.42", from: new Date(NOW - 600_000).toISOString(), to: new Date(NOW).toISOString() },
  status: "investigating",
  createdAt: NOW,
  updatedAt: NOW,
  caseFile: null,
  evidence: [],
  timeline: [],
  revisions: [],
  analystModel: null,
  analystTokens: null,
  error: null,
};

function reply(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe("report API", () => {
  it("creates a report with the IP in the body", async () => {
    const fetchMock = reply(202, REPORT);
    await expect(createReport("203.0.113.42")).resolves.toMatchObject({ id: "r1", status: "investigating" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/reports");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ ip: "203.0.113.42" });
  });

  it("surfaces the server error code", async () => {
    reply(503, { error: { code: "AI_DISABLED", message: "AI is off" } });
    await expect(createReport("203.0.113.42")).rejects.toMatchObject({ status: 503, code: "AI_DISABLED", message: "AI is off" });
  });

  it("lists the reports of one IP", async () => {
    const summary = { id: "r1", scope: REPORT.scope, status: "approved", createdAt: NOW, updatedAt: NOW, verdict: "exploited", revisions: 2 };
    const fetchMock = reply(200, { items: [summary] });
    await expect(listReports("203.0.113.42")).resolves.toEqual([summary]);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe("/v1/reports?ip=203.0.113.42");
  });

  it("sends a refusal and returns the report", async () => {
    const fetchMock = reply(200, { ...REPORT, status: "revising" });
    const out = await decideReport("r1", { decision: "refuse", reason: "no CSP this week" });
    expect(out.status).toBe("revising");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/reports/r1/decision");
    expect(JSON.parse(init.body as string)).toEqual({ decision: "refuse", reason: "no CSP this week" });
  });

  it("keeps the code and message of a 422 and a 409", async () => {
    reply(422, { error: { code: "REASON_REQUIRED", message: "Give a reason." } });
    await expect(decideReport("r1", { decision: "refuse", reason: "  " })).rejects.toMatchObject({ status: 422, code: "REASON_REQUIRED" });
    reply(409, { error: { code: "BAD_STATE", message: "Not waiting for a decision." } });
    await expect(decideReport("r1", { decision: "approve" })).rejects.toMatchObject({ status: 409, code: "BAD_STATE" });
  });

  it("rejects a reply that does not match the contract", async () => {
    reply(200, { id: "r1", status: "nonsense" });
    const err = await getReport("r1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ code: "bad_response" });
  });
});

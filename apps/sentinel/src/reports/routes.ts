import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { CreateReportRequest, DecisionRequest, REPORT_LIMITS, type ApiError } from "@sentinel/contracts";
import type { ReportService } from "./service.ts";

type ErrorStatus = 400 | 404 | 409 | 413 | 422 | 503;

function fail(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

const limit = bodyLimit({ maxSize: 64 * 1024, onError: (c) => fail(c, 413, "TOO_LARGE", "Body over 64 KB") });
const json = (c: Context) => c.req.json().catch(() => undefined);
const IpParam = CreateReportRequest.shape.ip;

/**
 * Routes under /v1/reports. With no service (no AI key) every route answers 503 AI_DISABLED.
 * The app's host, origin and JSON-only guards run before these handlers.
 */
export function reportRoutes(service: ReportService | null): Hono {
  const app = new Hono();
  if (!service) {
    app.all("*", (c) => fail(c, 503, "AI_DISABLED", "Incident reports are off. Set ANTHROPIC_API_KEY for Sentinel and restart it."));
    return app;
  }

  app.post("/", limit, async (c) => {
    const body = CreateReportRequest.safeParse(await json(c));
    if (!body.success) return fail(c, 400, "BAD_INPUT", z.prettifyError(body.error));
    const result = service.create(body.data.ip);
    if ("error" in result) return fail(c, 404, "NOT_FOUND", "Sentinel has not seen this IP.");
    return c.json(result.report, result.created ? 202 : 200);
  });

  app.get("/", (c) => {
    const ip = c.req.query("ip");
    if (ip !== undefined && !IpParam.safeParse(ip).success) return fail(c, 400, "BAD_INPUT", "ip must be an IPv4 or IPv6 address");
    return c.json({ items: service.list(ip === undefined ? {} : { ip }) });
  });

  app.get("/:id", (c) => {
    const report = service.get(c.req.param("id"));
    return report ? c.json(report) : fail(c, 404, "NOT_FOUND", "No report with this id");
  });

  app.post("/:id/decision", limit, async (c) => {
    const body = DecisionRequest.safeParse(await json(c));
    if (!body.success) {
      // A missing, blank or short reason fails on the `reason` field; too long a reason is an ordinary bad input.
      const reasonMissing = body.error.issues.some((i) => i.path[0] === "reason" && i.code !== "too_big");
      if (reasonMissing) return fail(c, 422, "REASON_REQUIRED", "A refusal needs a reason of at least 3 characters.");
      return fail(c, 400, "BAD_INPUT", "Send { decision: \"approve\" } or { decision: \"refuse\", reason } with a reason up to 1000 characters.");
    }
    const result = service.decide(c.req.param("id"), body.data);
    if ("id" in result) return c.json(result);
    if (result.error === "NOT_FOUND") return fail(c, 404, "NOT_FOUND", "No report with this id");
    const message =
      result.error === "BAD_STATE"
        ? "This report is not waiting for a decision."
        : `This report reached the limit of ${REPORT_LIMITS.revisions} revisions. Approve it or start a new report.`;
    return fail(c, 409, result.error, message);
  });

  return app;
}

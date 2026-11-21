import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import type { ApiError } from "@sentinel/contracts";

export type ErrorStatus = 400 | 401 | 403 | 404 | 413 | 415 | 422 | 500 | 503;

/** Every API error has the same envelope: `{ error: { code, message } }`. */
export function fail(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

/** Constant-time check of `Authorization: Bearer <token>`. */
export function tokenMatches(header: string | undefined, token: string): boolean {
  const given = Buffer.from(header?.replace(/^Bearer\s+/i, "") ?? "");
  const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/**
 * Refuses a request without `Authorization: Bearer <token>` before any body is read.
 * Without a token configured, every caller passes (local development).
 */
export function requireToken(token: string | undefined): MiddlewareHandler {
  return async (c, next) => {
    if (token && !tokenMatches(c.req.header("Authorization"), token)) return fail(c, 401, "unauthorized", "Missing or wrong ingest token");
    await next();
  };
}

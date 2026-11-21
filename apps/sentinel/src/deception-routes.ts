import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { DeceptionBatch, IDEMPOTENCY_KEY_REUSED, PageQuery, type DeceptionAccepted } from "@sentinel/contracts";
import { CursorError, type DeceptionStore } from "./deception.ts";
import { fail, requireToken } from "./http.ts";

/**
 * A full batch is 500 actions with two 8 KB bodies each, about 8 MB of ASCII text.
 * Escaped non-ASCII text can be larger. The router cuts every batch to half of this limit before
 * it sends (agent-detection/mirror/post.py, MAX_BATCH_BYTES; a test pins the 16 MB figure) and
 * still splits a batch that gets a 413.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;
/** A batch of 500 bad events would otherwise answer with thousands of lines. */
const MAX_REPORTED_ISSUES = 10;

function describe(error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES);
  const more = error.issues.length - issues.length;
  return z.prettifyError(new z.ZodError(issues)) + (more > 0 ? `\n…and ${more} more issues` : "");
}

/** POST /v1/deception/events from the mirror router; GET /v1/tracks and /v1/findings for the dashboard. */
export function deceptionRoutes({ deception, ingestToken }: { deception: DeceptionStore; ingestToken?: string }) {
  const routes = new Hono();

  routes.post(
    "/deception/events",
    requireToken(ingestToken),
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => fail(c, 413, "too_large", "Body over 16 MB") }),
    async (c) => {
      const parsed = DeceptionBatch.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success) return fail(c, 400, "invalid_request", describe(parsed.error));
      const out = deception.ingest(parsed.data);
      if (!out.ok) return fail(c, 422, IDEMPOTENCY_KEY_REUSED, `eventId ${out.reusedEventId} is stored with a different body`);
      return c.json<DeceptionAccepted>({ accepted: out.accepted, duplicates: out.duplicates }, 202);
    },
  );

  const page = <T>(c: Context, read: (q: PageQuery) => T) => {
    const q = PageQuery.safeParse(c.req.query());
    if (!q.success) return fail(c, 400, "invalid_query", describe(q.error));
    try {
      c.header("Cache-Control", "no-store");
      return c.json(read(q.data));
    } catch (err) {
      if (err instanceof CursorError) return fail(c, 400, "invalid_cursor", err.message);
      throw err;
    }
  };

  routes.get("/tracks", (c) => page(c, (q) => deception.tracks(q)));
  routes.get("/findings", (c) => page(c, (q) => deception.findings(q)));

  routes.get("/tracks/:trackId", (c) => {
    const detail = deception.track(c.req.param("trackId"));
    c.header("Cache-Control", "no-store");
    return detail ? c.json(detail) : fail(c, 404, "track_not_found", "No track with this id");
  });

  return routes;
}

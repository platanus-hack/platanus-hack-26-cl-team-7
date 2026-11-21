import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import {
  CopilotRequest,
  IngestBody,
  IngestEvent,
  Range,
  type ApiError,
  type CopilotEvent,
  type Health,
  type StreamBatch,
} from "@sentinel/contracts";
import type { Ai } from "./ai.ts";
import type { Bus } from "./bus.ts";
import type { Store } from "./store.ts";

export interface AppDeps {
  store: Store;
  bus: Bus;
  ai: Ai;
  version?: string;
  startedAt?: number;
  heartbeatMs?: number;
}

const ALLOWED_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420"];

function fail(c: Context, status: 400 | 404 | 413 | 500 | 503, code: string, message: string) {
  return c.json<ApiError>({ error: { code, message } }, status);
}

export function createApp({ store, bus, ai, version = "0.1.0", startedAt = Date.now(), heartbeatMs = 15_000 }: AppDeps) {
  const app = new Hono().basePath("/v1");

  app.use(
    "*",
    cors({
      origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      maxAge: 600,
    }),
  );

  // Every response says how long the server worked on it.
  app.use("*", async (c, next) => {
    const t0 = performance.now();
    await next();
    if (!c.res.headers.get("Content-Type")?.startsWith("text/event-stream"))
      c.res.headers.set("Server-Timing", `app;dur=${(performance.now() - t0).toFixed(2)}`);
  });

  app.onError((err, c) => {
    console.error("[http]", err);
    return fail(c, 500, "internal", "Unexpected server error");
  });
  app.notFound((c) => fail(c, 404, "not_found", "No such route"));

  const rangeOf = (c: Context) => Range.safeParse(c.req.query("range") ?? "1h");

  app.get("/health", (c) =>
    c.json<Health>({ ok: true, version, ai: { enabled: ai.enabled, model: ai.enabled ? "claude-opus-5-5" : null }, uptimeMs: Date.now() - startedAt }),
  );

  /** Everything the dashboard needs for first paint, in one response. */
  app.get("/snapshot", (c) => {
    const r = rangeOf(c);
    if (!r.success) return fail(c, 400, "invalid_range", "range must be 5m, 1h or 24h");
    c.header("Cache-Control", "no-store");
    return c.json(store.snapshot(r.data));
  });

  app.get("/events", (c) => {
    const r = rangeOf(c);
    if (!r.success) return fail(c, 400, "invalid_range", "range must be 5m, 1h or 24h");
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 100) || 100));
    const before = Number(c.req.query("before") ?? Infinity);
    const items = store.events(r.data, { limit, filter: (e) => e.seq < before });
    return c.json({ items, nextCursor: items.length === limit ? items[items.length - 1]!.seq : null });
  });

  app.get("/attackers", (c) => {
    const r = rangeOf(c);
    if (!r.success) return fail(c, 400, "invalid_range", "range must be 5m, 1h or 24h");
    return c.json({ items: store.attackers(r.data) });
  });

  app.get("/attackers/:ip", (c) => {
    const d = store.detail(c.req.param("ip"));
    return d ? c.json(d) : fail(c, 404, "attacker_not_found", "No attacker with this IP");
  });

  app.get("/blocks", (c) => c.json({ items: store.blocks() }));

  /** Idempotent: repeating the call returns the original block time. */
  app.put("/blocks/:ip", (c) => {
    const ip = c.req.param("ip");
    if (!IngestEvent.shape.ip.safeParse(ip).success) return fail(c, 400, "invalid_ip", "Not a valid IP address");
    return c.json({ ip, blockedAt: store.block(ip) });
  });

  app.delete("/blocks/:ip", (c) => {
    store.unblock(c.req.param("ip"));
    return c.body(null, 204);
  });

  /** Gateways post one event or a batch of up to 500. The rules verdict comes back in the response. */
  app.post("/events", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => fail(c, 413, "too_large", "Body over 2 MB") }), async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const parsed = IngestBody.safeParse(body);
    if (!parsed.success) {
      // The union error is vague; re-run the matching branch for a precise message.
      const detail = (Array.isArray(body) ? z.array(IngestEvent).max(500) : IngestEvent).safeParse(body);
      return fail(c, 400, "invalid_request", z.prettifyError(detail.success ? parsed.error : detail.error));
    }
    const items = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const results = store.ingest(items);
    return c.json({ accepted: results.length, results }, 202);
  });

  /** Live changes as Server-Sent Events, one batch per 100 ms frame. */
  app.get("/stream", (c) => {
    const lastId = c.req.header("Last-Event-ID") ?? c.req.query("after");
    const after = lastId !== undefined && lastId !== "" ? Number(lastId) : bus.lastSeq;
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      type Item = { kind: "batch"; seq: number; data: string } | { kind: "reset" } | { kind: "ping" };
      const queue: Item[] = [];
      let wake: (() => void) | null = null;
      const push = (item: Item) => {
        queue.push(item);
        wake?.();
      };
      const pushBatch = (b: StreamBatch) => push({ kind: "batch", seq: b.seq, data: JSON.stringify(b) });

      const backlog = Number.isFinite(after) ? bus.since(after) : [];
      if (backlog === null) push({ kind: "reset" });
      else backlog.forEach(pushBatch);

      const unsubscribe = bus.subscribe(pushBatch);
      const beat = setInterval(() => push({ kind: "ping" }), heartbeatMs);
      let open = true;
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        clearInterval(beat);
        wake?.();
      });

      await stream.writeSSE({ event: "ready", data: JSON.stringify({ seq: bus.lastSeq }) });
      while (open) {
        if (queue.length === 0) await new Promise<void>((r) => (wake = r));
        wake = null;
        while (open && queue.length) {
          const item = queue.shift()!;
          if (item.kind === "ping") await stream.write(": ping\n\n");
          else if (item.kind === "reset") await stream.writeSSE({ event: "reset", data: "{}" });
          else await stream.writeSSE({ event: "batch", id: String(item.seq), data: item.data });
        }
      }
    });
  });

  /** Copilot answer as Server-Sent Events. Closing the request stops the model. */
  app.post("/copilot/messages", async (c) => {
    const parsed = CopilotRequest.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return fail(c, 400, "invalid_request", z.prettifyError(parsed.error));
    if (!ai.enabled) return fail(c, 503, "ai_unavailable", "AI is not configured. Set ANTHROPIC_API_KEY for Sentinel.");
    c.header("Cache-Control", "no-store");
    return streamSSE(c, async (stream) => {
      const ctrl = new AbortController();
      stream.onAbort(() => ctrl.abort());
      // Writes are chained so they keep their order and all finish before the stream closes.
      let writes = Promise.resolve();
      const send = (e: CopilotEvent) => {
        if (ctrl.signal.aborted) return;
        writes = writes.then(() => stream.writeSSE({ event: e.type, data: JSON.stringify(e) })).catch(() => ctrl.abort());
      };
      try {
        await ai.copilot(parsed.data, send, ctrl.signal);
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.error("[copilot]", err);
          send({ type: "error", code: "copilot_failed", message: "The copilot could not finish. Try again." });
        }
      }
      await writes;
    });
  });

  return app;
}

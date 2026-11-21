import { existsSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
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
  type CopilotEvent,
  type Health,
} from "@sentinel/contracts";
import { MODEL, type Ai } from "./ai.ts";
import type { Bus, EncodedFrame } from "./bus.ts";
import { reportRoutes } from "./reports/routes.ts";
import type { ReportService } from "./reports/service.ts";
import type { DeceptionStore } from "./deception.ts";
import { deceptionRoutes } from "./deception-routes.ts";
import { fail, requireToken } from "./http.ts";
import type { Store } from "./store.ts";

export interface AppDeps {
  store: Store;
  bus: Bus;
  ai: Ai;
  deception: DeceptionStore;
  version?: string;
  startedAt?: number;
  heartbeatMs?: number;
  /** Extra origins allowed to call the API. The bundled web app is same-origin and needs none. */
  allowedOrigins?: string[];
  /** Folder with the built web app. When it holds an index.html, Sentinel serves it at "/". */
  webRoot?: string;
  /** Host names the API answers besides localhost. Anything else is refused, which stops DNS rebinding. */
  allowedHosts?: string[];
  /** When set, POST /v1/events and POST /v1/deception/events need `Authorization: Bearer <token>`. */
  ingestToken?: string;
  /** Incident reports. Absent or null: every /v1/reports route answers 503 AI_DISABLED. */
  reports?: ReportService | null;
}

const MAX_QUEUED_FRAMES = 1000;
const MAX_QUEUED_BYTES = 16 * 1024 * 1024;
const LOCAL_HOSTS = ["127.0.0.1", "localhost", "::1"];

export function createApp({ store, bus, ai, deception, version = "0.1.0", startedAt = Date.now(), heartbeatMs = 15_000, allowedOrigins = [], webRoot, allowedHosts = [], ingestToken, reports = null }: AppDeps) {
  const app = new Hono().basePath("/v1");

  app.use(
    "*",
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Last-Event-ID"],
      maxAge: 600,
    }),
  );

  // Browsers may only reach the API from this origin (or a configured one), under a known host name.
  // POSTs must be JSON, which a cross-site form or a no-preflight fetch cannot send.
  const hosts = new Set([...LOCAL_HOSTS, ...allowedHosts]);
  app.use("*", async (c, next) => {
    const hostHeader = c.req.header("Host") ?? new URL(c.req.url).host;
    const host = hostHeader.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
    if (!hosts.has(host)) return fail(c, 403, "forbidden_host", "Unknown host name. Add it to SENTINEL_ALLOWED_HOSTS.");
    const method = c.req.method;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const origin = c.req.header("Origin");
      const sameOrigin = !!origin && URL.canParse(origin) && new URL(origin).host === hostHeader;
      if (origin && !sameOrigin && !allowedOrigins.includes(origin)) return fail(c, 403, "forbidden_origin", "Cross-site request refused");
      if (method === "POST" && !c.req.header("Content-Type")?.toLowerCase().startsWith("application/json"))
        return fail(c, 415, "unsupported_media_type", "Send Content-Type: application/json");
    }
    await next();
  });

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

  const rangeOf = (c: Context) => Range.safeParse(c.req.query("range") ?? "1h");

  app.get("/health", (c) =>
    c.json<Health>({ ok: true, version, ai: { enabled: ai.enabled, model: ai.enabled ? MODEL : null }, uptimeMs: Date.now() - startedAt }),
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
  app.post("/events", requireToken(ingestToken), bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => fail(c, 413, "too_large", "Body over 2 MB") }), async (c) => {
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
    // EventSource resends the last id on reconnect; the first connect passes the snapshot position.
    const position = c.req.header("Last-Event-ID") || c.req.query("after") || "";
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const queue: (EncodedFrame | "reset" | "ping")[] = [];
      let queuedBytes = 0;
      let wake: (() => void) | null = null;
      let open = true;
      const push = (item: EncodedFrame | "reset" | "ping") => {
        // A client that cannot keep up is told to reload instead of holding memory without limit.
        if (queue.length >= MAX_QUEUED_FRAMES || queuedBytes > MAX_QUEUED_BYTES) {
          queue.splice(0, queue.length, "reset");
          queuedBytes = 0;
        } else {
          queue.push(item);
          if (typeof item === "object") queuedBytes += item.json.length;
        }
        wake?.();
      };

      const backlog = position ? bus.since(position) : [];
      if (backlog === null) push("reset");
      else backlog.forEach(push);

      const unsubscribe = bus.subscribe(push);
      const beat = setInterval(() => push("ping"), heartbeatMs);
      stream.onAbort(() => {
        open = false;
        unsubscribe();
        clearInterval(beat);
        wake?.();
      });

      await stream.writeSSE({ event: "ready", data: JSON.stringify({ epoch: bus.epoch, seq: bus.lastSeq }) });
      while (open) {
        if (queue.length === 0) await new Promise<void>((r) => (wake = r));
        wake = null;
        while (open && queue.length) {
          const item = queue.shift()!;
          if (typeof item === "object") queuedBytes -= item.json.length;
          if (item === "ping") await stream.write(": ping\n\n");
          else if (item === "reset") {
            await stream.writeSSE({ event: "reset", data: "{}" });
            queue.length = 0;
            queuedBytes = 0;
          } else await stream.writeSSE({ event: "batch", id: item.id, data: item.json });
        }
      }
    });
  });

  /** Copilot answer as Server-Sent Events. Closing the request stops the model. */
  app.post("/copilot/messages", bodyLimit({ maxSize: 512 * 1024, onError: (c) => fail(c, 413, "too_large", "Body over 512 KB") }), async (c) => {
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

  app.route("/", deceptionRoutes({ deception, ingestToken }));
  app.route("/reports", reportRoutes(reports));

  // Unknown API paths answer in the API's error shape, never with the web app.
  app.all("/*", (c) => fail(c, 404, "not_found", "No such route"));

  const root = new Hono();
  root.route("/", app);
  if (webRoot && existsSync(join(webRoot, "index.html"))) {
    // Hashed asset names never change content, so browsers keep them for a year.
    // The app shell must not be cached, so a new build shows at once.
    root.use("/*", async (c, next) => {
      await next();
      if (c.req.path.startsWith("/assets/") && c.res.status === 200) c.res.headers.set("Cache-Control", "public, max-age=31536000, immutable");
      else if (c.res.headers.get("Content-Type")?.startsWith("text/html")) c.res.headers.set("Cache-Control", "no-cache");
    });
    root.use("/*", serveStatic({ root: webRoot, precompressed: true }));
    // A missing hashed asset is a 404, never the app shell (a stale tab would cache HTML as JS).
    root.all("/assets/*", (c) => c.text("Not found", 404));
    // Any other path loads the app shell.
    root.get("*", serveStatic({ root: webRoot, path: "index.html", precompressed: true }));
  }
  return root;
}

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { ExperimentStartRequest } from "@sentinel/contracts";
import { fail } from "../http.ts";
import type { createExperimentService } from "./service.ts";
import type { ExperimentStore } from "./store.ts";

export function experimentRoutes(store: ExperimentStore, service: ReturnType<typeof createExperimentService>) {
  const app = new Hono();
  app.get("/experiments/runs", (c) => c.json({ items: store.list() }));
  app.post("/experiments/runs", bodyLimit({ maxSize: 1024, onError: (c) => fail(c, 413, "invalid_experiment", "Solicitud demasiado grande.") }), async (c) => {
    const input = await c.req.text();
    let body: unknown = {};
    try { if (input) body = JSON.parse(input); } catch { return fail(c, 400, "invalid_experiment", "Solicitud de ejecución inválida."); }
    const parsed = ExperimentStartRequest.safeParse(body);
    if (!parsed.success) return fail(c, 400, "invalid_experiment", "Proyecto de ejecución inválido.");
    const result = await service.start(parsed.data.project);
    if ("error" in result) return fail(c, result.status, "experiment_unavailable", result.error);
    return c.json(result, 202);
  });
  app.get("/experiments/runs/:id", (c) => {
    const id = c.req.param("id");
    const run = store.get(id);
    return run ? c.json({ run, entries: store.entries(id) }) : fail(c, 404, "experiment_not_found", "No existe esta ejecución.");
  });
  app.get("/experiments/runs/:id/events", (c) => {
    const id = c.req.param("id");
    if (!store.get(id)) return fail(c, 404, "experiment_not_found", "No existe esta ejecución.");
    const cursor = Number(c.req.header("Last-Event-ID") || c.req.query("after") || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return fail(c, 400, "invalid_cursor", "Cursor inválido.");
    c.header("Cache-Control", "no-store");
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      let position = cursor;
      let lastPing = Date.now();
      while (!stream.aborted && !stream.closed) {
        const run = store.get(id);
        for (const entry of store.entries(id, position)) {
          await stream.writeSSE({ id: String(entry.seq), event: "entry", data: JSON.stringify(entry) });
          position = entry.seq;
        }
        if (!run || (run.status !== "running" && !run.patching)) {
          await stream.writeSSE({ event: "done", data: JSON.stringify(run) });
          break;
        }
        if (Date.now() - lastPing >= 15_000) {
          await stream.write(": heartbeat\n\n");
          lastPing = Date.now();
        }
        await stream.sleep(350);
      }
    });
  });
  return app;
}

import { bodyLimit } from "hono/body-limit";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { services, type EvidenceRun } from "@sentinel/contracts";
import { readReplay, validId } from "./evidence.ts";
import type { EvidenceJournal } from "./journal.ts";
import type { Pipeline } from "./pipeline.ts";
import { withRelated } from "./related.ts";

export interface EvidenceDeps {
  replayDirectory: string;
  journal: EvidenceJournal;
  pipeline?: Pipeline;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function htmlReport(run: EvidenceRun) {
  const rows = run.traces.map((t) => {
    const data = t.observed;
    const advisory = t.service === "other" ? undefined : services[t.service];
    const events = t.events.map((e) => `<li>${esc([e.time, e.kind, e.method, e.symbol, e.pattern, e.action, e.reason,
      e.status ? `HTTP ${e.status}` : undefined, e.actor ? `actor ${e.actor}` : undefined,
      e.rule, e.incident, e.expiresAt, e.elapsedMs === undefined ? undefined : `${e.elapsedMs.toFixed(2)} ms`,
      e.payload ? `Local payload capture ${e.payload.state}, ${e.payload.bodyBytes} body bytes` : undefined,
      e.signals?.join(", "), e.research?.status, e.research?.note, e.research?.retrievedAt].filter(Boolean).join(" · "))}${e.research?.source
      ? ` · <a href="${esc(e.research.source)}">Advisory source</a>` : ""}</li>`).join("");
    const related = t.related?.map((link) => `<li><a href="#${esc(link.trace)}">Related request</a> · ${esc(link.confidence)} · ${esc(link.reason)}</li>`).join("") ?? "";
    return `<tr id="${esc([t.run,t.plane,t.id].join("/"))}"><th scope="row">${esc(t.service === "other" ? "Other route" : services[t.service].name)}<br><code>${esc(t.id)}</code></th>
      <td>${esc(t.route)} · ${esc(t.case)} · ${esc(t.arm)} · ${esc(t.plane)}${t.label ? ` · ${esc(t.label)}` : ""}
      ${advisory ? `<br>Fixture analogue <a href="${esc(advisory.url)}">${esc(advisory.cve)}</a>` : ""}</td>
      <td>${data ? `HTTP ${data.status}, ${data.upstreamHits} upstream hit(s), ${t.label === "legitimate" ? "public reference" : "evidence"} ${data.headerEvidence ? "in headers" : data.bodyEvidence ? "in body" : "absent"}` : "Independent outcome unavailable"}</td>
      <td><ol>${events}${related}</ol></td></tr>`;
  }).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Último Paso evidence</title>
    <style>body{font:15px/1.5 system-ui;margin:2rem;color:#132828}table{border-collapse:collapse;width:100%}th,td{padding:.65rem;border:1px solid #c3d0cc;vertical-align:top;text-align:left}code{overflow-wrap:anywhere}ol{padding-left:1rem;margin:0}</style>
    <h1>Último Paso evidence</h1><p>${esc(run.title)}</p><p>${esc(run.provenance)}</p>
    <p>Fixture events are synthetic. The HTTP proxy observes in-band evidence. Backend effects and attack intent require independent measurements.</p>
    <table><thead><tr><th>Service and trace</th><th>Case</th><th>Wire outcome</th><th>Events</th></tr></thead><tbody>${rows}</tbody></table></html>`;
}

export function evidenceRoutes({ replayDirectory, journal, pipeline }: EvidenceDeps) {
  const app = new Hono();
  let replay: EvidenceRun | undefined;
  const getRun = (id: string) => {
    if (id === "recorded") return replay ??= withRelated(readReplay(replayDirectory));
    const live = journal.run(id);
    return live ? withRelated(live) : undefined;
  };
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });
  app.get("/runs", (c) => c.json({ runs: journal.runs(), ...journal.state() }));
  app.get("/runs/:id", (c) => {
    const id = validId(c.req.param("id"));
    if (!id) return c.json({ error: "Invalid run identifier" }, 400);
    const run = getRun(id);
    return run ? c.json(run) : c.json({ error: "Run not found" }, 404);
  });
  app.get("/runs/:id/export/:format", (c) => {
    const id = validId(c.req.param("id"));
    const format = c.req.param("format");
    if (!id || (format !== "json" && format !== "html")) return c.json({ error: "Unknown export" }, 404);
    const run = getRun(id);
    if (!run) return c.json({ error: "Run not found" }, 404);
    c.header("Content-Disposition", `attachment; filename="ultimo-paso-${id}.${format}"`);
    return format === "json" ? c.json(run) : c.html(htmlReport(run));
  });
  if (pipeline) {
    app.get("/pipeline/runs", (c) => c.json({ runs: pipeline.list().map(({ id, mode, status, source, started, finished }) =>
      ({ id, mode, status, source, started, finished })) }));
    app.post("/pipeline/runs", bodyLimit({ maxSize: 4096 }), async (c) => {
      const body = await c.req.json().catch(() => null);
      if (!body || (body.mode !== "real" && body.mode !== "reproduce"))
        return c.json({ error: "Modo de ejecución inválido." }, 400);
      if (body.mode === "reproduce" && !validId(body.source))
        return c.json({ error: "Selecciona una ejecución grabada." }, 400);
      const result = pipeline.start(body.mode, body.mode === "reproduce" ? body.source : undefined);
      return "error" in result ? c.json({ error: result.error }, result.status)
        : c.json({ id: result.id }, 202);
    });
    app.get("/pipeline/runs/:id", (c) => {
      const result = pipeline.get(c.req.param("id"));
      return result ? c.json(result) : c.json({ error: "No se encontró la ejecución." }, 404);
    });
    app.get("/pipeline/runs/:id/tickets/:project/:incident", (c) => {
      const result = pipeline.get(c.req.param("id"));
      const issue = result?.projects.find((p) => p.project === c.req.param("project"))?.incidents
        .find((i) => i.id === c.req.param("incident"));
      if (!issue?.draft) return c.json({ error: "No se encontró el borrador." }, 404);
      c.header("Content-Disposition", `attachment; filename="ultimo-paso-${issue.id}.md"`);
      c.header("Content-Type", "text/markdown; charset=utf-8");
      return c.body(issue.draft);
    });
  }
  app.get("/stream", (c) => streamSSE(c, async (stream) => {
    let previous = "";
    let sent = 0;
    while (!stream.aborted) {
      const revision = `${journal.revision()}:${pipeline?.revision() ?? 0}`;
      if (revision !== previous) {
        await stream.writeSSE({ event: "revision", id: pipeline ? revision : revision.split(":")[0], data: revision });
        previous = revision;
        sent = 0;
      } else if (++sent >= 10) {
        await stream.write(": ping\n\n");
        sent = 0;
      }
      await stream.sleep(1000);
    }
  }));
  return app;
}

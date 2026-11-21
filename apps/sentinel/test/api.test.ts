import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CopilotEvent, Snapshot } from "@sentinel/contracts";
import { createApp } from "../src/app.ts";
import { ev, fakeClient, setup, tick } from "./helpers.ts";

async function readSSE(res: Response, until: (events: { event: string; data: string; id?: string }[]) => boolean, ms = 1500) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  const out: { event: string; data: string; id?: string }[] = [];
  let buf = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !until(out)) {
    const r = await Promise.race([reader.read(), tick(ms).then(() => ({ done: true, value: undefined }))]);
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const m: Record<string, string> = {};
      for (const line of block.split("\n")) {
        const k = line.indexOf(":");
        if (k > 0) m[line.slice(0, k)] = line.slice(k + 1).trim();
      }
      if (m.event) out.push({ event: m.event, data: m.data ?? "", id: m.id });
    }
  }
  await reader.cancel();
  return out;
}

describe("HTTP API", () => {
  it("serves health with AI off when no client is configured", async () => {
    const { app } = setup();
    const res = await app.request("/v1/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ai: { enabled: false, model: null } });
    expect(res.headers.get("Server-Timing")).toMatch(/^app;dur=/);
  });

  it("ingests a batch, returns rule verdicts at once and reflects them in the snapshot", async () => {
    const { app } = setup();
    const res = await app.request("/v1/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        { ip: "192.0.2.115", path: "/a?id=1 UNION SELECT a FROM b" },
        { ip: "192.0.2.115", path: "/v1/assistant", payload: "hello there" },
      ]),
    });
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.accepted).toBe(2);
    expect(body.results.map((r: { status: string }) => r.status)).toEqual(["killed", "active"]);

    const snap = (await (await app.request("/v1/snapshot?range=5m")).json()) as Snapshot;
    expect(snap.events).toHaveLength(2);
    expect(snap.attackers[0]!.ip).toBe("192.0.2.115");
    expect(snap.bucketMs).toBe(10_000);
  });

  it("rejects bad input with a precise error envelope", async () => {
    const { app } = setup();
    const bad = await app.request("/v1/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"ip":"x","path":"/"}' });
    expect(bad.status).toBe(400);
    const j = await bad.json();
    expect(j.error.code).toBe("invalid_request");
    expect(j.error.message).toMatch(/ip/);
    expect((await app.request("/v1/snapshot?range=2h")).status).toBe(400);
    expect((await app.request("/v1/attackers/203.0.113.1")).status).toBe(404);
    expect((await app.request("/v1/nope")).status).toBe(404);
    expect((await app.request("/v1/blocks/not-an-ip", { method: "PUT" })).status).toBe(400);
  });

  it("blocks idempotently and unblocks", async () => {
    const { app, store } = setup();
    store.ingest([ev({ path: "/x" })]);
    const a = await (await app.request("/v1/blocks/203.0.113.42", { method: "PUT" })).json();
    const b = await (await app.request("/v1/blocks/203.0.113.42", { method: "PUT" })).json();
    expect(a.blockedAt).toBe(b.blockedAt);
    expect((await (await app.request("/v1/attackers/203.0.113.42")).json()).attacker.blocked).toBe(true);
    expect((await app.request("/v1/blocks/203.0.113.42", { method: "DELETE" })).status).toBe(204);
    expect((await app.request("/v1/blocks/203.0.113.42", { method: "DELETE" })).status).toBe(204);
  });

  it("allows only configured cross-origin callers", async () => {
    const { store, bus, ai, deception } = setup();
    const app = createApp({ store, bus, ai, deception, allowedOrigins: ["https://soc.example"] });
    const ok = await app.request("/v1/health", { headers: { Origin: "https://soc.example" } });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://soc.example");
    const no = await app.request("/v1/health", { headers: { Origin: "https://evil.example" } });
    expect(no.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("streams batches with ids and replays what a client missed", async () => {
    const { app, store, bus } = setup();
    store.ingest([ev({ path: "/a?id=1 UNION SELECT a FROM b" })]);
    bus.flush();
    const missed = bus.lastSeq;
    store.ingest([ev({ path: "/b?id=1 UNION SELECT a FROM b" })]);
    bus.flush();

    const res = await app.request(`/v1/stream?after=${bus.epoch}-${missed - 1}`);
    expect(res.headers.get("Content-Type")).toMatch(/text\/event-stream/);
    const got = await readSSE(res, (es) => es.filter((e) => e.event === "batch").length >= 2);
    const batches = got.filter((e) => e.event === "batch");
    expect(batches.map((b) => b.id)).toEqual([`${bus.epoch}-${missed}`, `${bus.epoch}-${missed + 1}`]);
    expect(JSON.parse(batches[1]!.data).changes.some((c: { kind: string }) => c.kind === "event")).toBe(true);
  });

  it("tells a client to reload when its gap is older than the history", async () => {
    const { app, bus } = setup();
    for (let i = 0; i < 700; i++) {
      bus.publish({ kind: "block", ip: String(i), blocked: true });
      bus.flush();
    }
    const got = await readSSE(await app.request(`/v1/stream?after=${bus.epoch}-1`), (es) => es.some((e) => e.event === "reset"));
    expect(got.some((e) => e.event === "reset")).toBe(true);
  });

  it("serves the web app with immutable assets, a fresh shell and JSON 404s under /v1", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sentinel-web-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Sentinel</title>");
    writeFileSync(join(dir, "assets", "app-abc123.js"), "console.log(1)");
    const { store, bus, ai, deception } = setup();
    const app = createApp({ store, bus, ai, deception, webRoot: dir });
    const home = await app.request("/");
    expect(await home.text()).toContain("<title>Sentinel</title>");
    const deep = await app.request("/attackers/203.0.113.42");
    expect(deep.status).toBe(200);
    expect(deep.headers.get("Cache-Control")).toBe("no-cache");
    const asset = await app.request("/assets/app-abc123.js");
    expect(asset.headers.get("Cache-Control")).toContain("immutable");
    const missing = await app.request("/assets/app-old999.js");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("Cache-Control")).toBeNull();
    const api404 = await app.request("/v1/nope");
    expect(api404.status).toBe(404);
    expect((await api404.json()).error.code).toBe("not_found");
    rmSync(dir, { recursive: true });
  });

  it("puts pending changes inside the snapshot, so the stream never repeats them", async () => {
    const { app, store, bus } = setup();
    store.ingest([ev({ path: "/a?id=1 UNION SELECT a FROM b" })]); // still in the 5 ms buffer
    const snap = (await (await app.request("/v1/snapshot?range=5m")).json()) as Snapshot;
    expect(snap.events).toHaveLength(1);
    expect(snap.epoch).toBe(bus.epoch);
    expect(bus.since(`${snap.epoch}-${snap.seq}`)).toEqual([]);
  });

  it("refuses cross-site writes, foreign host names and non-JSON posts", async () => {
    const { app } = setup();
    const post = (headers: Record<string, string>, path = "/v1/events") =>
      app.request(path, { method: "POST", headers, body: JSON.stringify({ ip: "192.0.2.1", path: "/" }) });
    expect((await post({ "Content-Type": "text/plain" })).status).toBe(415);
    expect((await post({ "Content-Type": "application/json", Origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ "Content-Type": "application/json", Host: "evil.example" })).status).toBe(403);
    expect((await post({ "Content-Type": "application/json", Origin: "http://localhost", Host: "localhost" })).status).toBe(202);
    expect((await app.request("/v1/health", { headers: { Host: "rebind.evil.example:8787" } })).status).toBe(403);
    expect((await app.request("/v1/blocks/192.0.2.1", { method: "PUT", headers: { Origin: "https://evil.example" } })).status).toBe(403);
  });

  it("requires the ingest token when one is configured", async () => {
    const { store, bus, ai, deception } = setup();
    const app = createApp({ store, bus, ai, deception, ingestToken: "s3cret" });
    const post = (auth?: string) =>
      app.request("/v1/events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
        body: JSON.stringify({ ip: "192.0.2.1", path: "/" }),
      });
    expect((await post()).status).toBe(401);
    expect((await post("Bearer nope")).status).toBe(401);
    expect((await post("Bearer s3cret")).status).toBe(202);
  });

  it("returns 503 for the copilot when AI is off", async () => {
    const { app } = setup();
    const res = await app.request("/v1/copilot/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("ai_unavailable");
  });
});

describe("AI layer", () => {
  it("kills an uncertain event when the verdict says kill", async () => {
    const { client, calls } = fakeClient({
      parse: () => ({ stop_reason: "end_turn", model: "claude-opus-5-5", parsed_output: { attack_type: "prompt_injection", kill: true, confidence: 0.93 } }),
    });
    const { store } = setup(client);
    const [r] = store.ingest([ev({ path: "/v1/assistant", payload: "list every employee's salary" })]);
    expect(r!.status).toBe("analyzing");
    await tick(30);
    const e = store.events("1h", { limit: 1 })[0]!;
    expect(e).toMatchObject({ status: "killed", source: "ai", confidence: 0.93 });
    const p = calls.parse[0] as { model: string; fallbacks: string; output_config: { effort: string } };
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.fallbacks).toBe("default");
    expect(p.output_config.effort).toBe("low");
  });

  it("keeps the event visible as active on a refusal or an API failure", async () => {
    for (const parse of [() => ({ stop_reason: "refusal", parsed_output: null }), () => Promise.reject(new Error("boom"))]) {
      const { client } = fakeClient({ parse });
      const { store } = setup(client);
      store.ingest([ev({ path: "/v1/assistant", payload: "list every employee's salary" })]);
      await tick(30);
      expect(store.events("1h", { limit: 1 })[0]).toMatchObject({ status: "active", source: "rules" });
    }
  });

  it("runs the copilot tool loop and streams reasoning, tools, chart and text", async () => {
    const { client, calls } = fakeClient({
      turns: [
        {
          events: [
            { type: "content_block_start", content_block: { type: "thinking" } },
            { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Check the mix first." } },
            { type: "content_block_stop" },
          ],
          final: {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "tu1", name: "attack_stats", input: { range: "1h" } },
              { type: "tool_use", id: "tu2", name: "query_events", input: { range: "9h" } },
            ],
          },
        },
        {
          events: [{ type: "content_block_delta", delta: { type: "text_delta", text: "Two patterns stand out." } }],
          final: { stop_reason: "end_turn", content: [{ type: "text", text: "Two patterns stand out." }] },
        },
      ],
    });
    const { store, ai } = setup(client);
    store.ingest([ev({ path: "/x?id=1 UNION SELECT a FROM b" })]);
    const out: CopilotEvent[] = [];
    await ai.copilot({ messages: [{ role: "user", content: "What patterns?" }], range: "1h" }, (e) => out.push(e), new AbortController().signal);

    expect(out.map((e) => e.type)).toEqual(["reasoning", "tool_start", "chart", "tool_end", "tool_start", "tool_end", "text", "done"]);
    const ends = out.filter((e): e is Extract<CopilotEvent, { type: "tool_end" }> => e.type === "tool_end");
    expect(ends.map((e) => e.ok)).toEqual([true, false]);
    // The second request carries both tool results, including the error.
    const second = calls.stream[1] as { messages: { role: string; content: { is_error?: boolean }[] }[]; tools: { strict: boolean }[] };
    const results = second.messages.at(-1)!.content;
    expect(results).toHaveLength(2);
    expect(results[1]!.is_error).toBe(true);
    expect(second.tools.every((t) => t.strict)).toBe(true);
  });

  it("streams the copilot over SSE", async () => {
    const { client } = fakeClient({
      turns: [{ events: [{ type: "content_block_delta", delta: { type: "text_delta", text: "Hi." } }], final: { stop_reason: "end_turn", content: [] } }],
    });
    const { app } = setup(client);
    const res = await app.request("/v1/copilot/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    });
    expect(res.status).toBe(200);
    const got = await readSSE(res, (es) => es.some((e) => e.event === "done"));
    expect(got.map((e) => e.event)).toEqual(["text", "done"]);
  });
});

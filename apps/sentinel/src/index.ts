import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { DEFAULT_PORT } from "@sentinel/contracts";
import { Ai } from "./ai.ts";
import { createApp } from "./app.ts";
import { Bus } from "./bus.ts";
import { GeoResolver } from "./enrich.ts";
import { Store } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SENTINEL_PORT ?? DEFAULT_PORT);
const host = process.env.SENTINEL_HOST ?? "127.0.0.1";
const dbPath = resolve(process.env.SENTINEL_DB ?? resolve(here, "../data/sentinel.db"));

mkdirSync(dirname(dbPath), { recursive: true });
// The SDK resolves ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Without either, AI stays off.
const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;

const db = new DatabaseSync(dbPath);
const bus = new Bus();
const store = new Store(bus, { db, aiVerdicts: !!client });
const ai = new Ai(store, bus, { client });

// Attackers without a location hint get one from ip-api.com, off the ingest path.
const geo = new GeoResolver((ip, g) => store.setGeo(ip, g));
bus.subscribe((b) => {
  for (const c of b.changes) if (c.kind === "attacker" && !c.attacker.country) geo.request(c.attacker.ip);
});

const app = createApp({ store, bus, ai });
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`[sentinel] http://${host}:${info.port}/v1  ai=${ai.enabled ? "on" : "off (set ANTHROPIC_API_KEY)"}  db=${dbPath}`);
});

function shutdown() {
  ai.stop();
  bus.stop();
  store.close();
  db.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

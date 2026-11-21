import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { DEFAULT_PORT } from "@sentinel/contracts";
import { Ai } from "./ai.ts";
import { createApp } from "./app.ts";
import { Bus } from "./bus.ts";
import { DeceptionStore } from "./deception.ts";
import { GeoResolver } from "./enrich.ts";
import { FixProposer } from "./fixes.ts";
import { createMastraReportModel } from "./reports/mastra.ts";
import { ReportService } from "./reports/service.ts";
import { accessLogSource, engineSource, sentinelSource } from "./reports/sources.ts";
import { Pipeline, fixtureWorker } from "./ultimo-paso/pipeline.ts";
import { pipelineProviders, providerEnvironment } from "./ultimo-paso/providers.ts";
import { EvidenceJournal } from "./ultimo-paso/journal.ts";
import { inventoryOf } from "./ultimo-paso/research.ts";
import { Store } from "./store.ts";

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.SENTINEL_PORT ?? DEFAULT_PORT);
const host = process.env.SENTINEL_HOST ?? "127.0.0.1";
const dbPath = resolve(process.env.SENTINEL_DB ?? resolve(here, "../data/sentinel.db"));
const webRoot = resolve(process.env.SENTINEL_WEB ?? resolve(here, "../../web/dist"));
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const allowedOrigins = list(process.env.SENTINEL_ALLOWED_ORIGINS);
const allowedHosts = list(process.env.SENTINEL_ALLOWED_HOSTS);
const ingestToken = process.env.SENTINEL_INGEST_TOKEN || undefined;
// The agent-detection stack (scripts/stack_local.sh) writes its log and verdicts under agent-detection/run.
const repoRoot = resolve(here, "../../..");
const accessLogPath = resolve(process.env.SENTINEL_ACCESS_LOG || resolve(repoRoot, "agent-detection/run/access.log"));
const verdictsDbPath = resolve(process.env.SENTINEL_VERDICTS_DB || resolve(repoRoot, "agent-detection/run/verdicts.db"));

mkdirSync(dirname(dbPath), { recursive: true });
// The SDK resolves ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Without either, AI stays off.
const client = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new Anthropic() : null;

const db = new DatabaseSync(dbPath);
const bus = new Bus();
const deception = new DeceptionStore(db, bus);
const store = new Store(bus, { db, aiVerdicts: !!client, retained: [deception] });
const ai = new Ai(store, bus, { client });
const fixes = new FixProposer(deception, bus, { client });

// Attackers without a location hint get one from ip-api.com, off the ingest path.
const geo = new GeoResolver((ip, g) => store.setGeo(ip, g));
bus.subscribe((b) => {
  for (const c of b.changes) if (c.kind === "attacker" && !c.attacker.country) geo.request(c.attacker.ip);
});

// Incident reports need ANTHROPIC_API_KEY (a bearer token alone is not enough for the Mastra client). Missing files are fine: that log store reports STORE_DOWN.
const reportModel = createMastraReportModel({ apiKey: process.env.ANTHROPIC_API_KEY });
const reports = reportModel
  ? new ReportService({ store, db, model: reportModel, sources: { sen: sentinelSource(store), acc: accessLogSource(accessLogPath), eng: engineSource(verdictsDbPath) } })
  : null;

const upRoot = resolve(repoRoot, "ultimo-paso");
const upEnvironment = providerEnvironment(resolve(upRoot, ".env"));
const replayDirectory = resolve(upRoot, "scoreboard/evidence");
const eventDirectory = process.env.ULTIMO_PASO_EVENT_DIR || resolve(upRoot, "scoreboard/runs/live");
if (!process.env.ULTIMO_PASO_EVENT_DIR) mkdirSync(eventDirectory, { recursive: true });
const inventory = inventoryOf({ package: process.env.ULTIMO_PASO_PACKAGE, version: process.env.ULTIMO_PASO_VERSION });
const journal = new EvidenceJournal(db, eventDirectory, upEnvironment.FIRECRAWL_API_KEY, inventory);
const pipeline = new Pipeline(db, { ...pipelineProviders(upEnvironment),
  evaluate: fixtureWorker(upRoot, eventDirectory, upEnvironment.ULTIMO_PASO_LIMA_VM) });
const app = createApp({ evidence: { replayDirectory, journal, pipeline }, store, bus, ai, deception, webRoot, allowedOrigins, allowedHosts, ingestToken, reports });
const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  const web = existsSync(resolve(webRoot, "index.html")) ? `http://${host}:${info.port}/` : "not built (pnpm build)";
  console.log(`[sentinel] api http://${host}:${info.port}/v1  web ${web}  ai=${ai.enabled ? "on" : "off (set ANTHROPIC_API_KEY)"}  reports=${reports ? "on" : "off (set ANTHROPIC_API_KEY)"}`);
});

function shutdown() {
  ai.stop();
  fixes.stop();
  bus.stop();
  pipeline.stop();
  journal.stop();
  store.close();
  db.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

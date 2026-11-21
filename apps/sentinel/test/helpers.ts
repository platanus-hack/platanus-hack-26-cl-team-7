import { DatabaseSync } from "node:sqlite";
import type Anthropic from "@anthropic-ai/sdk";
import type { DeceptionEvent, IngestEvent } from "@sentinel/contracts";
import { IngestEvent as IngestSchema } from "@sentinel/contracts";
import { Ai } from "../src/ai.ts";
import { createApp } from "../src/app.ts";
import { Bus } from "../src/bus.ts";
import { DeceptionStore } from "../src/deception.ts";
import { Store } from "../src/store.ts";

export function ev(partial: Partial<IngestEvent> & { path: string }) {
  return IngestSchema.parse({ ip: "203.0.113.42", userAgent: "curl/8.9.1", ...partial });
}

type StreamEvent = Record<string, unknown>;
export interface FakeTurn {
  events?: StreamEvent[];
  final: { stop_reason: string; content: unknown[]; model?: string };
}

/** Minimal stand-in for the parts of the SDK client that Sentinel calls. */
export function fakeClient(opts: { parse?: (params: unknown) => unknown; turns?: FakeTurn[] }) {
  const calls: { parse: unknown[]; stream: unknown[] } = { parse: [], stream: [] };
  let turn = 0;
  const client = {
    beta: {
      messages: {
        parse: async (params: unknown) => {
          calls.parse.push(params);
          if (!opts.parse) throw new Error("parse not faked");
          return opts.parse(params);
        },
        stream: (params: unknown) => {
          calls.stream.push(structuredClone(params));
          const t = opts.turns?.[turn++];
          if (!t) throw new Error("no more fake turns");
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of t.events ?? []) yield e;
            },
            finalMessage: async () => ({ model: "claude-opus-5-5", ...t.final }),
          };
        },
      },
    },
  };
  return { client: client as unknown as Anthropic, calls };
}

export function setup(client: Anthropic | null = null, now?: () => number) {
  const bus = new Bus(5);
  const deception = new DeceptionStore(new DatabaseSync(":memory:"), bus, { now });
  const store = new Store(bus, { now, aiVerdicts: !!client, retained: [deception] });
  const ai = new Ai(store, bus, { client, reportDebounceMs: 5 });
  const app = createApp({ store, bus, ai, deception, heartbeatMs: 50 });
  return { bus, store, ai, deception, app };
}

export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

/** Reads Server-Sent Events from a response until `until` holds or `ms` pass. */
export async function readSSE(res: Response, until: (events: { event: string; data: string; id?: string }[]) => boolean, ms = 1500) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const out: { event: string; data: string; id?: string }[] = [];
  let buf = "";
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !until(out)) {
    const r = await Promise.race([reader.read(), tick(ms).then(() => ({ done: true, value: undefined }))]);
    if (r.done) break;
    buf += decoder.decode(r.value, { stream: true });
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

/* ------------------------------ deception ------------------------------ */

export const TRACK = "trk_0123456789abcdef";
export const T0 = 1_763_700_000_000;
let requestSeq = 0;
const rid = () => `req-${++requestSeq}`;

/** Router events as mirror/contracts.py writes them. Each call gets a fresh request id unless one is given. */
export const dec = {
  opened: (p: Partial<Extract<DeceptionEvent, { type: "track.opened" }>> = {}): DeceptionEvent => ({
    type: "track.opened",
    eventId: `track.opened:${rid()}`,
    trackId: TRACK,
    ts: T0,
    ip: "203.0.113.7",
    userAgent: "python-httpx/0.27.0",
    rule: "R3",
    reason: "critical flag: sql injection in query",
    keys: [{ kind: "ip_ua", value: "203.0.113.7|python-httpx/0.27.0" }],
    ...p,
  }),
  linked: (p: Partial<Extract<DeceptionEvent, { type: "track.linked" }>> = {}): DeceptionEvent => ({
    type: "track.linked",
    eventId: `track.linked:${rid()}`,
    trackId: TRACK,
    ts: T0 + 1,
    key: { kind: "twin_born", value: "a".repeat(64) },
    ...p,
  }),
  action: (p: Partial<Extract<DeceptionEvent, { type: "track.action" }>> = {}): DeceptionEvent => ({
    type: "track.action",
    eventId: `track.action:${rid()}`,
    trackId: TRACK,
    ts: T0 + 2,
    method: "POST",
    path: "/login",
    query: "",
    status: 401,
    durationMs: 12,
    requestBody: "username=admin'--&pw=x",
    responseBody: "<p>Wrong user name or password</p>",
    ...p,
  }),
  finding: (p: Partial<Extract<DeceptionEvent, { type: "finding.confirmed" }>> = {}): DeceptionEvent => ({
    type: "finding.confirmed",
    eventId: `finding.confirmed:${rid()}`,
    trackId: TRACK,
    ts: T0 + 3,
    findingId: "fnd_fedcba9876543210",
    kind: "auth_flip",
    endpoint: "POST /login",
    evidence: "401 for this track, then 200 with signature 'sql comment'",
    ...p,
  }),
};

/** A parse() result the fake client returns for a fix proposal. */
export const proposal = (summary: string) => ({ stop_reason: "end_turn", model: "claude-opus-5-5", parsed_output: { summary } });

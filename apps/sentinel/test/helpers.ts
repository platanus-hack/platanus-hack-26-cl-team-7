import type Anthropic from "@anthropic-ai/sdk";
import type { IngestEvent } from "@sentinel/contracts";
import { IngestEvent as IngestSchema } from "@sentinel/contracts";
import { Ai } from "../src/ai.ts";
import { createApp } from "../src/app.ts";
import { Bus } from "../src/bus.ts";
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
  const store = new Store(bus, { now, aiVerdicts: !!client });
  const ai = new Ai(store, bus, { client, reportDebounceMs: 5 });
  const app = createApp({ store, bus, ai, heartbeatMs: 50 });
  return { bus, store, ai, app };
}

export const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

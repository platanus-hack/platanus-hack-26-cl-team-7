import { create } from "zustand";
import type { ChartBlock, CopilotEvent, Range } from "@sentinel/contracts";
import { api, readSse } from "../sentinel";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  state: "run" | "ok" | "err";
  summary?: string;
  ms?: number;
}

export interface AssistantTurn {
  role: "assistant";
  id: string;
  reasoning: string;
  startedAt: number;
  reasoningMs: number | null;
  tools: ToolCall[];
  charts: ChartBlock[];
  text: string;
  done: boolean;
  at: number | null;
  error: string | null;
}

export interface UserTurn {
  role: "user";
  id: string;
  text: string;
}

export type Turn = UserTurn | AssistantTurn;

/** Applies one copilot stream event to the assistant turn. Pure, so it is easy to test. */
export function reduceTurn(turn: AssistantTurn, ev: CopilotEvent): AssistantTurn {
  switch (ev.type) {
    case "reasoning":
      return { ...turn, reasoning: turn.reasoning + ev.delta };
    case "tool_start":
      return { ...turn, tools: [...turn.tools, { id: ev.id, name: ev.name, args: ev.args, state: "run" }] };
    case "tool_end":
      return {
        ...turn,
        tools: turn.tools.map((t) => (t.id === ev.id ? { ...t, state: ev.ok ? "ok" : "err", summary: ev.summary, ms: ev.ms } : t)),
      };
    case "chart":
      return { ...turn, charts: [...turn.charts, ev.chart] };
    case "text":
      return { ...turn, reasoningMs: turn.reasoningMs ?? Date.now() - turn.startedAt, text: turn.text + ev.delta };
    case "done":
      return {
        ...turn,
        done: true,
        at: ev.at,
        reasoningMs: ev.reasoningMs || turn.reasoningMs,
        tools: turn.tools.map((t) => (t.state === "run" ? { ...t, state: "err", summary: "stopped" } : t)),
      };
    case "error":
      return { ...turn, done: true, at: Date.now(), error: ev.message };
  }
}

export const MAX_HISTORY = 20;

/** The turns sent to the server: non-empty, the last MAX_HISTORY, always starting with a user turn. */
export function toHistory(turns: Turn[]): { role: "user" | "assistant"; content: string }[] {
  const msgs = turns.map((t) => ({ role: t.role, content: t.text })).filter((t) => t.content.trim().length > 0);
  const recent = msgs.slice(-MAX_HISTORY);
  const firstUser = recent.findIndex((t) => t.role === "user");
  return firstUser === -1 ? [] : recent.slice(firstUser);
}

interface CopilotState {
  turns: Turn[];
  streaming: boolean;
  send: (text: string, range: Range) => Promise<void>;
  stop: () => void;
}

let ctrl: AbortController | null = null;
const uid = () => Math.random().toString(36).slice(2, 10);

export const useCopilot = create<CopilotState>((set, get) => ({
  turns: [],
  streaming: false,
  stop: () => ctrl?.abort(),
  send: async (text, range) => {
    const q = text.trim();
    if (!q || get().streaming) return;
    const user: UserTurn = { role: "user", id: uid(), text: q };
    const reply: AssistantTurn = {
      role: "assistant",
      id: uid(),
      reasoning: "",
      startedAt: Date.now(),
      reasoningMs: null,
      tools: [],
      charts: [],
      text: "",
      done: false,
      at: null,
      error: null,
    };
    const history = toHistory([...get().turns, user]);
    set((s) => ({ turns: [...s.turns, user, reply], streaming: true }));

    // Text deltas arrive many times a second; apply them once per frame.
    let pending: CopilotEvent[] = [];
    let raf = 0;
    const apply = () => {
      raf = 0;
      const evs = pending;
      pending = [];
      set((s) => ({
        turns: s.turns.map((t) => (t.id === reply.id && t.role === "assistant" ? evs.reduce(reduceTurn, t) : t)),
      }));
    };
    const push = (ev: CopilotEvent) => {
      pending.push(ev);
      if (!raf) raf = requestAnimationFrame(apply);
    };

    ctrl = new AbortController();
    try {
      const res = await fetch(api.copilotUrl(), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ messages: history, range }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        push({ type: "error", code: "http_error", message: body?.error?.message ?? `Copilot request failed (${res.status})` });
      } else {
        for await (const msg of readSse(res.body)) {
          try {
            push(JSON.parse(msg.data) as CopilotEvent);
          } catch {
            /* skip malformed event */
          }
        }
      }
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === "AbortError";
      push(aborted ? { type: "done", at: Date.now(), reasoningMs: 0 } : { type: "error", code: "network", message: "Reaper is not reachable." });
    } finally {
      ctrl = null;
      if (raf) cancelAnimationFrame(raf);
      apply();
      set((s) => ({
        streaming: false,
        turns: s.turns.map((t) => (t.id === reply.id && t.role === "assistant" && !t.done ? reduceTurn(t, { type: "done", at: Date.now(), reasoningMs: 0 }) : t)),
      }));
    }
  },
}));

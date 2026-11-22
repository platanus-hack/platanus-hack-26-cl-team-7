import { z } from "zod";
import { Range } from "./api.ts";

const CopilotTurn = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(8000),
});

/** Body of POST /v1/copilot/messages. The answer is an SSE stream of CopilotEvent. */
export const CopilotRequest = z.object({
  messages: z.array(CopilotTurn).min(1).max(40),
  range: Range.default("1h"),
});
export type CopilotRequest = z.input<typeof CopilotRequest>;

export interface ChartBlock {
  title: string;
  subtitle: string;
  source: string;
  note?: string;
  rows: { label: string; value: number; share: number }[];
}

export type CopilotEvent =
  | { type: "reasoning"; delta: string }
  | { type: "tool_start"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_end"; id: string; summary: string; ms: number; ok: boolean }
  | { type: "chart"; chart: ChartBlock }
  | { type: "text"; delta: string }
  | { type: "done"; at: number; reasoningMs: number }
  | { type: "error"; code: string; message: string };

import { describe, expect, it } from "vitest";
import { reduceTurn, type AssistantTurn } from "../src/copilot/store";

const empty = (): AssistantTurn => ({ role: "assistant", id: "a", reasoning: "", startedAt: 0, reasoningMs: null, tools: [], charts: [], text: "", done: false, at: null, error: null });

describe("reduceTurn", () => {
  it("builds a turn from stream events", () => {
    let t = empty();
    t = reduceTurn(t, { type: "reasoning", delta: "Two IPs " });
    t = reduceTurn(t, { type: "reasoning", delta: "share a fingerprint." });
    t = reduceTurn(t, { type: "tool_start", id: "t1", name: "query_events", args: { range: "1h" } });
    t = reduceTurn(t, { type: "tool_end", id: "t1", summary: "1,284 rows", ms: 84, ok: true });
    t = reduceTurn(t, { type: "text", delta: "Three patterns" });
    t = reduceTurn(t, { type: "done", at: 5, reasoningMs: 6000 });
    expect(t.reasoning).toBe("Two IPs share a fingerprint.");
    expect(t.tools[0]).toMatchObject({ state: "ok", summary: "1,284 rows", ms: 84 });
    expect(t.text).toBe("Three patterns");
    expect(t).toMatchObject({ done: true, at: 5, reasoningMs: 6000 });
  });

  it("marks running tools as stopped when the turn ends early", () => {
    let t = reduceTurn(empty(), { type: "tool_start", id: "t1", name: "get_attacker", args: {} });
    t = reduceTurn(t, { type: "done", at: 1, reasoningMs: 0 });
    expect(t.tools[0]!.state).toBe("err");
  });

  it("records errors", () => {
    expect(reduceTurn(empty(), { type: "error", code: "x", message: "boom" })).toMatchObject({ done: true, error: "boom" });
  });
});

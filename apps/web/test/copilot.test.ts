import { describe, expect, it } from "vitest";
import { MAX_HISTORY, reduceTurn, toHistory, type AssistantTurn, type Turn } from "../src/copilot/store";

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

describe("toHistory", () => {
  const user = (i: number): Turn => ({ role: "user", id: `u${i}`, text: `q${i}` });
  const reply = (i: number, text = `a${i}`): Turn => ({ ...empty(), id: `a${i}`, text });

  it("keeps the last turns and always starts with a user turn", () => {
    const turns: Turn[] = [];
    for (let i = 0; i < 15; i++) turns.push(user(i), reply(i));
    turns.push(user(15));
    const h = toHistory(turns);
    expect(h.length).toBeLessThanOrEqual(MAX_HISTORY);
    expect(h[0]!.role).toBe("user");
    expect(h[h.length - 1]).toEqual({ role: "user", content: "q15" });
  });

  it("drops empty answers", () => {
    expect(toHistory([user(1), reply(1, ""), user(2)])).toEqual([
      { role: "user", content: "q1" },
      { role: "user", content: "q2" },
    ]);
  });
});

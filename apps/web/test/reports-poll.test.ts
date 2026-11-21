import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Report, ReportStatus } from "@sentinel/contracts";
import { MAX_POLL_FAILURES, POLL_MS, isRunning, pollReport } from "../src/reports/poll";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);

const report = (status: ReportStatus): Report => ({
  id: "r1",
  scope: { ip: "203.0.113.42", from: new Date(NOW - 600_000).toISOString(), to: new Date(NOW).toISOString() },
  status,
  createdAt: NOW,
  updatedAt: NOW,
  caseFile: null,
  evidence: [],
  timeline: [],
  revisions: [],
  analystModel: null,
  analystTokens: null,
  error: null,
});

/** A `load` that answers with the given statuses in order, then repeats the last one. */
function loads(...statuses: ReportStatus[]) {
  let n = 0;
  return vi.fn(async (_signal: AbortSignal) => report(statuses[Math.min(n++, statuses.length - 1)]!));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("isRunning", () => {
  it("polls only while an agent works", () => {
    expect(isRunning("investigating")).toBe(true);
    expect(isRunning("revising")).toBe(true);
    for (const s of ["awaiting_decision", "approved", "failed"] as const) expect(isRunning(s)).toBe(false);
  });
});

describe("pollReport", () => {
  it("asks once a second, not before", async () => {
    const load = loads("investigating");
    const stop = pollReport({ load, onReport: vi.fn(), onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS - 1);
    expect(load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    stop();
  });

  it("keeps going through investigating and revising, hands over each answer, and stops when the status settles", async () => {
    const load = loads("investigating", "revising", "awaiting_decision");
    const seen: ReportStatus[] = [];
    pollReport({ load, onReport: (r) => seen.push(r.status), onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(3 * POLL_MS);
    expect(seen).toEqual(["investigating", "revising", "awaiting_decision"]);
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when the view closes", async () => {
    const load = loads("investigating");
    const onReport = vi.fn();
    const stop = pollReport({ load, onReport, onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("drops an answer that arrives after the view closed", async () => {
    let answer: (r: Report) => void = () => undefined;
    const load = vi.fn((_signal: AbortSignal) => new Promise<Report>((resolve) => (answer = resolve)));
    const onReport = vi.fn();
    const stop = pollReport({ load, onReport, onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    const signal = load.mock.calls[0]![0];
    stop();
    expect(signal.aborted).toBe(true);
    answer(report("investigating"));
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(onReport).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("waits for a slow answer before it asks again", async () => {
    let answer: (r: Report) => void = () => undefined;
    const load = vi.fn((_signal: AbortSignal) => new Promise<Report>((resolve) => (answer = resolve)));
    const stop = pollReport({ load, onReport: vi.fn(), onGiveUp: vi.fn() });
    await vi.advanceTimersByTimeAsync(5 * POLL_MS);
    expect(load).toHaveBeenCalledTimes(1);
    answer(report("investigating"));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    stop();
  });

  it("gives up after failures in a row, but a good answer resets the count", async () => {
    const boom = new Error("down");
    let calls = 0;
    const load = vi.fn(async (_signal: AbortSignal) => {
      calls += 1;
      // One good answer after four failures, then failures for good.
      if (calls === MAX_POLL_FAILURES) return report("investigating");
      throw boom;
    });
    const onGiveUp = vi.fn();
    pollReport({ load, onReport: vi.fn(), onGiveUp });
    await vi.advanceTimersByTimeAsync((MAX_POLL_FAILURES + 1) * POLL_MS);
    expect(load).toHaveBeenCalledTimes(MAX_POLL_FAILURES + 1);
    expect(onGiveUp).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync((MAX_POLL_FAILURES - 1) * POLL_MS);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
    expect(onGiveUp).toHaveBeenCalledWith(boom);
    expect(load).toHaveBeenCalledTimes(2 * MAX_POLL_FAILURES);
    await vi.advanceTimersByTimeAsync(10 * POLL_MS);
    expect(load).toHaveBeenCalledTimes(2 * MAX_POLL_FAILURES);
  });
});

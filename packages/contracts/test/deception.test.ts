import { describe, expect, it } from "vitest";
import {
  DECEPTION_LIMITS,
  DeceptionBatch,
  DeceptionEvent,
  Finding,
  PageQuery,
  TrackDetail,
  TrackKey,
  type DeceptionEvent as Event,
} from "../src/index.ts";
import data from "./fixtures/deception-batch.json" with { type: "json" };

/** Written by Python (tests/test_mirror_contracts.py checks mirror.contracts produces exactly this). */
const fixture = data as unknown as { limits: Record<string, number>; batch: Event[] };
const [opened, linked, action, finding] = fixture.batch as [Event, Event, Event, Event];

describe("deception contract", () => {
  it("accepts the Python batch unchanged", () => {
    const parsed = DeceptionBatch.parse(fixture.batch);
    expect(parsed).toEqual(fixture.batch);
    expect(parsed.map((e) => e.type)).toEqual([
      "track.opened",
      "track.linked",
      "track.action",
      "finding.confirmed",
      "track.opened",
    ]);
  });

  it("uses the same limits as Python", () => {
    expect(fixture.limits).toEqual({ ...DECEPTION_LIMITS });
  });

  it("refuses a field Python does not send, and a missing one", () => {
    expect(DeceptionEvent.safeParse({ ...action, lane: "mirror" }).success).toBe(false);
    const { durationMs: _, ...withoutDuration } = action as Extract<Event, { type: "track.action" }>;
    expect(DeceptionEvent.safeParse(withoutDuration).success).toBe(false);
  });

  it("ties the eventId to the event type", () => {
    expect(DeceptionEvent.safeParse({ ...action, eventId: (opened as Event).eventId }).success).toBe(false);
    expect(DeceptionEvent.safeParse({ ...finding, eventId: "finding.confirmed:r1:canary_read" }).success).toBe(true);
    expect(DeceptionEvent.safeParse({ ...finding, eventId: "finding.confirmed:" }).success).toBe(false);
  });

  it("counts body limits in code points, like Python", () => {
    const lock = "\u{1F512}";
    const full = lock.repeat(DECEPTION_LIMITS.body);
    expect(DeceptionEvent.safeParse({ ...action, responseBody: full }).success).toBe(true);
    expect(DeceptionEvent.safeParse({ ...action, responseBody: `a${full}` }).success).toBe(false);
  });

  it("checks track key values by kind", () => {
    expect(TrackKey.safeParse((linked as Extract<Event, { type: "track.linked" }>).key).success).toBe(true);
    expect(TrackKey.safeParse({ kind: "twin_born", value: "raw-cookie-value" }).success).toBe(false);
    expect(TrackKey.safeParse({ kind: "ip", value: "fe80::1%en0" }).success).toBe(false);
  });

  it("takes 1 to 500 events per batch", () => {
    expect(DeceptionBatch.safeParse([]).success).toBe(false);
    expect(DeceptionBatch.safeParse(Array(DECEPTION_LIMITS.batch).fill(action)).success).toBe(true);
    expect(DeceptionBatch.safeParse(Array(DECEPTION_LIMITS.batch + 1).fill(action)).success).toBe(false);
  });

  it("builds read models from the same fields", () => {
    const f = finding as Extract<Event, { type: "finding.confirmed" }>;
    const a = action as Extract<Event, { type: "track.action" }>;
    const read = Finding.parse({ ...f, proposal: null, proposalStatus: "pending" });
    expect(read.findingId).toBe(f.findingId);
    expect(Finding.safeParse({ ...f, proposal: null }).success).toBe(false);
    expect(Finding.safeParse({ ...f, proposal: null, proposalStatus: "writing" }).success).toBe(false);
    const detail = TrackDetail.parse({
      track: {
        trackId: a.trackId,
        ip: "203.0.113.7",
        userAgent: "python-httpx/0.27.0",
        rule: "R3",
        reason: "critical flag",
        keys: [],
        openedAt: a.ts,
        lastSeen: a.ts,
        actions: 1,
        findings: 1,
      },
      actions: [a],
      findings: [read],
    });
    expect(detail.actions[0]?.durationMs).toBe(a.durationMs);
    expect(PageQuery.parse({ limit: "20" })).toEqual({ range: "24h", limit: 20 });
    expect(PageQuery.safeParse({ limit: "201" }).success).toBe(false);
  });
});

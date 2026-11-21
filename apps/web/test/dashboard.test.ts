import { describe, expect, it } from "vitest";
import type { AttackEvent, Attacker, Snapshot, StreamBatch } from "@sentinel/contracts";
import {
  MAX_EVENTS,
  advanceSeries,
  applyBatches,
  bucketOf,
  confirmedBlocks,
  fromSnapshot,
  isStaleEpoch,
  partitionBatches,
  pruneAttackers,
  setBlocked,
  withBlockOverrides,
} from "../src/dashboard/store";

const B = 60_000;
const NOW = 1_700_000_000_000;
const T = bucketOf(NOW, B);

let n = 0;
function ev(p: Partial<AttackEvent> = {}): AttackEvent {
  n += 1;
  return { id: `e${n}`, seq: n, ts: NOW, ip: "203.0.113.42", method: "POST", path: "/api/login", payload: "", attackType: "credential_stuffing", status: "killed", source: "rules", confidence: 0.9, ...p };
}
function attacker(p: Partial<Attacker> = {}): Attacker {
  return { ip: "203.0.113.42", country: "Chile", countryCode: "CL", city: "Santiago", network: null, device: null, os: null, browser: null, firstSeen: NOW, lastSeen: NOW, events: 1, killed: 1, notKilled: 0, topType: "credential_stuffing", risk: 50, blocked: false, ...p };
}
function snap(p: Partial<Snapshot> = {}): Snapshot {
  return { range: "1h", now: NOW, bucketMs: B, series: [{ t: T - B, received: 2, killed: 2 }, { t: T, received: 1, killed: 1 }], events: [], attackers: [], seq: 10, epoch: "E1", ...p };
}
const batch = (seq: number, changes: StreamBatch["changes"], epoch = "E1"): StreamBatch => ({ epoch, seq, now: NOW, changes });
const at = (d: ReturnType<typeof fromSnapshot>, t = T) => d.series.find((s) => s.t === t)!;

describe("fromSnapshot", () => {
  it("sorts events newest first and attackers by risk", () => {
    const a = ev({ ts: NOW - 5000 });
    const b = ev({ ts: NOW });
    const d = fromSnapshot(snap({ events: [a, b], attackers: [attacker({ ip: "1.1.1.1", risk: 10 }), attacker({ ip: "2.2.2.2", risk: 90 })] }));
    expect(d.events.map((e) => e.id)).toEqual([b.id, a.id]);
    expect(d.attackers.map((x) => x.ip)).toEqual(["2.2.2.2", "1.1.1.1"]);
    expect(d.seq).toBe(10);
  });
});

describe("applyBatches", () => {
  it("adds a new event to the feed and counts it in its bucket", () => {
    const d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: ev({ status: "analyzing" }) }])]);
    expect(d.events).toHaveLength(1);
    const p = d.series.find((s) => s.t === T)!;
    expect(p.received).toBe(2);
    expect(p.killed).toBe(1);
    expect(d.seq).toBe(11);
  });

  it("counts a kill once when an analyzing event becomes killed", () => {
    const e = ev({ status: "analyzing" });
    let d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: e }])]);
    d = applyBatches(d, [batch(12, [{ kind: "event", event: { ...e, status: "killed", source: "ai" } }])]);
    const p = d.series.find((s) => s.t === T)!;
    expect(p.received).toBe(2);
    expect(p.killed).toBe(2);
    expect(d.events).toHaveLength(1);
    expect(d.events[0]!.status).toBe("killed");
  });

  it("ignores batches it already applied", () => {
    const base = fromSnapshot(snap());
    const d = applyBatches(base, [batch(9, [{ kind: "event", event: ev() }])]);
    expect(d.events).toHaveLength(0);
  });

  it("caps the feed at the maximum size", () => {
    const changes = Array.from({ length: MAX_EVENTS + 40 }, (_, i) => ({ kind: "event" as const, event: ev({ ts: NOW - i }) }));
    const d = applyBatches(fromSnapshot(snap()), [batch(11, changes)]);
    expect(d.events).toHaveLength(MAX_EVENTS);
    expect(d.events[0]!.ts).toBe(NOW);
  });

  it("upserts attackers and keeps them sorted by risk", () => {
    const base = fromSnapshot(snap({ attackers: [attacker({ ip: "1.1.1.1", risk: 40 })] }));
    const d = applyBatches(base, [batch(11, [{ kind: "attacker", attacker: attacker({ ip: "2.2.2.2", risk: 80 }) }, { kind: "attacker", attacker: attacker({ ip: "1.1.1.1", risk: 95 }) }])]);
    expect(d.attackers.map((a) => [a.ip, a.risk])).toEqual([["1.1.1.1", 95], ["2.2.2.2", 80]]);
  });

  it("stores reports and block changes", () => {
    const base = fromSnapshot(snap({ attackers: [attacker()] }));
    const d = applyBatches(base, [batch(11, [{ kind: "report", report: { ip: "203.0.113.42", summary: "x", generatedAt: NOW, model: "m" } }, { kind: "block", ip: "203.0.113.42", blocked: true }])]);
    expect(d.reports["203.0.113.42"]?.summary).toBe("x");
    expect(d.attackers[0]!.blocked).toBe(true);
    expect(setBlocked(d, "203.0.113.42", false).attackers[0]!.blocked).toBe(false);
  });
});

describe("advanceSeries", () => {
  it("fills empty buckets up to now and drops buckets outside the range", () => {
    const s = advanceSeries([{ t: T - 2 * 60 * B, received: 5, killed: 5 }, { t: T - B, received: 1, killed: 0 }], NOW + 2 * B, "1h", B);
    expect(s[s.length - 1]!.t).toBe(T + 2 * B);
    expect(s.find((p) => p.t === T - 2 * 60 * B)).toBeUndefined();
    expect(s.find((p) => p.t === T - B)!.received).toBe(1);
    expect(s).toHaveLength(60);
  });
});

describe("event updates for events the client does not hold", () => {
  it("counts a kill but never a receive when prev says it was published before", () => {
    const d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: ev({ status: "killed" }), prev: "analyzing" }])]);
    expect(at(d)).toEqual({ t: T, received: 1, killed: 2 });
  });

  it("changes nothing when the earlier state was already killed", () => {
    const d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: ev({ status: "killed" }), prev: "killed" }])]);
    expect(at(d)).toEqual({ t: T, received: 1, killed: 1 });
  });

  it("ignores an update whose bucket is outside the window", () => {
    const old = ev({ ts: NOW - 3 * 60 * B, status: "killed" });
    const d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: old, prev: "analyzing" }])]);
    expect(d.series.reduce((n, p) => n + p.killed, 0)).toBe(3);
    expect(d.series.reduce((n, p) => n + p.received, 0)).toBe(3);
  });

  it("still counts a change without prev as a new attack", () => {
    const d = applyBatches(fromSnapshot(snap()), [batch(11, [{ kind: "event", event: ev({ status: "active" }) }])]);
    expect(at(d)).toEqual({ t: T, received: 2, killed: 1 });
  });
});

describe("epochs", () => {
  it("asks for a reload when a batch comes from another Sentinel process", () => {
    const d = fromSnapshot(snap());
    expect(isStaleEpoch(d, "E1")).toBe(false);
    expect(isStaleEpoch(d, "E2")).toBe(true);
    const r = partitionBatches(d, [batch(11, []), batch(12, [], "E2")]);
    expect(r.reload).toBe(true);
    expect(r.apply.map((b) => b.seq)).toEqual([11]);
    expect(partitionBatches(d, [batch(11, [])]).reload).toBe(false);
  });

  it("never applies a batch from another epoch", () => {
    const d = applyBatches(fromSnapshot(snap()), [batch(99, [{ kind: "event", event: ev() }], "E2")]);
    expect(d.events).toHaveLength(0);
    expect(d.seq).toBe(10);
  });
});

describe("attackers", () => {
  it("drops attackers whose last attack left the range window", () => {
    const base = fromSnapshot(snap({ attackers: [attacker({ ip: "1.1.1.1", lastSeen: NOW - 10 * B }), attacker({ ip: "2.2.2.2", lastSeen: NOW - 59 * B })] }));
    expect(base.attackers).toHaveLength(2);
    const later = pruneAttackers(base, NOW + 5 * B);
    expect(later.attackers.map((a) => a.ip)).toEqual(["1.1.1.1"]);
    expect(pruneAttackers(later, NOW + 5 * B)).toBe(later);
  });

  it("applies 10k attacker updates in one frame quickly", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => attacker({ ip: `10.0.${i >> 8}.${i & 255}`, risk: i % 100 }));
    const base = fromSnapshot(snap({ attackers: many }));
    const changes = many.map((a) => ({ kind: "attacker" as const, attacker: { ...a, risk: 99 - a.risk } }));
    const t0 = performance.now();
    const d = applyBatches(base, [batch(11, changes)]);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(d.attackers).toHaveLength(10_000);
    expect(d.attackers[0]!.risk).toBe(99);
  });
});

describe("optimistic blocks", () => {
  it("keeps the pending block over stream updates until the server confirms", () => {
    const base = fromSnapshot(snap({ attackers: [attacker()] }));
    const streamed = applyBatches(base, [batch(11, [{ kind: "attacker", attacker: attacker({ events: 2 }) }])]);
    expect(streamed.attackers[0]!.blocked).toBe(false);
    const shown = withBlockOverrides(streamed, { "203.0.113.42": true });
    expect(shown.attackers[0]).toMatchObject({ blocked: true, events: 2 });
    expect(withBlockOverrides(shown, {})).toBe(shown);
    expect(confirmedBlocks([batch(12, [{ kind: "block", ip: "203.0.113.42", blocked: true }])]).get("203.0.113.42")).toBe(true);
  });
});

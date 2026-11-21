import { describe, expect, it } from "vitest";
import type { AttackEvent, Attacker, Snapshot, StreamBatch } from "@sentinel/contracts";
import { MAX_EVENTS, advanceSeries, applyBatches, bucketOf, fromSnapshot, setBlocked } from "../src/dashboard/store";

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
  return { range: "1h", now: NOW, bucketMs: B, series: [{ t: T - B, received: 2, killed: 2 }, { t: T, received: 1, killed: 1 }], events: [], attackers: [], seq: 10, ...p };
}
const batch = (seq: number, changes: StreamBatch["changes"]): StreamBatch => ({ seq, now: NOW, changes });

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

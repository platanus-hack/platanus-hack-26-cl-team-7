import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DeceptionBatch, MAX_TRACK_ACTIONS, PageQuery, RANGE_MS, type DeceptionEvent, type StreamChange } from "@sentinel/contracts";
import fixture from "../../../packages/contracts/test/fixtures/deception-batch.json" with { type: "json" };
import { Bus } from "../src/bus.ts";
import { CursorError, DeceptionStore } from "../src/deception.ts";
import { SCHEMA_VERSION } from "../src/schema.ts";
import { Store } from "../src/store.ts";
import { T0, TRACK, dec } from "./helpers.ts";

function open(now = () => T0 + 10, db = new DatabaseSync(":memory:")) {
  const bus = new Bus(1);
  const changes: StreamChange[] = [];
  bus.subscribe((f) => changes.push(...f.changes));
  return { db, bus, changes, store: new DeceptionStore(db, bus, { now }) };
}

const q = (p: Record<string, string> = {}) => PageQuery.parse(p);
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("deception store: ingest", () => {
  it("accepts the batch Python writes and projects tracks, actions and findings", () => {
    const { store } = open();
    const batch = DeceptionBatch.parse(fixture.batch);
    expect(store.ingest(batch)).toEqual({ ok: true, accepted: 5, duplicates: 0 });
    const d = store.track(TRACK)!;
    expect(d.track).toMatchObject({ ip: "203.0.113.7", rule: "R3", actions: 1, findings: 1, openedAt: 1763700000000, lastSeen: 1763700000003 });
    expect(d.track.keys.map((k) => k.kind)).toEqual(["ip_ua", "ip", "twin_born", "ip"]);
    expect(d.actions[0]).toMatchObject({ method: "POST", path: "/login", status: 401, responseBody: expect.stringContaining("🔒") });
    expect(d.findings[0]).toMatchObject({ findingId: "fnd_fedcba9876543210", kind: "auth_flip", proposal: null });
  });

  it("counts a retry with the same body as a duplicate, even inside one batch", () => {
    const { store, db } = open();
    const a = dec.action();
    expect(store.ingest([a, a])).toEqual({ ok: true, accepted: 1, duplicates: 1 });
    // Key order on the wire does not change the hash: the parsed event is hashed.
    const reordered = DeceptionBatch.parse([Object.fromEntries(Object.entries(a).reverse())]);
    expect(store.ingest(reordered)).toEqual({ ok: true, accepted: 0, duplicates: 1 });
    expect(count(db, "deception_events")).toBe(1);
    expect(store.track(TRACK)).toBeNull(); // not opened yet
  });

  it("rolls the whole batch back when an eventId comes again with another body", () => {
    const { store, db, bus, changes } = open();
    const first = dec.action();
    store.ingest([dec.opened(), first]);
    bus.flush();
    changes.length = 0;
    const out = store.ingest([dec.action({ eventId: "track.action:new-one" }), { ...first, status: 200 } as DeceptionEvent]);
    expect(out).toEqual({ ok: false, reusedEventId: first.eventId });
    expect(count(db, "deception_events")).toBe(2);
    expect(store.track(TRACK)!.track.actions).toBe(1);
    expect(db.isTransaction).toBe(false);
    bus.flush();
    expect(changes).toEqual([]);
  });

  it("stores nothing from a batch when a write fails part way through", () => {
    const { store, db } = open();
    db.exec(`CREATE TRIGGER fail_one BEFORE INSERT ON deception_events WHEN NEW.event_id = 'track.action:boom'
      BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    expect(() => store.ingest([dec.opened(), dec.action(), dec.action({ eventId: "track.action:boom" })])).toThrow(/disk full/);
    expect(count(db, "deception_events")).toBe(0);
    expect(count(db, "tracks")).toBe(0);
    expect(db.isTransaction).toBe(false);
  });

  it("builds the same track whatever order the events arrive in", () => {
    const events = [dec.action(), dec.linked(), dec.opened({ ts: T0 + 1 }), dec.opened({ ts: T0, ip: "198.51.100.9" }), dec.finding()];
    const a = open().store;
    const b = open().store;
    a.ingest(events);
    for (const e of [...events].reverse()) b.ingest([e]);
    const strip = (s: DeceptionStore) => ({ ...s.track(TRACK)!.track, keys: new Set(s.track(TRACK)!.track.keys.map((k) => k.value)) });
    expect(strip(a)).toEqual(strip(b));
    expect(a.track(TRACK)!.track).toMatchObject({ ip: "198.51.100.9", openedAt: T0, actions: 1, findings: 1 });
  });

  it("counts a finding once when a second event confirms the same findingId", () => {
    const { store } = open();
    store.ingest([dec.opened(), dec.finding(), dec.finding()]);
    expect(store.track(TRACK)!.track.findings).toBe(1);
    expect(store.findings(q()).items).toHaveLength(1);
  });

  it("replaces a timestamp far in the future with the server clock", () => {
    const { store } = open(() => T0);
    store.ingest([dec.opened({ ts: T0 + RANGE_MS["24h"] })]);
    expect(store.track(TRACK)!.track.lastSeen).toBe(T0);
  });

  it("keeps the first 64 keys of a track and ignores repeated ones", () => {
    const { store } = open();
    const links = Array.from({ length: 70 }, (_, i) => dec.linked({ key: { kind: "twin_born", value: i.toString(16).padStart(64, "0") } }));
    store.ingest([dec.opened(), ...links, dec.linked({ key: { kind: "twin_born", value: "0".repeat(64) } })]);
    expect(store.track(TRACK)!.track.keys).toHaveLength(64);
  });

  it("publishes each changed track and each new finding after commit", () => {
    const { store, bus, changes } = open();
    store.ingest([dec.opened(), dec.action(), dec.action(), dec.finding(), dec.action({ trackId: "trk_1111111111111111" })]);
    bus.flush();
    expect(changes.map((c) => c.kind)).toEqual(["track", "finding"]);
    expect(changes[0]).toMatchObject({ kind: "track", track: { actions: 2, findings: 1 } });
  });
});

describe("deception store: reads", () => {
  function many(n: number) {
    const s = open(() => T0 + 1000);
    for (let i = 0; i < n; i++) {
      const trackId = `trk_${i.toString(16).padStart(16, "0")}`;
      s.store.ingest([
        dec.opened({ trackId, ts: T0 + i }),
        dec.finding({ trackId, ts: T0 + (i % 3), findingId: `fnd_${i.toString(16).padStart(16, "0")}` }),
      ]);
    }
    return s.store;
  }

  it("sends the requests that led to a finding along with the newest ones, within the cap", () => {
    const { store } = open(() => T0 + 10_000);
    store.ingest([dec.opened()]);
    const acts = Array.from({ length: 300 }, (_, i) => dec.action({ ts: T0 + 10 + i, path: `/p${i}` }));
    for (let i = 0; i < acts.length; i += 50) store.ingest(acts.slice(i, i + 50).filter((_, k) => i + k !== 20));
    // The proving request (#20) started before 30 others that were still running when the finding came.
    acts[20] = dec.action({ eventId: "track.action:req-proof", ts: T0 + 10 + 20, path: "/p20" });
    store.ingest([acts[20]!]);
    store.ingest([dec.finding({ eventId: "finding.confirmed:req-proof:signature_success", ts: T0 + 10 + 50 })]);
    const d = store.track(TRACK)!;
    expect(d.actions).toHaveLength(MAX_TRACK_ACTIONS);
    const paths = d.actions.map((a) => a.path);
    expect(paths[0]).toBe("/p299");
    expect(paths).toContain("/p20"); // the proving request, far older than the newest 200
    expect(paths).toContain("/p9"); // and the 11 requests before it
    expect(paths).not.toContain("/p8");
    expect(paths).not.toContain("/p21");
    const ts = d.actions.map((a) => a.ts);
    expect(ts).toEqual(ts.toSorted((x, y) => y - x));
  });

  it("pages tracks most recently active first without gaps or repeats", () => {
    const store = many(7);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = store.tracks(q({ limit: "3", ...(cursor ? { cursor } : {}) }));
      seen.push(...page.items.map((t) => t.trackId));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen[0]).toBe("trk_0000000000000006");
  });

  it("pages findings newest first, ties broken by id", () => {
    const store = many(5);
    const first = store.findings(q({ limit: "2" }));
    const rest = store.findings(q({ limit: "10", cursor: first.nextCursor! }));
    expect([...first.items, ...rest.items].map((f) => f.ts)).toEqual([T0 + 2, T0 + 1, T0 + 1, T0, T0]);
    expect(rest.nextCursor).toBeNull();
  });

  it("filters by range and refuses a cursor it did not write", () => {
    const { store } = open(() => T0 + RANGE_MS["1h"] + 1);
    store.ingest([dec.opened()]);
    expect(store.tracks(q({ range: "1h" })).items).toHaveLength(0);
    expect(store.tracks(q({ range: "24h" })).items).toHaveLength(1);
    expect(() => store.tracks(q({ cursor: "bm90LWpzb24" }))).toThrow(CursorError);
    expect(() => store.tracks(q({ cursor: Buffer.from('["x",1]').toString("base64url") }))).toThrow(CursorError);
  });

  it("returns the newest 200 actions of a track", () => {
    const { store } = open();
    store.ingest([dec.opened(), ...Array.from({ length: 250 }, (_, i) => dec.action({ ts: T0 + i }))]);
    const d = store.track(TRACK)!;
    expect(d.track.actions).toBe(250);
    expect(d.actions).toHaveLength(200);
    expect(d.actions[0]!.ts).toBe(T0 + 249);
  });
});

describe("deception store: retention and schema", () => {
  it("prunes rows older than 24 h through the main store's pruning", () => {
    let now = T0 + 10;
    const { store, db } = open(() => now);
    const main = new Store(new Bus(1), { now: () => now, retained: [store] });
    store.ingest([dec.opened(), dec.action(), dec.finding(), dec.opened({ trackId: "trk_2222222222222222", ts: T0 + RANGE_MS["1h"] })]);
    now = T0 + RANGE_MS["24h"] + 10;
    main.prune();
    expect(count(db, "deception_events")).toBe(1);
    expect(count(db, "findings")).toBe(0);
    expect(store.track(TRACK)).toBeNull();
    expect(store.track("trk_2222222222222222")).not.toBeNull();
    main.close();
  });

  it("keeps the rows of a version 2 database and adds the deception tables", () => {
    const db = new DatabaseSync(":memory:");
    new Store(new Bus(1), { db }).block("192.0.2.1");
    // What a version 2 database looks like: the attack tables and no deception tables.
    db.exec("DROP TABLE deception_events; DROP TABLE tracks; DROP TABLE findings; PRAGMA user_version = 2;");
    open(undefined, db).store.ingest([dec.opened()]);
    expect((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION);
    expect(new Store(new Bus(1), { db }).blocks().map((b) => b.ip)).toEqual(["192.0.2.1"]);
    expect(count(db, "tracks")).toBe(1);
  });

  it("survives a restart with the same rows and idempotency", () => {
    const first = open();
    const a = dec.action();
    first.store.ingest([dec.opened(), a]);
    const again = open(undefined, first.db).store;
    expect(again.ingest([a])).toEqual({ ok: true, accepted: 0, duplicates: 1 });
    expect(again.track(TRACK)!.track.actions).toBe(1);
  });
});

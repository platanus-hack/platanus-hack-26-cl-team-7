import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPORT_LIMITS, RequestRow, ToolResult } from "@sentinel/contracts";
import { buildScope } from "../src/reports/scope.ts";
import { accessLogSource, engineSource, sentinelSource, StoreDownError } from "../src/reports/sources.ts";
import { GetRequestInput, QueryEventsInput, getAttacker, getRequest, queryEvents } from "../src/reports/tools.ts";
import { ev } from "./helpers.ts";
import {
  ACC, ENG, INJECTION, IP, MIN, NOW, OTHER_IP, SCOPE, cleanupTemp, iso, makeSources, newStore, seedStore, tempDir, writeAccessLog, writeVerdictsDb,
} from "./reports-helpers.ts";

afterEach(cleanupTemp);

/** Tool inputs come from a model, so tests pass shapes the types would not allow. */
const qInput = (v: Record<string, unknown>) => v as unknown as Parameters<typeof queryEvents>[2];
const rInput = (v: Record<string, unknown>) => v as unknown as Parameters<typeof getRequest>[2];

function fixture(down: ("acc" | "eng")[] = []) {
  const { store } = newStore();
  const ids = seedStore(store);
  return { store, ids, sources: makeSources(store, down) };
}

describe("buildScope", () => {
  it("pads the attacker's first and last request and uses ISO UTC", () => {
    const { store } = fixture();
    expect(buildScope(store, IP)).toEqual(SCOPE);
  });

  it("returns null for an unknown IP", () => {
    const { store } = fixture();
    expect(buildScope(store, "192.0.2.200")).toBeNull();
  });
});

describe("sentinelSource", () => {
  it("lists this IP's events oldest first as RequestRows", () => {
    const { store, ids } = fixture();
    const rows = sentinelSource(store).list(SCOPE);
    expect(rows.map((r) => r.id)).toEqual([ids.sqli1, ids.sqli2, ids.xss, ids.clean]);
    for (const r of rows) expect(RequestRow.parse(r)).toEqual(r);
    expect(rows[2]).toEqual({ id: ids.xss, ts: iso(NOW - 18.5 * MIN), method: "POST", path: "/api/comments", payload: INJECTION, attack_type: "xss", http_status: null, blocked: true });
    expect(rows[3]).toMatchObject({ attack_type: "unknown", http_status: null, blocked: false });
  });

  it("maps an analyzing event to blocked null", () => {
    const { store } = newStore({ aiVerdicts: true });
    store.ingest([ev({ ts: NOW - 19 * MIN, path: "/api/orders/42" })]);
    expect(sentinelSource(store).list(SCOPE)[0]!.blocked).toBeNull();
  });

  it("cuts payloads to the payload limit", () => {
    const { store } = newStore();
    store.ingest([ev({ ts: NOW - 19 * MIN, method: "POST", path: "/v1/assistant", payload: "x".repeat(500) })]);
    expect(sentinelSource(store).list(SCOPE)[0]!.payload).toHaveLength(REPORT_LIMITS.payloadChars);
  });

  it("gets any event by id with its IP, and null for an unknown id", () => {
    const { store, ids } = fixture();
    const src = sentinelSource(store);
    expect(src.get(ids.other)).toMatchObject({ ip: OTHER_IP, row: { id: ids.other, attack_type: "path_traversal" } });
    expect(src.get("sen:nope")).toBeNull();
  });
});

describe("accessLogSource", () => {
  const source = () => accessLogSource(writeAccessLog(tempDir()));

  it("maps an access line: client_ip wins, path without query, query as payload, epoch seconds to ISO", () => {
    expect(source().list(SCOPE)[0]).toEqual({
      id: "acc:1", ts: iso(ACC.line1Ts), method: "GET", path: "/api/users", payload: "id=1%20UNION%20SELECT%20name,pass%20FROM%20users",
      attack_type: null, http_status: 500, blocked: null,
    });
  });

  it("falls back to remote_ip and cuts the query to the payload limit", () => {
    const r = source().get("acc:6")!;
    expect(r.ip).toBe(IP);
    expect(r.row).toMatchObject({ ts: iso(ACC.line6Ts), path: "/search", http_status: 200 });
    expect(r.row.payload).toBe(ACC.longQuery.slice(0, REPORT_LIMITS.payloadChars));
  });

  it("lists only this IP's lines inside the window, by 1-based line number", () => {
    expect(source().list(SCOPE).map((r) => r.id)).toEqual(["acc:1", "acc:6"]);
  });

  it("excludes another IP's lines but still resolves them with their IP", () => {
    expect(source().get("acc:4")?.ip).toBe(OTHER_IP);
  });

  it("excludes this IP's lines outside the window", () => {
    const src = source();
    expect(src.list(SCOPE).some((r) => r.id === "acc:5")).toBe(false);
    expect(src.get("acc:5")).toMatchObject({ ip: IP, row: { ts: iso(ACC.line5Ts), http_status: 404 } });
  });

  it("skips non-access logger lines and malformed JSON", () => {
    const src = source();
    expect(src.get("acc:2")).toBeNull();
    expect(src.get("acc:3")).toBeNull();
  });

  it("throws StoreDownError for a missing file or no path", () => {
    expect(() => accessLogSource(join(tempDir(), "missing.log")).list(SCOPE)).toThrow(StoreDownError);
    expect(() => accessLogSource(undefined).list(SCOPE)).toThrow(StoreDownError);
  });
});

describe("engineSource", () => {
  it("maps a verdict: payload ts to ISO, payload text '<rule>: <reason>', other fields null", () => {
    expect(engineSource(writeVerdictsDb(tempDir())).list(SCOPE)).toEqual([
      { id: "eng:1", ts: iso(ENG.row1Ts), method: null, path: null, payload: "R3: critical flag: union select", attack_type: null, http_status: null, blocked: null },
    ]);
  });

  it("resolves other IPs and out-of-window verdicts with their IP", () => {
    const src = engineSource(writeVerdictsDb(tempDir()));
    expect(src.get("eng:2")?.ip).toBe(OTHER_IP);
    expect(src.get("eng:3")?.ip).toBe(IP);
    expect(src.get("eng:99")).toBeNull();
  });

  it("cuts the payload text to the payload limit", () => {
    const db = writeVerdictsDb(tempDir(), [{ ip: IP, tsMs: NOW - 19 * MIN, reason: "y".repeat(400) }]);
    expect(engineSource(db).get("eng:4")!.row.payload).toHaveLength(REPORT_LIMITS.payloadChars);
  });

  it("throws StoreDownError for a missing db and does not create it", () => {
    const path = join(tempDir(), "missing.db");
    expect(() => engineSource(path).list(SCOPE)).toThrow(StoreDownError);
    expect(existsSync(path)).toBe(false);
    expect(() => engineSource(undefined).list(SCOPE)).toThrow(StoreDownError);
  });
});

describe("report tools", () => {
  it("returns envelopes that pass the ToolResult schema, errors included", () => {
    const { sources, ids } = fixture(["acc"]);
    const results = [
      getAttacker(sources, SCOPE),
      queryEvents(sources, SCOPE, qInput({ store: "all" })),
      queryEvents(sources, SCOPE, qInput({ store: "sen", group_by: ["attack_type", "path"] })),
      queryEvents(sources, SCOPE, qInput({ store: "acc" })),
      queryEvents(sources, SCOPE, qInput({ store: "sen", limit: 51 })),
      getRequest(sources, SCOPE, rInput({ id: ids.xss })),
      getRequest(sources, SCOPE, rInput({ id: ids.other })),
    ];
    for (const r of results) expect(ToolResult.parse(r)).toEqual(r);
  });

  it("echoes the locked scope and the store", () => {
    const { sources } = fixture();
    expect(queryEvents(sources, SCOPE, qInput({ store: "acc" })).scope).toEqual({ ...SCOPE, store: "acc" });
  });

  it("counts total before the limit and marks truncation at 50 rows", () => {
    const { store } = newStore();
    store.ingest(Array.from({ length: 60 }, (_, i) => ev({ ts: NOW - 20 * MIN + i * 1000, path: `/api/items/${i}` })));
    const sources = makeSources(store, ["acc", "eng"]);
    const scope = buildScope(store, IP)!;
    const max = queryEvents(sources, scope, qInput({ store: "sen", limit: 50 }));
    expect(max).toMatchObject({ total: 60, returned: 50, truncated: true, error: null });
    expect(max.rows).toHaveLength(50);
    expect(queryEvents(sources, scope, qInput({ store: "sen" }))).toMatchObject({ total: 60, returned: 20, truncated: true });
    expect(queryEvents(sources, scope, qInput({ store: "sen", path_contains: "/api/items/5" }))).toMatchObject({ total: 11, returned: 11, truncated: false });
  });

  it("filters by attack type and counts groups", () => {
    const { sources } = fixture();
    expect(queryEvents(sources, SCOPE, qInput({ store: "sen", attack_type: "sql_injection" })).total).toBe(2);
    const grouped = queryEvents(sources, SCOPE, qInput({ store: "sen", group_by: ["attack_type"] }));
    expect(grouped.rows).toEqual(expect.arrayContaining([{ attack_type: "sql_injection", count: 2 }, { attack_type: "xss", count: 1 }, { attack_type: "unknown", count: 1 }]));
    expect(grouped.rows).toHaveLength(3);
  });

  it("get_attacker returns grouped counts only, never raw requests", () => {
    const { sources } = fixture();
    const r = getAttacker(sources, SCOPE);
    expect(r.error).toBeNull();
    expect(r.rows).toEqual(expect.arrayContaining([
      { group: "attack_type", key: "sql_injection", count: 2 },
      { group: "store", key: "sen", count: 4 },
      { group: "store", key: "acc", count: 2 },
      { group: "store", key: "eng", count: 1 },
    ]));
    for (const g of r.rows) expect(Object.keys(g).sort()).toEqual(["count", "group", "key"]);
  });

  it("query_events on all stores skips a down store, keeps the rows and adds a hint", () => {
    const { sources, ids } = fixture(["acc"]);
    const r = queryEvents(sources, SCOPE, qInput({ store: "all" }));
    expect(r.rows.map((x) => x.id)).toEqual(expect.arrayContaining([ids.sqli1, "eng:1"]));
    expect(r.error?.code).toBe("STORE_DOWN");
    expect(r.error?.hint).toMatch(/acc|access/i);
  });

  it("returns STORE_DOWN for a single down store", () => {
    const { sources } = fixture(["acc"]);
    expect(queryEvents(sources, SCOPE, qInput({ store: "acc" }))).toMatchObject({ rows: [], error: { code: "STORE_DOWN" } });
    expect(getRequest(sources, SCOPE, rInput({ id: "acc:1" })).error?.code).toBe("STORE_DOWN");
  });

  it("returns BAD_INPUT with a hint for limit 51 and a bad id", () => {
    const { sources } = fixture();
    for (const r of [queryEvents(sources, SCOPE, qInput({ store: "sen", limit: 51 })), getRequest(sources, SCOPE, rInput({ id: "../etc/passwd" }))]) {
      expect(r).toMatchObject({ total: 0, returned: 0, rows: [], error: { code: "BAD_INPUT" } });
      expect(r.error!.hint.length).toBeGreaterThan(0);
    }
  });

  it("get_request returns the one row in scope", () => {
    const { sources, ids } = fixture();
    const r = getRequest(sources, SCOPE, rInput({ id: ids.xss }));
    expect(r).toMatchObject({ total: 1, returned: 1, truncated: false, error: null });
    expect(r.rows[0]).toMatchObject({ id: ids.xss, payload: INJECTION });
  });

  it("answers another IP's id exactly like an unknown id", () => {
    const { sources, ids } = fixture();
    const foreign = getRequest(sources, SCOPE, rInput({ id: ids.other }));
    const unknown = getRequest(sources, SCOPE, rInput({ id: "sen:doesnotexist" }));
    expect(foreign.error?.code).toBe("NOT_FOUND");
    expect(foreign).toEqual(unknown);
  });

  it("returns OUT_OF_WINDOW for this IP's id outside the window", () => {
    const { sources } = fixture();
    expect(getRequest(sources, SCOPE, rInput({ id: "acc:5" }))).toMatchObject({ rows: [], error: { code: "OUT_OF_WINDOW" } });
  });
});

describe("scope lock", () => {
  it("has no ip key in any input schema", () => {
    expect(Object.keys(QueryEventsInput.shape)).not.toContain("ip");
    expect(Object.keys(GetRequestInput.shape)).not.toContain("ip");
  });

  it("ignores an ip passed in the input", () => {
    const { sources, ids } = fixture();
    const r = queryEvents(sources, SCOPE, qInput({ store: "all", ip: OTHER_IP }));
    expect(r.scope.ip).toBe(IP);
    const got = r.rows.map((x) => x.id);
    for (const foreign of [ids.other, "acc:4", "eng:2"]) expect(got).not.toContain(foreign);
  });
});

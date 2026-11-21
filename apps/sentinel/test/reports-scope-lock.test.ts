import { afterEach, describe, expect, it } from "vitest";
import { ToolResult } from "@sentinel/contracts";
import { scopedLookup } from "../src/reports/scope.ts";
import { createReportTools, getRequest, queryEvents } from "../src/reports/tools.ts";
import { INJECTION, IP, OTHER_IP, SCOPE, cleanupTemp, makeSources, newStore, seedStore } from "./reports-helpers.ts";

afterEach(cleanupTemp);

/** The runtime passes a context; these tools read none of it. */
const ctx = {} as never;

function fixture() {
  const { store } = newStore();
  const ids = seedStore(store);
  const sources = makeSources(store);
  return { ids, sources, tools: createReportTools(sources, SCOPE) };
}

describe("scopedLookup", () => {
  it("resolves the exact id of a row in scope", () => {
    const { sources, ids } = fixture();
    const lookup = scopedLookup(sources, SCOPE);
    for (const id of [ids.sqli1, "acc:1", "eng:1"]) expect(lookup(id)?.id).toBe(id);
  });

  it("rejects zero-padded aliases of an id", () => {
    const { sources } = fixture();
    const lookup = scopedLookup(sources, SCOPE);
    expect(lookup("acc:1")).not.toBeNull();
    expect(lookup("acc:001")).toBeNull();
    expect(lookup("eng:01")).toBeNull();
  });

  it("rejects another IP's row and a row outside the window", () => {
    const { sources, ids } = fixture();
    const lookup = scopedLookup(sources, SCOPE);
    expect([ids.other, "acc:4", "eng:2", "acc:5", "eng:3"].map((id) => lookup(id))).toEqual([null, null, null, null, null]);
  });

  it("answers a zero-padded id like an unknown id in get_request", () => {
    const { sources } = fixture();
    const alias = getRequest(sources, SCOPE, { id: "acc:001" });
    expect(alias.error?.code).toBe("NOT_FOUND");
    expect(alias).toEqual(getRequest(sources, SCOPE, { id: "acc:900" }));
  });
});

describe("scope lock through the Mastra tools", () => {
  it("ignores an ip in the input of query_events", async () => {
    const { sources, tools, ids } = fixture();
    const out = await tools.query_events.execute!({ store: "all", ip: OTHER_IP } as never, ctx);
    const result = ToolResult.parse(out);
    expect(result.scope.ip).toBe(IP);
    expect(result).toEqual(queryEvents(sources, SCOPE, { store: "all" }));
    const got = result.rows.map((r) => r.id);
    expect(got).toEqual(expect.arrayContaining([ids.sqli1, "acc:1", "eng:1"]));
    for (const foreign of [ids.other, "acc:4", "eng:2"]) expect(got).not.toContain(foreign);
  });

  it("answers another IP's id from get_request like an unknown id", async () => {
    const { tools, ids } = fixture();
    const foreign = await tools.get_request.execute!({ id: ids.other }, ctx);
    const unknown = await tools.get_request.execute!({ id: "sen:doesnotexist" }, ctx);
    expect(ToolResult.parse(foreign).error?.code).toBe("NOT_FOUND");
    expect(foreign).toEqual(unknown);
  });

  it("shows the model attacker text only in untrusted_ columns, quoted and with < escaped", async () => {
    const { tools } = fixture();
    const out = await tools.query_events.execute!({ store: "sen", limit: 20 }, ctx);
    const shown = tools.query_events.toModelOutput!(out as never) as { type: string; value: string };
    expect(shown.type).toBe("text");
    const [, columns] = shown.value.split("\n");
    expect(columns!.split(" | ")).toEqual(["id", "ts", "untrusted_method", "untrusted_path", "untrusted_payload", "attack_type", "http_status", "blocked"]);
    expect(shown.value).toContain("\\u003cscript>alert(1)\\u003c/script>");
    expect(shown.value).not.toContain("<");
    expect(INJECTION).toContain("<");
  });

  it("names the key column of get_attacker untrusted_key, since it holds paths", async () => {
    const { tools } = fixture();
    const out = await tools.get_attacker.execute!({}, ctx);
    const shown = tools.get_attacker.toModelOutput!(out as never) as { value: string };
    expect(shown.value.split("\n")[1]).toBe("group | untrusted_key | count");
    expect(shown.value).toContain('path | "/api/users" |');
  });
});

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  AttackType,
  EvidenceId,
  LOG_STORE_LABEL,
  LOG_STORES,
  LogStore,
  REPORT_LIMITS,
  ToolResult,
  type ReportScope,
  type RequestRow,
  type ToolErrorCode,
} from "@sentinel/contracts";
import { listAll, storeOf } from "./scope.ts";
import { inWindow, StoreDownError, type LogSources } from "./sources.ts";

/** No `ip` field in any input: the scope comes from code, never from the model. */
export const QueryEventsInput = z.object({
  store: z.union([LogStore, z.literal("all")]).describe("sen = Sentinel events, acc = access log, eng = engine verdicts, all = the three together"),
  attack_type: AttackType.optional(),
  http_status: z.number().int().optional().describe("Only the access log has a status"),
  path_contains: z.string().max(100).optional().describe("Case-insensitive text inside the request path"),
  group_by: z.array(z.enum(["attack_type", "path", "http_status"])).max(2).optional().describe("Count requests per group instead of listing them"),
  limit: z.number().int().min(1).max(REPORT_LIMITS.requests).default(20),
});
export const GetRequestInput = z.object({ id: EvidenceId.describe("An id from query_events, such as sen:abc, acc:12 or eng:7") });

type Row = ToolResult["rows"][number];
type StoreName = ToolResult["scope"]["store"];

function envelope(scope: ReportScope, store: StoreName, total: number, rows: Row[], error: ToolResult["error"] = null): ToolResult {
  return { scope: { ...scope, store }, total, returned: rows.length, truncated: total > rows.length, rows, error };
}

const fail = (scope: ReportScope, store: StoreName, code: ToolErrorCode, hint: string) => envelope(scope, store, 0, [], { code, hint });

function downHint(down: LogStore[]): string {
  const names = down.map((s) => `${s} (${LOG_STORE_LABEL[s]})`).join(", ");
  return `Store ${names} could not be read. Treat it as a gap and continue with the other stores.`;
}

const countBy = <T>(items: T[], key: (item: T) => string | null): [string, number][] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k !== null) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
};

/** Grouped counts for the whole scope. Never a raw request. */
export function getAttacker(sources: LogSources, scope: ReportScope): ToolResult {
  const { rows, down } = listAll(sources, scope);
  const paths = countBy(rows, (r) => r.path);
  const groups: Row[] = [];
  const add = (group: string, counts: [string, number][]) => counts.forEach(([key, count]) => groups.push({ group, key, count }));
  add("attack_type", countBy(rows, (r) => r.attack_type));
  add("path", paths.slice(0, 10));
  add("http_status", countBy(rows, (r) => (r.http_status === null ? null : String(r.http_status))));
  add("store", LOG_STORES.filter((s) => !down.includes(s)).map((s): [string, number] => [s, rows.filter((r) => storeOf(r.id) === s).length]));
  const hidden = Math.max(0, paths.length - 10);
  return envelope(scope, "all", groups.length + hidden, groups, down.length ? { code: "STORE_DOWN", hint: downHint(down) } : null);
}

export function queryEvents(sources: LogSources, scope: ReportScope, input: unknown): ToolResult {
  const parsed = QueryEventsInput.safeParse(input);
  if (!parsed.success) {
    const raw = typeof input === "object" && input !== null ? (input as { store?: unknown }).store : undefined;
    const store = raw === "all" || LOG_STORES.find((s) => s === raw) ? (raw as StoreName) : "all";
    return fail(scope, store, "BAD_INPUT", `Use store sen, acc, eng or all; limit 1 to ${REPORT_LIMITS.requests}; group_by with at most 2 of attack_type, path, http_status.`);
  }
  const q = parsed.data;
  let found: RequestRow[];
  let down: LogStore[] = [];
  if (q.store === "all") ({ rows: found, down } = listAll(sources, scope));
  else {
    try {
      found = sources[q.store].list(scope);
    } catch (err) {
      if (!(err instanceof StoreDownError)) throw err;
      return fail(scope, q.store, "STORE_DOWN", downHint([q.store]));
    }
  }
  const needle = q.path_contains?.toLowerCase();
  const matched = found.filter(
    (r) =>
      (!q.attack_type || r.attack_type === q.attack_type) &&
      (q.http_status === undefined || r.http_status === q.http_status) &&
      (!needle || (r.path ?? "").toLowerCase().includes(needle)),
  );
  const keys = [...new Set(q.group_by ?? [])];
  let rows: Row[] = matched;
  if (keys.length) {
    const groups = new Map<string, Row>();
    for (const r of matched) {
      const group: Row = Object.fromEntries(keys.map((k) => [k, r[k]]));
      const id = JSON.stringify(group);
      const seen = groups.get(id);
      groups.set(id, { ...group, count: Number(seen?.count ?? 0) + 1 });
    }
    rows = [...groups.values()].sort((a, b) => Number(b.count) - Number(a.count));
  }
  const out = envelope(scope, q.store, rows.length, rows.slice(0, q.limit));
  return down.length ? { ...out, error: { code: "STORE_DOWN", hint: downHint(down) } } : out;
}

export function getRequest(sources: LogSources, scope: ReportScope, input: unknown): ToolResult {
  const parsed = GetRequestInput.safeParse(input);
  if (!parsed.success) return fail(scope, "all", "BAD_INPUT", "Pass id as sen:<id>, acc:<line> or eng:<id>, taken from query_events.");
  const { id } = parsed.data;
  const store = storeOf(id);
  let found: ReturnType<LogSources[LogStore]["get"]> = null;
  try {
    if (store) found = sources[store].get(id);
  } catch (err) {
    if (!(err instanceof StoreDownError) || !store) throw err;
    return fail(scope, store, "STORE_DOWN", downHint([store]));
  }
  // Another IP's id answers like an unknown id, so the tool never confirms that it exists.
  // `acc:007` reads line 7 but is not that row's id; only the exact id is an answer.
  if (!found || found.ip !== scope.ip || found.row.id !== id) return fail(scope, store ?? "all", "NOT_FOUND", "No request with this id for this attacker. List ids with query_events.");
  if (!inWindow(found.row.ts, scope)) return fail(scope, store ?? "all", "OUT_OF_WINDOW", "This request is outside the investigation window. Query inside the window.");
  return envelope(scope, store ?? "all", 1, [found.row]);
}

/* ---------------------------- model-facing text --------------------------- */

/** Columns that hold attacker-controlled text. Every prompt shows them as quoted data under an `untrusted_` name. */
export const UNTRUSTED_COLUMNS: ReadonlySet<string> = new Set(["path", "payload", "method", "key"]);
/** The name a column has in a prompt: `untrusted_<column>` when attacker-controlled, else unchanged. */
export const promptColumn = (column: string): string => (UNTRUSTED_COLUMNS.has(column) ? `untrusted_${column}` : column);
const MARKER_BYTES = 64;

const quote = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/\|/g, "\\u007c");
const byteLength = (s: string) => Buffer.byteLength(s, "utf8");

/** One header line and a pipe table, at most REPORT_LIMITS.resultBytes bytes. */
export function toModelText(result: ToolResult): string {
  const { scope, total, returned, truncated, rows, error } = result;
  const header =
    `scope ip=${scope.ip} from=${scope.from} to=${scope.to} store=${scope.store} total=${total} returned=${returned} truncated=${truncated}` +
    (error ? ` error=${error.code} hint=${JSON.stringify(error.hint)}` : "");
  if (rows.length === 0) return header;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        const v = r[c] ?? null;
        return v === null ? "" : UNTRUSTED_COLUMNS.has(c) ? quote(String(v)) : String(v);
      })
      .join(" | "),
  );
  const head = [header, columns.map(promptColumn).join(" | ")];
  const limit = REPORT_LIMITS.resultBytes;
  const size = (ls: string[]) => byteLength(ls.join("\n"));
  if (size([...head, ...lines]) <= limit) return [...head, ...lines].join("\n");
  const kept: string[] = [];
  let used = size(head);
  for (const line of lines) {
    if (used + 1 + byteLength(line) + MARKER_BYTES > limit) break;
    kept.push(line);
    used += 1 + byteLength(line);
  }
  return [...head, ...kept, `TRUNCATED: ${lines.length - kept.length} more rows dropped to fit ${limit} bytes.`].join("\n");
}

/* ------------------------------ Mastra tools ------------------------------ */

const asText = (output: ToolResult) => ({ type: "text" as const, value: toModelText(output) });

/** The three read tools, locked to one scope. The model cannot widen it. */
export function createReportTools(sources: LogSources, scope: ReportScope) {
  return {
    get_attacker: createTool({
      id: "get_attacker",
      description: "Counts for the attacker under investigation: requests per attack type, top paths, HTTP statuses and log store. Start here. Returns no raw requests.",
      inputSchema: z.object({}),
      outputSchema: ToolResult,
      execute: async () => getAttacker(sources, scope),
      toModelOutput: asText,
    }),
    query_events: createTool({
      id: "query_events",
      description: "List or count this attacker's requests in one store or all three. Use group_by for counts. At most 50 rows; check total and truncated.",
      inputSchema: QueryEventsInput,
      outputSchema: ToolResult,
      execute: async (input) => queryEvents(sources, scope, input),
      toModelOutput: asText,
    }),
    get_request: createTool({
      id: "get_request",
      description: "Read one request by id. Use it to confirm the exact request and status behind a fact before you cite it.",
      inputSchema: GetRequestInput,
      outputSchema: ToolResult,
      execute: async (input) => getRequest(sources, scope, input),
      toModelOutput: asText,
    }),
  };
}

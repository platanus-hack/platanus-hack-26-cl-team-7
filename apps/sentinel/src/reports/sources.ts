import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { REPORT_LIMITS, type AttackEvent, type EvidenceId, type LogStore, type ReportScope, type RequestRow } from "@sentinel/contracts";
import type { Store } from "../store.ts";

/** A log store that cannot be read right now: file missing, no path configured, unreadable. */
export class StoreDownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoreDownError";
  }
}

/** One log store seen as RequestRows. Rows of other IPs stay out of `list`; `get` still names their IP. */
export interface LogSource {
  store: LogStore;
  /** Every row of `scope.ip` inside the window, oldest first. Throws StoreDownError. */
  list(scope: ReportScope): RequestRow[];
  /** Any row by id with the IP it belongs to, or null. Throws StoreDownError. */
  get(id: EvidenceId): { row: RequestRow; ip: string } | null;
}
export type LogSources = Record<LogStore, LogSource>;

/** Cuts attacker text to the payload limit without leaving half a surrogate pair. */
export function cut(text: string): string {
  const end = REPORT_LIMITS.payloadChars;
  if (text.length <= end) return text;
  const last = text.charCodeAt(end - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? end - 1 : end);
}

export function inWindow(ts: string, scope: ReportScope): boolean {
  const t = Date.parse(ts);
  return t >= Date.parse(scope.from) && t <= Date.parse(scope.to);
}

/** Stable sort key: ISO UTC strings of equal width order like the times they hold. */
export function byTime(a: RequestRow, b: RequestRow): number {
  return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idOf = (store: LogStore, id: EvidenceId): string | null => (id.startsWith(`${store}:`) ? id.slice(store.length + 1) : null);

/** A time in ms that Date can print, or null. */
function isoOf(ms: number): string | null {
  return Number.isFinite(ms) && Math.abs(ms) <= 8.64e15 ? new Date(ms).toISOString() : null;
}

/* ----------------------- Reaper events (sen) ----------------------- */

export function sentinelSource(store: Store): LogSource {
  const toRow = (e: AttackEvent): RequestRow => ({
    id: `sen:${e.id}`,
    ts: new Date(e.ts).toISOString(),
    method: e.method,
    path: e.path,
    payload: cut(e.payload),
    attack_type: e.attackType,
    http_status: null,
    blocked: e.status === "killed" ? true : e.status === "active" ? false : null,
  });
  return {
    store: "sen",
    list(scope) {
      const rows = store.events("24h", { filter: (e) => e.ip === scope.ip }).map(toRow).filter((r) => inWindow(r.ts, scope));
      return rows.sort(byTime);
    },
    get(id) {
      const eventId = idOf("sen", id);
      const e = eventId === null ? null : store.event(eventId);
      return e ? { row: toRow(e), ip: e.ip } : null;
    },
  };
}

/* ------------------------ Caddy access log (acc) ----------------------- */

interface AccessLine {
  ip: string;
  row: RequestRow;
}

/** Caddy v2 JSON access line, or null for any other line. `ts` is epoch seconds as a float. */
function parseAccessLine(raw: string, line: number): AccessLine | null {
  if (!raw.startsWith("{")) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(o) || typeof o.logger !== "string" || !o.logger.startsWith("http.log.access") || !isRecord(o.request)) return null;
  const req = o.request;
  const ip = text(req.client_ip) ?? text(req.remote_ip);
  const ts = typeof o.ts === "number" ? isoOf(Math.round(o.ts * 1000)) : null;
  if (!ip || !ts) return null;
  const uri = typeof req.uri === "string" ? req.uri : "";
  const q = uri.indexOf("?");
  const query = q < 0 ? "" : uri.slice(q + 1);
  return {
    ip,
    row: {
      // Line numbers restart when the log rotates, so an `acc:` ID saved in an old report may name another row later.
      id: `acc:${line}`,
      ts,
      method: text(req.method),
      path: text(q < 0 ? uri : uri.slice(0, q)),
      payload: query ? cut(query) : null,
      attack_type: null,
      http_status: typeof o.status === "number" && Number.isInteger(o.status) ? o.status : null,
      blocked: null,
    },
  };
}

/** What has been read of the access log. `offset` is the byte after the last newline read; `lines` counts every line up to it. */
interface AccessState {
  ino: number;
  offset: number;
  lines: number;
  rows: AccessLine[];
  byLine: Map<number, AccessLine>;
}

/** Reads bytes `[from, to)` of a file. May return fewer when the file shrank meanwhile. */
function readRange(path: string, from: number, to: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(to - from);
    let got = 0;
    while (got < buf.length) {
      const n = readSync(fd, buf, got, buf.length - got, from + got);
      if (n === 0) break;
      got += n;
    }
    return buf.subarray(0, got);
  } finally {
    closeSync(fd);
  }
}

export function accessLogSource(path: string | undefined): LogSource {
  let state: AccessState | null = null;
  /**
   * The parsed log. A call reads only the bytes added since the last one and parses only whole lines.
   * The log starts over when it shrank or its inode changed. Line numbers count every line, parsed or not.
   * A last line without its newline is shown when it already parses and is kept for good once the newline arrives.
   */
  const load = (): { rows: AccessLine[]; line: (n: number) => AccessLine | undefined } => {
    if (!path) throw new StoreDownError("No access log path is configured.");
    try {
      const st = statSync(path);
      if (!state || st.ino !== state.ino || st.size < state.offset) state = { ino: st.ino, offset: 0, lines: 0, rows: [], byLine: new Map() };
      const s = state;
      let tail: AccessLine | null = null;
      let tailLine = 0;
      if (st.size > s.offset) {
        const chunk = readRange(path, s.offset, st.size);
        const end = chunk.lastIndexOf(0x0a) + 1;
        if (end > 0) {
          const raws = chunk.toString("utf8", 0, end).split("\n");
          raws.pop();
          raws.forEach((raw, i) => {
            const parsed = parseAccessLine(raw, s.lines + i + 1);
            if (!parsed) return;
            s.rows.push(parsed);
            s.byLine.set(s.lines + i + 1, parsed);
          });
          s.lines += raws.length;
          s.offset += end;
        }
        tailLine = s.lines + 1;
        if (end < chunk.length) tail = parseAccessLine(chunk.toString("utf8", end), tailLine);
      }
      return { rows: tail ? [...s.rows, tail] : s.rows, line: (n) => (tail && n === tailLine ? tail : s.byLine.get(n)) };
    } catch {
      throw new StoreDownError("The access log file cannot be read.");
    }
  };
  return {
    store: "acc",
    list: (scope) =>
      load()
        .rows.filter((l) => l.ip === scope.ip && inWindow(l.row.ts, scope))
        .map((l) => l.row)
        .sort(byTime),
    get(id) {
      const n = idOf("acc", id);
      const found = n !== null && /^\d+$/.test(n) ? load().line(Number(n)) : undefined;
      return found ? { row: found.row, ip: found.ip } : null;
    },
  };
}

/* ------------------- agent-detection verdicts (eng) -------------------- */

interface VerdictRow {
  id: number;
  received_at: number;
  payload: string;
}

function parseVerdict(r: VerdictRow): { row: RequestRow; ip: string } | null {
  let p: unknown;
  try {
    p = JSON.parse(r.payload);
  } catch {
    return null;
  }
  if (!isRecord(p)) return null;
  const ip = text(p.ip);
  const ts = isoOf(Math.round((typeof p.ts === "number" ? p.ts : r.received_at) * 1000));
  if (!ip || !ts) return null;
  const detail = `${String(p.rule ?? "")}: ${String(p.reason ?? "")}`;
  return {
    ip,
    row: { id: `eng:${r.id}`, ts, method: null, path: null, payload: cut(detail), attack_type: null, http_status: null, blocked: null },
  };
}

export function engineSource(dbPath: string | undefined): LogSource {
  /** Opens the db read-only for one query. The engine's dashboard owns the file and may be writing. */
  const query = <T>(run: (db: DatabaseSync) => T): T => {
    if (!dbPath || !existsSync(dbPath)) throw new StoreDownError("The engine verdicts database was not found.");
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1000 });
      try {
        return run(db);
      } finally {
        db.close();
      }
    } catch {
      throw new StoreDownError("The engine verdicts database cannot be read.");
    }
  };
  return {
    store: "eng",
    list: (scope) =>
      query((db) => db.prepare("SELECT id, received_at, payload FROM verdicts WHERE json_extract(payload, '$.ip') = ? ORDER BY id").all(scope.ip) as unknown as VerdictRow[])
        .map(parseVerdict)
        .flatMap((v) => (v && v.ip === scope.ip && inWindow(v.row.ts, scope) ? [v.row] : []))
        .sort(byTime),
    get(id) {
      const n = idOf("eng", id);
      if (n === null || !/^\d+$/.test(n)) return null;
      const r = query((db) => db.prepare("SELECT id, received_at, payload FROM verdicts WHERE id = ?").get(Number(n)) as unknown as VerdictRow | undefined);
      return r ? parseVerdict(r) : null;
    },
  };
}

import { LOG_STORES, REPORT_LIMITS, type EvidenceId, type LogStore, type ReportScope, type RequestRow } from "@sentinel/contracts";
import type { Store } from "../store.ts";
import { byTime, inWindow, StoreDownError, type LogSources } from "./sources.ts";

/** The attacker's first and last request, padded. Null when Sentinel has not seen the IP. */
export function buildScope(store: Store, ip: string): ReportScope | null {
  const a = store.attacker(ip);
  if (!a) return null;
  const iso = (ms: number) => new Date(ms).toISOString();
  return { ip, from: iso(a.firstSeen - REPORT_LIMITS.windowPadMs), to: iso(a.lastSeen + REPORT_LIMITS.windowPadMs) };
}

/** The store a valid evidence ID points to. */
export function storeOf(id: string): LogStore | null {
  const prefix = id.split(":")[0];
  return LOG_STORES.find((s) => s === prefix) ?? null;
}

/** Rows of the scope from every store that answers, oldest first, and the stores that do not. */
export function listAll(sources: LogSources, scope: ReportScope): { rows: RequestRow[]; down: LogStore[] } {
  const rows: RequestRow[] = [];
  const down: LogStore[] = [];
  for (const store of LOG_STORES) {
    try {
      rows.push(...sources[store].list(scope));
    } catch (err) {
      if (!(err instanceof StoreDownError)) throw err;
      down.push(store);
    }
  }
  return { rows: rows.sort(byTime), down };
}

/** Resolves an evidence ID to its row only when it belongs to the scope's IP and window. */
export function scopedLookup(sources: LogSources, scope: ReportScope): (id: EvidenceId) => RequestRow | null {
  return (id) => {
    const store = storeOf(id);
    if (!store) return null;
    try {
      const found = sources[store].get(id);
      // The id must be the row's own: a zero-padded alias such as `acc:007` reads line 7 but names no row.
      return found && found.row.id === id && found.ip === scope.ip && inWindow(found.row.ts, scope) ? found.row : null;
    } catch (err) {
      if (err instanceof StoreDownError) return null;
      throw err;
    }
  };
}

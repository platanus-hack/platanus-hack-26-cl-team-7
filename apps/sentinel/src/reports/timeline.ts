import type { CaseFile, RequestRow, TimelinePoint } from "@sentinel/contracts";

/** The timeline holds at most this many points. Rows the case file cites always stay. */
export const MAX_TIMELINE_POINTS = 500;

/** One point per row. `damage` is true only when the verdict is exploited and the case file lists the row in `exploitEvidence`. A row that a fact cites is not damage by that alone. */
export function buildTimeline(rows: RequestRow[], caseFile: CaseFile | null): TimelinePoint[] {
  const exploited = new Set(caseFile?.verdict === "exploited" ? caseFile.exploitEvidence : []);
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    attack_type: r.attack_type,
    http_status: r.http_status,
    blocked: r.blocked,
    damage: exploited.has(r.id),
  }));
}

/** Keeps every cited row and spreads the rest evenly when the attacker made more requests than the cap. */
export function capRows(rows: RequestRow[], keep: Iterable<string>): RequestRow[] {
  if (rows.length <= MAX_TIMELINE_POINTS) return rows;
  const must = new Set(keep);
  const others = rows.filter((r) => !must.has(r.id));
  const room = Math.max(0, MAX_TIMELINE_POINTS - (rows.length - others.length));
  const stride = Math.max(1, Math.ceil(others.length / Math.max(1, room)));
  const sampled = new Set(others.filter((_, i) => i % stride === 0).slice(0, room).map((r) => r.id));
  return rows.filter((r) => must.has(r.id) || sampled.has(r.id));
}

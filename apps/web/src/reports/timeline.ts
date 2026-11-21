/** Pure geometry for the attack timeline. The component only draws what this returns. */
import type { TimelinePoint } from "@sentinel/contracts";

export type Tone = "damage" | "blocked" | "ok" | "error" | "unknown";

export interface Mark {
  id: string;
  x: number;
  tone: Tone;
}

/** Damage first, then blocked, then the HTTP class. No status is unknown. */
export function toneOf(p: Pick<TimelinePoint, "damage" | "blocked" | "http_status">): Tone {
  if (p.damage) return "damage";
  if (p.blocked === true) return "blocked";
  const status = p.http_status;
  if (status !== null) {
    if (status >= 400) return "error";
    if (status >= 200 && status < 400) return "ok";
  }
  return "unknown";
}

/**
 * One mark per point, oldest first, x spread over [0, width] in proportion to time.
 * One point, or points that share a time, sit at width / 2.
 */
export function timelineMarks(points: TimelinePoint[], width: number): Mark[] {
  if (points.length === 0) return [];
  const times = points.map((p) => Date.parse(p.ts));
  const finite = times.filter(Number.isFinite);
  const t0 = finite.length ? Math.min(...finite) : 0;
  const t1 = finite.length ? Math.max(...finite) : 0;
  const span = t1 - t0;
  return points
    .map((p, i) => ({ p, t: Number.isFinite(times[i]) ? times[i]! : t0 }))
    .sort((a, b) => a.t - b.t)
    .map(({ p, t }) => ({ id: p.id, x: span > 0 ? ((t - t0) / span) * width : width / 2, tone: toneOf(p) }));
}

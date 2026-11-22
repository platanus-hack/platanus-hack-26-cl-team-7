import type { Attacker, AttackerReport, AttackEvent, EventStatus, SeriesPoint } from "./monitor.ts";
import type { Finding, Track } from "./deception.ts";

/** A frame carries at most this many events; the rest is counted in a "counts" change. */
export const MAX_EVENTS_PER_FRAME = 500;

/**
 * GET /v1/stream sends `event: ready` with `{ epoch, seq }`, then `event: batch`
 * with ids `${epoch}-${seq}`. `event: reset` means the client missed more than the
 * server kept (or the server restarted): reload the snapshot and reconnect.
 * The server coalesces changes into one "batch" message per 100 ms frame.
 */
export type StreamChange =
  /**
   * `prev` is set when this updates an event published earlier (for example
   * analyzing → killed). Without `prev` the event is new: count it as received.
   */
  | { kind: "event"; event: AttackEvent; prev?: EventStatus }
  /** Chart counts for events left out of a busy frame. `t` is a 10 s bucket start; add the deltas. */
  | { kind: "counts"; buckets: SeriesPoint[] }
  | { kind: "attacker"; attacker: Attacker }
  | { kind: "report"; report: AttackerReport }
  | { kind: "block"; ip: string; blocked: boolean }
  /** A deception track opened or changed (new action, link or finding count). */
  | { kind: "track"; track: Track }
  /** A finding was confirmed, or its fix proposal arrived. */
  | { kind: "finding"; finding: Finding };

export interface StreamBatch {
  epoch: string;
  seq: number;
  now: number;
  changes: StreamChange[];
}

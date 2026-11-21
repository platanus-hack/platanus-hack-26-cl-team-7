/**
 * What the top of the screen says. Interface: `caughtInRange`, `statusSentence`,
 * `defaultAgent`, `emptyState`, `hasGatewayFeed`, `visibleTab`. Pure, so the words are tested.
 */
import { RANGE_MS, type Range, type Track } from "@sentinel/contracts";
import type { LiveData } from "../dashboard/store";

export const RANGE_WORDS: Record<Range, string> = { "5m": "in the last 5 minutes", "1h": "in the last hour", "24h": "in the last 24 hours" };

/** Caught agents active in the range, most recently active first (the order of the store). */
export function caughtInRange(tracks: Track[], now: number, range: Range): Track[] {
  const from = now - RANGE_MS[range];
  return tracks.filter((t) => t.lastSeen >= from);
}

/**
 * The agent selected when nothing is: the most recently active one that reached the decoy
 * or proved something, so the screen does not open on an empty line. Else the newest one.
 */
export function defaultAgent(tracks: Track[]): string | null {
  return (tracks.find((t) => t.actions > 0 || t.findings > 0) ?? tracks[0])?.trackId ?? null;
}

export interface StatusSentence {
  /** Who we caught. */
  lead: string;
  /** Whether real data stayed safe. Null when nobody was caught. */
  safe: string | null;
}

/**
 * "2 agents caught in the last hour. After each catch, none of their requests reached the real shop."
 * The second part is true by design: after the catch, every request of a caught agent runs on the decoy.
 * When some of the listed agents were caught before the range, the lead says they were active in it instead.
 */
export function statusSentence(inRange: Track[], now: number, range: Range): StatusSentence {
  const n = inRange.length;
  const words = RANGE_WORDS[range];
  if (n === 0) return { lead: `No agent caught ${words}.`, safe: null };
  const from = now - RANGE_MS[range];
  const allCaughtInRange = inRange.every((t) => t.openedAt >= from);
  const who = n === 1 ? "1 agent" : `${n} agents`;
  const lead = allCaughtInRange ? `${who} caught ${words}.` : `${n === 1 ? "1 caught agent" : `${n} caught agents`} active ${words}.`;
  const safe = n === 1 ? "After the catch, none of its requests reached the real shop." : "After each catch, none of their requests reached the real shop.";
  return { lead, safe };
}

/**
 * The empty screen says what it will show and how to see it. The status line above already
 * says nobody was caught; `earlier` counts agents active in the last 24 hours, outside the range.
 */
export function emptyState(range: Range, earlier: number): { title: string; body: string; widen: string | null } {
  return {
    title: "Send a scanner at the shop and it shows here within 2 seconds.",
    body: "Each caught agent gets a row with who it is and why it was caught. Next to it: its requests to the decoy copy of the shop, what it proved there, and the fix.",
    widen: range !== "24h" && earlier > 0 ? `Show ${earlier === 1 ? "the agent" : `the ${earlier} agents`} caught in the last 24 hours` : null,
  };
}

/** The older gateway feed has data: any attack event, attacker or counted request in the range. */
export function hasGatewayFeed(data: Pick<LiveData, "events" | "attackers" | "series">): boolean {
  return data.events.length > 0 || data.attackers.length > 0 || data.series.some((p) => p.received > 0);
}

export type Tab = "caught" | "gateway";

/** The gateway tab shows only when its feed has data; without it, the caught agents screen is the only one. */
export const visibleTab = (chosen: Tab, gatewayHasData: boolean): Tab => (gatewayHasData ? chosen : "caught");

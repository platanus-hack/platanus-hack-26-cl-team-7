/**
 * The caught agents in the selected range. Interface: `useCaught()`.
 * The store holds 24 h of caught agents; the range switch only filters them here,
 * against a clock that ticks every few seconds so agents leave the range without a reload.
 */
import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../dashboard/store";
import { useMirror } from "../mirror/store";
import { caughtInRange } from "./summary";

const TICK_MS = 5000;

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function useCaught() {
  const range = useDashboard((s) => s.data.range);
  const tracks = useMirror((s) => s.data.tracks);
  const loading = useMirror((s) => s.loading);
  const now = useNow();
  // A track streamed in after the last tick counts as in range: its lastSeen can be a little ahead of `now`.
  const list = useMemo(() => caughtInRange(tracks, now, range), [tracks, now, range]);
  return { list, now, range, loading: loading && tracks.length === 0 };
}

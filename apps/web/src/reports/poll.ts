/** The polling loop for a report that an agent is still working on. Plain functions, no React. */
import type { Report, ReportStatus } from "@sentinel/contracts";

export const POLL_MS = 1000;
/** Failed polls in a row before the loop gives up and reports the error. */
export const MAX_POLL_FAILURES = 5;

/** The agents are still working: the view polls and the decision bar waits. */
export const isRunning = (status: ReportStatus) => status === "investigating" || status === "revising";

/**
 * Calls `load` every `POLL_MS`, each call after the last one finished. Stops by itself when the status
 * settles or after `MAX_POLL_FAILURES` failures in a row. The returned function stops it for good:
 * an answer that arrives later is dropped.
 */
export function pollReport(opts: {
  load: (signal: AbortSignal) => Promise<Report>;
  onReport: (report: Report) => void;
  onGiveUp: (error: unknown) => void;
}): () => void {
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;

  const tick = async () => {
    try {
      const next = await opts.load(ctrl.signal);
      if (ctrl.signal.aborted) return;
      failures = 0;
      opts.onReport(next);
      if (!isRunning(next.status)) return;
    } catch (e) {
      if (ctrl.signal.aborted) return;
      if (++failures >= MAX_POLL_FAILURES) return opts.onGiveUp(e);
    }
    timer = setTimeout(() => void tick(), POLL_MS);
  };

  timer = setTimeout(() => void tick(), POLL_MS);
  return () => {
    ctrl.abort();
    clearTimeout(timer);
  };
}

/**
 * Loads the report for one attacker, polls it while an agent works, and sends decisions.
 * Newest report for the IP if there is one, else a new one. Polling stops when the status
 * settles and when the view closes.
 */
import { useCallback, useEffect, useState } from "react";
import type { DecisionRequest, Report } from "@sentinel/contracts";
import { ApiRequestError, createReport, decideReport, getReport, listReports } from "../sentinel";
import { isRunning, pollReport } from "./poll";

export type ReportState =
  | { phase: "loading" }
  | { phase: "ready"; report: Report }
  | { phase: "disabled" }
  | { phase: "error"; message: string };

export function errorText(e: unknown): string {
  if (e instanceof ApiRequestError) return e.message;
  return e instanceof Error && e.name !== "AbortError" ? e.message : "Sentinel did not answer. Try again.";
}

/** Maps a failed request to a view state. AI off is a notice, not an error. */
function failure(e: unknown): ReportState {
  return e instanceof ApiRequestError && e.code === "AI_DISABLED" ? { phase: "disabled" } : { phase: "error", message: errorText(e) };
}

const LIMIT_NOTICE = "Revision limit reached. This is a new report.";

/** The newest report for this IP (the server lists newest first), or a new one if there is none. */
async function newestReport(ip: string, signal?: AbortSignal): Promise<Report> {
  const [newest] = await listReports(ip, signal);
  return newest ? getReport(newest.id, signal) : createReport(ip, signal);
}

export function useReport(ip: string) {
  const [state, setState] = useState<ReportState>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const report = state.phase === "ready" ? state.report : null;
  const reportId = report?.id ?? null;
  const running = report !== null && isRunning(report.status);

  // Load: the newest report for this IP, or start one.
  useEffect(() => {
    const ctrl = new AbortController();
    setState({ phase: "loading" });
    setDecisionError(null);
    setNotice(null);
    void (async () => {
      try {
        const loaded = await newestReport(ip, ctrl.signal);
        if (!ctrl.signal.aborted) setState({ phase: "ready", report: loaded });
      } catch (e) {
        if (!ctrl.signal.aborted) setState(failure(e));
      }
    })();
    return () => ctrl.abort();
  }, [ip, attempt]);

  // Poll while an agent runs. The loop stops itself when the status settles; the cleanup stops it on close.
  useEffect(() => {
    if (!running || reportId === null) return;
    return pollReport({
      load: (signal) => getReport(reportId, signal),
      onReport: (next) => setState({ phase: "ready", report: next }),
      onGiveUp: (e) => setState(failure(e)),
    });
  }, [running, reportId]);

  /** Swaps the view to the report that `get` returns. `message` is a one-line notice for the reader. */
  const show = useCallback(async (get: () => Promise<Report>, message: string | null) => {
    setState({ phase: "loading" });
    setDecisionError(null);
    setNotice(message);
    try {
      setState({ phase: "ready", report: await get() });
    } catch (e) {
      setState(failure(e));
    }
  }, []);

  /** Starts a report for this IP. The server returns the open one if there is one, so this is safe to repeat. */
  const startNew = useCallback(() => show(() => createReport(ip), null), [ip, show]);

  /** Sends a decision. Returns true when the server took it. A refused request keeps its message for the bar. */
  const decide = useCallback(
    async (body: DecisionRequest): Promise<boolean> => {
      if (reportId === null || deciding) return false;
      setDeciding(true);
      setDecisionError(null);
      try {
        setState({ phase: "ready", report: await decideReport(reportId, body) });
        return true;
      } catch (e) {
        if (e instanceof ApiRequestError && e.code === "REVISION_LIMIT") {
          // A report at the revision limit is no longer open, so the server starts a new one for this IP.
          await show(() => createReport(ip), LIMIT_NOTICE);
        } else {
          setDecisionError(errorText(e));
          // The status may have moved on the server (409): show what is true now.
          if (e instanceof ApiRequestError && e.status === 409) {
            void getReport(reportId)
              .then((fresh) => setState({ phase: "ready", report: fresh }))
              .catch(() => undefined);
          }
        }
        return false;
      } finally {
        setDeciding(false);
      }
    },
    [reportId, deciding, ip, show],
  );

  /** Loads again from the start: the newest report for this IP, or a new one if there is none. */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { state, deciding, decisionError, notice, decide, retry, startNew };
}

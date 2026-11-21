/**
 * The main screen: caught agents on the left, the selected agent's journey on the right.
 * Interface: `<CaughtScreen />` and `<StatusLine />` (the sentence at the top).
 * With nobody caught in the range, it says what it will show and how to see it.
 */
import { useEffect } from "react";
import { useDashboard } from "../dashboard/store";
import { useMirror } from "../mirror/store";
import { Skeleton } from "../ui";
import { AgentList } from "./AgentList";
import { Journey } from "./Journey";
import { caughtInRange, defaultAgent, emptyState, statusSentence } from "./summary";
import { useCaught } from "./useCaught";
import "./caught.css";

export function StatusLine() {
  const { list, now, range, loading } = useCaught();
  if (loading) return <Skeleton w="min(560px, 100%)" h={30} />;
  const s = statusSentence(list, now, range);
  return (
    <p className="status-line" role="status">
      {s.lead}
      {s.safe && <span className="fog"> {s.safe}</span>}
    </p>
  );
}

function EmptyState() {
  const { range, now } = useCaught();
  const tracks = useMirror((s) => s.data.tracks);
  const setRange = useDashboard((s) => s.setRange);
  const e = emptyState(range, caughtInRange(tracks, now, "24h").length);
  return (
    <div className="caught-empty">
      <h2>{e.title}</h2>
      <p>{e.body}</p>
      {e.widen && (
        <button type="button" className="btn" onClick={() => setRange("24h")}>
          {e.widen}
        </button>
      )}
    </div>
  );
}

export function CaughtScreen() {
  const { list, loading } = useCaught();
  const selected = useMirror((s) => s.selected);
  const error = useMirror((s) => s.error);
  const select = useMirror((s) => s.select);
  const inList = list.some((t) => t.trackId === selected);
  const first = defaultAgent(list);

  // The selection follows the range: an agent outside it gives way to the newest active one inside.
  useEffect(() => {
    if (!inList && first) select(first);
  }, [inList, first, select]);

  return (
    <div className="caught">
      {error && (
        <p role="alert" className="caught-error">
          {error}
        </p>
      )}
      {loading ? (
        <div className="caught-grid" aria-busy>
          <div className="agents">
            <Skeleton w="100%" h={84} />
          </div>
          <div className="journey">
            <Skeleton w={240} h={28} />
          </div>
        </div>
      ) : list.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="caught-grid">
          <AgentList agents={list} />
          <Journey />
        </div>
      )}
    </div>
  );
}

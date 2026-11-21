/**
 * The caught agents list. Interface: `<AgentList agents={…} />`.
 * Newest activity first. Each row says who, when it was caught, why, how many requests
 * the decoy answered and how many proofs it gave. Up and down arrows move between rows.
 */
import { memo, useCallback, type KeyboardEvent } from "react";
import type { Track } from "@sentinel/contracts";
import { useMirror } from "../mirror/store";
import { dayClock, num } from "../ui";
import { showJourneyWhenLoaded } from "./Journey";
import { clientWords, whyCaught } from "./plain";

const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

const AgentRow = memo(function AgentRow({ t, selected, onSelect }: { t: Track; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <li>
      <button type="button" className="agent" aria-current={selected || undefined} data-track={t.trackId} onClick={() => onSelect(t.trackId)}>
        <span className="agent-who">
          <span className="agent-ip tnum">{t.ip}</span>
          <span className="fog">{clientWords(t)}</span>
        </span>
        <span className="agent-when small fog tnum">Caught {dayClock(t.openedAt)}</span>
        <span className="agent-why">{whyCaught(t.rule, t.reason)}</span>
        <span className="agent-counts small">
          <span className="fog">{plural(t.actions, "decoy request", "decoy requests")}</span>
          {t.findings > 0 ? (
            <span className="agent-proofs">
              <span className="ml-key ml-key-proof" aria-hidden />
              {plural(t.findings, "proof", "proofs")}
            </span>
          ) : (
            <span className="fog">No proof</span>
          )}
        </span>
      </button>
    </li>
  );
});

function onArrows(e: KeyboardEvent<HTMLUListElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.agent")];
  const i = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (i === -1) return;
  e.preventDefault();
  rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

export function AgentList({ agents }: { agents: Track[] }) {
  const selected = useMirror((s) => s.selected);
  const pick = useMirror((s) => s.select);
  const select = useCallback(
    (id: string) => {
      showJourneyWhenLoaded(id === useMirror.getState().selected);
      pick(id);
    },
    [pick],
  );
  const more = useMirror((s) => s.tracksCursor !== null);
  const loadOlder = useMirror((s) => s.loadOlder);
  return (
    <section className="agents" aria-labelledby="agents-h">
      <h2 id="agents-h" className="agents-h">
        Caught agents <span className="fog tnum">{num(agents.length)}</span>
      </h2>
      <ul onKeyDown={onArrows}>
        {agents.map((t) => (
          <AgentRow key={t.trackId} t={t} selected={t.trackId === selected} onSelect={select} />
        ))}
      </ul>
      {more && (
        <button type="button" className="btn agents-more" onClick={() => void loadOlder()}>
          Load older caught agents
        </button>
      )}
    </section>
  );
}

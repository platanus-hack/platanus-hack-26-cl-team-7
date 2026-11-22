/**
 * Every request of a caught agent that Sentinel sends, newest first, in a fixed-height box that
 * scrolls smoothly. Only the visible rows are in the page (virtualized), so 200 rows cost the same as 10.
 * Interface: `<RequestList actions={detail.actions} answered? />`; `answered` names who answered (default the fake copy).
 * Paths, queries and bodies are attacker controlled; React renders them as text only.
 */
import { memo, useCallback, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { TrackAction } from "@sentinel/contracts";
import { clock, cn } from "../ui";
import { numEs } from "./moments";

const ROW = 44;
const statusClass = (status: number) => (status >= 500 ? "s5" : status >= 400 ? "s4" : status >= 300 ? "s3" : "s2");

const RequestRow = memo(function RequestRow({ a, open, onToggle, answered }: { a: TrackAction; open: boolean; onToggle: (id: string) => void; answered: string }) {
  return (
    <>
      <button type="button" className="rl-row" aria-expanded={open} onClick={() => onToggle(a.eventId)}>
        <span className="mono dim tnum">{clock(a.ts, false)}</span>
        <span className="mono truncate">
          {a.method} {a.query ? `${a.path}?${a.query}` : a.path}
        </span>
        <span className={cn("mstatus mono tnum", statusClass(a.status))}>{a.status}</span>
      </button>
      {open && (
        <div className="rl-bodies">
          <div>
            <div className="cap">Lo que envió</div>
            <pre>{a.requestBody || "(vacío)"}</pre>
          </div>
          <div>
            <div className="cap">{answered}</div>
            <pre>{a.responseBody || "(vacío)"}</pre>
          </div>
        </div>
      )}
    </>
  );
});

export function RequestList({ actions, answered = "Lo que respondió la copia falsa" }: { actions: TrackAction[]; answered?: string }) {
  const box = useRef<HTMLDivElement>(null);
  // Open rows are kept here: a virtualized row unmounts when it scrolls away.
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback(
    (id: string) =>
      setOpenIds((s) => {
        const n = new Set(s);
        if (!n.delete(id)) n.add(id);
        return n;
      }),
    [],
  );
  const v = useVirtualizer({
    count: actions.length,
    getScrollElement: () => box.current,
    estimateSize: () => ROW,
    getItemKey: (i) => actions[i]!.eventId,
    overscan: 8,
  });
  return (
    <section className="rl" aria-label="Solicitudes del agente">
      <h3 className="rl-h">
        Solicitudes <span className="dim tnum">{numEs(actions.length)}</span>
      </h3>
      <div className="rl-box" ref={box}>
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-index={item.index}
              ref={v.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)` }}
            >
              <RequestRow a={actions[item.index]!} open={openIds.has(actions[item.index]!.eventId)} onToggle={toggle} answered={answered} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The decoy request log of one caught agent. Interface: `<RequestLog actions={…} total={…} />`.
 * Newest first, the first rows only until asked for all. The API sends only the newest
 * requests; the footer says how many there are.
 */
import { useState } from "react";
import type { TrackAction } from "@sentinel/contracts";
import { clock, num } from "../ui";
import { requestLine } from "./plain";

/** Rows shown before "Show all", so the proofs and fix stay near the top of a phone screen. */
export const FIRST_ROWS = 25;

export function RequestLog({ actions, total }: { actions: TrackAction[]; total: number }) {
  const [all, setAll] = useState(false);
  const rows = all ? actions : actions.slice(0, FIRST_ROWS);
  return (
    <section className="j-sect" aria-labelledby="log-h">
      <h3 id="log-h">Decoy request log</h3>
      {actions.length === 0 ? (
        <p className="fog">No request reached the decoy yet.</p>
      ) : (
        <table className="log">
          <thead>
            <tr>
              <th scope="col" className="log-time">
                Time
              </th>
              <th scope="col">Request</th>
              <th scope="col" className="log-num">
                Status
              </th>
              <th scope="col" className="log-num">
                Duration
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const line = requestLine(a);
              return (
                <tr key={a.eventId}>
                  <td className="tnum fog">{clock(a.ts)}</td>
                  <td className="mono log-req" title={line}>
                    {line}
                  </td>
                  <td className="log-num tnum">{a.status}</td>
                  <td className="log-num tnum fog">{num(a.durationMs)} ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {rows.length < actions.length && (
        <button type="button" className="btn log-more" onClick={() => setAll(true)}>
          Show all {num(actions.length)} loaded requests
        </button>
      )}
      {total > actions.length && (
        <p className="small fog">
          Sentinel keeps the newest {num(actions.length)} of {num(total)} decoy requests here.
        </p>
      )}
    </section>
  );
}

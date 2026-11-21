/** What the analyst found (facts and gaps) and the log rows behind it. All text is attacker-controlled, so React escapes it. */
import type { CaseFile, RequestRow } from "@sentinel/contracts";
import { EvidenceIds, Section, timeOf } from "./parts";

export function Findings({ caseFile }: { caseFile: CaseFile }) {
  if (caseFile.facts.length === 0 && caseFile.gaps.length === 0) return null;
  return (
    <Section title="What the logs show">
      {caseFile.facts.length > 0 && (
        <ul className="rv-list">
          {caseFile.facts.map((fact, i) => (
            <li key={i}>
              <span>{fact.text}</span>
              <EvidenceIds ids={fact.evidence} />
            </li>
          ))}
        </ul>
      )}
      {caseFile.gaps.length > 0 && (
        <>
          <p className="cap mt-1.5">What the logs cannot show</p>
          <ul className="rv-list">
            {caseFile.gaps.map((gap, i) => (
              <li key={i}>
                <span className="dim">{gap}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/** A table cell that cuts long text with an ellipsis and keeps the full value in the title. */
function Cell({ value, mono }: { value: string | null; mono?: boolean }) {
  if (value === null || value === "") return <td className="dim">-</td>;
  return (
    <td className={mono ? "mono" : undefined} title={value}>
      {value}
    </td>
  );
}

function blockedText(blocked: boolean | null): string | null {
  return blocked === null ? null : blocked ? "Blocked" : "Not blocked";
}

/** The first cell: the ID, with a marker when the analyst cites this row as the request that did the damage. */
function IdCell({ id, exploit }: { id: string; exploit: boolean }) {
  return (
    <td className="mono" title={id}>
      {exploit && (
        <span role="img" aria-label="Exploit evidence" title="Exploit evidence" className="mr-1 text-ember">
          ●
        </span>
      )}
      {id}
    </td>
  );
}

export function EvidenceTable({ rows, exploit }: { rows: RequestRow[]; exploit: readonly string[] }) {
  if (rows.length === 0) return null;
  return (
    <Section title="Evidence">
      <div className="rv-tablewrap">
        <table className="rv-table">
          <colgroup>
            <col style={{ width: 116 }} />
            <col style={{ width: 92 }} />
            <col style={{ width: 60 }} />
            <col style={{ width: "24%" }} />
            <col />
            <col style={{ width: 60 }} />
            <col style={{ width: 116 }} />
          </colgroup>
          <thead className="cap">
            <tr>
              <th>ID</th>
              <th>Time</th>
              <th>Method</th>
              <th>Path</th>
              <th>Payload</th>
              <th>HTTP</th>
              <th>Blocked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <IdCell id={r.id} exploit={exploit.includes(r.id)} />
                <td className="mono tnum" title={r.ts}>
                  {timeOf(r.ts)}
                </td>
                <Cell value={r.method} mono />
                <Cell value={r.path} mono />
                <Cell value={r.payload} mono />
                <Cell value={r.http_status === null ? null : String(r.http_status)} mono />
                <Cell value={blockedText(r.blocked)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

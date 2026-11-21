/** Every revision with the human decision on it. */
import type { Revision, ReportStatus } from "@sentinel/contracts";
import { clock } from "../ui";
import { Chip, Section, tokensText } from "./parts";

function DecisionLine({ revision, waiting }: { revision: Revision; waiting: boolean }) {
  const d = revision.decision;
  if (d?.kind === "approve") return <Chip tone="green">Approved</Chip>;
  if (d?.kind === "refuse") {
    return (
      <>
        <Chip tone="ember">Refused</Chip>
        {d.reason && <span className="wrap-anywhere">{d.reason}</span>}
      </>
    );
  }
  return <Chip>{waiting ? "Waiting for your decision" : "No decision"}</Chip>;
}

export function Revisions({ revisions, status }: { revisions: Revision[]; status: ReportStatus }) {
  if (revisions.length === 0) return null;
  return (
    <Section title="Revisions">
      <ol className="rv-list">
        {revisions.map((r, i) => (
          <li key={r.n}>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-3 text-[13px]">
                <b className="font-medium text-text">Revision {r.n}</b>
                <span className="dim mono" title={r.model}>
                  {clock(r.createdAt, false)} · {tokensText(r.tokens)}
                </span>
              </div>
              <p className="my-1 truncate text-[13.5px]" title={r.hypothesis.fix.change}>
                {r.hypothesis.fix.change}
              </p>
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1.5 text-[13px]">
                <DecisionLine revision={r} waiting={status === "awaiting_decision" && i === revisions.length - 1} />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

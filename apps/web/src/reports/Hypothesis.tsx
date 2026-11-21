/** The engineer's answer: root cause, fix, test request, rejected option. On a revision, also what changed after a refusal. */
import type { ReactNode } from "react";
import type { Hypothesis as HypothesisData, Revision } from "@sentinel/contracts";
import { CONFIDENCE_LABEL, CONFIDENCE_TONE, Chip, EvidenceIds, Section } from "./parts";

/** A label and its value: a `dt` and `dd` pair for the `.facts` grid. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

/** The refusal reason that led to this revision: the decision on the one before it. */
function refusalBefore(revisions: Revision[]): string | null {
  const decision = revisions[revisions.length - 2]?.decision;
  return decision?.kind === "refuse" ? decision.reason : null;
}

function RevisionNotes({ hypothesis, refusal }: { hypothesis: HypothesisData; refusal: string | null }) {
  const { restatedReason, changed, conflicts } = hypothesis;
  if (!refusal && !restatedReason && !changed && conflicts.length === 0) return null;
  return (
    <Section title="What changed" className="rep">
      <dl className="facts">
        {refusal && (
          <Row label="You said">
            <blockquote className="border-l-2 border-ember pl-3 text-text">{refusal}</blockquote>
          </Row>
        )}
        {restatedReason && <Row label="We read it as">{restatedReason}</Row>}
        {changed && <Row label="Now">{changed}</Row>}
      </dl>
      {conflicts.length > 0 && (
        <>
          <div className="cap mt-1.5">Where your reason and the logs disagree</div>
          <ul className="rv-list">
            {conflicts.map((c, i) => (
              <li key={i}>
                <span>
                  <b>{c.claim}</b>
                  <br />
                  {c.note}
                </span>
                <EvidenceIds ids={c.evidence} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

export function HypothesisView({ revisions }: { revisions: Revision[] }) {
  const latest = revisions[revisions.length - 1];
  if (!latest) return null;
  const { rootCause, fix, rejected, confidence } = latest.hypothesis;
  const test = fix.test;
  return (
    <>
      {latest.n >= 2 && <RevisionNotes hypothesis={latest.hypothesis} refusal={refusalBefore(revisions)} />}
      <Section title="Root cause">
        <div className="rv-chips">
          <Chip mono>{rootCause.cwe}</Chip>
          <Chip mono title="OWASP Top 10:2025">
            OWASP {rootCause.owasp}
          </Chip>
          <Chip tone={CONFIDENCE_TONE[confidence]}>{CONFIDENCE_LABEL[confidence]}</Chip>
        </div>
        <p className="text-[15px] text-text">{rootCause.explanation}</p>
        <dl className="facts">
          <Row label="Endpoint">
            <code>{rootCause.endpoint}</code>
          </Row>
          <Row label="Parameter">{rootCause.parameter === null ? <span className="dim">none</span> : <code>{rootCause.parameter}</code>}</Row>
        </dl>
      </Section>
      <Section title="Fix">
        <p className="text-[15px] text-text">{fix.change}</p>
        <dl className="facts">
          <Row label="Where">{fix.where}</Row>
          <Row label="Test request">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line2 bg-canvas px-[11px] py-[9px] font-mono text-[12.5px] text-ash wrap-anywhere">
              {test.method} {test.path}
              {test.payload ? `\n${test.payload}` : ""}
            </pre>
          </Row>
          <Row label="Must happen">{test.expect}</Row>
          <Row label="Rejected">
            {rejected.option}
            <span className="dim"> - {rejected.reason}</span>
          </Row>
        </dl>
      </Section>
    </>
  );
}

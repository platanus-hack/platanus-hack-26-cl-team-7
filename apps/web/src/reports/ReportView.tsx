/**
 * The incident report view. Interface: `<ReportView ip={…} />` (a native modal dialog: the browser traps focus,
 * Escape and the backdrop close it, focus returns to the button that opened it) and `<ReportBody report={…} />`
 * (the report itself, no fetches, no polling). Inside: the load and polling hook, the decision bar, and the parts
 * in this folder.
 */
import { useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import { Sparkles, X } from "lucide-react";
import { REPORT_LIMITS, type CaseFile, type Report } from "@sentinel/contracts";
import { Skeleton, joinDefined } from "../ui";
import { DecisionBar } from "./DecisionBar";
import { EvidenceTable, Findings } from "./Evidence";
import { HypothesisView } from "./Hypothesis";
import { Chip, CONFIDENCE_LABEL, CONFIDENCE_TONE, Section, STATUS_LABEL, VERDICT_LABEL, VERDICT_TONE, tokensText } from "./parts";
import { isRunning } from "./poll";
import { Revisions } from "./Revisions";
import { useReports } from "./store";
import { Timeline } from "./TimelineChart";
import { useReport } from "./useReport";

function VerdictLine({ caseFile }: { caseFile: CaseFile }) {
  return (
    <header>
      <div className="rv-chips">
        <Chip tone={VERDICT_TONE[caseFile.verdict]}>{VERDICT_LABEL[caseFile.verdict]}</Chip>
        <Chip tone={CONFIDENCE_TONE[caseFile.confidence]}>{CONFIDENCE_LABEL[caseFile.confidence]}</Chip>
      </div>
      <p className="mt-2.5 text-[17px] leading-[1.4] text-text">{caseFile.summary}</p>
    </header>
  );
}

/** The whole report as read-only content. Safe to render anywhere: it holds no state. */
export function ReportBody({ report }: { report: Report }) {
  const { caseFile } = report;
  const analyst = joinDefined([report.analystModel, report.analystTokens && tokensText(report.analystTokens)]);
  return (
    <div className="flex flex-col gap-6 pt-[18px]">
      {caseFile && <VerdictLine caseFile={caseFile} />}
      {report.timeline.length > 0 && (
        <Section title="What happened">
          <Timeline points={report.timeline} />
        </Section>
      )}
      {caseFile && <Findings caseFile={caseFile} />}
      <EvidenceTable rows={report.evidence} exploit={caseFile?.exploitEvidence ?? []} />
      <HypothesisView revisions={report.revisions} />
      <Revisions revisions={report.revisions} status={report.status} />
      {analyst && <p className="cap mono">Analyst {analyst}</p>}
    </div>
  );
}

function Progress({ report }: { report: Report }) {
  const text = report.status === "revising" ? "Revising the fix. The engineer is reading your reason." : "Investigating. Reading the logs for this attacker.";
  return (
    <div className="flex flex-col gap-3 pt-[18px]" role="status" aria-busy>
      <p className="text-ash">{text}</p>
      <div className="flex flex-col gap-2">
        <Skeleton w="92%" />
        <Skeleton w="76%" />
        <Skeleton w="48%" />
      </div>
    </div>
  );
}

/** Same notice as the AI report in the attacker panel. */
function AiOff() {
  return (
    <div className="pt-[18px]">
      <div className="rep">
        <div className="t">
          <Sparkles size={12} />
          Incident report
        </div>
        <p className="!text-mid">AI unavailable. Set ANTHROPIC_API_KEY for Sentinel to get reports.</p>
      </div>
    </div>
  );
}

function Notice({ children, action }: { children: ReactNode; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex flex-col items-start gap-3 pt-[18px]">
      <p role="alert" className="err">
        {children}
      </p>
      {action && (
        <button type="button" className="btn-ghost" onClick={action.run}>
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ReportView({ ip }: { ip: string }) {
  const close = useReports((s) => s.close);
  const { state, deciding, decisionError, notice, decide, retry, startNew } = useReport(ip);
  const [refusing, setRefusing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // A modal dialog: the page behind goes inert, Tab stays inside, and closing gives focus back to the button
  // that opened it. Every way out ends in the `close` event, which unmounts the view.
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  // Escape closes the refuse box first; a second Escape closes the view.
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    if (!refusing) return;
    e.preventDefault();
    setRefusing(false);
  };

  const report = state.phase === "ready" ? state.report : null;
  // A different report (new, reloaded, or none while loading) never inherits an open refuse box.
  const reportId = report?.id ?? null;
  useEffect(() => setRefusing(false), [reportId]);
  const decidable = report !== null && report.revisions.length > 0 && report.status !== "failed" && report.status !== "investigating";

  return (
    <dialog
      ref={dialog}
      className="rv"
      aria-labelledby="rv-title"
      onClose={close}
      onCancel={onCancel}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
    >
      <div className="cph">
        <div className="min-w-0 flex-1">
          <b id="rv-title">Incident report</b>
          <small className="mono">{ip}</small>
        </div>
        {report && <Chip tone={report.status === "failed" ? "ember" : report.status === "approved" ? "green" : "blue"}>{STATUS_LABEL[report.status]}</Chip>}
        <button type="button" className="x" aria-label="Close report" onClick={() => dialog.current?.close()}>
          <X size={14} />
        </button>
      </div>
      <div className="scroll" tabIndex={0} aria-label="Report details">
        {state.phase === "loading" && (
          <div className="flex flex-col gap-3 pt-[18px]" role="status" aria-busy aria-label="Loading report">
            <Skeleton w="60%" />
            <Skeleton w="90%" />
            <Skeleton w="40%" />
          </div>
        )}
        {state.phase === "disabled" && <AiOff />}
        {state.phase === "error" && <Notice action={{ label: "Try again", run: retry }}>{state.message}</Notice>}
        {notice && (
          <p role="status" className="cap pt-[18px]">
            {notice}
          </p>
        )}
        {report && isRunning(report.status) && <Progress report={report} />}
        {report?.status === "failed" && (
          <Notice action={{ label: "Start again", run: () => void startNew() }}>{report.error ?? "The investigation failed."}</Notice>
        )}
        {report && <ReportBody report={report} />}
      </div>
      {report && decidable && (
        <DecisionBar
          status={report.status}
          atLimit={report.revisions.length >= REPORT_LIMITS.revisions}
          busy={deciding}
          error={decisionError}
          refusing={refusing}
          setRefusing={setRefusing}
          onApprove={() => decide({ decision: "approve" })}
          onRefuse={(reason) => decide({ decision: "refuse", reason })}
          onStartNew={() => void startNew()}
        />
      )}
    </dialog>
  );
}

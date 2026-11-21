/**
 * The fix for one proof. Interface: `<FixBlock finding={…} />`.
 * The AI proposal as a lead and numbered steps, with a Copy fix button;
 * "Writing a fix…" while it is pending and "AI is off" when Sentinel runs without AI.
 * The screen shows the text in plain words; Copy fix copies it as the AI wrote it.
 */
import { useEffect, useRef, useState } from "react";
import type { Finding } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { proposalState } from "../mirror/store";
import { clock } from "../ui";
import { plainFix, splitFix } from "./plain";

function CopyFix({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="btn"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : "Copy fix"}</span>
    </button>
  );
}

export function FixBlock({ finding }: { finding: Finding }) {
  const aiEnabled = useDashboard((s) => s.health?.ai.enabled ?? null);
  const state = proposalState(finding, aiEnabled);
  const proposal = finding.proposal;
  const fix = proposal ? splitFix(plainFix(proposal.summary)) : null;
  return (
    <div className="fix-block">
      <div className="fix-head">
        <h4>
          <span className="ml-key ml-key-fix" aria-hidden />
          Fix
        </h4>
        {state === "ready" && proposal && <CopyFix text={proposal.summary} />}
      </div>
      {state === "ready" && proposal && fix ? (
        <>
          {fix.lead && <p className="fix-lead">{fix.lead}</p>}
          {fix.steps.length > 0 && (
            <ol className="fix-steps">
              {fix.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          )}
          <p className="small fog tnum">Written by AI at {clock(proposal.generatedAt)}</p>
        </>
      ) : state === "unavailable" ? (
        <p className="fog">AI is off. Set ANTHROPIC_API_KEY for Sentinel to get a fix for each proof.</p>
      ) : state === "failed" ? (
        <p className="fog">The AI could not write a fix. Sentinel tries again when it restarts.</p>
      ) : (
        <p className="fog" role="status">
          Writing a fix…
        </p>
      )}
    </div>
  );
}

/**
 * Approve or refuse the latest fix. Refuse opens a box for the reason; the server may still answer 422 or 409.
 * An approved report, or one at the revision limit, offers a new one. Whether the box is open is the parent's state, so the dialog's
 * Escape can close the box first.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import type { ReportStatus } from "@sentinel/contracts";
import { REASON_MAX_LENGTH, canSubmitRefusal } from "./decision";

const HINT: Record<ReportStatus, string> = {
  investigating: "Working on it.",
  awaiting_decision: "Approve this fix, or tell us why not.",
  revising: "Revising the fix with your reason.",
  approved: "Approved. Start a new report if the attack comes back.",
  failed: "This report failed.",
};

export function DecisionBar({
  status,
  atLimit,
  busy,
  error,
  refusing,
  setRefusing,
  onApprove,
  onRefuse,
  onStartNew,
}: {
  status: ReportStatus;
  /** The latest revision is the last one allowed: Refuse gives way to Start new. */
  atLimit: boolean;
  busy: boolean;
  error: string | null;
  refusing: boolean;
  setRefusing: (open: boolean) => void;
  onApprove: () => Promise<boolean>;
  onRefuse: (reason: string) => Promise<boolean>;
  onStartNew: () => void;
}) {
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const locked = busy || status !== "awaiting_decision";

  useEffect(() => {
    if (refusing) box.current?.focus();
  }, [refusing]);

  const submit = async () => {
    if (locked || !canSubmitRefusal(text)) return;
    if (await onRefuse(text.trim())) {
      setRefusing(false);
      setText("");
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div className="flex flex-col gap-2.5 border-t border-line2 px-6 pb-3.5 pt-3">
      {refusing && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <label htmlFor="rv-reason" className="text-[13px] text-ash">
            Why not? Say what you cannot do.
          </label>
          <div className="pi">
            <textarea
              id="rv-reason"
              ref={box}
              rows={3}
              value={text}
              maxLength={REASON_MAX_LENGTH}
              disabled={busy}
              placeholder="For example: we cannot ship a CSP this week."
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
            />
            <div className="tb gap-2">
              <button type="button" className="btn-ghost" onClick={() => setRefusing(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-ghost warn" disabled={locked || !canSubmitRefusal(text)}>
                Send refusal
              </button>
            </div>
          </div>
        </form>
      )}
      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {!refusing && (
        <div className="flex items-center justify-end gap-2.5">
          <span className="cap mr-auto" role="status">
            {busy ? "Sending…" : HINT[status]}
          </span>
          {status === "approved" ? (
            <button type="button" className="btn-ghost" onClick={onStartNew}>
              Start new
            </button>
          ) : (
            <>
              {atLimit ? (
                <button type="button" className="btn-ghost" disabled={busy} onClick={onStartNew}>
                  Start new
                </button>
              ) : (
                <button type="button" className="btn-ghost" disabled={locked} onClick={() => setRefusing(true)}>
                  Refuse
                </button>
              )}
              <button type="button" className="btn-block" disabled={locked} onClick={() => void onApprove()}>
                <Check size={15} strokeWidth={2.4} />
                Approve
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

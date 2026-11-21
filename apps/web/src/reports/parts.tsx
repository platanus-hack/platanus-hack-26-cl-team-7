/** Small pieces that every part of the report view shares. */
import type { ReactNode } from "react";
import type { Confidence, ReportStatus, ReportVerdict, TokenUsage } from "@sentinel/contracts";
import { clock, cn } from "../ui";

export const VERDICT_LABEL: Record<ReportVerdict, string> = {
  exploited: "Exploited",
  attempt_only: "Attempt only",
  inconclusive: "Inconclusive",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = { low: "Low confidence", medium: "Medium confidence", high: "High confidence" };

export const STATUS_LABEL: Record<ReportStatus, string> = {
  investigating: "Investigating",
  awaiting_decision: "Needs your decision",
  revising: "Revising",
  approved: "Approved",
  failed: "Failed",
};

export type ChipTone = "ember" | "green" | "blue" | "mid";

export function Chip({ tone = "mid", mono, children, title }: { tone?: ChipTone; mono?: boolean; children: ReactNode; title?: string }) {
  return (
    <span className={cn("rv-chip", `t-${tone}`, mono && "mono")} title={title}>
      {children}
    </span>
  );
}

export const VERDICT_TONE: Record<ReportVerdict, ChipTone> = { exploited: "ember", attempt_only: "green", inconclusive: "mid" };
export const CONFIDENCE_TONE: Record<Confidence, ChipTone> = { low: "mid", medium: "blue", high: "blue" };

export function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)} aria-label={title}>
      <h3 className="sec">{title}</h3>
      {children}
    </section>
  );
}

/** Clock time of an ISO timestamp. A value that does not parse shows as it came. */
export function timeOf(iso: string, seconds = true): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? clock(ms, seconds) : iso;
}

/** Token count as the report shows it: "842", "0.7k", "12.5k". */
const tokenCount = (n: number) => (n < 100 ? String(n) : `${(n / 1000).toFixed(1)}k`);

/** "12.5k in · 0.7k out" */
export const tokensText = (t: TokenUsage) => `${tokenCount(t.input)} in · ${tokenCount(t.output)} out`;

/** Evidence IDs as small mono chips. */
export function EvidenceIds({ ids }: { ids: string[] }) {
  return (
    <span className="rv-chips flex-none justify-end">
      {ids.map((id) => (
        <Chip key={id} mono>
          {id}
        </Chip>
      ))}
    </span>
  );
}

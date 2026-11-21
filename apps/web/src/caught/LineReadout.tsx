/**
 * What a mark of the mirror line holds. Interface: `<Readout item={…} />` and `itemLabel(item)`.
 * A single request shows its request line; a bin shows its time span, its count and its
 * newest request line; a proof shows what it proved and the request that proved it.
 * With no marks at all it says that nothing reached the decoy yet.
 */
import { clock, cn, num } from "../ui";
import type { LineItem } from "./line";

const span = (item: LineItem) => {
  const first = item.marks[0]!;
  const last = item.marks[item.marks.length - 1]!;
  return first.ts === last.ts ? clock(first.ts) : `${clock(first.ts)} to ${clock(last.ts)}`;
};

/** The accessible name of a mark, the readout in one sentence. */
export function itemLabel(item: LineItem): string {
  const last = item.marks[item.marks.length - 1]!;
  const answered = last.status !== null ? `, answered ${last.status}` : "";
  if (item.kind !== "request") return `${item.kind === "proof" ? "Proof" : "Fix"} at ${clock(last.ts)}: ${last.title} ${last.text}`;
  if (item.marks.length === 1) return `Decoy request at ${clock(last.ts)}: ${last.text}${answered}`;
  return `${num(item.marks.length)} decoy requests from ${span(item)}, the last ${last.text}${answered}`;
}

export function Readout({ item, empty }: { item: LineItem | undefined; empty: boolean }) {
  if (empty) return <p className="ml-readout ml-hint fog">No request reached the decoy yet.</p>;
  if (!item) return <p className="ml-readout ml-hint fog">Hover or focus a mark to see its requests. Taller bars hold more requests.</p>;
  const last = item.marks[item.marks.length - 1]!;
  const many = item.kind === "request" && item.marks.length > 1;
  return (
    <p className="ml-readout" aria-hidden>
      <span className="ml-readout-lead">
        <span className="tnum fog">{span(item)}</span>
        <span className={cn("ml-key", `ml-key-${item.kind}`)} />
        {many && <span className="fog">{num(item.marks.length)} requests, the last</span>}
        {last.title && <span className="ml-readout-title">{last.title}</span>}
      </span>
      <span className="ml-readout-line">
        <span className="ml-readout-text mono">{last.text}</span>
        {last.status !== null && <span className="tnum fog">{last.status}</span>}
      </span>
    </p>
  );
}

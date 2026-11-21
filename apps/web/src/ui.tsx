/** Shared primitives: class helper, formatters, orb, skeleton, segmented control, status mark. */
import type { CSSProperties } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { EventStatus } from "@sentinel/contracts";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));


export function clock(ts: number, seconds = true): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return seconds ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** A time with its day when it is not today: "12:59", "yesterday 12:59", "19 Nov 12:59". */
export function dayClock(ts: number, now = Date.now(), seconds = false): string {
  const d = new Date(ts);
  const n = new Date(now);
  const start = (offset: number) => new Date(n.getFullYear(), n.getMonth(), n.getDate() - offset).getTime();
  const t = clock(ts, seconds);
  if (ts >= start(0)) return t;
  if (ts >= start(1)) return `yesterday ${t}`;
  return `${d.getDate()} ${d.toLocaleString("en-US", { month: "short" })} ${t}`;
}

const nf = new Intl.NumberFormat("en-US");
export const num = (n: number) => nf.format(n);

export function joinDefined(parts: (string | null | undefined)[], sep = ", "): string | null {
  const v = parts.filter((p): p is string => Boolean(p && p.trim()));
  return v.length ? v.join(sep) : null;
}

/** Renders tool arguments like `range: "1h", by: "fingerprint"`. */
export function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
    .join(", ");
}

export function Orb({ size, state = "talking", className }: { size: number; state?: "idle" | "thinking" | "talking"; className?: string }) {
  return <span aria-hidden className={cn("orb", state !== "talking" && state, className)} style={{ width: size, height: size }} />;
}

export function Skeleton({ w, h = 12, style }: { w: number | string; h?: number; style?: CSSProperties }) {
  return <span className="sk block" style={{ width: w, height: h, ...style }} />;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const LABEL: Record<EventStatus, string> = { killed: "Killed", active: "Active", analyzing: "Analyzing" };

export function Status({ status }: { status: EventStatus }) {
  return (
    <span className={`status ${status}`}>
      <i />
      {LABEL[status]}
    </span>
  );
}


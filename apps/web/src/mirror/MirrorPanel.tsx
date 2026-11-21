/**
 * Sentinel's one screen. Interface: `<MirrorPanel sidebarOverlay={…} />`.
 * Left: the selected caught agent (who, why, what it proved, the fix, its requests).
 * Right: the live list of caught agents.
 * Every string from a track is attacker-controlled; React renders it as text only.
 */
import { memo, useState, type ReactNode } from "react";
import { FileSearch, Sparkles } from "lucide-react";
import type { Finding, FindingKind, Track, TrackAction } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { useReports } from "../reports/store";
import { Skeleton, clock, cn, num } from "../ui";
import { proposalState, useMirror } from "./store";
import "./mirror.css";

const FINDING_LABEL: Record<FindingKind, string> = {
  canary_read: "Read decoy data",
  auth_flip: "Got past login",
  signature_success: "Exploit worked",
};

/** Why the router caught an agent, in plain words. */
export function caughtFor(t: Pick<Track, "rule" | "reason">): string {
  if (t.rule === "R1") return "Probed missing pages";
  if (t.rule === "R2") return "Scanned many pages fast";
  const sig = /critical flag: ([^(]+)/.exec(t.reason)?.[1]?.trim();
  return sig ? `Sent an attack pattern (${sig})` : "Sent an attack pattern";
}

/** Rows shown before "Show all requests". */
const FIRST_ROWS = 25;

const count = (n: number, noun: string) => `${num(n)} ${noun}${n === 1 ? "" : "s"}`;
const statusClass = (status: number) => (status >= 500 ? "s5" : status >= 400 ? "s4" : status >= 300 ? "s3" : "s2");
const preloadReport = () => void import("../reports/ReportView");

function Fix({ f }: { f: Finding }) {
  const aiEnabled = useDashboard((s) => s.health?.ai.enabled ?? null);
  const [full, setFull] = useState(false);
  const state = proposalState(f, aiEnabled);
  return (
    <div className="rep mf-fix">
      <div className="t">
        <Sparkles size={12} />
        Fix
      </div>
      {state === "ready" && f.proposal ? (
        <>
          <p className={cn("whitespace-pre-wrap", !full && "mf-clamp")}>{f.proposal.summary}</p>
          <button type="button" className="mf-open" onClick={() => setFull(!full)}>
            {full ? "Show less" : "Show full fix"}
          </button>
        </>
      ) : state === "unavailable" ? (
        <p className="!text-mid">AI is off. Set ANTHROPIC_API_KEY for Sentinel to get fixes.</p>
      ) : state === "failed" ? (
        <p className="!text-mid">The AI could not write a fix. Sentinel tries again when it restarts.</p>
      ) : (
        <div className="flex flex-col gap-2 pt-1" aria-label="Writing fix">
          <Skeleton w="90%" />
          <Skeleton w="70%" />
        </div>
      )}
    </div>
  );
}

function Proof({ f }: { f: Finding }) {
  return (
    <article className="mf">
      <header>
        <span className="mf-kind">{FINDING_LABEL[f.kind]}</span>
        <span className="mono truncate">{f.endpoint}</span>
        <span className="dim mono tnum ml-auto">{clock(f.ts)}</span>
      </header>
      <p className="mf-ev" title={f.evidence}>
        {f.evidence}
      </p>
      <Fix f={f} />
    </article>
  );
}

const RequestRow = memo(function RequestRow({ a }: { a: TrackAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="trow ma-cols w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mono dim tnum">{clock(a.ts)}</span>
        <span className="mono truncate pr-4">
          {a.method} {a.query ? `${a.path}?${a.query}` : a.path}
        </span>
        <span className={cn("mstatus mono tnum", statusClass(a.status))}>{a.status}</span>
      </button>
      {open && (
        <div className="ma-bodies">
          <div>
            <div className="cap">Request body</div>
            <pre>{a.requestBody || "(empty)"}</pre>
          </div>
          <div>
            <div className="cap">Answer from the decoy</div>
            <pre>{a.responseBody || "(empty)"}</pre>
          </div>
        </div>
      )}
    </>
  );
});

function AgentView() {
  const detail = useMirror((s) => s.detail);
  const selected = useMirror((s) => s.selected);
  const loading = useMirror((s) => s.loading);
  const investigate = useReports((s) => s.open);
  const [all, setAll] = useState(false);
  if (!detail || detail.track.trackId !== selected) {
    return (
      <section className="sect" aria-label="Caught agent">
        <div className="dh">
          {loading || selected ? (
            <Skeleton w={220} h={26} />
          ) : (
            <p className="m-0 text-mid">No agent caught in the last 24 hours. A caught agent shows here within 2 seconds.</p>
          )}
        </div>
      </section>
    );
  }
  const t = detail.track;
  const rows = all ? detail.actions : detail.actions.slice(0, FIRST_ROWS);
  return (
    <section className="sect" aria-label={`Caught agent ${t.ip}`}>
      <div className="dh mv-head">
        <div className="min-w-0">
          <div className="ip">{t.ip}</div>
          <div className="sub">
            {caughtFor(t)}. Caught at {clock(t.openedAt)}.
          </div>
          <div className="sub tnum">
            {count(t.actions, "request")} on the decoy, {count(t.findings, "proof")}.
          </div>
        </div>
        <button type="button" className="ask" onClick={() => investigate(t.ip)} onMouseEnter={preloadReport} onFocus={preloadReport}>
          <FileSearch size={16} />
          Investigate
        </button>
      </div>
      <div className="scroll">
        {detail.findings.length > 0 && (
          <div className="mv-proofs">
            {detail.findings.map((f) => (
              <Proof key={f.findingId} f={f} />
            ))}
          </div>
        )}
        <h3 className="mv-h">Requests on the decoy</h3>
        {rows.map((a) => (
          <RequestRow key={a.eventId} a={a} />
        ))}
        {detail.actions.length === 0 && <p className="px-8 py-6 text-mid">No requests yet.</p>}
        {!all && detail.actions.length > FIRST_ROWS && (
          <button type="button" className="mf-open px-8 py-4" onClick={() => setAll(true)}>
            Show all {num(detail.actions.length)} requests
          </button>
        )}
      </div>
    </section>
  );
}

const AgentRow = memo(function AgentRow({ t, selected, onSelect }: { t: Track; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className="att-row mt-row" onClick={() => onSelect(t.trackId)}>
      <span className="mt-ip">
        <span className={t.findings > 0 ? "dot hot" : "dot"} />
        <span className="mono truncate">{t.ip}</span>
        <span className="mono dim tnum ml-auto">{clock(t.lastSeen, false)}</span>
      </span>
      <span className="mt-why truncate">{caughtFor(t)}</span>
    </button>
  );
});

function Agents() {
  const tracks = useMirror((s) => s.data.tracks);
  const selected = useMirror((s) => s.selected);
  const select = useMirror((s) => s.select);
  const more = useMirror((s) => s.tracksCursor !== null);
  const loadOlder = useMirror((s) => s.loadOlder);
  return (
    <section className="sect" aria-label="Caught agents">
      <div className="hd pb-3">
        <h2>Caught agents</h2>
        <span className="r cap">{num(tracks.length)}</span>
      </div>
      <div className="scroll">
        <div role="listbox" aria-label="Caught agents, most recently active first">
          {tracks.map((t) => (
            <AgentRow key={t.trackId} t={t} selected={t.trackId === selected} onSelect={select} />
          ))}
        </div>
        {more && (
          <button type="button" className="mf-open px-6 py-3" onClick={() => void loadOlder()}>
            Load older agents
          </button>
        )}
      </div>
    </section>
  );
}

/** The main area. `sidebarOverlay` (the copilot) covers the right column. */
export function MirrorPanel({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useMirror((s) => s.error);
  return (
    <main className="main">
      <div className="mirror-left">
        {error && (
          <p role="alert" className="m-0 px-8 py-2 text-sm text-ember">
            {error}
          </p>
        )}
        <AgentView />
      </div>
      <div className="right mirror-right">
        <Agents />
        {sidebarOverlay}
      </div>
    </main>
  );
}

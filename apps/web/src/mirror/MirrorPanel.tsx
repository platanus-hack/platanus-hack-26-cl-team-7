/**
 * The mirror lane view. Interface: `<MirrorPanel sidebarOverlay={…} />`.
 * Left: the selected track (who it is, its findings, its action timeline).
 * Right: live tracks list and every confirmed finding with its fix proposal.
 * Every string from a track is attacker-controlled; React renders it as text only.
 */
import { memo, useState, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import type { Finding, FindingKind, Track, TrackAction } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { Skeleton, clock, cn, num } from "../ui";
import { proposalState, useMirror } from "./store";
import "./mirror.css";

const FINDING_LABEL: Record<FindingKind, string> = {
  canary_read: "Canary read",
  auth_flip: "Auth flip",
  signature_success: "Signature success",
};

const count = (n: number, noun: string) => `${num(n)} ${noun}${n === 1 ? "" : "s"}`;
const statusClass = (status: number) => (status >= 500 ? "s5" : status >= 400 ? "s4" : status >= 300 ? "s3" : "s2");

function Proposal({ f }: { f: Finding }) {
  const aiEnabled = useDashboard((s) => s.health?.ai.enabled ?? null);
  const state = proposalState(f, aiEnabled);
  return (
    <div className="rep mt-3 !mx-0">
      <div className="t">
        <Sparkles size={12} />
        Fix proposal
      </div>
      {state === "ready" && f.proposal ? (
        <p className="whitespace-pre-wrap">{f.proposal.summary}</p>
      ) : state === "unavailable" ? (
        <p className="!text-mid">Proposal unavailable: AI is off. Set ANTHROPIC_API_KEY for Sentinel to get fix proposals.</p>
      ) : (
        <div className="flex flex-col gap-2 pt-1" aria-label="Writing fix proposal">
          <Skeleton w="90%" />
          <Skeleton w="70%" />
        </div>
      )}
    </div>
  );
}

function FindingCard({ f, onOpen }: { f: Finding; onOpen?: (trackId: string) => void }) {
  return (
    <article className="mf">
      <header>
        <span className="mf-kind">{FINDING_LABEL[f.kind]}</span>
        <span className="mono truncate">{f.endpoint}</span>
        <span className="dim mono tnum ml-auto">{clock(f.ts)}</span>
      </header>
      <pre className="mf-ev">{f.evidence}</pre>
      {onOpen && (
        <button type="button" className="mf-open" onClick={() => onOpen(f.trackId)}>
          Open track <span className="mono">{f.trackId}</span>
        </button>
      )}
      <Proposal f={f} />
    </article>
  );
}

const ActionRow = memo(function ActionRow({ a }: { a: TrackAction }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="trow ma-cols w-full text-left" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="mono dim tnum">{clock(a.ts)}</span>
        <span className="mono">{a.method}</span>
        <span className="mono truncate pr-4">{a.query ? `${a.path}?${a.query}` : a.path}</span>
        <span className="mono dim tnum">{num(a.durationMs)} ms</span>
        <span className={cn("mstatus mono tnum", statusClass(a.status))}>{a.status}</span>
      </button>
      {open && (
        <div className="ma-bodies">
          <div>
            <div className="cap">Request body</div>
            <pre>{a.requestBody || "(empty)"}</pre>
          </div>
          <div>
            <div className="cap">Response body (twin)</div>
            <pre>{a.responseBody || "(empty)"}</pre>
          </div>
        </div>
      )}
    </>
  );
});

function TrackView() {
  const detail = useMirror((s) => s.detail);
  const selected = useMirror((s) => s.selected);
  const loading = useMirror((s) => s.loading);
  if (!detail || detail.track.trackId !== selected) {
    return (
      <section className="sect" aria-label="Track">
        <div className="dh">
          {loading || selected ? <Skeleton w={220} h={26} /> : <p className="m-0 text-sm text-mid">No flagged agent in the last 24 h. Tracks show here when the router sends one to the mirror lane.</p>}
        </div>
      </section>
    );
  }
  const t = detail.track;
  return (
    <section className="sect" aria-label={`Track ${t.trackId}`}>
      <div className="dh">
        <div className="ip">{t.ip}</div>
        <div className="sub tnum">
          {t.rule} · {t.reason} · opened {clock(t.openedAt)} · {count(t.actions, "action")} · {count(t.findings, "finding")}
        </div>
        <div className="sub truncate" title={t.userAgent}>
          {t.userAgent || "No user agent"}
        </div>
        <ul className="mkeys">
          {t.keys.map((k) => (
            <li key={`${k.kind}:${k.value}`} title={k.value}>
              <b>{k.kind}</b> {k.value}
            </li>
          ))}
        </ul>
      </div>
      <div className="scroll">
        {detail.findings.length > 0 && (
          <div className="px-6 pt-4">
            {detail.findings.map((f) => (
              <FindingCard key={f.findingId} f={f} />
            ))}
          </div>
        )}
        <div className="thead ma-cols" role="row">
          <span>Time</span>
          <span>Method</span>
          <span>Path</span>
          <span>Duration</span>
          <span>Status</span>
        </div>
        {detail.actions.map((a) => (
          <ActionRow key={a.eventId} a={a} />
        ))}
        {detail.actions.length === 0 && <p className="px-6 py-6 text-sm text-mid">No actions recorded yet.</p>}
        {t.actions > detail.actions.length && <p className="px-6 py-3 text-xs text-mid">Showing the newest {num(detail.actions.length)} of {num(t.actions)} actions.</p>}
      </div>
    </section>
  );
}

const TrackRow = memo(function TrackRow({ t, selected, onSelect }: { t: Track; selected: boolean; onSelect: (id: string) => void }) {
  return (
    <button type="button" role="option" aria-selected={selected} className="att-row mt-cols" onClick={() => onSelect(t.trackId)}>
      <span className="truncate">
        <span className={t.findings > 0 ? "dot hot" : "dot"} />
        <span className="mono">{t.ip}</span>
      </span>
      <span className="dim">{t.rule}</span>
      <span className="mono tnum">{num(t.actions)}</span>
      <span className="mono dim tnum">{clock(t.lastSeen, false)}</span>
    </button>
  );
});

function Tracks() {
  const tracks = useMirror((s) => s.data.tracks);
  const selected = useMirror((s) => s.selected);
  const select = useMirror((s) => s.select);
  const more = useMirror((s) => s.tracksCursor !== null);
  const loadOlder = useMirror((s) => s.loadOlder);
  return (
    <section className="sect" aria-label="Tracks">
      <div className="hd pb-3">
        <h2>Mirror lane</h2>
        <span className="r cap">{count(tracks.length, "track")}</span>
      </div>
      <div role="listbox" aria-label="Tracks, most recently active first" className="scroll" style={{ maxHeight: 44 * 6 }}>
        {tracks.map((t) => (
          <TrackRow key={t.trackId} t={t} selected={t.trackId === selected} onSelect={select} />
        ))}
        {more && (
          <button type="button" className="mf-open px-6 py-3" onClick={() => void loadOlder()}>
            Load older tracks
          </button>
        )}
      </div>
    </section>
  );
}

function Findings() {
  const findings = useMirror((s) => s.data.findings);
  const select = useMirror((s) => s.select);
  return (
    <section className="sect" aria-label="Findings">
      <div className="hd pb-3">
        <h2>Findings</h2>
        <span className="r cap">{num(findings.length)} confirmed</span>
      </div>
      <div className="scroll px-6">
        {findings.map((f) => (
          <FindingCard key={f.findingId} f={f} onOpen={select} />
        ))}
        {findings.length === 0 && <p className="py-6 text-sm text-mid">No confirmed findings. A finding shows here when an agent wins against the twin.</p>}
      </div>
    </section>
  );
}

/** The mirror view in the dashboard's main area. `sidebarOverlay` (the copilot) covers the right column. */
export function MirrorPanel({ sidebarOverlay }: { sidebarOverlay?: ReactNode }) {
  const error = useMirror((s) => s.error);
  return (
    <main className="main">
      <div className="mirror-left">
        {error && (
          <p role="alert" className="m-0 px-6 py-2 text-sm text-ember">
            {error}
          </p>
        )}
        <TrackView />
      </div>
      <div className="right">
        <Tracks />
        <Findings />
        {sidebarOverlay}
      </div>
    </main>
  );
}

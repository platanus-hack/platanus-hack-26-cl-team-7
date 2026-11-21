/**
 * The copilot panel. Interface: the default export, loaded lazily by the app.
 * Inside: conversation scroll, messages (reasoning, tool trace, answer, charts),
 * markdown-lite rendering and the prompt input.
 */
import { Fragment, memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ArrowUp, Brain, Check, ChevronDown, ChevronRight, Copy, LoaderCircle, Square, X } from "lucide-react";
import type { ChartBlock } from "@sentinel/contracts";
import { useDashboard } from "../dashboard/store";
import { useCopilot, type AssistantTurn, type ToolCall } from "./store";
import { parseBlocks, type Block, type Inline } from "./markdown";
import { Orb, clock, formatArgs } from "../ui";

/** Scroll container that sticks to the bottom while new content streams in, unless the user scrolled up. */
function Conversation({ children, deps }: { children: ReactNode; deps: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [deps]);
  return (
    <div
      ref={ref}
      className="conv"
      role="log"
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {children}
    </div>
  );
}

function Reasoning({ text, seconds, streaming }: { text: string; seconds: number | null; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const thinking = streaming && seconds === null;
  const label = thinking ? "Thinking…" : `Thought for ${Math.max(1, seconds ?? 1)} second${(seconds ?? 1) > 1 ? "s" : ""}`;
  return (
    <Collapsible.Root className="reason" open={open} onOpenChange={setOpen}>
      <Collapsible.Trigger className="trig" disabled={!text}>
        <Brain size={14} />
        <span className={thinking ? "shimmer" : undefined}>{label}</span>
        {text && (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
      </Collapsible.Trigger>
      <Collapsible.Content className="body">{text}</Collapsible.Content>
    </Collapsible.Root>
  );
}

const ToolLine = memo(function ToolLine({ call }: { call: ToolCall }) {
  const meta = call.state === "run" ? "reading…" : [call.summary, call.ms !== undefined ? `${call.ms} ms` : null].filter(Boolean).join(" · ");
  return (
    <Collapsible.Root className={`tt ${call.state}`}>
      <Collapsible.Trigger className="tl">
        <span className="g">{call.state === "ok" ? <Check size={12} strokeWidth={2.6} /> : call.state === "err" ? <X size={12} strokeWidth={2.6} /> : <LoaderCircle size={12} strokeWidth={2.6} />}</span>
        <span className="fn">{call.name}</span>
        <span className="args">({formatArgs(call.args)})</span>
        <span className="meta">{meta}</span>
        <span className="cv">
          <ChevronRight size={12} />
        </span>
      </Collapsible.Trigger>
      <Collapsible.Content className="tres">{JSON.stringify(call.args, null, 2)}</Collapsible.Content>
    </Collapsible.Root>
  );
});

/** Our own tool call list: one line per call, written like a function call. */
function ToolTrace({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  return (
    <div className="trace">
      {calls.map((c) => (
        <ToolLine key={c.id} call={c} />
      ))}
    </div>
  );
}

const SHADES = ["#5f8fff", "#3d6cf0", "#2b55c9", "#24407f", "#1d3366", "#172a54"];

const ChartCard = memo(function ChartCard({ chart }: { chart: ChartBlock }) {
  const max = Math.max(1, ...chart.rows.map((r) => r.value));
  return (
    <figure className="ccard m-0" aria-label={chart.title}>
      <figcaption className="ch">
        <b>{chart.title}</b>
        <span>{chart.subtitle}</span>
      </figcaption>
      <div className="hbars">
        {chart.rows.map((r, i) => (
          <div key={r.label} className="hbar">
            <span className="truncate">{r.label}</span>
            <span className="track">
              <span className="fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%`, background: SHADES[Math.min(i, SHADES.length - 1)] }} />
            </span>
            <em>{Math.round(r.share * 100)}%</em>
          </div>
        ))}
      </div>
      <div className="src">
        <span>{chart.source}</span>
        {chart.note && <em>{chart.note}</em>}
      </div>
    </figure>
  );
});

function Inl({ inl }: { inl: Inline[] }) {
  return (
    <>
      {inl.map((p, i) =>
        p.t === "b" ? <strong key={i}>{p.v}</strong> : p.t === "code" ? <code key={i}>{p.v}</code> : <Fragment key={i}>{p.v}</Fragment>,
      )}
    </>
  );
}

function renderBlock(b: Block, i: number, first: boolean): ReactNode {
  switch (b.kind) {
    case "p":
      return (
        <p key={i} className={first ? "lead" : undefined}>
          <Inl inl={b.inl} />
        </p>
      );
    case "h":
      return (
        <div key={i} className="sec">
          {b.text}
        </div>
      );
    case "ul":
      return (
        <div key={i} className="finds">
          {b.items.map((f, j) => (
            <div key={j} className="find">
              {f.title ? (
                <>
                  <div className="ft">
                    <Inl inl={f.title} />
                  </div>
                  {f.detail.length > 0 && (
                    <div className="fd">
                      <Inl inl={f.detail} />
                    </div>
                  )}
                </>
              ) : (
                <div className="fd !mt-0">
                  <Inl inl={f.detail} />
                </div>
              )}
            </div>
          ))}
        </div>
      );
    case "ol":
      return (
        <ol key={i} className="fix">
          {b.items.map((it, j) => (
            <li key={j}>
              <span className="n">{j + 1}</span>
              <span>
                <Inl inl={it} />
              </span>
            </li>
          ))}
        </ol>
      );
  }
}

/**
 * Renders an answer. Charts go right after the findings list (before the next heading),
 * so the figure sits between "what we found" and "how to fix", as in the design.
 */
const Response = memo(function Response({ text, charts }: { text: string; charts: ChartBlock[] }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  const chartAt = useMemo(() => {
    const ul = blocks.findIndex((b) => b.kind === "ul");
    if (ul !== -1) return ul + 1;
    const h = blocks.findIndex((b) => b.kind === "h");
    return h === -1 ? blocks.length : h;
  }, [blocks]);

  const out: ReactNode[] = [];
  let section: ReactNode[] | null = null;
  blocks.forEach((b, i) => {
    if (i === chartAt) charts.forEach((c, k) => out.push(<ChartCard key={`c${k}`} chart={c} />));
    if (b.kind === "h") {
      section = [renderBlock(b, i, false)];
      out.push(
        <div key={`s${i}`} className="next">
          {section}
        </div>,
      );
      return;
    }
    const node = renderBlock(b, i, i === 0);
    if (section) section.push(node);
    else out.push(node);
  });
  if (chartAt >= blocks.length) charts.forEach((c, k) => out.push(<ChartCard key={`c${k}`} chart={c} />));

  return <div className="resp">{out}</div>;
});

function UserMessage({ text }: { text: string }) {
  return <div className="msg-user">{text}</div>;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      aria-label="Copy answer"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/** Assistant answer: steps (reasoning + tool calls), answer, figures, then time and copy. */
const AssistantMessage = memo(function AssistantMessage({ turn }: { turn: AssistantTurn }) {
  const seconds = turn.reasoningMs === null ? null : Math.round(turn.reasoningMs / 1000);
  const hasSteps = turn.reasoning.length > 0 || turn.tools.length > 0 || !turn.done;
  return (
    <div className="msg-ai">
      {hasSteps && (
        <div className="work">
          <Reasoning text={turn.reasoning} seconds={turn.done ? (seconds ?? 0) : seconds} streaming={!turn.done} />
          <ToolTrace calls={turn.tools} />
        </div>
      )}
      {(turn.text || turn.charts.length > 0) && <Response text={turn.text} charts={turn.charts} />}
      {turn.error && <p className="err m-0">{turn.error}</p>}
      {turn.done && turn.at !== null && (
        <div className="when">
          <span>{clock(turn.at, false)}</span>
          {turn.text && <CopyButton text={turn.text} />}
        </div>
      )}
    </div>
  );
});

function PromptInput({ onSubmit, onStop, streaming, disabled }: { onSubmit: (text: string) => void; onStop: () => void; streaming: boolean; disabled?: boolean }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const submit = () => {
    if (!value.trim() || streaming || disabled) return;
    onSubmit(value);
    setValue("");
    if (ref.current) ref.current.style.height = "";
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form
      className="pi"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        ref={ref}
        rows={2}
        value={value}
        disabled={disabled}
        placeholder={disabled ? "Copilot is unavailable" : "Ask about attacks, attackers or patterns…"}
        aria-label="Message the copilot"
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "";
          e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
        }}
        onKeyDown={onKey}
      />
      <div className="tb">
        {streaming ? (
          <button type="button" className="send" onClick={onStop} aria-label="Stop">
            <Square size={12} fill="currentColor" />
          </button>
        ) : (
          <button type="submit" className="send" disabled={!value.trim() || disabled} aria-label="Send">
            <ArrowUp size={15} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </form>
  );
}

export default function CopilotPanel() {
  const close = useDashboard((s) => s.toggleCopilot);
  const range = useDashboard((s) => s.data.range);
  const health = useDashboard((s) => s.health);
  const turns = useCopilot((s) => s.turns);
  const streaming = useCopilot((s) => s.streaming);
  const send = useCopilot((s) => s.send);
  const stop = useCopilot((s) => s.stop);
  const aiOff = health !== null && !health.ai.enabled;
  const offline = health === null;

  return (
    <aside className="cp" aria-label="Copilot">
      <div className="cph">
        <Orb size={32} state={streaming ? "thinking" : turns.length ? "talking" : "idle"} />
        <div>
          <b>Copilot</b>
          <small>Security analyst</small>
        </div>
        <button type="button" className="x" aria-label="Close copilot" onClick={() => close(false)}>
          <X size={14} />
        </button>
      </div>
      <Conversation deps={turns}>
        {turns.length === 0 ? (
          <div className="empty">
            <Orb size={56} state="idle" />
            {aiOff ? (
              <div>
                <b>AI is unavailable</b>
                <p className="mt-2 mb-0">Set ANTHROPIC_API_KEY for Sentinel and restart it. Detection keeps running with rules in the meantime.</p>
              </div>
            ) : offline ? (
              <div>
                <b>Sentinel is not reachable</b>
                <p className="mt-2 mb-0">The copilot answers when the Sentinel service is running.</p>
              </div>
            ) : (
              <div>
                <b>Ask about your attack data</b>
                <p className="mt-2 mb-0">The copilot reads the events and attackers, finds patterns and explains how to fix them.</p>
              </div>
            )}
          </div>
        ) : (
          turns.map((t) => (t.role === "user" ? <UserMessage key={t.id} text={t.text} /> : <AssistantMessage key={t.id} turn={t} />))
        )}
      </Conversation>
      <div className="cpf">
        <PromptInput streaming={streaming} disabled={aiOff || offline} onStop={stop} onSubmit={(text) => void send(text, range)} />
      </div>
    </aside>
  );
}

/**
 * The A/B lab run every part of the dashboard shows. Interface: `useLab`, `startLab`.
 * It follows a running run live (its event stream), and otherwise the latest run of all four services.
 * `show(runId)` pins another run, for example one opened from "Pruebas y replays"; a new run that
 * starts afterwards takes over, so the dashboard always shows the measurement in progress.
 */
import { create } from "zustand";
import { ExperimentEntry, ExperimentRun, type ExperimentDetail, type ExperimentProject } from "@sentinel/contracts";
import { api } from "../sentinel";
import { labAgents, type LabAgent } from "./labTrack";

interface LabState {
  detail: ExperimentDetail | null;
  agents: LabAgent[];
  /** The lab agent open in the main area; null when a caught agent or the activity is shown. */
  selected: ExperimentProject | null;
  select: (project: ExperimentProject | null) => void;
  show: (runId: string, project?: ExperimentProject) => void;
  refresh: () => void;
}

const POLL_MS = 8000;
let pinned: string | null = null;
/** The run in progress when the pin was set: only a run that starts after it replaces the pin. */
let pinnedDuring: string | null = null;
let running: string | null = null;
let stream: EventSource | null = null;
let loading: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

const setDetail = (detail: ExperimentDetail) => useLab.setState({ detail, agents: labAgents(detail) });

function follow(detail: ExperimentDetail) {
  stream?.close();
  stream = null;
  if (detail.run.status !== "running") return;
  const id = detail.run.id;
  const source = new EventSource(api.experimentStream(id, detail.entries.at(-1)?.seq ?? 0));
  stream = source;
  source.addEventListener("entry", (message: MessageEvent<string>) => {
    const entry = ExperimentEntry.safeParse(JSON.parse(message.data));
    const current = useLab.getState().detail;
    if (!entry.success || current?.run.id !== id || (current.entries.at(-1)?.seq ?? 0) >= entry.data.seq) return;
    setDetail({ ...current, entries: [...current.entries, entry.data] });
  });
  source.addEventListener("done", (message: MessageEvent<string>) => {
    const run = ExperimentRun.safeParse(JSON.parse(message.data));
    const current = useLab.getState().detail;
    if (run.success && current?.run.id === id) setDetail({ ...current, run: run.data });
    source.close();
    if (stream === source) stream = null;
  });
}

async function load(id: string) {
  loading?.abort();
  const ctrl = new AbortController();
  loading = ctrl;
  try {
    const detail = await api.experiment(id, ctrl.signal);
    if (ctrl.signal.aborted) return;
    setDetail(detail);
    follow(detail);
  } catch {
    // The lab is optional: caught agents still show when experiment storage is unavailable.
  }
}

async function poll() {
  try {
    const { items } = await api.experiments();
    running = items.find((run) => run.status === "running")?.id ?? null;
    // A run that starts after a pin takes over; until then the pinned run stays.
    if (running && pinned && running !== pinned && running !== pinnedDuring) pinned = null;
    const finished = items.filter((run) => run.mode === "live" && run.status !== "interrupted");
    // Without a pin, the run in progress, else the latest run of all four services, else the latest one.
    const target = pinned ?? running ?? (finished.find((run) => !run.project) ?? finished[0])?.id;
    const current = useLab.getState().detail;
    if (!target) return;
    if (current?.run.id !== target) await load(target);
    else if (current.run.status === "running" && !stream) await load(target);
  } catch {
    // Retried on the next poll.
  }
}

export const useLab = create<LabState>(() => ({
  detail: null,
  agents: [],
  selected: null,
  select: (project) => useLab.setState({ selected: project }),
  show: (runId, project) => {
    pinned = runId;
    pinnedDuring = running;
    useLab.setState({ selected: project ?? null });
    if (useLab.getState().detail?.run.id !== runId) void load(runId);
  },
  refresh: () => void poll(),
}));

/** Starts following the lab. Returns the stop. */
export function startLab(): () => void {
  void poll();
  timer = setInterval(() => void poll(), POLL_MS);
  return () => {
    clearInterval(timer);
    timer = undefined;
    loading?.abort();
    stream?.close();
    stream = null;
  };
}

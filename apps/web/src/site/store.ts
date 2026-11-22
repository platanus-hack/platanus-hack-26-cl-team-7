/**
 * The panel's one store. Interface: `useSite`, `startSite`.
 * It holds the A/B runs, the run shown (a run in progress live over its event stream, else the most
 * recent full run, which out of the box is the recording Sentinel bundles), the site open, and the
 * guided demo step. A run the viewer picks stays until a newer run starts.
 */
import { create } from "zustand";
import { ExperimentEntry, ExperimentRun, type ExperimentDetail, type ExperimentProject } from "@sentinel/contracts";
import { api } from "../sentinel";
import { labAgents, type LabAgent } from "../experiments/labTrack";

interface SiteState {
  runs: ExperimentRun[];
  detail: ExperimentDetail | null;
  sites: LabAgent[];
  site: ExperimentProject | null;
  starting: boolean;
  error: string;
  /** Index of the guided demo step, or null outside the demo. */
  demo: number | null;
  selectSite: (project: ExperimentProject) => void;
  showRun: (runId: string) => void;
  start: () => Promise<void>;
  setDemo: (step: number | null) => void;
}

const POLL_MS = 8000;
let pinned: string | null = null;
/** The run in progress when the viewer picked one: only a run that starts after it replaces the pick. */
let pinnedDuring: string | null = null;
let running: string | null = null;
let stream: EventSource | null = null;
let loading: AbortController | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

function setDetail(detail: ExperimentDetail) {
  const sites = labAgents(detail);
  useSite.setState((s) => ({ detail, sites, site: s.site && sites.some((x) => x.project === s.site) ? s.site : sites[0]?.project ?? s.site }));
}

function follow(detail: ExperimentDetail) {
  stream?.close();
  stream = null;
  // The patch step can run after the run finished: the stream stays open until the server says done.
  if (detail.run.status !== "running" && !detail.run.patching) return;
  const id = detail.run.id;
  const source = new EventSource(api.experimentStream(id, detail.entries.at(-1)?.seq ?? 0));
  stream = source;
  source.addEventListener("entry", (message: MessageEvent<string>) => {
    const entry = ExperimentEntry.safeParse(JSON.parse(message.data));
    const current = useSite.getState().detail;
    if (!entry.success || current?.run.id !== id || (current.entries.at(-1)?.seq ?? 0) >= entry.data.seq) return;
    setDetail({ ...current, entries: [...current.entries, entry.data] });
  });
  source.addEventListener("done", (message: MessageEvent<string>) => {
    const run = ExperimentRun.safeParse(JSON.parse(message.data));
    const current = useSite.getState().detail;
    if (run.success && current?.run.id === id) setDetail({ ...current, run: run.data });
    source.close();
    if (stream === source) stream = null;
    void poll();
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
    if (!ctrl.signal.aborted) useSite.setState({ error: "No se pudo abrir la prueba." });
  }
}

/** Most recent first by start time; a run without one (never started) last. */
const byStart = (a: ExperimentRun, b: ExperimentRun) => (b.started ?? "").localeCompare(a.started ?? "");

async function poll() {
  try {
    const { items } = await api.experiments();
    const runs = [...items].filter((run) => run.status !== "interrupted").sort(byStart);
    useSite.setState({ runs });
    running = runs.find((run) => run.status === "running")?.id ?? null;
    if (running && pinned && running !== pinned && running !== pinnedDuring) pinned = null;
    // Without a pick: the run in progress, else the most recent run of all four services.
    const target = pinned ?? running ?? (runs.find((run) => !run.project && run.status === "completed") ?? runs[0])?.id;
    const current = useSite.getState().detail;
    if (!target) return;
    if (current?.run.id !== target) await load(target);
    else if (!stream && (current.run.status === "running" || runs.find((run) => run.id === target)?.patching)) await load(target);
  } catch {
    useSite.setState({ error: "Sentinel no responde. Se reintenta solo." });
    return;
  }
  if (useSite.getState().error.startsWith("Sentinel no responde")) useSite.setState({ error: "" });
}

export const useSite = create<SiteState>(() => ({
  runs: [],
  detail: null,
  sites: [],
  site: null,
  starting: false,
  error: "",
  demo: null,
  selectSite: (project) => useSite.setState({ site: project }),
  showRun: (runId) => {
    pinned = runId;
    pinnedDuring = running;
    if (useSite.getState().detail?.run.id !== runId) void load(runId);
  },
  start: async () => {
    useSite.setState({ starting: true, error: "" });
    try {
      const { id } = await api.startExperiment();
      pinned = null;
      running = id;
      await load(id);
      void poll();
    } catch (reason) {
      useSite.setState({ error: reason instanceof Error ? reason.message : "No se pudo iniciar la prueba." });
    } finally {
      useSite.setState({ starting: false });
    }
  },
  setDemo: (step) => useSite.setState({ demo: step }),
}));

/** Starts following the runs. Returns the stop. */
export function startSite(): () => void {
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

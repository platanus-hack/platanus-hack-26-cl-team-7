/**
 * The Sentinel client: the one module that talks to the server.
 * JSON requests with timeouts and the error envelope, plus an SSE reader for streams.
 */
import { Report, ReportSummary, type AttackerDetail, type Block, type DecisionRequest, type FindingPage, type Health, type Range, type Snapshot, type TrackDetail, type TrackPage } from "@sentinel/contracts";
import { EvidenceDemoBundle, EvidenceDemoEvaluation, ExperimentDetail, ExperimentList, ExperimentStarted, type ExperimentProject } from "@sentinel/contracts";

/** Same origin by default: Sentinel serves this app in production and Vite proxies /v1 in development. */
export const BASE_URL: string = (import.meta.env.VITE_SENTINEL_URL as string | undefined) ?? "";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init?.timeoutMs ?? 8000);
  const onAbort = () => ctrl.abort();
  init?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { accept: "application/json", ...(init?.body ? { "content-type": "application/json" } : {}), ...init?.headers },
    });
    if (res.status === 204) return undefined as T;
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new ApiRequestError(res.status, err?.code ?? "http_error", err?.message ?? `Request failed (${res.status})`);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", onAbort);
  }
}

/** Parses a response with a contract schema. A body that does not match is a server fault, not a crash. */
function parseWith<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, body: unknown): T {
  const out = schema.safeParse(body);
  if (!out.success) throw new ApiRequestError(502, "bad_response", "Sentinel sent a reply this dashboard cannot read.");
  return out.data;
}

/** Starts a report for one attacker. Returns the open report when one exists. Code `AI_DISABLED` means AI is off. */
export async function createReport(ip: string, signal?: AbortSignal): Promise<Report> {
  return parseWith(Report, await request<unknown>("/v1/reports", { method: "POST", body: JSON.stringify({ ip }), signal }));
}

export async function getReport(id: string, signal?: AbortSignal): Promise<Report> {
  return parseWith(Report, await request<unknown>(`/v1/reports/${encodeURIComponent(id)}`, { signal }));
}

/** Newest first. */
export async function listReports(ip?: string, signal?: AbortSignal): Promise<ReportSummary[]> {
  const query = ip === undefined ? "" : `?ip=${encodeURIComponent(ip)}`;
  const body = await request<{ items?: unknown } | null>(`/v1/reports${query}`, { signal });
  if (!Array.isArray(body?.items)) throw new ApiRequestError(502, "bad_response", "Sentinel sent a reply this dashboard cannot read.");
  return body.items.map((item) => parseWith(ReportSummary, item));
}

/** Codes to expect: `REASON_REQUIRED` (422), `BAD_STATE` and `REVISION_LIMIT` (409). The message is plain words. */
export async function decideReport(id: string, body: DecisionRequest, signal?: AbortSignal): Promise<Report> {
  return parseWith(Report, await request<unknown>(`/v1/reports/${encodeURIComponent(id)}/decision`, { method: "POST", body: JSON.stringify(body), signal }));
}

/** Paging of GET /v1/tracks and /v1/findings. `cursor` is the previous page's nextCursor. */
export interface PageParams {
  range: Range;
  limit: number;
  cursor?: string | null;
}

function pageQuery({ range, limit, cursor }: PageParams): string {
  const q = new URLSearchParams({ range, limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return q.toString();
}

export const api = {
  experiments: async (signal?: AbortSignal) => parseWith(ExperimentList, await request<unknown>("/v1/experiments/runs", { signal })),
  experiment: async (id: string, signal?: AbortSignal) => parseWith(ExperimentDetail, await request<unknown>(`/v1/experiments/runs/${encodeURIComponent(id)}`, { signal })),
  startExperiment: async (project?: ExperimentProject) => parseWith(ExperimentStarted, await request<unknown>("/v1/experiments/runs", { method: "POST", body: JSON.stringify({ project }), timeoutMs: 20_000 })),
  experimentStream: (id: string, after: number) => `${BASE_URL}/v1/experiments/runs/${encodeURIComponent(id)}/events?after=${after}`,
  evidenceDemo: async (signal?: AbortSignal) => parseWith(EvidenceDemoBundle, await request<unknown>("/v1/evidence-demo", { signal })),
  evaluateEvidence: async () => parseWith(EvidenceDemoEvaluation, await request<unknown>("/v1/evidence-demo/evaluate", {
    method: "POST", body: "{}", timeoutMs: 50_000,
  })),
  health: (signal?: AbortSignal) => request<Health>("/v1/health", { signal, timeoutMs: 3000 }),
  snapshot: (range: Range, signal?: AbortSignal) => request<Snapshot>(`/v1/snapshot?range=${range}`, { signal }),
  attacker: (ip: string, signal?: AbortSignal) => request<AttackerDetail>(`/v1/attackers/${encodeURIComponent(ip)}`, { signal }),
  block: (ip: string) => request<Block>(`/v1/blocks/${encodeURIComponent(ip)}`, { method: "PUT" }),
  unblock: (ip: string) => request<void>(`/v1/blocks/${encodeURIComponent(ip)}`, { method: "DELETE" }),
  tracks: (p: PageParams, signal?: AbortSignal) => request<TrackPage>(`/v1/tracks?${pageQuery(p)}`, { signal }),
  track: (trackId: string, signal?: AbortSignal) => request<TrackDetail>(`/v1/tracks/${encodeURIComponent(trackId)}`, { signal }),
  findings: (p: PageParams, signal?: AbortSignal) => request<FindingPage>(`/v1/findings?${pageQuery(p)}`, { signal }),
  streamUrl: (after: string) => `${BASE_URL}/v1/stream?after=${encodeURIComponent(after)}`,
  copilotUrl: () => `${BASE_URL}/v1/copilot/messages`,
};

/** One parsed Server-Sent Events message. */
export interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental SSE parser (WHATWG event-stream format). Feed it decoded text chunks;
 * it returns the complete messages found so far and keeps any partial message.
 */
export function createSseParser() {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let id: string | undefined;

  function dispatch(out: SseMessage[]) {
    if (data.length > 0) out.push({ event: event || "message", data: data.join("\n"), id });
    event = "";
    data = [];
  }

  return {
    push(chunk: string): SseMessage[] {
      buffer += chunk;
      const out: SseMessage[] = [];
      let nl: number;
      while ((nl = buffer.search(/\r\n|\r|\n/)) !== -1) {
        const line = buffer.slice(0, nl);
        const sepLen = buffer.startsWith("\r\n", nl) ? 2 : 1;
        buffer = buffer.slice(nl + sepLen);
        if (line === "") {
          dispatch(out);
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" ")) value = value.slice(1);
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
        else if (field === "id") id = value;
      }
      return out;
    },
  };
}

/** Reads an SSE response body and yields messages until the stream ends or aborts. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const msg of parser.push(decoder.decode(value, { stream: true }))) yield msg;
    }
    for (const msg of parser.push("\n\n")) yield msg;
  } finally {
    reader.releaseLock();
  }
}

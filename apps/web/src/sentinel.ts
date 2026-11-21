/**
 * The Sentinel client: the one module that talks to the server.
 * JSON requests with timeouts and the error envelope, plus an SSE reader for streams.
 */
import type { AttackerDetail, Block, Health, Range, Snapshot } from "@sentinel/contracts";

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

export const api = {
  health: (signal?: AbortSignal) => request<Health>("/v1/health", { signal, timeoutMs: 3000 }),
  snapshot: (range: Range, signal?: AbortSignal) => request<Snapshot>(`/v1/snapshot?range=${range}`, { signal }),
  attacker: (ip: string, signal?: AbortSignal) => request<AttackerDetail>(`/v1/attackers/${encodeURIComponent(ip)}`, { signal }),
  block: (ip: string) => request<Block>(`/v1/blocks/${encodeURIComponent(ip)}`, { method: "PUT" }),
  unblock: (ip: string) => request<void>(`/v1/blocks/${encodeURIComponent(ip)}`, { method: "DELETE" }),
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

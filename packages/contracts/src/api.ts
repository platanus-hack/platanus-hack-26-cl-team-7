import { z } from "zod";

/** Reaper API version prefix. Every route lives under it. */
export const API_PREFIX = "/v1";
export const DEFAULT_PORT = 8787;

export const Range = z.enum(["5m", "1h", "24h"]);
export type Range = z.infer<typeof Range>;

export const RANGE_MS: Record<Range, number> = {
  "5m": 5 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
};

export const IpAddress = z.ipv4().or(z.ipv6());

export const ApiError = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({
  ok: z.literal(true),
  version: z.string(),
  ai: z.object({ enabled: z.boolean(), model: z.string().nullable() }),
  uptimeMs: z.number().int(),
});
export type Health = z.infer<typeof Health>;

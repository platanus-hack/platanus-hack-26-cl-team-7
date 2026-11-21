import { UAParser } from "ua-parser-js";
import type { GeoHint } from "@sentinel/contracts";

export interface ClientInfo {
  device: string | null;
  os: string | null;
  browser: string | null;
}

const TOOL_AGENTS: [RegExp, string][] = [
  [/^curl\/([\d.]+)/i, "curl"],
  [/^python-requests\/([\d.]+)/i, "python-requests"],
  [/^Go-http-client\/([\d.]+)/i, "Go http client"],
  [/^Wget\/([\d.]+)/i, "Wget"],
  [/sqlmap\/([\d.]+)/i, "sqlmap"],
  [/nikto/i, "Nikto"],
];

export function parseClient(userAgent: string): ClientInfo {
  if (!userAgent) return { device: null, os: null, browser: null };
  for (const [re, name] of TOOL_AGENTS) {
    const m = re.exec(userAgent);
    if (m) return { device: "Server", os: null, browser: m[1] ? `${name} ${m[1]}` : name };
  }
  const r = UAParser(userAgent);
  const deviceType = r.device.type;
  const device = deviceType === "mobile" ? "Mobile" : deviceType === "tablet" ? "Tablet" : "Desktop";
  const os = r.os.name ? `${r.os.name}${r.os.version ? ` ${r.os.version.split(".")[0]}` : ""}` : null;
  const browserName = r.browser.name?.replace(/^Chrome Headless$/i, "Headless Chrome") ?? null;
  const browser = browserName ? `${browserName}${r.browser.major ? ` ${r.browser.major}` : ""}` : null;
  return { device, os, browser };
}

/** Short stable fingerprint of a client. Same tooling from several IPs gives the same value. */
export function fingerprint(userAgent: string): string {
  let h = 2166136261;
  for (let i = 0; i < userAgent.length; i++) {
    h ^= userAgent.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface Geo {
  country: string | null;
  countryCode: string | null;
  city: string | null;
  network: string | null;
}

export const EMPTY_GEO: Geo = { country: null, countryCode: null, city: null, network: null };

export function geoFromHint(h: GeoHint | undefined): Geo | null {
  if (!h || (!h.country && !h.countryCode && !h.city && !h.network)) return null;
  return {
    country: h.country ?? null,
    countryCode: h.countryCode ?? null,
    city: h.city ?? null,
    network: h.network ?? null,
  };
}

/** Private, loopback, link-local, CGNAT and documentation ranges have no public location. */
export function isPublicIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p as [number, number, number, number];
  if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

/**
 * Looks up public IPs at ip-api.com (free, no key, 45 requests per minute).
 * Never blocks ingest: callers get the result later through the callback.
 * Each IP is looked up once per process.
 */
export class GeoResolver {
  private readonly cache = new Map<string, Geo>();
  private readonly pending = new Set<string>();
  private stamps: number[] = [];

  private readonly onResolved: (ip: string, geo: Geo) => void;
  private readonly fetchImpl: typeof fetch;
  private readonly perMinute: number;

  constructor(onResolved: (ip: string, geo: Geo) => void, fetchImpl: typeof fetch = fetch, perMinute = 40) {
    this.onResolved = onResolved;
    this.fetchImpl = fetchImpl;
    this.perMinute = perMinute;
  }

  get(ip: string): Geo | null {
    return this.cache.get(ip) ?? null;
  }

  request(ip: string): void {
    if (this.cache.has(ip) || this.pending.has(ip) || !isPublicIPv4(ip)) return;
    const now = Date.now();
    this.stamps = this.stamps.filter((t) => now - t < 60_000);
    if (this.stamps.length >= this.perMinute) return; // Try again on the next event from this IP.
    this.stamps.push(now);
    this.pending.add(ip);
    void this.lookup(ip).finally(() => this.pending.delete(ip));
  }

  private async lookup(ip: string): Promise<void> {
    try {
      const res = await this.fetchImpl(
        `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,city,isp,org,as`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (!res.ok) return;
      const j = (await res.json()) as Record<string, string>;
      if (j.status !== "success") return;
      const geo: Geo = {
        country: j.country ?? null,
        countryCode: j.countryCode ?? null,
        city: j.city ?? null,
        network: j.org || j.isp || null,
      };
      this.cache.set(ip, geo);
      this.onResolved(ip, geo);
    } catch {
      // Network errors leave the location empty. The UI shows "Unknown".
    }
  }
}

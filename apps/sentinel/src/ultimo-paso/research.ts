import { services, type Research, type Service } from "@sentinel/contracts";
import { row } from "./evidence.ts";

export interface Inventory {
  package: string;
  version: string;
}

export function inventoryOf(value: unknown): Inventory | undefined {
  const item = row(value);
  if (typeof item.package !== "string" || !/^[a-z0-9@][a-z0-9./_-]{0,79}$/i.test(item.package)) return undefined;
  if (typeof item.version !== "string" || !/^\d+(?:\.\d+){1,3}(?:-[\w.-]+)?$/.test(item.version)) return undefined;
  return { package: item.package, version: item.version };
}

const CVE = /\bCVE-\d{4}-\d{4,}\b/i;
const sources = ["github.com", "react.dev", "vercel.com", "nextjs.org", "nvd.nist.gov", "osv.dev"];
const affected = [
  { package: "vite", versions: ["6.4.4"], advisory: services.bruma },
  { package: "react-server-dom-webpack", versions: ["19.0.0", "19.1.0", "19.1.1", "19.2.0"], advisory: services.litoral },
  { package: "react-server-dom-parcel", versions: ["19.0.0", "19.1.0", "19.1.1", "19.2.0"], advisory: services.litoral },
  { package: "react-server-dom-turbopack", versions: ["19.0.0", "19.1.0", "19.1.1", "19.2.0"], advisory: services.litoral },
];

const remediation = {
  bruma: { fix: "Actualiza Vite 6.4.4 a 6.4.5 o a una versión corregida posterior.", affected: "Vite 6.4.4" },
  litoral: { fix: "Actualiza el paquete React Server Components a una versión corregida de su rama, según las instrucciones vigentes del aviso.",
    affected: "Paquetes react-server-dom-webpack, react-server-dom-parcel y react-server-dom-turbopack: 19.0.0, 19.1.0, 19.1.1 y 19.2.0." },
  surco: { fix: "Usa una versión corregida vigente de tu rama. El aviso documenta 12.3.5, 13.5.9, 14.2.25 y 15.2.3 como correcciones iniciales.",
    affected: "Next.js 12.x, 13.x, 14.x y 15.x anteriores a la corrección de su rama, según el aviso." },
} as const;

function publicSource(value: unknown): string | undefined {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !sources.includes(url.hostname)) return undefined;
  if (url.hostname === "github.com" && !/\/advisories\//.test(url.pathname)) return undefined;
  url.search = "";
  url.hash = "";
  return url.href;
}

export function researchKey(service: Service, inventory?: Inventory) {
  if (service !== "other") return `fixture:${service}`;
  return inventory ? `${inventory.package}@${inventory.version}` : "unidentified";
}

export async function lookupAdvisory(
  service: Service,
  token?: string,
  inventory?: Inventory,
  fetcher: typeof fetch = fetch,
): Promise<Research> {
  const verified = service === "other" && inventory
    ? affected.find((x) => x.package === inventory.package && x.versions.includes(inventory.version))
    : undefined;
  const reference = service === "other" ? verified?.advisory : services[service];
  const base = reference ? { cve: reference.cve, source: reference.url, ...(service === "other" ? {} : remediation[service]) } : {};
  if (!reference && !inventory) return { status: "unresolved", note: "Trusted component and version are unavailable." };
  if (!token) return { ...base, status: "not-configured", note: "Firecrawl is disabled. Any source shown is the curated reference." };
  try {
    const payload = reference
      ? { url: reference.url, formats: ["markdown"], onlyMainContent: true, timeout: 8_000 }
      : { query: `${inventory!.package} ${inventory!.version} security advisory CVE`, limit: 5 };
    const response = await fetcher(`https://api.firecrawl.dev/v2/${reference ? "scrape" : "search"}`, {
      method: "POST", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) return { ...base, status: "provider-error", note: `Firecrawl returned HTTP ${response.status}.` };
    const body = row(await response.json());
    const data = row(body.data);
    if (body.success !== true) return { ...base, status: "provider-error", note: "Firecrawl response was unsuccessful." };
    const retrievedAt = new Date().toISOString();
    if (reference) {
      if (typeof data.markdown !== "string" || !data.markdown.toUpperCase().includes(reference.cve))
        return { ...base, status: "provider-error", note: "The retrieved page did not contain the expected advisory identifier." };
      return { ...base, retrievedAt, status: verified ? "verified-version" : "fixture-analogue",
        note: verified ? "A curated affected-version entry matches the trusted inventory. Firecrawl retrieved its advisory."
          : "Firecrawl retrieved the public advisory for the fixture’s simulated outcome." };
    }
    for (const item of Array.isArray(data.web) ? data.web : []) {
      const hit = row(item);
      const source = publicSource(hit.url);
      const cve = CVE.exec(`${hit.title ?? ""} ${hit.description ?? ""}`)?.[0]?.toUpperCase();
      if (source && cve) return { status: "potential-match", source, cve, retrievedAt,
        note: "Firecrawl returned a public advisory candidate. Affected versions still need review." };
    }
    return { status: "unresolved", retrievedAt, note: "No supported public advisory matched the search." };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ...base, status: "provider-error", note: timedOut ? "Firecrawl lookup timed out." : "Firecrawl lookup failed." };
  }
}

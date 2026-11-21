import type { EvidenceEvent, EvidenceRun, EvidenceTrace, TraceLink } from "@sentinel/contracts";

const windowMs = 120_000;
const maxLinks = 20;
const traceKey = (t: EvidenceTrace) => [t.run, t.plane, t.id].join("/");
const suspicious = (r: EvidenceEvent) => r.symbol === "probe" || r.symbol === "exploit" || r.symbol === "confirm";

function features(t: EvidenceTrace) {
  return {
    trace: t, request: t.events.find((e) => e.kind === "request"),
    confirmed: t.events.some((e) => e.kind === "contain" || (e.kind === "response" && e.action === "replace")),
    rules: new Set(t.events.filter((e) => e.kind === "request" || e.kind === "rule_installed" || e.kind === "historical-rule").map((e) => e.rule).filter(Boolean)),
    time: Date.parse(t.time ?? ""),
  };
}
type Features = ReturnType<typeof features>;

function inferred(a: Features, b: Features, gap: number) {
  if (!a.request?.actor || a.request.actor !== b.request?.actor || !b.request || gap > windowMs) return undefined;
  if (a.trace.label === "legitimate" || b.trace.label === "legitimate") return undefined;
  const aSuspicious = suspicious(a.request) || a.confirmed;
  const bSuspicious = suspicious(b.request) || b.confirmed;
  if (aSuspicious && bSuspicious) {
    if (a.request.pattern && a.request.pattern === b.request.pattern) return "Same observed actor and matching detection pattern";
    const payload = a.request.payload;
    if (payload?.bodyBytes && payload.sha256 && payload.sha256 === b.request.payload?.sha256)
      return "Same observed actor and matching request-body digest";
    if (a.trace.route === b.trace.route && a.trace.service !== "other") return "Same observed actor and suspicious activity on the same route";
    if (gap <= 30_000 && (a.confirmed || b.confirmed)) return "Same observed actor with nearby suspicious activity and a response confirmation";
  }
  const [first, second] = a.time <= b.time ? [a, b] : [b, a];
  if (first.request?.symbol === "fingerprint" && second.request && (suspicious(second.request) || second.confirmed))
    return "Same observed actor progressed from fingerprinting to a suspicious or confirmed request";
  return undefined;
}

export function withRelated(run: EvidenceRun): EvidenceRun {
  const actors = new Map<string, Features[]>();
  const rules = new Map<string, Features[]>();
  const scope = (t: EvidenceTrace) => `${t.run}/${t.plane}/`;
  const rows = run.traces.map(features);
  const index = (map: Map<string, Features[]>, key: string, value: Features) => {
    const existing = map.get(key);
    if (existing) existing.push(value);
    else map.set(key, [value]);
  };
  for (const row of rows) {
    const prefix = scope(row.trace);
    if (row.request?.actor && Number.isFinite(row.time)) index(actors, prefix + row.request.actor, row);
    for (const rule of row.rules) index(rules, prefix + rule, row);
  }
  for (const actor of actors.values()) actor.sort((a, b) => a.time - b.time);
  const traces = rows.map((row) => {
    const prefix = scope(row.trace);
    const linked = new Map<string, TraceLink>();
    for (const rule of row.rules) {
      for (const match of rules.get(prefix + rule) ?? []) {
        if (match === row || linked.size === maxLinks) continue;
        const trace = traceKey(match.trace);
        linked.set(trace, { trace, confidence: "rule-linked", reason: `Both transactions reference containment rule ${rule}` });
      }
    }
    const peers = row.request?.actor ? actors.get(prefix + row.request.actor) : undefined;
    if (peers && Number.isFinite(row.time)) {
      // Only evaluate the neighbourhood around this request, even on a busy actor.
      const position = peers.indexOf(row);
      for (let step = 1; linked.size < maxLinks && step <= 120; step++) {
        const neighbours = [peers[position - step], peers[position + step]];
        if (neighbours.every((match) => !match || Math.abs(match.time - row.time) > windowMs)) break;
        for (const match of neighbours) {
          if (!match || linked.size >= maxLinks) continue;
          const trace = traceKey(match.trace);
          if (linked.has(trace)) continue;
          const gap = Math.abs(match.time - row.time);
          const reason = inferred(row, match, gap);
          if (reason) linked.set(trace, { trace, confidence: "inferred", reason, gapSeconds: Math.round(gap / 1000) });
        }
      }
    }
    return { ...row.trace, related: [...linked.values()] };
  });
  return { ...run, traces };
}

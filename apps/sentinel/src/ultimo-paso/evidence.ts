import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { services, pipelineCases, type Arm, type EvidenceEvent, type EvidenceRun, type EvidenceTrace, type Observation, type Plane, type Service, type Traffic } from "@sentinel/contracts";

export type Row = Record<string, unknown>;
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export const row = (value: unknown): Row => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const timestamp = (value: unknown) => /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(str(value)) && !Number.isNaN(Date.parse(str(value))) ? str(value) : undefined;
export const validId = (value: unknown) => /^[a-zA-Z0-9_-]{1,80}$/.test(str(value)) ? str(value) : undefined;
export const planeOf = (value: unknown): Plane | undefined => value === "extproc" || value === "revproxy" ? value : undefined;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
const oneOf = <T extends string>(value: unknown, options: readonly T[]): T | undefined => options.find((item) => item === value);
const labels = ["disclosure-fixture", "request-indicator", "legitimate", "unlabelled-control"] as const;
const names = [...pipelineCases, "direct", "first_protected", "repeat", "other_route", "other_actor", "repeated_header", "unlabelled_record", "known-indicator", "script-indicator", "query-indicator", "path-indicator", "clean-control",
  "progression-fingerprint", "progression-probe", "progression-repeat"] as const;
const kinds = ["request", "response", "contain", "rule_installed", "alert_created", "alert_delivery", "wire"] as const;
const signal = (value: unknown) => {
  const s = str(value);
  if (/^canary:(bruma|litoral|surco)$/.test(s)) return s;
  if (s.startsWith("canary:")) return "canary:registered";
  return /^(sig:(cmd-id|etc-passwd|pem-key|aws-akid|win-dir|php-warning):(header|body)|baseline:content-type)$/.test(s) ? s : undefined;
};

export function routeOf(value: unknown): { service: Service; route: string } {
  const match = /^\/(bruma|litoral|surco)\/(receipt|service|repeated|unlabelled)?$/.exec(str(value));
  if (match) return { service: match[1] as Service, route: match[0] };
  return { service: "other", route: value === "/" ? "/" : "/[redacted route]" };
}

export function observation(e: Row): Observation | undefined {
  if (number(e.status) === undefined || number(e.upstream_hits) === undefined ||
      typeof e.evidence_in_body !== "boolean" || typeof e.evidence_in_headers !== "boolean") return undefined;
  return { status: e.status as number, upstreamHits: e.upstream_hits as number, bodyEvidence: e.evidence_in_body, headerEvidence: e.evidence_in_headers };
}

export function eventOf(e: Row, run: string): EvidenceEvent | undefined {
  const kind = oneOf(e.kind, kinds);
  if (!kind) return undefined;
  const reason = str(e.reason);
  const capture = row(e.payload_capture);
  const state = oneOf(capture.state, ["recorded", "partial", "archive-full", "write-failed"]);
  const bodyBytes = number(capture.body_bytes);
  const safeReason = /^(canary|correlated-evidence|evidence-without-suspicion:log-only|fingerprint|suspect|containment containment|confirmed:(response-evidence|honeytoken|[a-z0-9-]{1,40})|actor-and-route|local-alert|not-configured|failed|(?:delivered|failed)-http-[1-5][0-9]{2})$/.test(reason) ? reason : undefined;
  return {
    kind, time: timestamp(e.ts), route: routeOf(e.route).route,
    actor: typeof e.actor === "string" && e.actor ? hash(run + "\0" + e.actor).slice(0, 10) : undefined,
    method: oneOf(e.method, ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"]),
    symbol: oneOf(e.symbol, ["browse", "enumerate", "fingerprint", "probe", "exploit", "confirm"]),
    pattern: oneOf(e.pattern, ["sqli", "xss", "cmd-injection", "tmpl-injection", "path-traversal", "vite-fs-raw", "nextjs-mw-bypass", "react2shell", "craftcms-transform", "ssrf-metadata", "code-injection"]),
    action: oneOf(e.action, ["pass", "tag", "trap", "divert", "block", "replace", "truncate"]),
    level: oneOf(e.level, ["normal", "suspect", "confirmed"]), reason: safeReason,
    signals: Array.isArray(e.evidence) ? [...new Set(e.evidence.map(signal).filter((s): s is string => !!s))] : undefined,
    rule: /^(contain|research)-\d{1,12}$/.test(str(e.rule_id)) ? str(e.rule_id) : undefined,
    incident: validId(e.incident_id), expiresAt: timestamp(e.expires_at), elapsedMs: number(e.elapsed_ms), status: number(e.status),
    payload: kind === "request" && state && bodyBytes !== undefined ? {
      state, bodyBytes, sha256: /^[0-9a-f]{64}$/.test(str(capture.sha256)) ? str(capture.sha256) : undefined,
    } : undefined,
  };
}

export function liveTrace(e: Row): EvidenceTrace | undefined {
  const run = validId(e.run_id);
  const id = validId(e.trace_id);
  const plane = planeOf(e.data_plane);
  if (!run || !id || !plane) return undefined;
  const event = eventOf(e, run);
  if (!event) return undefined;
  return {
    id, run, plane, ...routeOf(e.route), time: event.time,
    hasPayload: e.has_payload === true || !!event.payload?.bodyBytes,
    arm: event.kind === "wire" && e.arm === "direct" ? "direct" : "protected",
    case: event.kind === "wire" ? oneOf(e.case, names) ?? "Live request" : "Live request",
    label: event.kind === "wire" ? oneOf(e.label, labels) : undefined,
    observed: event.kind === "wire" ? observation(e) : undefined,
    events: [event],
  };
}

export function mergeTraces(rows: EvidenceTrace[]): EvidenceTrace[] {
  const grouped = new Map<string, EvidenceTrace>();
  const recorded = new Map<string, Map<string, number>>();
  for (const next of rows) {
    const key = [next.run, next.plane, next.id].join(":");
    if (!grouped.has(key)) {
      grouped.set(key, { ...next, events: [] });
      recorded.set(key, new Map());
    }
    const prior = grouped.get(key)!;
    const seen = recorded.get(key)!;
    for (const event of next.events) {
      const identity = JSON.stringify([event.kind, event.time, event.incident, event.rule, event.research?.status]);
      const index = seen.get(identity);
      if (index === undefined) {
        seen.set(identity, prior.events.length);
        prior.events.push(event);
      } else if (event.payload && !prior.events[index]?.payload) {
        prior.events[index] = event;
      }
    }
    prior.hasPayload ||= next.hasPayload;
    if (next.observed) {
      prior.observed = next.observed;
      prior.label = next.label;
      prior.case = next.case;
      prior.arm = next.arm;
    }
  }
  return [...grouped.values()];
}

export function readReplay(directory: string): EvidenceRun {
  const traces: EvidenceTrace[] = [];
  for (const version of ["before", "after"] as const) {
    const data = row(JSON.parse(readFileSync(join(directory, `defense-${version}.json`), "utf8")));
    for (const [name, value] of Object.entries(row(data.data_planes))) {
      const plane = planeOf(name);
      if (!plane) continue;
      const entry = row(value);
      const cases = row(entry.cases);
      const events = Array.isArray(entry.events) ? entry.events.map(row) : [];
      const run = `recorded-${version}`;
      const add = (name: string, raw: unknown, arm: Arm, label: Traffic, expectedActor?: string, repeat = false, historicalRule?: Row) => {
        const test = row(raw);
        const observed = observation(test);
        if (!observed) return;
        const { route, service } = routeOf(test.path);
        const at = expectedActor ? events.findIndex((e) => e.kind === "request" && e.route === route &&
          str(e.actor).includes(`|${expectedActor}|`) && (repeat ? e.action === "divert" : e.action !== "divert")) : -1;
        const joined: EvidenceEvent[] = [];
        if (at >= 0) {
          for (let i = at; i < events.length && (i === at || events[i]?.kind !== "request"); i++) {
            const e = events[i]!;
            if (e.route !== route || e.actor !== events[at]?.actor) continue;
            const event = eventOf(e, run);
            if (event) joined.push(event);
          }
        }
        if (historicalRule && validId(historicalRule.ID)) {
          joined.push({ kind: "historical-rule", route, rule: str(historicalRule.ID), time: timestamp(historicalRule.CreatedAt),
            expiresAt: timestamp(historicalRule.ExpiresAt), reason: "actor-and-route", elapsedMs: number(historicalRule.observed_ms) });
        }
        traces.push({
          id: `${version}-${plane}-${service}-${name}`, run, plane, service, arm, route, case: name,
          time: joined[0]?.time ?? timestamp(data.timestamp_utc), label, observed, events: joined, legacy: true, hasPayload: label === "request-indicator",
        });
      };
      const protection = version === "before" ? "original" : "patched";
      for (const service of Object.keys(services)) {
        const data = row(cases[service]);
        const actor = `receipt-check-${service}`;
        add("direct", data.direct, "direct", "disclosure-fixture");
        add("first_protected", data.first_protected, protection, "disclosure-fixture", actor, false,
          { ...row(data.rule), observed_ms: data.rule_observed_by_ms });
        add("repeat", data.repeat, protection, "disclosure-fixture", actor, true);
        add("other_route", data.other_route, protection, "legitimate", actor);
        add("other_actor", data.other_actor, protection, "disclosure-fixture", `independent-${service}`);
      }
      add("repeated_header", cases.repeated_header, protection, "disclosure-fixture", "header-fields");
      add("unlabelled_record", cases.unlabelled_record, protection, "unlabelled-control", "unlabelled-check");
      if (Array.isArray(cases.request_observations)) {
        for (const [i, fixture] of ["known-indicator", "script-indicator", "query-indicator", "path-indicator", "clean-control"].entries())
          add(fixture, cases.request_observations[i], protection, fixture === "clean-control" ? "legitimate" : "request-indicator", fixture);
      }
    }
  }
  return { id: "recorded", title: "Before and after · 21 Nov 2026", mode: "replay",
    provenance: "Recorded fixture requests through Envoy 1.36.2 and the Go fallback in Lima. Historical event joins use the fixed fixture actor and route.", traces };
}

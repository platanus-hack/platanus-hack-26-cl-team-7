import { describe, expect, it } from "vitest";
import type { Finding, Track, TrackAction, TrackDetail } from "@sentinel/contracts";
import { PROOF_TITLE, browserName, clientWords, knownBy, plainFix, proofDetail, requestLine, signatureWords, splitFix, whyCaught } from "../src/caught/plain";
import { caughtInRange, defaultAgent, emptyState, hasGatewayFeed, statusSentence, visibleTab } from "../src/caught/summary";
import { lineItems, lineMarks } from "../src/caught/line";
import { itemLabel } from "../src/caught/LineReadout";
import { dayClock } from "../src/ui";

const NOW = 1_795_280_000_000;
const MIN = 60_000;
const hex = (n: number) => n.toString(16).padStart(16, "0");

function track(p: Partial<Track> = {}): Track {
  return { trackId: `trk_${hex(1)}`, ip: "203.0.113.7", userAgent: "curl/8.7.1", rule: "R1", reason: "5 requests outside the route list within 300 s", keys: [], openedAt: NOW - 10 * MIN, lastSeen: NOW - MIN, actions: 3, findings: 0, ...p };
}
function action(n: number, p: Partial<TrackAction> = {}): TrackAction {
  return { eventId: `track.action:${n}`, trackId: `trk_${hex(1)}`, ts: NOW - 10 * MIN + n * MIN, method: "GET", path: "/search", query: "", status: 200, durationMs: 2, requestBody: "", responseBody: "", ...p };
}
function finding(p: Partial<Finding> = {}): Finding {
  return {
    findingId: `fnd_${hex(1)}`,
    trackId: `trk_${hex(1)}`,
    ts: NOW - 5 * MIN,
    kind: "signature_success",
    endpoint: "GET /search",
    evidence: "GET /search with signature 'sql tautology' got 200, 723 bytes; the 404 page has 10. Request: GET /search?q=juice%27+OR+%271%27%3d%271",
    proposal: null,
    proposalStatus: "pending",
    ...p,
  };
}

describe("plain words", () => {
  it("names the client the way an operator says it", () => {
    expect(browserName("curl/8.7.1")).toBe("curl");
    expect(browserName("Fuzz Faster U Fool v2.1.0-dev")).toBe("ffuf scanner");
    expect(browserName("python-httpx/0.28")).toBe("Python httpx");
    expect(browserName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15")).toBe("Safari");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36")).toBe("Chrome");
    expect(browserName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0 Safari/537.36 Edge/18.17763")).toBe("Edge");
    expect(browserName("sqlmap/1.8#stable (https://sqlmap.org)")).toBe("sqlmap scanner");
    expect(browserName("Mozilla/5.00 (Nikto/2.5.0) (Evasions:None)")).toBe("Nikto scanner");
    expect(browserName("probe-agent/1.0")).toBe("probe-agent");
    expect(browserName("")).toBe("No browser name");
  });

  it("says why an agent was caught, with the real count and the signature in plain words", () => {
    expect(whyCaught("R1", "5 requests outside the route list within 300 s")).toBe("Probed 5 missing pages");
    expect(whyCaught("R1", "7 requests outside the route list within 300 s")).toBe("Probed 7 missing pages");
    expect(whyCaught("R2", "40 distinct endpoints within 60 s")).toBe("Scanned many pages fast");
    expect(whyCaught("R3", "critical flag: dotenv file")).toBe("Sent an attack pattern: dotenv file");
    expect(whyCaught("R3", "critical flag: sql tautology")).toBe("Sent an attack pattern: SQL injection test");
    expect(whyCaught("R3", "something else")).toBe("Sent an attack pattern");
  });

  it("groups signatures into families an operator knows", () => {
    expect(signatureWords("sql union select")).toBe("SQL injection test");
    expect(signatureWords("xss script tag")).toBe("Script injection test");
    expect(signatureWords("path traversal to secret")).toBe("Path traversal test");
    expect(signatureWords("git metadata")).toBe("git metadata");
  });

  it("names each finding kind and turns its evidence into sentences plus the request", () => {
    expect(PROOF_TITLE).toEqual({ signature_success: "Exploit worked on the decoy", canary_read: "Read decoy data", auth_flip: "Got past login on the decoy" });
    expect(proofDetail(finding())).toEqual({
      text: "SQL injection test on GET /search. The decoy answered 200 with 723 bytes, where a missing page gets 10 bytes.",
      request: "GET /search?q=juice%27+OR+%271%27%3d%271",
    });
    const flip = proofDetail(finding({ kind: "auth_flip", endpoint: "POST /login", evidence: "POST /login answered this track 401 (request r1), now 200 with signature 'sql comment break'. Request: POST /login body {}" }));
    expect(flip.text).toBe("SQL injection test on POST /login. The decoy refused this agent with 401 before, then answered 200.");
    const canary = proofDetail(finding({ kind: "canary_read", endpoint: "GET /api/users", evidence: "GET /api/users holds canary api_key (users.token row 3). Request: GET /api/users" }));
    expect(canary.text).toBe("GET /api/users answered with a decoy api key planted in users.token row 3.");
    expect(proofDetail(finding({ evidence: "odd shape" }))).toEqual({ text: "odd shape", request: null });
  });

  it("says how later requests are tied to the agent", () => {
    expect(knownBy([{ kind: "ip", value: "203.0.113.7" }, { kind: "ip_ua", value: "203.0.113.7|curl" }])).toBe("address, with or without browser");
    expect(knownBy([{ kind: "ip_ua", value: "a" }, { kind: "ip_ua", value: "b" }, { kind: "twin_born", value: "f".repeat(64) }])).toBe("address and browser (it used 2 different browser names), a decoy login");
    expect(knownBy([{ kind: "ip", value: "a" }, { kind: "ip_ua", value: "a|b" }, { kind: "ip_ua", value: "a|c" }])).toBe("address, with or without browser (it used 2 different browser names)");
    expect(knownBy([{ kind: "ip", value: "a" }, { kind: "twin_born", value: "x" }, { kind: "twin_born", value: "y" }])).toBe("address, 2 decoy logins");
  });

  it("names a client that rotates its browser name by its first name and how many others it used", () => {
    const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    const pair = (v: string) => ({ kind: "ip_ua" as const, value: v });
    expect(clientWords({ userAgent: "curl/8.7.1", keys: [pair("a"), { kind: "ip", value: "a" }] })).toBe("curl");
    expect(clientWords({ userAgent: chrome, keys: [pair("a"), pair("b")] })).toBe("Chrome (and 1 other browser name)");
    expect(clientWords({ userAgent: chrome, keys: Array.from({ length: 63 }, (_, i) => pair(`k${i}`)) })).toBe("Chrome (and 62 other browser names)");
  });

  it("writes the literal request line and splits a fix into its steps", () => {
    expect(requestLine({ method: "GET", path: "/search", query: "q=1" })).toBe("GET /search?q=1");
    expect(requestLine({ method: "POST", path: "/login", query: "" })).toBe("POST /login");
    expect(splitFix("SQL injection in GET /search. Fix: 1. Bind the parameter. 2. Validate q. 3. Add a test.")).toEqual({
      lead: "SQL injection in GET /search.",
      steps: ["Bind the parameter.", "Validate q.", "Add a test."],
    });
    expect(splitFix("Use a prepared statement.")).toEqual({ lead: "Use a prepared statement.", steps: [] });
  });

  it("says decoy, not twin, in the fix text it shows", () => {
    expect(plainFix("GET / is open: the twin returned a 200. Twin logs show it. Re-run the scan against the twin.")).toBe(
      "GET / is open: the decoy returned a 200. Decoy logs show it. Re-run the scan against the decoy.",
    );
    expect(plainFix("Both twins and the mirror lane answered; twinkle and betwixt stay.")).toBe("Both decoys and the decoy answered; twinkle and betwixt stay.");
  });

  it("adds the day to a time that is not today", () => {
    const now = new Date(2026, 10, 21, 15, 0).getTime();
    expect(dayClock(new Date(2026, 10, 21, 9, 5).getTime(), now)).toBe("09:05");
    expect(dayClock(new Date(2026, 10, 20, 23, 59).getTime(), now)).toBe("yesterday 23:59");
    expect(dayClock(new Date(2026, 10, 19, 12, 59).getTime(), now)).toBe("19 Nov 12:59");
  });
});

describe("status sentence", () => {
  it("counts the agents caught in the range and says the real shop stayed safe", () => {
    const two = [track(), track({ trackId: `trk_${hex(2)}` })];
    expect(statusSentence(two, NOW, "1h")).toEqual({
      lead: "2 agents caught in the last hour.",
      safe: "After each catch, none of their requests reached the real shop.",
    });
    expect(statusSentence([track()], NOW, "24h")).toEqual({
      lead: "1 agent caught in the last 24 hours.",
      safe: "After the catch, none of its requests reached the real shop.",
    });
  });

  it("says active, not caught, when an agent was caught before the range", () => {
    const old = track({ openedAt: NOW - 30 * MIN, lastSeen: NOW - MIN });
    expect(statusSentence([old], NOW, "5m").lead).toBe("1 caught agent active in the last 5 minutes.");
  });

  it("says nobody was caught when the range is empty", () => {
    expect(statusSentence([], NOW, "1h")).toEqual({ lead: "No agent caught in the last hour.", safe: null });
  });

  it("lists only agents active in the range", () => {
    const recent = track({ lastSeen: NOW - MIN });
    const stale = track({ trackId: `trk_${hex(2)}`, lastSeen: NOW - 2 * 60 * MIN });
    expect(caughtInRange([recent, stale], NOW, "1h")).toEqual([recent]);
    expect(caughtInRange([recent, stale], NOW, "24h")).toHaveLength(2);
    expect(caughtInRange([recent], NOW, "5m")).toEqual([recent]);
  });
});

describe("default agent", () => {
  it("opens on the newest agent that reached the decoy or proved something, else the newest one", () => {
    const quiet = track({ trackId: `trk_${hex(5)}`, actions: 0, findings: 0 });
    const busy = track({ trackId: `trk_${hex(6)}`, actions: 4 });
    const proved = track({ trackId: `trk_${hex(7)}`, actions: 0, findings: 1 });
    expect(defaultAgent([quiet, busy])).toBe(`trk_${hex(6)}`);
    expect(defaultAgent([quiet, proved, busy])).toBe(`trk_${hex(7)}`);
    expect(defaultAgent([quiet])).toBe(`trk_${hex(5)}`);
    expect(defaultAgent([])).toBeNull();
  });
});

describe("empty state", () => {
  it("says what the screen will show and how to see it", () => {
    const e = emptyState("1h", 0);
    expect(e.title).toBe("Send a scanner at the shop and it shows here within 2 seconds.");
    expect(e.body).toContain("decoy copy of the shop");
    expect(e.widen).toBeNull();
  });

  it("offers the 24 hour range when agents were caught earlier", () => {
    expect(emptyState("5m", 1).widen).toBe("Show the agent caught in the last 24 hours");
    expect(emptyState("1h", 4).widen).toBe("Show the 4 agents caught in the last 24 hours");
    expect(emptyState("24h", 4).widen).toBeNull();
  });
});

describe("gateway feed tab", () => {
  const empty = { events: [], attackers: [], series: [{ t: NOW, received: 0, killed: 0 }] };

  it("shows only when the gateway feed has data", () => {
    expect(hasGatewayFeed(empty)).toBe(false);
    expect(hasGatewayFeed({ ...empty, series: [{ t: NOW, received: 2, killed: 1 }] })).toBe(true);
    expect(visibleTab("gateway", false)).toBe("caught");
    expect(visibleTab("gateway", true)).toBe("gateway");
    expect(visibleTab("caught", true)).toBe("caught");
  });
});

describe("mirror line marks", () => {
  const t = track({ openedAt: NOW - 10 * MIN, lastSeen: NOW, actions: 3, findings: 1 });
  const fix = { summary: "Bind it.", generatedAt: NOW - 4 * MIN, model: "m" };
  const detail: TrackDetail = { track: t, actions: [action(9), action(2), action(5, { status: 404 })], findings: [finding({ proposal: fix, proposalStatus: "ready" })] };

  it("puts requests, proofs and fixes in time order between the catch and the last mark", () => {
    const g = lineMarks(detail);
    expect(g.marks.map((m) => [m.kind, m.seg, m.at])).toEqual([
      ["request", "window", 0.2],
      ["request", "window", 0.5],
      ["proof", "window", 0.5],
      ["fix", "window", 0.6],
      ["request", "window", 0.9],
    ]);
    expect(g.marks[1]!.text).toBe("GET /search");
    expect(g.marks[1]!.status).toBe(404);
    expect(g.notLoaded).toBe(0);
    expect(g.breakAt).toBe(g.start);
  });

  it("shows the request that proved a proof, or its endpoint without one", () => {
    const proof = lineMarks(detail).marks.find((m) => m.kind === "proof")!;
    expect([proof.title, proof.text]).toEqual(["Exploit worked on the decoy:", "GET /search?q=juice%27+OR+%271%27%3d%271"]);
    const bare = lineMarks({ ...detail, findings: [finding({ evidence: "odd shape" })] }).marks.find((m) => m.kind === "proof")!;
    expect(bare.text).toBe("GET /search");
  });

  it("gives the earlier requests that are not loaded one band, and the loaded window the rest", () => {
    const g = lineMarks({ ...detail, track: { ...t, actions: 4820 } });
    expect(g.notLoaded).toBe(4817);
    expect(g.breakAt).toBe(NOW - 8 * MIN);
    // The proof (5 min) and fix (4 min) are in the window, at their true times in it.
    expect(g.marks.map((m) => [m.kind, m.seg, Number(m.at.toFixed(3))])).toEqual([
      ["request", "window", 0],
      ["request", "window", 0.375],
      ["proof", "window", 0.375],
      ["fix", "window", 0.5],
      ["request", "window", 0.875],
    ]);
    // A proof before the oldest loaded request sits in the band, at its true time there.
    const early = lineMarks({ ...detail, track: { ...t, actions: 4820 }, findings: [finding({ ts: NOW - 9 * MIN })] });
    expect(early.marks.find((m) => m.kind === "proof")).toMatchObject({ seg: "band", at: 0.5 });
  });

  it("bins requests into a density strip and keeps each proof and fix as its own mark", () => {
    const many: TrackDetail = {
      track: { ...t, actions: 200 },
      actions: Array.from({ length: 200 }, (_, i) => action(0, { eventId: `a${i}`, ts: NOW - 10 * MIN + i * 3000 })),
      findings: [finding({ proposal: fix, proposalStatus: "ready" })],
    };
    const items = lineItems(lineMarks(many), 10);
    const bins = items.filter((i) => i.kind === "request");
    expect(bins.length).toBeLessThanOrEqual(10);
    expect(bins.reduce((n, b) => n + b.marks.length, 0)).toBe(200);
    expect(items.filter((i) => i.kind !== "request").map((i) => i.kind)).toEqual(["proof", "fix"]);
    const xs = items.map((i) => i.at);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(itemLabel(bins[0]!)).toMatch(/^\d+ decoy requests from \d\d:\d\d:\d\d to \d\d:\d\d:\d\d, the last GET \/search, answered 200$/);
    const one = lineItems(lineMarks(detail), 100).find((i) => i.kind === "request")!;
    expect(itemLabel(one)).toMatch(/^Decoy request at \d\d:\d\d:\d\d: GET \/search, answered 200$/);
  });

  it("draws no fix mark while the fix is being written", () => {
    expect(lineMarks({ ...detail, findings: [finding()] }).marks.some((m) => m.kind === "fix")).toBe(false);
  });
});

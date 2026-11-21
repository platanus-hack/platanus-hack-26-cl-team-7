import { describe, expect, it } from "vitest";
import {
  ApiError,
  DeceptionAccepted,
  FindingPage,
  IDEMPOTENCY_KEY_REUSED,
  TrackDetail,
  TrackPage,
  type DeceptionEvent,
  type StreamBatch,
} from "@sentinel/contracts";
import { createApp } from "../src/app.ts";
import { T0, TRACK, dec, setup, tick } from "./helpers.ts";

const TOKEN = "router-token";

function withToken() {
  const s = setup(null, () => T0 + 10);
  return { ...s, app: createApp({ ...s, ingestToken: TOKEN }) };
}

function post(app: ReturnType<typeof setup>["app"], body: unknown, headers: Record<string, string> = {}) {
  return app.request("/v1/deception/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /v1/deception/events", () => {
  it("answers 202 with accepted and duplicate counts", async () => {
    const { app } = withToken();
    const batch = [dec.opened(), dec.action(), dec.finding()];
    const first = await post(app, batch);
    expect(first.status).toBe(202);
    expect(DeceptionAccepted.parse(await first.json())).toEqual({ accepted: 3, duplicates: 0 });
    const retry = await post(app, batch);
    expect(await retry.json()).toEqual({ accepted: 0, duplicates: 3 });
  });

  it("refuses a missing or wrong bearer token before reading the body", async () => {
    const { app, deception } = withToken();
    expect((await post(app, [dec.opened()], { Authorization: "" })).status).toBe(401);
    const wrong = await post(app, [dec.opened()], { Authorization: "Bearer nope" });
    expect(wrong.status).toBe(401);
    expect(ApiError.parse(await wrong.json()).error.code).toBe("unauthorized");
    expect(deception.track(TRACK)).toBeNull();
  });

  it("answers 422 IDEMPOTENCY_KEY_REUSED and stores nothing from that batch", async () => {
    const { app, deception } = withToken();
    const action = dec.action();
    await post(app, [dec.opened(), action]);
    const res = await post(app, [dec.action(), { ...action, durationMs: 99 } as DeceptionEvent]);
    expect(res.status).toBe(422);
    const err = ApiError.parse(await res.json()).error;
    expect(err.code).toBe(IDEMPOTENCY_KEY_REUSED);
    expect(err.message).toContain(action.eventId);
    expect(deception.track(TRACK)!.track.actions).toBe(1);
  });

  it("rejects bad input with the error envelope and a short message", async () => {
    const { app } = withToken();
    for (const body of ["not json", [], { ...dec.opened() }, [{ ...dec.action(), lane: "mirror" }]]) {
      const res = await post(app, body);
      expect(res.status).toBe(400);
      expect(ApiError.parse(await res.json()).error.code).toBe("invalid_request");
    }
    const bad = Array.from({ length: 50 }, () => ({ ...dec.action(), status: 42 }));
    const msg = ApiError.parse(await (await post(app, bad)).json()).error.message;
    expect(msg).toMatch(/and 40 more issues/);
    expect((await post(app, Array.from({ length: 501 }, () => dec.action()))).status).toBe(400);
  });

  it("refuses a body over the limit with 413", async () => {
    const { app } = withToken();
    const res = await post(app, "x".repeat(16 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it("stores each event once when the same batch races in parallel", async () => {
    const { app, deception } = withToken();
    const batch = [dec.opened(), ...Array.from({ length: 50 }, () => dec.action())];
    const answers = await Promise.all(Array.from({ length: 8 }, async () => DeceptionAccepted.parse(await (await post(app, batch)).json())));
    expect(answers.reduce((n, a) => n + a.accepted, 0)).toBe(51);
    expect(answers.reduce((n, a) => n + a.duplicates, 0)).toBe(51 * 7);
    expect(deception.track(TRACK)!.track.actions).toBe(50);
  });
});

describe("GET /v1/tracks and /v1/findings", () => {
  it("lists tracks and findings and returns one track in the contract shape", async () => {
    const { app } = withToken();
    await post(app, [dec.opened(), dec.action({ status: 200 }), dec.finding()]);
    const tracks = TrackPage.parse(await (await app.request("/v1/tracks?range=1h&limit=10")).json());
    expect(tracks.items.map((t) => t.trackId)).toEqual([TRACK]);
    expect(tracks.nextCursor).toBeNull();
    const detail = TrackDetail.parse(await (await app.request(`/v1/tracks/${TRACK}`)).json());
    expect(detail.actions[0]!.status).toBe(200);
    expect(detail.findings).toHaveLength(1);
    const findings = FindingPage.parse(await (await app.request("/v1/findings")).json());
    expect(findings.items[0]!.proposal).toBeNull();
  });

  it("answers an unknown track with 404 and bad paging with 400", async () => {
    const { app } = withToken();
    const missing = await app.request("/v1/tracks/trk_ffffffffffffffff");
    expect(missing.status).toBe(404);
    expect(ApiError.parse(await missing.json()).error.code).toBe("track_not_found");
    expect((await app.request("/v1/tracks/not-a-track")).status).toBe(404);
    const codes = async (url: string) => ApiError.parse(await (await app.request(url)).json()).error.code;
    expect(await codes("/v1/tracks?range=2h")).toBe("invalid_query");
    expect(await codes("/v1/findings?limit=0")).toBe("invalid_query");
    expect(await codes("/v1/findings?cursor=garbage")).toBe("invalid_cursor");
  });

  it("streams track and finding changes", async () => {
    const { app, bus } = withToken();
    const frames: StreamBatch[] = [];
    bus.subscribe((f) => frames.push(f.batch));
    await post(app, [dec.opened(), dec.finding()]);
    await tick();
    const kinds = frames.flatMap((f) => f.changes.map((c) => c.kind));
    expect(kinds).toEqual(["track", "finding"]);
  });
});

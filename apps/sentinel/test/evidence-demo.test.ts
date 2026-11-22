import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { EvidenceDemoBundle } from "@sentinel/contracts";
import { evidenceDemoRoutes } from "../src/evidence-demo/routes.ts";
import { setup } from "./helpers.ts";

describe("GET /v1/evidence-demo", () => {
  it("serves the two replays with AI off and leaves live events empty", async () => {
    const { app } = setup();
    const response = await app.request("/v1/evidence-demo");
    expect(response.status).toBe(200);
    const { runs: [bank, detector] } = EvidenceDemoBundle.parse(await response.json());
    for (const [arm, disclosed] of [["direct", true], ["protected", false]] as const) {
      const trials = bank.trials.filter((t) => t.arm === arm);
      const events = trials.flatMap((t) => t.observations);
      expect(events.filter((e) => e.kind === "disclosure").map((e) => e.disclosed)).toEqual(Array(5).fill(disclosed));
      expect(events.filter((e) => e.kind === "execution").map((e) => e.executed)).toEqual(Array(5).fill(true));
      const benign = trials.filter((t) => t.profile === "benign").flatMap((t) => t.observations);
      expect(benign.filter((e) => e.kind === "response").map((e) => e.blocked)).toEqual(Array(25).fill(false));
      expect(events.every((e) => e.timestamp === null && !e.requestId && !e.traceId)).toBe(true);
    }
    const verdicts = detector.trials.flatMap((t) => t.observations.filter((e) => e.kind === "verdict"));
    expect(verdicts).toMatchObject([{ rule: "R1", ordinal: 5, runId: detector.id }]);
    const snapshot = await (await app.request("/v1/snapshot")).json();
    expect(snapshot.events).toEqual([]);
  });

  it.each([
    () => { throw new Error("missing"); },
    () => "invalid JSON",
    () => "{}",
  ])("answers 503 when bundled evidence is unavailable", async (readBundle) => {
    const app = new Hono().basePath("/v1").route("/", evidenceDemoRoutes(readBundle));
    const response = await app.request("/v1/evidence-demo");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "evidence_demo_unavailable" } });
  });

  it("rejects observations pointing to a different run", async () => {
    const { app } = setup();
    const body = await (await app.request("/v1/evidence-demo")).json();
    body.runs[1].trials[0].observations[0].runId = body.runs[0].id;
    expect(EvidenceDemoBundle.safeParse(body).success).toBe(false);
  });
});

import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import type { Finding } from "@sentinel/contracts";
import { Bus } from "../src/bus.ts";
import { DeceptionStore } from "../src/deception.ts";
import { FixProposer, type FixOptions } from "../src/fixes.ts";
import { T0, dec, fakeClient, proposal, tick } from "./helpers.ts";

const FINDING = "fnd_fedcba9876543210";

function setupFixes(client: Anthropic | null, opts: Partial<FixOptions> = {}, db = new DatabaseSync(":memory:")) {
  const bus = new Bus(1);
  const deception = new DeceptionStore(db, bus, { now: () => T0 + 10 });
  const findings: Finding[] = [];
  bus.subscribe((f) => {
    for (const c of f.changes) if (c.kind === "finding") findings.push(c.finding);
  });
  const fixes = new FixProposer(deception, bus, { client, retryMs: 5, ...opts });
  return { bus, deception, fixes, findings, db };
}

async function until(check: () => boolean, ms = 1000) {
  const end = Date.now() + ms;
  while (!check() && Date.now() < end) await tick(5);
}

describe("fix proposals", () => {
  it("writes a proposal for a confirmed finding and streams the updated finding", async () => {
    const { client, calls } = fakeClient({ parse: () => proposal("SQL injection in POST /login. 1. Use a bound parameter.") });
    const { deception, fixes, findings } = setupFixes(client);
    deception.ingest([dec.opened(), dec.action({ requestBody: "username=admin'--" }), dec.finding()]);
    await until(() => findings.at(-1)?.proposal != null);
    expect(deception.finding(FINDING)!.proposal).toMatchObject({ summary: expect.stringContaining("bound parameter"), model: "claude-opus-5-5" });
    expect(findings.map((f) => f.proposal === null)).toEqual([true, false]);
    expect(calls.parse).toHaveLength(1);
    const prompt = JSON.stringify(calls.parse[0]);
    expect(prompt).toContain("untrusted_evidence");
    expect(prompt).toContain("admin'--");
    expect(prompt).not.toContain("Wrong user name"); // twin response bodies stay out of the prompt
    fixes.stop();
  });

  it("leaves the proposal empty and never calls a model when AI is off", async () => {
    const { deception, fixes } = setupFixes(null);
    expect(fixes.enabled).toBe(false);
    deception.ingest([dec.opened(), dec.finding()]);
    await tick();
    expect(deception.finding(FINDING)!.proposal).toBeNull();
    fixes.stop();
  });

  it("retries a failed call with backoff and gives up after the last attempt", async () => {
    let n = 0;
    const { client, calls } = fakeClient({
      parse: () => {
        n++;
        if (n === 1) throw new Error("overloaded");
        if (n === 2) return { stop_reason: "refusal", model: "m", parsed_output: null };
        return proposal("Fix it.");
      },
    });
    const { deception, fixes } = setupFixes(client);
    deception.ingest([dec.opened(), dec.finding()]);
    await until(() => deception.finding(FINDING)?.proposal !== null);
    expect(calls.parse).toHaveLength(3);
    expect(deception.finding(FINDING)!.proposal!.summary).toBe("Fix it.");

    const failing = fakeClient({ parse: () => Promise.reject(new Error("down")) });
    const second = setupFixes(failing.client, { attempts: 2 });
    second.deception.ingest([dec.opened(), dec.finding()]);
    await tick(80);
    expect(failing.calls.parse).toHaveLength(2);
    expect(second.deception.finding(FINDING)!.proposal).toBeNull();
    expect(second.deception.finding(FINDING)!.proposalStatus).toBe("failed");
    expect(second.findings.map((f) => f.proposalStatus)).toEqual(["pending", "failed"]);
    expect(deception.finding(FINDING)!.proposalStatus).toBe("ready");
    fixes.stop();
    second.fixes.stop();
  });

  it("tries a failed proposal again after a restart, and never on its own failed frame", async () => {
    const db = new DatabaseSync(":memory:");
    const failing = fakeClient({ parse: () => Promise.reject(new Error("down")) });
    const first = setupFixes(failing.client, { attempts: 1 }, db);
    first.deception.ingest([dec.opened(), dec.finding()]);
    await tick(40);
    expect(failing.calls.parse).toHaveLength(1);
    expect(first.deception.finding(FINDING)!.proposalStatus).toBe("failed");
    first.fixes.stop();
    const { client } = fakeClient({ parse: () => proposal("Second try.") });
    const again = setupFixes(client, {}, db);
    await until(() => again.deception.finding(FINDING)?.proposal !== null);
    expect(again.deception.finding(FINDING)!.proposalStatus).toBe("ready");
    expect(again.deception.setProposalFailed(FINDING)).toBe(false); // a written proposal stays
    again.fixes.stop();
  });

  it("does not retry an answer that fails the same way every time, but retries a rate limit", async () => {
    const apiError = (status: number) => Anthropic.APIError.generate(status, { type: "error", error: { type: "error", message: "no" } }, "no", new Headers());
    const bad = fakeClient({ parse: () => Promise.reject(apiError(400)) });
    const first = setupFixes(bad.client);
    first.deception.ingest([dec.opened(), dec.finding()]);
    const limited = fakeClient({ parse: () => Promise.reject(apiError(429)) });
    const second = setupFixes(limited.client);
    second.deception.ingest([dec.opened(), dec.finding()]);
    await tick(80);
    expect(bad.calls.parse).toHaveLength(1);
    expect(limited.calls.parse).toHaveLength(3);
    first.fixes.stop();
    second.fixes.stop();
  });

  it("caps concurrent calls and calls per minute", async () => {
    let running = 0;
    let peak = 0;
    const { client, calls } = fakeClient({
      parse: async () => {
        peak = Math.max(peak, ++running);
        await tick(10);
        running--;
        return proposal("Fix.");
      },
    });
    const { deception, fixes } = setupFixes(client, { concurrency: 2, perMinute: 3 });
    const ids = Array.from({ length: 5 }, (_, i) => `fnd_${i.toString(16).padStart(16, "0")}`);
    deception.ingest([dec.opened(), ...ids.map((findingId) => dec.finding({ findingId }))]);
    await tick(100);
    expect(peak).toBe(2);
    expect(calls.parse).toHaveLength(3);
    expect(ids.filter((id) => deception.finding(id)!.proposal === null)).toHaveLength(2);
    fixes.stop();
  });

  it("marks a finding failed when the queue is full", async () => {
    const { client } = fakeClient({ parse: () => new Promise<never>(() => {}) });
    const { deception, fixes } = setupFixes(client, { concurrency: 1 });
    const ids = Array.from({ length: 102 }, (_, i) => `fnd_${i.toString(16).padStart(16, "0")}`);
    deception.ingest([dec.opened(), ...ids.map((findingId) => dec.finding({ findingId }))]);
    await tick(20);
    expect(ids.filter((id) => deception.finding(id)!.proposalStatus === "failed")).toEqual([ids[101]]);
    fixes.stop();
  });

  it("picks up findings still waiting for a proposal after a restart", async () => {
    const db = new DatabaseSync(":memory:");
    const off = setupFixes(null, {}, db);
    off.deception.ingest([dec.opened(), dec.finding()]);
    const { client } = fakeClient({ parse: () => proposal("Later fix.") });
    const on = setupFixes(client, {}, db);
    await until(() => on.deception.finding(FINDING)?.proposal !== null);
    expect(on.deception.finding(FINDING)!.proposal!.summary).toBe("Later fix.");
    on.fixes.stop();
  });

  it("stops retrying once stopped", async () => {
    const failing = fakeClient({ parse: () => Promise.reject(new Error("down")) });
    const { deception, fixes } = setupFixes(failing.client, { retryMs: 30 });
    deception.ingest([dec.opened(), dec.finding()]);
    await tick(10);
    fixes.stop();
    await tick(60);
    expect(failing.calls.parse).toHaveLength(1);
  });
});

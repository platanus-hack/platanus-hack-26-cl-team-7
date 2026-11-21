import { describe, expect, it } from "vitest";
import { caughtFor } from "../src/mirror/MirrorPanel";

describe("caughtFor", () => {
  it("says why the router caught an agent in plain words", () => {
    expect(caughtFor({ rule: "R1", reason: "5 requests outside the route list within 300 s" })).toBe("Probed missing pages");
    expect(caughtFor({ rule: "R2", reason: "12 distinct endpoints within 60 s" })).toBe("Scanned many pages fast");
    expect(caughtFor({ rule: "R3", reason: "critical flag: dotenv file" })).toBe("Sent an attack pattern (dotenv file)");
    expect(caughtFor({ rule: "R3", reason: "critical flag: sql tautology (login body)" })).toBe("Sent an attack pattern (sql tautology)");
    expect(caughtFor({ rule: "R3", reason: "" })).toBe("Sent an attack pattern");
  });
});

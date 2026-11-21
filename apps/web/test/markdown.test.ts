import { describe, expect, it } from "vitest";
import { inlineToText, parseBlocks, parseInline, toFinding } from "../src/copilot/markdown";

describe("parseInline", () => {
  it("splits bold and code", () => {
    expect(parseInline("Block **both** IPs on `/v1/assistant`.")).toEqual([
      { t: "text", v: "Block " },
      { t: "b", v: "both" },
      { t: "text", v: " IPs on " },
      { t: "code", v: "/v1/assistant" },
      { t: "text", v: "." },
    ]);
  });
  it("never turns html into markup", () => {
    expect(parseInline("<img src=x onerror=alert(1)>")).toEqual([{ t: "text", v: "<img src=x onerror=alert(1)>" }]);
  });
});

describe("toFinding", () => {
  it("splits a bold title from its detail", () => {
    const f = toFinding("**One actor behind two IPs.** `203.0.113.42` and `203.0.113.9` share a fingerprint.");
    expect(inlineToText(f.title!)).toBe("One actor behind two IPs");
    expect(inlineToText(f.detail)).toBe("203.0.113.42 and 203.0.113.9 share a fingerprint.");
  });
  it("accepts a dash separator", () => {
    const f = toFinding("**Scanner** — sends SQL injection");
    expect(inlineToText(f.detail)).toBe("sends SQL injection");
  });
});

describe("parseBlocks", () => {
  const answer = `Three patterns stand out in the last hour.

- **One actor behind two IPs.** They share a fingerprint.
- **Prompt injection is rising.** 4x the hour before.

## How to fix
1. **Block both IPs at the gateway.** One actor.
2. **Revoke the stolen session.**`;

  it("parses lead, findings, heading and steps", () => {
    const b = parseBlocks(answer);
    expect(b.map((x) => x.kind)).toEqual(["p", "ul", "h", "ol"]);
    expect(b[2]).toEqual({ kind: "h", text: "How to fix" });
    const ol = b[3];
    expect(ol?.kind === "ol" && ol.items.length).toBe(2);
  });

  it("treats a bold line on its own as a heading", () => {
    expect(parseBlocks("**How to fix:**\n1. Do it")[0]).toEqual({ kind: "h", text: "How to fix" });
  });

  it("joins wrapped list lines and paragraph lines", () => {
    const b = parseBlocks("- **A.** first\n  continues\nline one\nline two");
    expect(b[0]?.kind === "ul" && inlineToText(b[0].items[0]!.detail)).toBe("first continues");
    expect(b[1]?.kind === "p" && inlineToText(b[1].inl)).toBe("line one line two");
  });

  it("is safe on partial streaming text", () => {
    expect(() => parseBlocks("- **Unclosed bold")).not.toThrow();
  });
});

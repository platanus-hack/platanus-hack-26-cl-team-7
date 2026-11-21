import { describe, expect, it } from "vitest";
import { createSseParser, readSse } from "../src/sentinel";

describe("createSseParser", () => {
  it("parses events split across chunks", () => {
    const p = createSseParser();
    expect(p.push("event: text\ndata: {\"a\"")).toEqual([]);
    expect(p.push(":1}\n\n")).toEqual([{ event: "text", data: '{"a":1}', id: undefined }]);
  });

  it("handles CRLF, ids, comments and multi-line data", () => {
    const p = createSseParser();
    const out = p.push(": heartbeat\r\nid: 7\r\nevent: batch\r\ndata: one\r\ndata: two\r\n\r\n");
    expect(out).toEqual([{ event: "batch", data: "one\ntwo", id: "7" }]);
  });

  it("defaults the event name to message", () => {
    expect(createSseParser().push("data: hi\n\n")[0]!.event).toBe("message");
  });
});

describe("readSse", () => {
  it("reads a byte stream", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode("event: text\ndata: {\"type\":\"text\",\"delta\":\"Hi\"}\n\nevent: done\n"));
        c.enqueue(enc.encode("data: {\"type\":\"done\"}\n\n"));
        c.close();
      },
    });
    const got: string[] = [];
    for await (const m of readSse(body)) got.push(m.event);
    expect(got).toEqual(["text", "done"]);
  });
});

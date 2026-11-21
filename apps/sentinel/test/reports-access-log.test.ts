import { appendFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { accessLogSource, StoreDownError } from "../src/reports/sources.ts";
import { IP, MIN, NOW, SCOPE, caddyLine, cleanupTemp, tempDir, writeAccessLog } from "./reports-helpers.ts";

afterEach(cleanupTemp);

/** A Caddy access line for IP, `minutes` before NOW, inside the scope window. */
const line = (minutes: number, uri: string) => caddyLine({ ts: (NOW - minutes * MIN) / 1000, remoteIp: IP, clientIp: IP, method: "GET", uri, status: 200 });
const ids = (src: ReturnType<typeof accessLogSource>) => src.list(SCOPE).map((r) => r.id);

/** writeAccessLog leaves 6 lines: rows acc:1 and acc:6 are this IP's inside the window. */
function open() {
  const path = writeAccessLog(tempDir());
  return { path, src: accessLogSource(path) };
}

describe("accessLogSource reads only what was added", () => {
  it("shows appended lines under stable ids and keeps the rows it already parsed", () => {
    const { path, src } = open();
    const first = src.list(SCOPE);
    expect(first.map((r) => r.id)).toEqual(["acc:1", "acc:6"]);
    appendFileSync(path, `${line(18.2, "/a")}\n${line(18.1, "/b?x=1")}\n`);
    const second = src.list(SCOPE);
    expect(second.map((r) => r.id)).toEqual(["acc:1", "acc:6", "acc:7", "acc:8"]);
    // The same objects: the old lines were not parsed a second time.
    expect(second[0]).toBe(first[0]);
    expect(second[1]).toBe(first[1]);
    expect(src.get("acc:8")?.row).toMatchObject({ path: "/b", payload: "x=1" });
  });

  it("counts lines it cannot parse, so ids match the line numbers of the file", () => {
    const { path, src } = open();
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    appendFileSync(path, `not json\n\n${line(18.2, "/a")}\n`);
    expect(ids(src)).toEqual(["acc:1", "acc:6", "acc:9"]);
  });

  it("waits for the newline of a partial last line, then adds it once", () => {
    const { path, src } = open();
    const full = line(18.2, "/a");
    appendFileSync(path, full.slice(0, 40));
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    expect(src.get("acc:7")).toBeNull();
    appendFileSync(path, `${full.slice(40)}\n${line(18.1, "/b")}\n`);
    expect(ids(src)).toEqual(["acc:1", "acc:6", "acc:7", "acc:8"]);
    expect(src.get("acc:7")?.row.path).toBe("/a");
  });

  it("shows a complete last line that has no newline yet and keeps its id when the newline arrives", () => {
    const { path, src } = open();
    appendFileSync(path, line(18.2, "/a"));
    expect(ids(src)).toEqual(["acc:1", "acc:6", "acc:7"]);
    expect(ids(src)).toEqual(["acc:1", "acc:6", "acc:7"]);
    appendFileSync(path, `\n${line(18.1, "/b")}\n`);
    expect(ids(src)).toEqual(["acc:1", "acc:6", "acc:7", "acc:8"]);
    expect(src.get("acc:7")?.row.path).toBe("/a");
  });

  it("reads a multi-byte character that two reads split in the middle", () => {
    const { path, src } = open();
    const bytes = Buffer.from(`${line(18.2, "/ñandú")}\n`);
    const cut = bytes.indexOf(Buffer.from("ñ")) + 1;
    appendFileSync(path, bytes.subarray(0, cut));
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    appendFileSync(path, bytes.subarray(cut));
    expect(src.get("acc:7")?.row.path).toBe("/ñandú");
  });
});

describe("accessLogSource when the file changes under it", () => {
  it("reads the file again from the start when it shrank", () => {
    const { path, src } = open();
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    writeFileSync(path, `${line(18.2, "/only")}\n`);
    expect(src.list(SCOPE)).toEqual([expect.objectContaining({ id: "acc:1", path: "/only" })]);
    expect(src.get("acc:6")).toBeNull();
  });

  it("reads the file again from the start when it was replaced by a larger one", () => {
    const { path, src } = open();
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    const replacement = join(tempDir(), "access.log");
    writeFileSync(replacement, Array.from({ length: 12 }, (_, i) => `${line(18.9 - i / 10, `/new/${i}`)}\n`).join(""));
    renameSync(replacement, path);
    const rows = src.list(SCOPE);
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 12 }, (_, i) => `acc:${i + 1}`));
    expect(rows.map((r) => r.path)).toEqual(Array.from({ length: 12 }, (_, i) => `/new/${i}`));
  });

  it("throws StoreDownError when the log disappears after it was read", () => {
    const { path, src } = open();
    expect(ids(src)).toEqual(["acc:1", "acc:6"]);
    rmSync(path);
    expect(() => src.list(SCOPE)).toThrow(StoreDownError);
    expect(() => src.get("acc:1")).toThrow(StoreDownError);
  });
});

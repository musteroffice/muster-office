import { appendFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JsonlTailer } from "../src/tailer.js";
import { PathDenied, SafeReader, TooLarge } from "../src/safe-fs.js";

let dir: string;
let reader: SafeReader;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "automicvault-fs-"));
  reader = new SafeReader();
  reader.setRoots([{ path: dir, kind: "dir" }]);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("JsonlTailer", () => {
  it("reads complete lines only and holds back a torn tail", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, "one\ntwo\npar");
    const t = new JsonlTailer(reader, file);
    const a = await t.poll();
    expect(a).toMatchObject({ reset: true, lines: ["one", "two"], missing: false });
    appendFileSync(file, "tial\nthree\n");
    const b = await t.poll();
    expect(b).toMatchObject({ reset: false, lines: ["partial", "three"] });
    expect((await t.poll()).lines).toEqual([]);
  });

  it("handles CRLF endings", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, "a\r\nb\r\n");
    expect((await new JsonlTailer(reader, file).poll()).lines).toEqual(["a", "b"]);
  });

  it("resets when the file shrinks (truncation)", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, "aaaa\nbbbb\ncccc\n");
    const t = new JsonlTailer(reader, file);
    await t.poll();
    truncateSync(file, 0);
    writeFileSync(file, "x\n");
    const r = await t.poll();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(["x"]);
  });

  it("resets when the file is replaced by another file (rename over)", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, "old1\nold2\n");
    const t = new JsonlTailer(reader, file);
    await t.poll();
    const next = join(dir, "next.tmp");
    writeFileSync(next, "new-one-is-longer-than-old\n");
    renameSync(next, file);
    const r = await t.poll();
    expect(r.reset).toBe(true);
    expect(r.lines).toEqual(["new-one-is-longer-than-old"]);
  });

  it("reports a missing file, then a reset when it comes back", async () => {
    const file = join(dir, "q.jsonl");
    const t = new JsonlTailer(reader, file);
    expect(await t.poll()).toMatchObject({ missing: true, reset: false });
    writeFileSync(file, "a\n");
    expect(await t.poll()).toMatchObject({ missing: false, reset: true, lines: ["a"] });
    rmSync(file);
    expect(await t.poll()).toMatchObject({ missing: true, reset: true });
    writeFileSync(file, "b\n");
    expect(await t.poll()).toMatchObject({ reset: true, lines: ["b"] });
  });

  it("starts at a line boundary when only the trailing bytes are wanted", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, Array.from({ length: 100 }, (_, i) => `line-${String(i).padStart(3, "0")}`).join("\n") + "\n");
    const t = new JsonlTailer(reader, file, { initialTailBytes: 50 });
    const r = await t.poll();
    expect(r.lines.length).toBeGreaterThan(0);
    expect(r.lines.every((l) => /^line-\d{3}$/.test(l))).toBe(true);
    expect(r.lines.at(-1)).toBe("line-099");
  });

  it("drains big appends across polls using `more`", async () => {
    const file = join(dir, "q.jsonl");
    writeFileSync(file, Array.from({ length: 50 }, (_, i) => `l${i}`).join("\n") + "\n");
    const t = new JsonlTailer(reader, file, { maxBytesPerPoll: 20 });
    const all: string[] = [];
    for (let i = 0; i < 100; i++) {
      const r = await t.poll();
      all.push(...r.lines);
      if (!r.more) break;
    }
    expect(all).toHaveLength(50);
    expect(all[49]).toBe("l49");
  });
});

describe("SafeReader", () => {
  it("reads files inside a root and returns null for missing ones", async () => {
    writeFileSync(join(dir, "a.json"), '{"a":1}');
    expect(await reader.readText(join(dir, "a.json"))).toBe('{"a":1}');
    expect(await reader.readText(join(dir, "nope.json"))).toBeNull();
    expect(await reader.list(join(dir, "missing-dir"))).toEqual([]);
  });

  it("denies paths outside every root, including .. traversal", async () => {
    const outside = mkdtempSync(join(tmpdir(), "automicvault-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "top secret");
      await expect(reader.readText(join(outside, "secret.txt"))).rejects.toBeInstanceOf(PathDenied);
      await expect(reader.readText(join(dir, "..", outside.split(/[\\/]/).pop()!, "secret.txt"))).rejects.toBeInstanceOf(PathDenied);
      await expect(reader.readText("relative/path.txt")).rejects.toBeInstanceOf(PathDenied);
      await expect(reader.readText(`${dir}/a\0b`)).rejects.toBeInstanceOf(PathDenied);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("denies a sibling directory that merely shares the root's prefix", async () => {
    const sibling = `${dir}-evil`;
    mkdirSync(sibling);
    try {
      writeFileSync(join(sibling, "x.txt"), "x");
      await expect(reader.readText(join(sibling, "x.txt"))).rejects.toBeInstanceOf(PathDenied);
    } finally {
      rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("denies a directory link (symlink/junction) that points outside the root", async () => {
    const outside = mkdtempSync(join(tmpdir(), "automicvault-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "top secret");
      symlinkSync(outside, join(dir, "linkdir"), "junction"); // junctions need no privilege on Windows
      await expect(reader.readText(join(dir, "linkdir", "secret.txt"))).rejects.toBeInstanceOf(PathDenied);
      await expect(reader.list(join(dir, "linkdir"))).rejects.toBeInstanceOf(PathDenied);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("denies a file symlink that points outside the root", async (ctx) => {
    const outside = mkdtempSync(join(tmpdir(), "automicvault-outside-"));
    try {
      writeFileSync(join(outside, "secret.txt"), "top secret");
      try {
        symlinkSync(join(outside, "secret.txt"), join(dir, "link.txt"));
      } catch {
        ctx.skip(); // Windows without symlink privilege
        return;
      }
      await expect(reader.readText(join(dir, "link.txt"))).rejects.toBeInstanceOf(PathDenied);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("follows a symlinked root itself (a user may symlink ~/.local/state/muster)", async () => {
    const real = mkdtempSync(join(tmpdir(), "automicvault-real-"));
    const link = `${dir}-link`;
    try {
      writeFileSync(join(real, "a.txt"), "ok");
      symlinkSync(real, link, "junction");
      const r = new SafeReader();
      r.setRoots([{ path: link, kind: "dir" }]);
      expect(await r.readText(join(link, "a.txt"))).toBe("ok");
    } finally {
      rmSync(link, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it("accepts a file root only for that exact file", async () => {
    const f = join(dir, "VISION.md");
    writeFileSync(f, "# v");
    writeFileSync(join(dir, "other.md"), "no");
    const r = new SafeReader();
    r.setRoots([{ path: f, kind: "file" }]);
    expect(await r.readText(f)).toBe("# v");
    await expect(r.readText(join(dir, "other.md"))).rejects.toBeInstanceOf(PathDenied);
  });

  it("refuses files over the size limit and directories", async () => {
    writeFileSync(join(dir, "big.txt"), "x".repeat(100));
    await expect(reader.readText(join(dir, "big.txt"), 10)).rejects.toBeInstanceOf(TooLarge);
    mkdirSync(join(dir, "sub"));
    await expect(reader.readText(join(dir, "sub"))).rejects.toBeTruthy();
  });
});

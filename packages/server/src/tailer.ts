import type { SafeReader } from "./safe-fs.js";

export interface TailResult {
  /** True when the consumer must discard everything it holds for this file and start over. */
  reset: boolean;
  /** Complete lines only (no trailing newline). The unterminated tail is held back. */
  lines: string[];
  /** The file does not exist (or was removed). */
  missing: boolean;
  /** Bytes remain (a capped poll); call again right away. */
  more: boolean;
}

export interface TailerOptions {
  /** On the first read, only look at this many trailing bytes (aligned to a line start). */
  initialTailBytes?: number;
  /** Cap per poll so one giant append cannot stall the loop; the rest comes next poll. */
  maxBytesPerPoll?: number;
}

/**
 * Tails an append-only JSONL file by byte offset, the way Muster's own `QueueReader` does
 * (`src/switchboard.ts:60`): the offset resets when the file is replaced (dev/ino change),
 * truncated (size < offset) or rewritten in place at the same size (mtime change), and a torn
 * trailing line is never surfaced until its newline arrives.
 */
export class JsonlTailer {
  private dev: number | null = null;
  private ino: number | null = null;
  private offset = 0;
  private mtime = 0;
  private rest = Buffer.alloc(0);
  private started = false;
  private present = false;
  private skipPartialFirst = false;

  constructor(
    private readonly reader: SafeReader,
    readonly path: string,
    private readonly opts: TailerOptions = {},
  ) {}

  async poll(): Promise<TailResult> {
    const h = await this.reader.openRead(this.path);
    if (!h) {
      const wasPresent = this.present;
      this.forget();
      this.present = false;
      return { reset: wasPresent, lines: [], missing: true, more: false };
    }
    try {
      const st = await h.stat();
      if (!st.isFile()) {
        this.forget();
        return { reset: false, lines: [], missing: true, more: false };
      }
      let reset = !this.started;
      const replaced = this.started && (st.dev !== this.dev || st.ino !== this.ino);
      const shrunk = this.started && st.size < this.offset;
      const rewritten = this.started && st.size === this.offset && st.mtimeMs !== this.mtime;
      if (replaced || shrunk || rewritten) {
        reset = true;
        this.offset = 0;
        this.rest = Buffer.alloc(0);
        this.skipPartialFirst = false;
      }
      if (!this.started || reset) {
        const tail = this.opts.initialTailBytes;
        if (tail !== undefined && st.size > tail) {
          this.offset = st.size - tail;
          this.skipPartialFirst = true; // we start mid-line; drop up to the first newline
        }
      }
      this.started = true;
      this.present = true;
      this.dev = st.dev;
      this.ino = st.ino;
      this.mtime = st.mtimeMs;

      const want = Math.min(st.size - this.offset, this.opts.maxBytesPerPoll ?? 8 * 1024 * 1024);
      if (want <= 0) return { reset, lines: [], missing: false, more: false };
      const buf = Buffer.alloc(want);
      let got = 0;
      while (got < want) {
        const { bytesRead } = await h.read(buf, got, want - got, this.offset + got);
        if (bytesRead === 0) break;
        got += bytesRead;
      }
      this.offset += got;
      const more = this.offset < st.size;
      let data = Buffer.concat([this.rest, buf.subarray(0, got)]);
      if (this.skipPartialFirst) {
        const nl = data.indexOf(10);
        if (nl < 0) {
          this.rest = Buffer.alloc(0);
          return { reset, lines: [], missing: false, more };
        }
        data = data.subarray(nl + 1);
        this.skipPartialFirst = false;
      }
      const end = data.lastIndexOf(10);
      if (end < 0) {
        this.rest = data;
        return { reset, lines: [], missing: false, more };
      }
      this.rest = Buffer.from(data.subarray(end + 1));
      const text = data.subarray(0, end).toString("utf8");
      const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
      return { reset, lines, missing: false, more };
    } finally {
      await h.close();
    }
  }

  private forget(): void {
    this.dev = null;
    this.ino = null;
    this.offset = 0;
    this.mtime = 0;
    this.rest = Buffer.alloc(0);
    this.started = false;
    this.skipPartialFirst = false;
  }
}

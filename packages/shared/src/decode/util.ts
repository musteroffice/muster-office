/** Small tolerant-decoding helpers. Nothing here throws. */

export type Rec = Record<string, unknown>;

export function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

export function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function bool(v: unknown, fallback = false): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function strArr(v: unknown): string[] {
  return arr(v).filter((x): x is string => typeof x === "string");
}

/** `v` when it is one of `list`, else `undefined`. */
export function pick<T extends string | number>(list: readonly T[], v: unknown): T | undefined {
  return (list as readonly unknown[]).includes(v) ? (v as T) : undefined;
}

/** Parse an ISO timestamp to epoch ms; NaN becomes `fallback`. */
export function ms(v: unknown, fallback = 0): number {
  if (typeof v !== "string") return fallback;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : fallback;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
// C0 controls except \t \n, DEL, C1 controls, and bidi overrides/isolates (display spoofing).
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩‎‏]/g;

/** Remove terminal escapes, control and bidi characters. */
export function stripControl(text: string): string {
  return text.replace(ANSI_RE, "").replace(CONTROL_RE, "");
}

/** Sanitise for display: strip control chars, optionally collapse whitespace, cap length with an ellipsis. */
export function clean(v: unknown, max = 200, collapse = true): string {
  if (typeof v !== "string") return "";
  let t = stripControl(v);
  if (collapse) t = t.replace(/\s+/g, " ").trim();
  const chars = [...t];
  return chars.length <= max ? t : `${chars.slice(0, Math.max(0, max - 1)).join("")}…`;
}

export function basename(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return i < 0 ? trimmed : trimmed.slice(i + 1);
}

export function shortId(v: string, n = 8): string {
  return v.length <= n ? v : v.slice(0, n);
}

/** Collects issues while decoding one document. */
export class Issues {
  readonly issues: string[] = [];
  readonly notes: string[] = [];
  private static readonly CAP = 20;
  warn(msg: string): void {
    if (this.issues.length < Issues.CAP) this.issues.push(msg);
    else if (this.issues.length === Issues.CAP) this.issues.push("…more issues omitted");
  }
  note(msg: string): void {
    if (this.notes.length < Issues.CAP) this.notes.push(msg);
  }
}

/** Split a chunk of text into complete lines, returning the unterminated tail separately. */
export function splitLines(text: string): { lines: string[]; rest: string } {
  const i = text.lastIndexOf("\n");
  if (i < 0) return { lines: [], rest: text };
  return { lines: text.slice(0, i).split("\n"), rest: text.slice(i + 1) };
}

/** JSON.parse that returns `undefined` instead of throwing. */
export function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

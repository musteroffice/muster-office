import { formatAge } from "@automicvault/shared";

export function ageOf(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const a = formatAge(Math.max(0, now - t));
  return a === "now" ? "just now" : `${a} ago`;
}

export function ageMs(ms: number): string {
  const a = formatAge(Math.max(0, ms));
  return a === "now" ? "now" : a;
}

export function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function fmtKB(kb: number): string {
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function fmtDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function modelShort(model: string): string {
  const base = model.includes("/") ? (model.split("/").pop() ?? model) : model;
  return base.replace(/^claude-/, "").replace(/^gpt-/, "gpt ");
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Agent labels arrive as "<emoji> Callsign · role". The interface uses icons, never emoji, so the
 * pictographs are dropped and the readable part is kept.
 */
export function plainLabel(label: string): string {
  return label.replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\uFE0F\u200D]/gu, "").replace(/\s+/g, " ").trim();
}

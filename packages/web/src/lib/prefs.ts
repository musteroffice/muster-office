/** Per-viewer conveniences in localStorage. Every access is guarded: storage may be blocked or absent. */

const PREFIX = "muster-office:";

export function loadPref<T>(key: string, fallback: T, validate?: (v: unknown) => v is T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const v: unknown = JSON.parse(raw);
    if (validate ? validate(v) : typeof v === typeof fallback) return v as T;
  } catch {
    /* storage unavailable or corrupt value */
  }
  return fallback;
}

export function savePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* ignore: private mode, quota, blocked */
  }
}

export type Theme = "system" | "dark" | "light" | "mono";
export const THEMES: readonly Theme[] = ["system", "dark", "light", "mono"];
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

export type ViewMode = "office" | "board";
export const isViewMode = (v: unknown): v is ViewMode => v === "office" || v === "board";

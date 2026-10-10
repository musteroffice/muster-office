import { useEffect, useState } from "react";
import type { AgentStateOrUnknown } from "@automicvault/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATE_META, type Tone } from "../lib/meta";
import { TONE_BADGE } from "../lib/tone";

/** A single shared 1 Hz clock so every relative age ticks together and stops when the tab is hidden. */
const listeners = new Set<(now: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function ensureTimer(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();
    for (const fn of listeners) fn(now);
  }, 1000);
}

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    listeners.add(setNow);
    ensureTimer();
    setNow(Date.now());
    return () => {
      listeners.delete(setNow);
      if (listeners.size === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return now;
}

export type BodyKind = "desk" | "owner" | "report";
export interface BodyState {
  status: "idle" | "loading" | "ok" | "error";
  body: string;
  refs: string[];
  error?: string;
}

const bodyCache = new Map<string, BodyState>();

/** Fetches a body on demand, only while `enabled` ("show bodies"). Bodies never ride the SSE stream. */
export function useBody(kind: BodyKind, project: string, id: string, enabled: boolean): BodyState {
  const key = `${kind}\0${project}\0${id}`;
  const [state, setState] = useState<BodyState>(() => bodyCache.get(key) ?? { status: "idle", body: "", refs: [] });
  useEffect(() => {
    if (!enabled) {
      setState({ status: "idle", body: "", refs: [] });
      return;
    }
    const cached = bodyCache.get(key);
    if (cached?.status === "ok") {
      setState(cached);
      return;
    }
    let cancelled = false;
    setState({ status: "loading", body: "", refs: [] });
    const qs = new URLSearchParams({ kind, project, id });
    fetch(`/api/body?${qs.toString()}`, { headers: { accept: "application/json" } })
      .then(async (r) => {
        const j = (await r.json()) as { body?: string; refs?: string[]; error?: string };
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        const ok: BodyState = { status: "ok", body: j.body ?? "", refs: j.refs ?? [] };
        bodyCache.set(key, ok);
        if (!cancelled) setState(ok);
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ status: "error", body: "", refs: [], error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, key, kind, project, id]);
  return state;
}

export function clearBodyCache(): void {
  bodyCache.clear();
}

export function Tag({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <Badge variant="outline" data-tone={tone} title={title} className={cn("rounded-md px-1.5 py-0 text-xs font-normal", TONE_BADGE[tone])}>
      {children}
    </Badge>
  );
}

export function StateBadge({ state, raw }: { state: AgentStateOrUnknown; raw?: string | undefined }) {
  const m = STATE_META[state];
  const Icon = m.icon;
  return (
    <Badge variant="outline" data-tone={m.tone} title={m.what} className={cn("gap-1 rounded-md px-1.5 py-0 text-xs font-medium", TONE_BADGE[m.tone])}>
      <Icon aria-hidden="true" className="size-3" />
      {raw && state === "unknown" ? raw : m.label}
    </Badge>
  );
}

export function BodyBlock({ kind, project, id, enabled }: { kind: BodyKind; project: string; id: string; enabled: boolean }) {
  const b = useBody(kind, project, id, enabled);
  if (!enabled) return <p className="muted small">Body hidden. Turn on “show bodies” in the top bar to read it.</p>;
  if (b.status === "loading") return <p className="muted small">Loading…</p>;
  if (b.status === "error") return <p className="bad small">Could not load: {b.error}</p>;
  if (b.status === "idle") return null;
  return (
    <>
      <pre className="body-text">{b.body || "(empty)"}</pre>
      {b.refs.length > 0 && (
        <p className="small muted">
          refs: {b.refs.map((r, i) => (
            <code key={i}>{r}</code>
          ))}
        </p>
      )}
    </>
  );
}

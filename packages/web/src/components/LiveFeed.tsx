import { memo, useMemo } from "react";
import type { TimelineEvent } from "@automicvault/shared";
import { cn } from "@/lib/utils";
import { clock } from "../lib/format";
import { useOffice } from "../store";
import { KIND_ICON, SEV_BAR } from "./Timeline";

const Row = memo(function Row({ e }: { e: TimelineEvent }) {
  const Icon = KIND_ICON[e.kind];
  return (
    <li className={cn("border-l-2 py-1 pl-2.5 text-[0.8125rem] leading-snug", SEV_BAR[e.severity], e.severity === "error" && "bg-destructive/5")}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden="true" className="size-3" />
        <span>{e.kind}</span>
        <time className="ml-auto font-mono" dateTime={new Date(e.ts).toISOString()}>
          {clock(e.ts)}
        </time>
      </div>
      <div>{e.text}</div>
    </li>
  );
});

/**
 * The newest events, in the empty margin beside the floor when the window is wider than the floor needs.
 * It is the Timeline's feed without its filters, so a wall display can read it from across a room.
 */
export function LiveFeed({ className }: { className?: string }) {
  const timeline = useOffice((s) => s.timeline);
  const project = useOffice((s) => s.project);
  const rows = useMemo(() => {
    const out: TimelineEvent[] = [];
    for (let i = timeline.length - 1; i >= 0 && out.length < 14; i--) {
      const e = timeline[i]!;
      if (e.project === project || e.project === null) out.push(e);
    }
    return out;
  }, [timeline, project]);
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card", className)} aria-label="Live feed" data-testid="live-feed">
      <h2 className="border-b px-3 py-2 text-sm font-semibold">Live feed</h2>
      <ol className="m-0 grid min-h-0 flex-1 list-none content-start gap-0.5 overflow-hidden px-2.5 py-2">
        {rows.map((e) => (
          <Row key={e.id} e={e} />
        ))}
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Nothing yet.</li>}
      </ol>
    </section>
  );
}

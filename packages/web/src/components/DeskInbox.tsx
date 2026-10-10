import { CircleCheck } from "lucide-react";
import { rankOpen } from "@automicvault/shared";
import { cn } from "@/lib/utils";
import { ageOf } from "../lib/format";
import { DESK_KIND_META } from "../lib/meta";
import { TONE_TEXT } from "../lib/tone";
import { selectProjectView, useOffice } from "../store";
import { useNow } from "./hooks";

/**
 * The desk's open items, ranked as Muster ranks them (blocked, approval, decision). Titles and ages
 * only: bodies stay on the server until "show bodies" is on and an item is opened.
 */
export function DeskInbox({ className }: { className?: string }) {
  const project = useOffice(selectProjectView);
  const select = useOffice((s) => s.select);
  const now = useNow();
  if (!project) return null;
  const open = rankOpen(project.desk);
  return (
    <section className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card", className)} aria-label="The desk" data-testid="desk-inbox">
      <h2 className="flex items-center justify-between border-b px-3 py-2 text-sm font-semibold">
        The desk
        <span className="rounded-md bg-muted px-1.5 font-mono text-xs font-normal text-muted-foreground">{open.length}</span>
      </h2>
      {open.length === 0 ? (
        <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
          <CircleCheck aria-hidden="true" className={cn("size-4", TONE_TEXT.ok)} /> Inbox clear
        </p>
      ) : (
        <ol className="m-0 min-h-0 flex-1 list-none overflow-hidden p-1.5">
          {open.slice(0, 8).map((d) => {
            const K = DESK_KIND_META[d.kind];
            return (
              <li key={d.id}>
                <button type="button" className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-[0.8125rem] leading-snug hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50" onClick={() => select({ type: "desk", project: project.slug })}>
                  <K.icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", TONE_TEXT[K.tone])} />
                  <span className="min-w-0 flex-1">
                    <span className="block">{d.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.kind} · {d.from} · {ageOf(d.ts, now)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

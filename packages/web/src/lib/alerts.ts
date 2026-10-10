import { flowInfo, type Change, type ProjectView, type Snapshot } from "@muster-office/shared";
import type { Toast } from "../store";

/**
 * Decides which data changes deserve a toast. Quiet by design: routine progress (running, reported,
 * verified) never interrupts; failures, stalls, blocked work, decisions and deliveries do.
 */

export type ToastDraft = Omit<Toast, "id" | "at">;

const rank = { bad: 0, warn: 1, ok: 2, info: 3 } as const;

export function alertsFor(changes: readonly Change[], before: Snapshot | null, after: Snapshot): ToastDraft[] {
  const out: ToastDraft[] = [];
  const proj = (slug: string): ProjectView | undefined => after.projects.find((p) => p.slug === slug);
  const label = (slug: string): string => proj(slug)?.label ?? slug;

  for (const c of changes) {
    if (c.t === "agent" && c.to && c.from !== c.to) {
      const who = c.agent?.label || c.name;
      if (c.to === "failed") out.push({ tone: "bad", title: `${who} failed`, text: `${label(c.project)} · the run stopped`, project: c.project, focus: { type: "agent", name: c.name }, select: { type: "agent", project: c.project, name: c.name } });
      else if (c.to === "silent") out.push({ tone: "warn", title: `${who} went quiet`, text: `${label(c.project)} · no output for the nudge window`, project: c.project, focus: { type: "agent", name: c.name }, select: { type: "agent", project: c.project, name: c.name } });
      else if (c.to === "interrupted") out.push({ tone: "warn", title: `${who} was interrupted`, text: `${label(c.project)} · the pane is gone`, project: c.project, focus: { type: "agent", name: c.name }, select: { type: "agent", project: c.project, name: c.name } });
    } else if (c.t === "desk" && c.change === "added" && (c.kind === "blocked" || c.kind === "approval" || c.kind === "decision")) {
      const item = proj(c.project)?.desk.find((d) => d.id === c.id);
      const what = c.kind === "blocked" ? "Blocked" : c.kind === "approval" ? "Approval needed" : "Decision needed";
      out.push({ tone: c.kind === "blocked" ? "bad" : "warn", title: what, text: `${label(c.project)}${item?.title ? ` · ${item.title}` : ""}`, project: c.project, focus: { type: "desk" }, select: { type: "desk", project: c.project } });
    } else if (c.t === "lane" && c.to && c.from && c.from.delivery !== c.to.delivery) {
      if (c.to.delivery === "proven") out.push({ tone: "ok", title: "Proven live", text: `${label(c.project)} · ${c.slug} delivered and proven`, project: c.project, focus: { type: "lane", slug: c.slug }, select: { type: "lane", project: c.project, slug: c.slug } });
      else if (c.to.delivery === "deployed") out.push({ tone: "info", title: "Deployed", text: `${label(c.project)} · ${c.slug} is out`, project: c.project, focus: { type: "lane", slug: c.slug }, select: { type: "lane", project: c.project, slug: c.slug } });
    } else if (c.t === "job" && c.to === "lost" && c.from !== "lost") {
      out.push({ tone: "bad", title: "Heavy job lost", text: `${c.id.slice(0, 8)} · its process is gone`, project: c.project, focus: { type: "machine" } });
    }
  }

  // Flow stalls: flip detection per project, from the same rules the wall ticker uses.
  if (before) {
    const now = Date.now();
    for (const p of after.projects) {
      const was = before.projects.find((x) => x.slug === p.slug);
      if (!was) continue;
      const a = flowInfo(was, now).notFlowing;
      const b = flowInfo(p, now).notFlowing;
      if (!a && b) out.push({ tone: "warn", title: "Flow stalled", text: `${p.label} · work is not moving`, project: p.slug, focus: { type: "ticker" }, select: { type: "project", project: p.slug } });
      else if (a && !b) out.push({ tone: "ok", title: "Flow restored", text: `${p.label} · work is moving again`, project: p.slug, focus: { type: "ticker" } });
    }
  }

  return out.sort((x, y) => rank[x.tone] - rank[y.tone]).slice(0, 3);
}

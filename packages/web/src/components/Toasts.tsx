import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { requestFocus } from "../lib/bus";
import { useOffice, type Toast } from "../store";

const TTL = 9000;

function show(t: Toast): void {
  const st = useOffice.getState();
  if (t.project && t.project !== st.project) st.selectProject(t.project);
  if (t.select) st.select(t.select);
  if (t.focus && st.view === "office") {
    const f = t.focus;
    // The engine switches floors on the next tick; give it a moment before flying.
    setTimeout(() => requestFocus(f), t.project && t.project !== st.project ? 120 : 0);
  }
}

/**
 * Alerts, shown with shadcn's Sonner. The store decides what deserves one (lib/alerts.ts); this only
 * renders them, with a button that takes you to the cause.
 */
export function Toasts() {
  useEffect(() => {
    let seen = useOffice.getState().toasts.at(-1)?.id ?? 0;
    return useOffice.subscribe((s) => {
      for (const t of s.toasts) {
        if (t.id <= seen) continue;
        seen = Math.max(seen, t.id);
        const opts = {
          id: t.id,
          description: t.text,
          duration: TTL,
          onDismiss: () => useOffice.getState().dismissToast(t.id),
          onAutoClose: () => useOffice.getState().dismissToast(t.id),
          action: t.focus || t.select ? { label: "Show", onClick: () => show(t) } : undefined,
        };
        if (t.tone === "bad") toast.error(t.title, opts);
        else if (t.tone === "warn") toast.warning(t.title, opts);
        else if (t.tone === "ok") toast.success(t.title, opts);
        else toast.info(t.title, opts);
      }
    });
  }, []);
  return <Toaster position="bottom-center" visibleToasts={3} offset={{ bottom: 236 }} mobileOffset={{ bottom: 72 }} toastOptions={{ classNames: { toast: "data-alert", actionButton: "!bg-primary !text-primary-foreground" } }} />;
}

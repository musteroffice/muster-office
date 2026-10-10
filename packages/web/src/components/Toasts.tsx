import { useEffect, useRef } from "react";
import { requestFocus } from "../lib/bus";
import { useOffice, type Toast } from "../store";

const GLYPH = { bad: "✖", warn: "!", ok: "✔", info: "i" } as const;
const TTL = 9000;

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useOffice((s) => s.dismissToast);
  const select = useOffice((s) => s.select);
  const selectProject = useOffice((s) => s.selectProject);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arm = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => dismiss(toast.id), TTL);
  };
  const hold = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => {
    arm();
    return hold;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  const show = (): void => {
    const st = useOffice.getState();
    if (toast.project && toast.project !== st.project) selectProject(toast.project);
    if (toast.select) select(toast.select);
    if (toast.focus && st.view === "office") {
      const f = toast.focus;
      // The engine switches floors on the next tick; give it a moment before flying.
      setTimeout(() => requestFocus(f), toast.project && toast.project !== st.project ? 120 : 0);
    }
    dismiss(toast.id);
  };

  return (
    <li className={`toast t-${toast.tone}`} onMouseEnter={hold} onMouseLeave={arm}>
      <span className="toast-glyph" aria-hidden="true">
        {GLYPH[toast.tone]}
      </span>
      <span className="toast-body">
        <strong>{toast.title}</strong>
        <span>{toast.text}</span>
      </span>
      {(toast.focus || toast.select) && (
        <button type="button" className="toast-act" onClick={show}>
          Show
        </button>
      )}
      <button type="button" className="toast-x" onClick={() => dismiss(toast.id)} aria-label={`Dismiss: ${toast.title}`}>
        ×
      </button>
      <span className="toast-bar" style={{ animationDuration: `${TTL}ms` }} aria-hidden="true" />
    </li>
  );
}

export function Toasts() {
  const toasts = useOffice((s) => s.toasts);
  return (
    <ol className="toasts" role="status" aria-live="polite" aria-label="Alerts" data-testid="toasts">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </ol>
  );
}

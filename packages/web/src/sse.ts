import type { Diff, Snapshot } from "@muster-office/shared";
import { useOffice } from "./store";

const FLUSH_MS = 50;
const STALE_MS = 40_000; // the server pings every 15 s
const MAX_BACKOFF_MS = 10_000;

/**
 * Connects to /events and feeds the store. Diffs are queued and applied in one batch every
 * ~50 ms, so a burst of server events becomes one React update and one animation hand-off.
 * A gap in `seq` forces a resync (reconnect, which sends a fresh snapshot).
 */
export function connectEvents(url = "/events"): () => void {
  const store = useOffice;
  let es: EventSource | null = null;
  let lastSeq = -1;
  let pending: Diff[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let retry = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let hadData = false;

  const flush = (): void => {
    flushTimer = null;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    store.getState().applyDiffs(batch);
  };

  const resync = (): void => {
    es?.close();
    es = null;
    pending = [];
    scheduleOpen(0);
  };

  const scheduleOpen = (delay: number): void => {
    if (closed) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(open, delay);
  };

  const open = (): void => {
    if (closed) return;
    store.getState().setConn(hadData ? "reconnecting" : "connecting");
    es = new EventSource(url);
    es.addEventListener("snapshot", (ev) => {
      try {
        const snap = JSON.parse((ev as MessageEvent<string>).data) as Snapshot;
        lastSeq = snap.seq;
        retry = 0;
        hadData = true;
        pending = [];
        store.getState().applySnapshot(snap);
      } catch {
        resync();
      }
    });
    es.addEventListener("diff", (ev) => {
      try {
        const diff = JSON.parse((ev as MessageEvent<string>).data) as Diff;
        if (diff.seq !== lastSeq + 1) {
          resync(); // missed a message: ask for a fresh snapshot
          return;
        }
        lastSeq = diff.seq;
        pending.push(diff);
        flushTimer ??= setTimeout(flush, FLUSH_MS);
      } catch {
        resync();
      }
    });
    es.addEventListener("ping", () => store.getState().touchMessage());
    es.onerror = () => {
      store.getState().setConn(hadData ? "reconnecting" : "offline");
      if (es && es.readyState === EventSource.CLOSED) {
        retry += 1;
        scheduleOpen(Math.min(MAX_BACKOFF_MS, 500 * 2 ** retry));
      }
    };
  };

  const watchdog = setInterval(() => {
    const s = store.getState();
    if (s.conn === "live" && Date.now() - s.lastMessageAt > STALE_MS) resync();
  }, 5_000);

  const onVisible = (): void => {
    if (document.visibilityState === "visible") {
      const s = store.getState();
      if (s.conn !== "live" || Date.now() - s.lastMessageAt > STALE_MS) resync();
    }
  };
  document.addEventListener("visibilitychange", onVisible);
  open();

  return () => {
    closed = true;
    clearInterval(watchdog);
    document.removeEventListener("visibilitychange", onVisible);
    if (flushTimer) clearTimeout(flushTimer);
    if (retryTimer) clearTimeout(retryTimer);
    es?.close();
  };
}

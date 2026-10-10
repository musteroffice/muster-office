import { useOffice } from "../store";
import { requestFocus } from "./bus";

/**
 * Full-screen mode: the browser goes full screen and only the office is left, scaled to fill the window.
 * `requestFullscreen` must be called straight from the click that asked for it.
 */
export function setFullScreen(on: boolean): void {
  useOffice.getState().setFocus(on);
  try {
    if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  } catch {
    /* the page still works as a "focus" layout when the browser refuses full screen */
  }
  setTimeout(() => requestFocus({ type: "fit" }), 160);
}

export function toggleFullScreen(): void {
  setFullScreen(!useOffice.getState().focus);
}

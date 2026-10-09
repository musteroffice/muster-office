import type { EngineDebug } from "./office/engine";

declare global {
  interface Window {
    /** Read-only debugging and test hooks. They expose nothing that is not already on screen. */
    __office?: {
      debug(): EngineDebug;
      screenPosOf(name: string): { x: number; y: number } | null;
      zoom(): number;
      centerOn(wx: number, wy: number): void;
      focusAgent(name: string): boolean;
    };
  }
}

export {};

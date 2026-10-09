import type { DataSource, Sink } from "../sink.js";

/** Placeholder replaced by the full simulator in milestone 6. */
export class DemoSource implements DataSource {
  constructor(readonly opts: { tickMs: number }) {}
  async start(sink: Sink): Promise<void> {
    sink.ready();
  }
  async stop(): Promise<void> {}
  reportText(_project: string, _id: string): string | null {
    return null;
  }
}

/**
 * The seam between a data source and the model. The filesystem source and the demo
 * simulator both feed *raw documents* through this interface, so parsing, view
 * building, diffing and SSE are exercised identically in both modes.
 */
export interface Sink {
  /** Whole text of `projects.jsonl`, or null when absent. */
  setRegistry(text: string | null): void;
  /** Whole text of a project's `project.json`, or null when absent. */
  setProject(dir: string, text: string | null): void;
  /** Whole text of a project's `VISION.md`, or null when absent. */
  setVision(dir: string, text: string | null): void;
  /** New complete lines of `herdr-desk/<slug>.jsonl`. `reset` discards earlier lines. */
  deskLines(slug: string, lines: readonly string[], reset: boolean): void;
  /** New complete lines of `owner-queue/<file>.jsonl`. */
  ownerLines(file: string, lines: readonly string[], reset: boolean): void;
  /** Text of `jobs/<id>.json`, or null when removed. */
  setJob(id: string, text: string | null): void;
  /** Text of `jobs/samples.json`, or null. */
  setSamples(text: string | null): void;
  /** New complete lines of `relay-events.jsonl`. */
  relayLines(lines: readonly string[], reset: boolean): void;
  /** Report (or clear, with null) a source-level problem such as an unreadable file. */
  degraded(source: string, message: string | null): void;
  /** The initial load is complete: publish the baseline snapshot and start emitting diffs. */
  ready(): void;
}

export interface DataSource {
  start(sink: Sink): Promise<void>;
  stop(): Promise<void>;
}

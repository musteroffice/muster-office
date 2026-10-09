import { DEPLOY_NAMES, type DeployLevel } from "../enums.js";
import type { DeployPosture, PolicyView, RelayEventView } from "../view.js";
import { clean, isRec, str, tryParse } from "./util.js";

/* -------------------------------------------------------------------- registry */

export interface RegistryEntry {
  slug: string;
  dir: string;
  spaceId: string | null;
  ts: string;
}

/** Newest line wins per slug; torn or foreign lines are skipped (`readRegistry`, `src/registry.ts:23`). */
export function decodeRegistry(text: string): Map<string, RegistryEntry> {
  const entries = new Map<string, RegistryEntry>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const raw = tryParse(line);
    if (!isRec(raw)) continue;
    if (typeof raw["slug"] !== "string" || typeof raw["dir"] !== "string") continue;
    entries.set(raw["slug"], {
      slug: raw["slug"],
      dir: raw["dir"],
      spaceId: typeof raw["spaceId"] === "string" ? raw["spaceId"] : null,
      ts: str(raw["ts"]),
    });
  }
  return entries;
}

/* ----------------------------------------------------------------------- relay */

export function decodeRelayLine(line: string): RelayEventView | null {
  if (!line.trim()) return null;
  const raw = tryParse(line);
  if (!isRec(raw)) return null;
  if (typeof raw["ts"] !== "string" || typeof raw["kind"] !== "string") return null;
  return {
    ts: raw["ts"],
    kind: clean(raw["kind"], 40),
    project: clean(raw["project"], 120),
    // Session ids are identifiers, shortened: the office never needs the full value.
    session: str(raw["session"]).slice(0, 8),
    itemCount: typeof raw["itemCount"] === "number" && Number.isFinite(raw["itemCount"]) ? raw["itemCount"] : null,
    path: typeof raw["path"] === "string" ? clean(raw["path"], 20) : null,
    woke: typeof raw["woke"] === "boolean" ? raw["woke"] : null,
    noteKind: typeof raw["noteKind"] === "string" ? clean(raw["noteKind"], 20) : null,
  };
}

/* ------------------------------------------------------------- deploy posture */

export interface DeploySection {
  level?: DeployLevel;
  issue?: string;
  missing: boolean;
}

/** Port of `decodeDeploySection` (`src/domain.ts:435`). A malformed section never loosens the fallback. */
export function decodeDeploySection(vision: string): DeploySection {
  const section = /^## Deploy posture[ \t]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(vision);
  if (!section) {
    return /^## Deploy posture[ \t]*$/m.test(vision)
      ? { missing: false, issue: "malformed Deploy posture: missing Level line" }
      : { missing: true };
  }
  const first = section[1]?.trim().split(/\r?\n/)[0] ?? "";
  const match = /^Level: ([0-3])(?: \((locked|prove|ship-and-watch|jfdi)\))?$/.exec(first);
  if (!match) return { missing: false, issue: "malformed Deploy posture: expected Level: <0-3> (<name>)" };
  const level = Number(match[1]) as DeployLevel;
  if (match[2] && match[2] !== DEPLOY_NAMES[level]) {
    return { missing: false, issue: "malformed Deploy posture: level and name differ" };
  }
  return { level, missing: false };
}

/** VISION.md wins over policy; policy over the default of 1 (`deployPosture`, `src/tokens.ts:73`). */
export function computeDeployPosture(policy: PolicyView, vision: string | null): DeployPosture {
  const notes: string[] = [];
  let section: DeploySection = { missing: true };
  if (vision !== null) section = decodeDeploySection(vision);
  if (section.issue) notes.push(section.issue);
  const level: DeployLevel = section.level ?? policy.deployLevel ?? 1;
  const source: DeployPosture["source"] =
    section.level !== undefined ? "VISION.md" : policy.deployLevel !== null ? "policy" : "default";
  if (section.level !== undefined && policy.deployLevel !== null && section.level !== policy.deployLevel) {
    notes.push(`policy ${policy.deployLevel} differs; VISION.md wins`);
  }
  return { level, source, notes };
}


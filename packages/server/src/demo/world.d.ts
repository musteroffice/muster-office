/**
 * The demo world: a pure function of (tick, cycleStart). Given the same tick it always
 * produces the same documents, so the simulator is deterministic and testable. Documents are
 * built in the exact shapes pi-muster writes, then handed to the same Sink the filesystem uses.
 *
 * One cycle is LOOP ticks. Over a cycle the world walks every agent lifecycle state, a stalled
 * flow, a failed agent, blocked desk items, a lost job, a dead desk and WIP-limit queueing.
 */
export declare const LOOP = 84;
type Track<T> = ReadonlyArray<readonly [number, T]>;
export interface Clock {
    /** Wall-clock ms when the demo started. Historical records are anchored here so they age smoothly. */
    epoch: number;
    /** Wall-clock ms at tick 0 of the current cycle. Events inside a cycle are anchored here. */
    cycleStart: number;
    tickMs: number;
}
type S = string;
interface AgentDef {
    name: string;
    role: "desk" | "hawk" | "boss" | "worker" | "judge";
    lane: string;
    label: string;
    model: string;
    thinking: string | null;
    states: Track<S>;
    /** Hidden (no row) until this tick. */
    appearsAt?: number;
    events?: ReadonlyArray<readonly [number, string, string]>;
    restarts?: Track<number>;
}
interface LaneDef {
    slug: string;
    kind: "work" | "role" | "retro";
    goal: string;
    state: Track<S>;
    delivery?: Track<S>;
    evidence?: Partial<Record<string, string>>;
    createdMinAgo: number;
    deployLevel?: number;
    deployRule?: string;
    archived?: boolean;
    rank?: number;
    override?: string;
}
interface PacketDef {
    agent: string;
    lane: string;
    seed: number;
    /** Tick at which the packet is reported; a negative number places it that many minutes in the past. */
    reported: number;
    states: Track<S>;
    landedAs?: string;
}
interface DeskLine {
    tick: number;
    id: string;
    from: string;
    kind: "decision" | "approval" | "blocked" | "done" | "fyi";
    title: string;
    body?: string;
    resolves?: string;
    /** For baseline lines: minutes before the cycle started. */
    minutesAgo?: number;
}
interface OwnerLine {
    tick: number;
    author: string;
    kind: string;
    text: string;
    lane?: string;
}
interface ProjectDef {
    slug: string;
    label: string;
    headline: string;
    nextAction: string;
    outcome: string;
    wipLimit: number | null;
    deployLevel?: number;
    vision?: string;
    createdMinAgo: number;
    lanes: LaneDef[];
    agents: AgentDef[];
    packets: PacketDef[];
    desk: DeskLine[];
    owner: OwnerLine[];
    deskSession: string;
}
export declare const PROJECTS: readonly ProjectDef[];
export declare function projectDocument(p: ProjectDef, k: number, c: Clock): string;
export declare function registryDocument(c: Clock): string;
export declare function visionDocument(p: ProjectDef): string | null;
export declare function deskLines(p: ProjectDef, k: number, c: Clock): string[];
export declare function ownerLines(p: ProjectDef, k: number, c: Clock): string[];
export declare function relayLines(k: number, c: Clock): string[];
export interface JobDocs {
    /** job id -> JSON text (only jobs that exist at tick k). */
    jobs: Map<string, string>;
    samples: string;
}
export declare function jobDocuments(k: number, c: Clock, nowMs: number): JobDocs;
export declare function reportDocument(project: string, packetId: string): string | null;
export {};

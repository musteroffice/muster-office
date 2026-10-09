import { DESK_KINDS, OWNER_KINDS, OPEN_KINDS, type DeskKind, type OpenKind, type OwnerKind } from "../enums.js";
import type { DeskItemView, OwnerNoteView } from "../view.js";
import { arr, clean, isRec, pick, shortId, str, strArr, tryParse } from "./util.js";

/* ------------------------------------------------------------------ desk queue */

/** A decoded desk line including its body. Lives server-side only. */
export interface RawDeskItem {
  id: string;
  ts: string;
  from: string;
  kind: DeskKind;
  title: string;
  body: string | null;
  refs: string[];
  resolves: string | null;
}

/** Same acceptance rule as Muster's `DeskItem` schema: required string fields and a known kind. */
export function decodeDeskLine(line: string): RawDeskItem | null {
  if (!line.trim()) return null;
  const raw = tryParse(line);
  if (!isRec(raw)) return null;
  const kind = pick(DESK_KINDS, raw["kind"]);
  if (
    !kind ||
    typeof raw["id"] !== "string" ||
    typeof raw["ts"] !== "string" ||
    typeof raw["from"] !== "string" ||
    typeof raw["title"] !== "string"
  ) {
    return null;
  }
  const body = typeof raw["body"] === "string" ? raw["body"] : null;
  return {
    id: raw["id"],
    ts: raw["ts"],
    from: raw["from"],
    kind,
    title: raw["title"],
    body,
    refs: strArr(raw["refs"]),
    resolves: typeof raw["resolves"] === "string" ? raw["resolves"] : null,
  };
}

export function isOpenKind(kind: DeskKind): kind is OpenKind {
  return (OPEN_KINDS as readonly string[]).includes(kind);
}

/** Ids resolved by some later line (Muster's `openDeskItems`, `src/tokens.ts:50`). */
export function resolutionMap(items: readonly RawDeskItem[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) if (item.resolves) map.set(item.resolves, item.id);
  return map;
}

const DESK_VIEW_TAIL = 200;

/** Build views in file order. All open items are kept; other lines are capped to the newest 200. */
export function buildDeskViews(items: readonly RawDeskItem[]): DeskItemView[] {
  const resolved = resolutionMap(items);
  const views = items.map<DeskItemView>((item) => {
    const resolvedBy = resolved.get(item.id) ?? null;
    return {
      id: clean(item.id, 64),
      ts: item.ts,
      from: clean(item.from, 60),
      kind: item.kind,
      title: clean(item.title, 200),
      hasBody: item.body !== null && item.body.trim().length > 0,
      refCount: item.refs.length,
      resolves: item.resolves ? clean(item.resolves, 64) : null,
      open: isOpenKind(item.kind) && resolvedBy === null,
      resolvedBy,
    };
  });
  if (views.length <= DESK_VIEW_TAIL) return views;
  const keepFrom = views.length - DESK_VIEW_TAIL;
  return views.filter((v, i) => i >= keepFrom || v.open);
}

/* ----------------------------------------------------------------- owner queue */

export interface RawOwnerNote {
  uri: string;
  cid: string;
  author: string;
  createdAt: string;
  text: string;
  kind: OwnerKind | "unknown";
  project: string | null;
  lane: string | null;
  refs: string[];
  replyParent: string | null;
  delivery: string | null;
  mentioned: string[];
}

const POST_NSID = "dev.muster.note.post";

/** Legacy delivery spellings normalised on read, as `decodeOwnerItem` does. */
function normaliseDelivery(status: unknown): string | null {
  if (typeof status !== "string") return null;
  if (status === "sent") return "delivered";
  if (status === "rejected" || status === "blocked" || status === "unavailable") return "failed";
  return status;
}

export function decodeOwnerLine(line: string): RawOwnerNote | null {
  if (!line.trim()) return null;
  const raw = tryParse(line);
  if (!isRec(raw)) return null;
  if (raw["$type"] !== POST_NSID) return null;
  if (
    typeof raw["uri"] !== "string" ||
    typeof raw["cid"] !== "string" ||
    typeof raw["author"] !== "string" ||
    typeof raw["createdAt"] !== "string" ||
    typeof raw["text"] !== "string"
  ) {
    return null;
  }
  const kindRaw = raw["kind"];
  const reply = isRec(raw["reply"]) ? raw["reply"] : null;
  const parent = reply && isRec(reply["parent"]) ? str(reply["parent"]["uri"]) : "";
  const delivery = isRec(raw["delivery"]) ? normaliseDelivery(raw["delivery"]["status"]) : null;
  const mentioned: string[] = [];
  for (const f of arr(raw["facets"])) {
    if (!isRec(f)) continue;
    for (const feat of arr(f["features"])) if (isRec(feat) && typeof feat["did"] === "string") mentioned.push(feat["did"]);
  }
  return {
    uri: raw["uri"],
    cid: raw["cid"],
    author: raw["author"],
    createdAt: raw["createdAt"],
    text: raw["text"],
    kind: pick(OWNER_KINDS, kindRaw) ?? "unknown",
    project: typeof raw["project"] === "string" ? raw["project"] : null,
    lane: typeof raw["lane"] === "string" ? raw["lane"] : null,
    refs: strArr(raw["refs"]),
    replyParent: parent || null,
    delivery,
    mentioned,
  };
}

/**
 * Title = first line of `text` after the leading `@<session> ` mention prefix;
 * body = everything after the first newline (`ownerPostText`, `src/owner-view.ts:56`).
 */
export function splitOwnerText(text: string, mentioned: readonly string[]): { title: string; body: string } {
  let t = text;
  for (const did of mentioned) {
    const prefix = `@${did} `;
    if (t.startsWith(prefix)) {
      t = t.slice(prefix.length);
      break;
    }
  }
  const nl = t.indexOf("\n");
  return nl < 0 ? { title: t, body: "" } : { title: t.slice(0, nl), body: t.slice(nl + 1) };
}

export function buildOwnerView(note: RawOwnerNote, authorName: string | null): OwnerNoteView {
  const { title, body } = splitOwnerText(note.text, note.mentioned);
  return {
    uri: note.uri,
    id: shortId(note.cid, 12),
    ts: note.createdAt,
    kind: note.kind,
    author: authorName ?? shortId(note.author, 8),
    title: clean(title, 200),
    hasBody: body.trim().length > 0,
    lane: note.lane ? clean(note.lane, 64) : null,
    replyTo: note.replyParent,
    delivery: note.delivery,
  };
}

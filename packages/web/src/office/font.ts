/**
 * A 3×5 bitmap font, drawn from pixel arrays so labels stay crisp at any integer zoom.
 * Upper case only (lower case maps up). Unknown characters render as "?".
 */

const G: Record<string, string> = {
  A: ".#.|#.#|###|#.#|#.#",
  B: "##.|#.#|##.|#.#|##.",
  C: ".##|#..|#..|#..|.##",
  D: "##.|#.#|#.#|#.#|##.",
  E: "###|#..|##.|#..|###",
  F: "###|#..|##.|#..|#..",
  G: ".##|#..|#.#|#.#|.##",
  H: "#.#|#.#|###|#.#|#.#",
  I: "###|.#.|.#.|.#.|###",
  J: "..#|..#|..#|#.#|.#.",
  K: "#.#|#.#|##.|#.#|#.#",
  L: "#..|#..|#..|#..|###",
  M: "#.#|###|###|#.#|#.#",
  N: "##.|#.#|#.#|#.#|#.#",
  O: ".#.|#.#|#.#|#.#|.#.",
  P: "##.|#.#|##.|#..|#..",
  Q: ".#.|#.#|#.#|##.|.##",
  R: "##.|#.#|##.|#.#|#.#",
  S: ".##|#..|.#.|..#|##.",
  T: "###|.#.|.#.|.#.|.#.",
  U: "#.#|#.#|#.#|#.#|###",
  V: "#.#|#.#|#.#|#.#|.#.",
  W: "#.#|#.#|###|###|#.#",
  X: "#.#|#.#|.#.|#.#|#.#",
  Y: "#.#|#.#|.#.|.#.|.#.",
  Z: "###|..#|.#.|#..|###",
  "0": "###|#.#|#.#|#.#|###",
  "1": ".#.|##.|.#.|.#.|###",
  "2": "##.|..#|.#.|#..|###",
  "3": "##.|..#|.#.|..#|##.",
  "4": "#.#|#.#|###|..#|..#",
  "5": "###|#..|##.|..#|##.",
  "6": ".##|#..|###|#.#|###",
  "7": "###|..#|.#.|.#.|.#.",
  "8": "###|#.#|###|#.#|###",
  "9": "###|#.#|###|..#|##.",
  ".": "...|...|...|...|.#.",
  ",": "...|...|...|.#.|#..",
  ":": "...|.#.|...|.#.|...",
  ";": "...|.#.|...|.#.|#..",
  "-": "...|...|###|...|...",
  "+": "...|.#.|###|.#.|...",
  "/": "..#|..#|.#.|#..|#..",
  "|": ".#.|.#.|.#.|.#.|.#.",
  "%": "#.#|..#|.#.|#..|#.#",
  "(": ".##|#..|#..|#..|.##",
  ")": "##.|..#|..#|..#|##.",
  "[": "##.|#..|#..|#..|##.",
  "]": ".##|..#|..#|..#|.##",
  "!": ".#.|.#.|.#.|...|.#.",
  "?": "##.|..#|.#.|...|.#.",
  ">": "#..|.#.|..#|.#.|#..",
  "<": "..#|.#.|#..|.#.|..#",
  "=": "...|###|...|###|...",
  _: "...|...|...|...|###",
  "'": ".#.|.#.|...|...|...",
  '"': "#.#|#.#|...|...|...",
  "*": "...|#.#|.#.|#.#|...",
  "#": "#.#|###|#.#|###|#.#",
  "@": ".#.|#.#|###|#..|.##",
  "&": ".#.|#.#|.#.|#.#|.##",
  " ": "...|...|...|...|...",
  "·": "...|...|.#.|...|...",
};

const ALIAS: Record<string, string> = { "→": ">", "←": "<", "×": "X", "✓": "V", "✔": "V", "⚠": "!", "…": ".", "—": "-", "–": "-", "•": "·", "▶": ">", "↻": "O" };

const ADVANCE = 4;

export function glyph(ch: string): string[] {
  const up = ch.toUpperCase();
  const key = G[up] !== undefined ? up : (ALIAS[ch] ?? "?");
  return (G[key] ?? G["?"]!).split("|");
}

export function textWidth(text: string): number {
  const n = [...text].length;
  return n === 0 ? 0 : n * ADVANCE - 1;
}

const cache = new Map<string, HTMLCanvasElement>();
const CACHE_CAP = 600;

/** A cached canvas holding `text` in `color`, with an optional 1px drop shadow. */
export function textSprite(text: string, color: string, shadow?: string): HTMLCanvasElement {
  const key = `${color}|${shadow ?? ""}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > CACHE_CAP) cache.clear();
  const w = Math.max(1, textWidth(text) + (shadow ? 1 : 0));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = 5 + (shadow ? 1 : 0);
  const g = c.getContext("2d")!;
  const paint = (ox: number, oy: number, col: string): void => {
    g.fillStyle = col;
    [...text].forEach((ch, i) => {
      glyph(ch).forEach((row, y) => {
        for (let x = 0; x < 3; x++) if (row[x] === "#") g.fillRect(ox + i * ADVANCE + x, oy + y, 1, 1);
      });
    });
  };
  if (shadow) paint(1, 1, shadow);
  paint(0, 0, color);
  cache.set(key, c);
  return c;
}

export function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, shadow?: string): void {
  ctx.drawImage(textSprite(text, color, shadow), Math.round(x), Math.round(y));
}

/** Draw text centred on x. */
export function drawTextCentered(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color: string, shadow?: string): void {
  drawText(ctx, text, cx - Math.floor(textWidth(text) / 2), y, color, shadow);
}

/** Truncate with a trailing "." so a label never exceeds `maxChars`. */
export function fit(text: string, maxChars: number): string {
  const chars = [...text];
  return chars.length <= maxChars ? text : `${chars.slice(0, Math.max(1, maxChars - 1)).join("")}.`;
}

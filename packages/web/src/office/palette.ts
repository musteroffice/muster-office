/** One small shared palette so props, furniture and characters read as one scene. */
export const C = {
  ink: "#161225",
  ink2: "#2a2340",
  wall: "#3b4163",
  wallDark: "#2a2f4c",
  wallLight: "#59608a",
  trim: "#6b739c",
  floorA: "#b9ac92",
  floorB: "#afa288",
  floorShade: "#968a72",
  aisle: "#a79b83",
  rug: "#5c4a73",
  rugLight: "#6e5a88",
  woodDark: "#5a3a26",
  wood: "#8b5a3a",
  woodLight: "#ab7348",
  metalDark: "#454c66",
  metal: "#7b84a0",
  metalLight: "#b3bbd0",
  screenOff: "#1c2a33",
  screenOn: "#5ff0d0",
  screenDim: "#2f7f78",
  white: "#f3efe6",
  paper: "#efe9d8",
  paperShade: "#cfc7ae",
  gray: "#9a98a4",
  grayDark: "#625f70",
  red: "#d6453d",
  redDark: "#8f2a2a",
  orange: "#e8803a",
  yellow: "#f2c84b",
  gold: "#e8b04a",
  goldDark: "#a8742a",
  green: "#5fcf7f",
  greenDark: "#2f7a4a",
  teal: "#3fb8b0",
  blue: "#4a7fd8",
  blueDark: "#2c4a8a",
  purple: "#8a5fc9",
  pink: "#e07aa8",
  glass: "#8fd0e0",
  rackDark: "#262a3c",
  rackMid: "#3a4058",
  ledGreen: "#6dff9a",
  ledAmber: "#ffc24a",
  ledRed: "#ff5a5a",
  skySun: "#8fd0ff",
  skyDusk: "#e89a6a",
  skyNight: "#1a2250",
} as const;

export const SHIRTS = [C.blue, C.teal, C.orange, C.purple, C.pink, C.green] as const;
export const SKINS = ["#f1c9a5", "#e0b08a", "#c58c64", "#9b6a46", "#6e4630"] as const;
export const HAIRS = ["#2b1d14", "#5a3a22", "#c98a3a", "#d9d2c0", "#b0382a", "#3a3a52", "#e8c25a"] as const;

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v + amount)));
  const r = f((n >> 16) & 255);
  const g = f((n >> 8) & 255);
  const b = f(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (s: number): number => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`;
}

import type { Tone } from "./meta";

/** Status colour classes, from the shadcn theme tokens. Colour is never the only signal: every use also has an icon and text. */
export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-success",
  warn: "text-warning",
  bad: "text-destructive",
  info: "text-info",
  ghost: "text-muted-foreground",
  neutral: "text-muted-foreground",
};

export const TONE_BADGE: Record<Tone, string> = {
  ok: "border-success/35 bg-success/10 text-success",
  warn: "border-warning/40 bg-warning/10 text-warning",
  bad: "border-destructive/45 bg-destructive/10 text-destructive",
  info: "border-info/35 bg-info/10 text-info",
  ghost: "border-dashed border-border bg-transparent text-muted-foreground",
  neutral: "border-border bg-transparent text-muted-foreground",
};

export const TONE_DOT: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  bad: "bg-destructive",
  info: "bg-info",
  ghost: "bg-muted-foreground/50",
  neutral: "bg-muted-foreground/50",
};

import { describe, expect, it } from "vitest";
import { PIXEL_ARRAYS, PIXEL_ARRAY_WIDTH, lookFor, poseKey } from "../src/office/sprites/procedural";
import { getSpriteSet, setSpriteSet, type SpriteSet } from "../src/office/sprites";
import { glyph, textWidth } from "../src/office/font";
import { modelAbbrev, nametag, steadyFor } from "../src/office/actors";
import { AGENT_STATES } from "@automicvault/shared";

describe("pixel arrays", () => {
  it("are exactly 16 columns wide (rows of equal length compose cleanly)", () => {
    for (const [name, rows] of Object.entries(PIXEL_ARRAYS)) {
      for (const [i, row] of rows.entries()) expect(row.length, `${name}[${i}] = "${row}"`).toBe(PIXEL_ARRAY_WIDTH);
    }
  });

  it("only use known palette keys", () => {
    const known = new Set(".OHSEMTtAPpBWKGVL ");
    for (const [name, rows] of Object.entries(PIXEL_ARRAYS)) {
      for (const row of rows) for (const ch of row) expect(known.has(ch), `${name}: unknown key ${ch}`).toBe(true);
    }
  });
});

describe("looks", () => {
  it("gives each role a distinct silhouette and is stable per name", () => {
    const hats = new Set(["boss", "hawk", "judge", "desk"].map((r) => lookFor(r as never, "x").hat));
    expect(hats.size).toBe(4);
    expect(lookFor("worker", "ada")).toEqual(lookFor("worker", "ada"));
    expect(lookFor("worker", "ada").shirt === lookFor("worker", "bob").shirt && lookFor("worker", "ada").skin === lookFor("worker", "bob").skin).toBe(false);
    expect(lookFor("unknown", "z").role).toBe("unknown");
  });

  it("builds unique pose keys", () => {
    const keys = new Set([
      poseKey({ kind: "stand", dir: "down" }),
      poseKey({ kind: "stand", dir: "left" }),
      poseKey({ kind: "walk", dir: "down", frame: 1 }),
      poseKey({ kind: "walk", dir: "down", frame: 5 }),
      poseKey({ kind: "carry", dir: "down", frame: 1 }),
      poseKey({ kind: "sit", frame: 1 }),
      poseKey({ kind: "slump" }),
    ]);
    expect(keys.size).toBe(6); // walk frame 5 wraps onto frame 1
  });
});

describe("sprite set registry", () => {
  it("can be swapped for a custom SpriteSet", () => {
    const original = getSpriteSet();
    expect(original.name).toBe("procedural");
    const fake = { name: "fake", frame: { w: 16, h: 24 }, character: () => null, prop: () => null, flame: () => null } as unknown as SpriteSet;
    setSpriteSet(fake);
    expect(getSpriteSet().name).toBe("fake");
    setSpriteSet(original);
    expect(getSpriteSet()).toBe(original);
  });
});

describe("bitmap font", () => {
  it("has a 3x5 glyph for every character the UI prints", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;-+/|%$()[]!?><=_'\"*#@& ·") {
      const g = glyph(ch);
      expect(g).toHaveLength(5);
      for (const row of g) expect(row).toHaveLength(3);
    }
    expect(glyph("é")).toEqual(glyph("?"));
    expect(glyph("a")).toEqual(glyph("A"));
    expect(glyph("→")).toEqual(glyph(">"));
    expect(textWidth("ABC")).toBe(11);
    expect(textWidth("")).toBe(0);
  });
});

describe("actors", () => {
  it("describes a steady appearance for every one of the 13 states, plus unknown", () => {
    for (const s of [...AGENT_STATES, "unknown" as const]) {
      const st = steadyFor(s);
      expect(st.badge.length).toBeGreaterThan(0);
      expect(typeof st.present).toBe("boolean");
    }
    expect(steadyFor("running").pose).toBe("type");
    expect(steadyFor("silent").emote).toBe("zzz");
    expect(steadyFor("failed").smoke).toBe(true);
    expect(steadyFor("interrupted").ghost).toBeTruthy();
    expect(steadyFor("closed").present).toBe(false);
    expect(steadyFor("planned").screen).toBe("blueprint");
  });

  it("abbreviates models for the name plate", () => {
    expect(modelAbbrev("claude-bridge/claude-opus-5-5")).toBe("OPUS5.5");
    expect(modelAbbrev("openai-codex/gpt-6.1-sol")).toBe("GPT6.1");
    expect(modelAbbrev("claude-bridge/claude-sonnet-5-5")).toBe("SONNE5.5");
    expect(nametag({ name: "ada", model: "openai-codex/gpt-6.1-sol", thinking: "medium" })).toEqual({ name: "ADA", model: "GPT6.1·MED" });
    expect(nametag({ name: "kestrelkestrel", model: "x", thinking: null }).name).toHaveLength(10);
  });
});

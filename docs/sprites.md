# Custom sprites

The office draws characters, props and flames only through the `SpriteSet` interface
(`packages/web/src/office/sprites/types.ts`). The default, `ProceduralSprites`, builds everything from
small pixel arrays in code, so the repo needs no image assets. To use your own art, implement the same
interface and install it before the first frame.

## The contract

```ts
export interface SpriteSet {
  readonly name: string;
  /** Character frame size in pixels. The anchor is the bottom-centre of the frame. */
  readonly frame: { w: number; h: number };
  character(look: Look, pose: Pose): HTMLCanvasElement;
  prop(name: PropName, variant?: number): HTMLCanvasElement;
  flame(tier: 1 | 2 | 3 | 4, frame: number): HTMLCanvasElement;
}
```

- **`Look`** says who is being drawn: `role` (`worker`, `boss`, `hawk`, `judge`, `desk`), plus the colours and hat the procedural set derives from the agent's name (`skin`, `hair`, `shirt`, `accent`, `pants`, `hat`). A sheet-based set can ignore the colours and key off `role` and `id` (a stable per-agent key such as `worker:ada`).
- **`Pose`** is one of:
  - `{ kind: "stand", dir }`, `{ kind: "walk", dir, frame: 0..3 }`, `{ kind: "carry", dir, frame }` with `dir` = `down | up | left | right` (the procedural set draws `right` and mirrors it for `left`; a custom set must return `left` itself)
  - `{ kind: "sit", frame: 0 | 1 | 2 }` (0 resting, 1 and 2 are the two typing frames), `slump` (silent/failed), `alert` (nudged), `{ kind: "stamp", frame: 0 | 1 }` (raised / down)
- **`PropName`**: `paper`, `blueprint`, `stamp`, `skull`, `check`, `bubble-bang`, `bubble-dots` (variant = which dot is lit), `spark`, `smoke` (variant = size), `ghost-scan`.
- **`flame(tier, frame)`**: tiers 1 (ember) to 4 (large), frames 0–3, anchored at the bottom centre.
- Returned canvases are cached by the caller and must not be mutated. The default frame is 16 × 24 px at 16-px tiles.

Seated characters are drawn *behind* their desk (the desk sprite overlaps their legs), so a seated frame
only needs to show the head, torso and arms resting on the desk.

## Installing a set

```ts
// packages/web/src/main.tsx, before createRoot(...)
import { setSpriteSet } from "./office/sprites";
import { SheetSprites } from "./my-sheet-sprites";

setSpriteSet(await SheetSprites.load("/sprites/office.png", "/sprites/office.json"));
```

Serve the images from the web root (`packages/web/public/`; they end up in `dist/web`). The server's CSP
allows `img-src 'self' data:`.

## A minimal sheet-based set

```ts
export class SheetSprites implements SpriteSet {
  readonly name = "sheet";
  readonly frame = { w: 16, h: 24 };
  private cache = new Map<string, HTMLCanvasElement>();
  constructor(private img: HTMLImageElement, private map: Record<string, [number, number, number, number]>) {}

  static async load(png: string, json: string): Promise<SheetSprites> {
    const img = new Image();
    img.src = png;
    await img.decode();
    return new SheetSprites(img, (await (await fetch(json)).json()) as Record<string, [number, number, number, number]>);
  }

  private cut(key: string): HTMLCanvasElement {
    let c = this.cache.get(key);
    if (!c) {
      const [x, y, w, h] = this.map[key] ?? [0, 0, 16, 24];
      c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const g = c.getContext("2d")!;
      g.imageSmoothingEnabled = false;
      g.drawImage(this.img, x, y, w, h, 0, 0, w, h);
      this.cache.set(key, c);
    }
    return c;
  }

  character(look: Look, pose: Pose): HTMLCanvasElement {
    return this.cut(`${look.role}/${poseKey(pose)}`); // poseKey is exported from procedural.ts
  }
  prop(name: PropName, variant = 0): HTMLCanvasElement {
    return this.cut(`prop/${name}/${variant}`);
  }
  flame(tier: 1 | 2 | 3 | 4, frame: number): HTMLCanvasElement {
    return this.cut(`flame/${tier}/${frame % 4}`);
  }
}
```

`poseKey()` (exported from `sprites/procedural.ts`) gives a stable string per pose, such as `walk:down:2` or
`sit:1`, which makes a handy key for a manifest. Open `/#sprites` while developing to see every role in
every pose drawn through the active set.

## Drawing the procedural way

The procedural set composes a character from layers: head, body, arms, legs, then a hat per role, each a
16-column array of palette keys (`O` outline, `H` hair, `S` skin, `T` shirt, `P` pants, …). To add a
role, add a hat array and a branch in `lookFor()` and `drawHat()` in `sprites/procedural.ts`. The unit
test in `packages/web/test/sprites.test.ts` fails if an array is not exactly 16 columns wide.

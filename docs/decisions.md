# Decisions and assumptions

Decisions made without asking, in the order they came up. Anything that differs from the
original brief is marked **(deviation)**.

## Tooling

1. **Stable toolchain majors, not the newest tags.** The registry's latest tags (TypeScript 7,
   Vite 8, Vitest 5, ESLint 10) were newer than anything the author could verify against, so
   the repo pins TypeScript 5.9, Vite 7, Vitest 3, ESLint 9, chokidar 4, Hono 4, `@hono/node-server` 1.
   Bumping is a one-line change per package.
2. **npm workspaces, not pnpm.** `npm install && npm run demo` is the acceptance path, so the repo
   needs nothing but npm.
3. **Canvas 2D, not PixiJS.** The scene is a few hundred tiles and sprites. A 2D canvas with
   `imageSmoothingEnabled = false` gives pixel-perfect integer scaling with zero dependencies, runs
   in headless CI (no WebGL), and is what the brief allowed ("plain canvas 2D if lighter").
4. **Hand-written tolerant decoders, not Zod/Effect schemas.** Muster's own decoders reject a whole
   document on one bad field. The office must do the opposite (skip the bad row, keep the rest,
   show a *degraded* badge), so the decoders are small explicit functions with per-row recovery.
   Muster's `Schema` definitions remain the reference; the contract is in `docs/data-contract.md`.
5. **One bundled server file.** `esbuild` bundles the server and `@muster-office/shared` into
   `dist/server/cli.js` (runtime deps `hono`, `@hono/node-server`, `chokidar` stay external);
   Vite writes the web app to `dist/web`. That is what makes `npx muster-office` a single package.

## Data

6. **State root = `--home` > `MUSTER_OFFICE_HOME` > `HOME` > `os.homedir()`.** Muster only
   relocates via `HOME`; there is no XDG support to honour.
7. **Bodies are fetched lazily, not hidden by CSS.** Desk/owner/report bodies never ride the SSE
   stream. With "show bodies" off the browser never receives them; turning it on makes the UI
   request `GET /api/body` for the item being looked at. The toggle persists in `localStorage`
   (in `try/catch`).
8. **Owner "titles" are the first line of `text`.** There is no title field in
   `dev.muster.note.post`; the office splits exactly where Muster's own renderer does.
9. **Job â†’ project is inferred** (cwd inside the project dir, else `repo` equals the slug or the
   directory name). Jobs are host-wide, so the machine room is drawn on every floor and highlights
   the jobs that belong to that project.
10. **Dead desk is approximated from the catalog.** Muster derives its skull from the live intercom
    session list, which is not on disk. The office shows the skull when desk items are open and no
    `desk`-role agent is in a process state. The tooltip says so.
11. **Commands are shown after redaction.** `muster-heavy` commands can embed tokens, so the server
    redacts `--token`-style flags, `*_KEY=`/`*_TOKEN=` assignments, URL credentials, bearer headers
    and well-known token shapes, and caps the command at 300 characters before it leaves the process.
12. **`AgentRow.profile.env`, `restore.env`, `cwd`, session files and pane ids are never forwarded.**
    Views are built from explicit allow-lists; a test serialises a view and asserts none of the
    planted secrets appear.

## Server

13. **Demo mode injects at the data-source layer.** The simulator emits the same raw documents
    (project.json text, JSONL lines, job JSON) through the same sink, parsers, model, diff and SSE
    code as the filesystem source. It writes nothing to disk, which keeps the "never opens a file in
    write mode" guarantee absolute, and the simulator is pure and deterministic (seeded, tick-driven).
14. **The server has no cache directory**, so the write-guard test asserts it opens *no* file for
    writing at all (stricter than the brief's "outside its cache dir").
15. **Watch directories, plus a 5 s rescan backstop.** Muster replaces `project.json` by atomic
    rename, which some watchers report as unlink+add. Watching the directory and rescanning by
    `(size, mtime)` every 5 s means a missed event costs at most 5 s.
16. **No browser auto-open.** Launching a browser is command execution; the CLI prints the URL.
17. **GET/HEAD only**, no CORS headers, strict `Host` and `Origin` allow-lists
    (`127.0.0.1`, `localhost`, `[::1]` on the bound port) to defeat DNS rebinding.
18. **A new snapshot is sent on every (re)connect** instead of replaying from `Last-Event-ID`.
    The client reconciles by fast-forwarding animations, so a reconnect never replays a walk-in.

## Office

19. **Tabs, not stacked floors.** One floor per project, chosen in the top bar.
20. **Character art is procedural** (pixel arrays + palettes in code). A `SpriteSet` interface and a
    registry make a PNG sprite sheet a drop-in replacement; see the README.
21. **Closed + archived lanes are hidden from the floor** (still in the Board view). Closed lanes
    whose delivery is `landed`/`deployed` stay, because they still count toward WIP.
22. **The queue at the door is drawn only when WIP is at the limit** and there is a backlog. It uses
    one generic "waiting" character per proposed lane in rank order.
23. **Mono theme honours `NO_COLOR`.** If the server process has `NO_COLOR` set, the UI defaults to the
    mono theme (the user can still switch).

## Added while building the office

24. **The demo script lives in `@muster-office/shared/demo`**, not in the server, because both the
    server's simulator and the web tests need the same pure script. It is a separate export, so the
    browser bundle never includes it.
25. **Geometry is rebuilt only on structural changes** (lane set, kinds, states, archived flags). Every
    sync re-points each bay at the current lane object, so delivery stage, deploy level and the static
    signature always see fresh data. A test caught the stale-lane bug this guards against.
26. **Bays are 9 tiles tall and the lobby 10**, so name plates always have headroom above heads and
    never collide with lane signs or the wall captions.
27. **Backlog is sped up, not just queued.** With several transitions in flight, walkers move up to 3Ã—
    faster; more than about 30 s of queued movement fast-forwards to the end state. Snapshots (first
    load, reconnect, project switch) and reduced motion place everyone directly.
28. **The data path was measured, not assumed.** A unit benchmark pushes 600+ events/min through the
    diff, reducer and world; a browser test drives a server at about 800 events/min and asserts at
    least 45 fps and under 8 ms of work per frame (measured here: 60 fps, about 1.8 ms).
29. **Plants are real obstacles.** Decoration that occupies a tile also blocks it in the walk grid, and
    the reachability tests still prove every seat, tray, queue spot and operator seat is reachable.
30. **`scripts/fixture-home.mjs` writes into a throw-away home** (never the server, never a real Muster
    path) so the non-demo path can be exercised, including by a Playwright test that plays the part of
    Muster and replaces `project.json` by atomic rename.
31. **No hard-coded test counts in docs**, so they cannot go stale.
32. **Not verified against a live Muster install.** None was available. The contract comes from the
    source at commit `e415c70`; everything real-data-shaped is tested with fixtures that follow the
    source schemas field for field, plus corrupt, partial and drifted variants.

## The "alive" upgrade

33. **Atmosphere is drawn per frame, not baked.** The static back canvas keeps only the window recess;
    sky, sun and moon, stars, clouds, rain and the skyline are drawn live (`office/fx.ts`), so they move
    and follow the local hour without rebuilding the floor. The weather is a pure function of the local
    calendar day (about one day in five is rainy), so a given day looks the same on every screen.
34. **Real lighting, one cheap pass.** A floor-sized mask is filled with the room's darkness for the
    local hour and every light (monitors, lamps, flames, rack LEDs, the warning light, windows) punches
    a soft hole with a cached radial sprite; a second additive pass adds coloured glow. Labels are drawn
    after it so they stay readable at night. `?hour=` pins the clock for screenshots and tests.
35. **Decoration is labelled as decoration.** Biscuit the cat, rain, dust and steam carry no data. The
    cat's tooltip and crew-list row say "not an agent", it never gets a name plate, it cannot be
    selected, and it settles into a nap under reduced motion. Its movement is a deterministic function of
    the project, and a unit test proves it only ever stands on walkable tiles (that test caught a real
    off-by-one in the cat's tile maths).
36. **Events are visible where they happen.** State changes, delivery stages, new desk items and job
    changes raise short floating labels at the place concerned (throttled per agent), proven deliveries
    throw confetti, and every change spikes the wall ECG. All of it is skipped on snapshots and under
    reduced motion, so a reconnect never replays a party.
37. **Alerts are quiet.** `lib/alerts.ts` turns only failures, silence, interruptions, new blocked,
    approval and decision items, deployed and proven deliveries, lost jobs and flow-stall flips into
    toasts (three at most per batch, de-duplicated, worst first). Routine progress never interrupts. Each
    toast knows where to take you; jumping from the Board selects without forcing the Office view.
38. **One bus, no coupling.** The crew list, palette, toasts and director ask the camera to move through a
    tiny `lib/bus.ts`, so none of them import the engine. Camera moves glide (eased, shorter for short
    hops, instant under reduced motion) and any manual pan, zoom or click cancels them and follow mode.
39. **The opening view is readable, not tiny.** A floor opens at 2x when the window is wide enough,
    centred on where the agents are, and is re-framed as the layout settles until the viewer moves the
    camera. `fit` still gives the whole-floor overview. (A first version framed too early, before the
    vital-signs row existed, and opened at 1x: the page grid now always reserves that row.)
40. **Director mode is a view feature only.** It flies to alerts and tours lanes, the desk and the machine
    room while idle, and backs off for 25 s after any input. Nothing it does touches data.
41. **Performance was measured, and CSS cost real frames.** Profiling showed the data path was cheap
    (about 1.9 ms of script per frame at ~800 events/min) but headless software compositing suffered from
    continuous CSS animations next to the canvas. So: no `backdrop-filter` or vignette over the canvas,
    no looping animations on healthy states, paint-free keyframes only (transform and opacity), the
    timeline does not animate rows, and the space around the floor is painted once into a cached layer
    and only the uncovered bands are copied each frame. The e2e floor is 40 fps (it measured 56) because
    headless Chromium has no GPU; real browsers target 60.
42. **Sound is opt-in and synthesised.** Off by default; turning it on creates the audio context from the
    click (which is what lets later alerts play). No audio files, no network.
43. **Portraits go through the sprite set.** The crew list and detail panel draw characters with the same
    `SpriteSet` as the office, so a custom sprite sheet changes them too, and one shared timer animates
    them all.

## shadcn/ui, icons instead of emoji

44. **The chrome is shadcn/ui, added with its own CLI.** Button, Badge, Tabs, Toggle Group, Switch, Dropdown
    Menu, Popover, Command (cmdk), Dialog, Select, Scroll Area, Table, Collapsible, Separator, Kbd, Tooltip
    and Sonner are the generated components under `packages/web/src/components/ui/`, themed with the zinc
    tokens (`--background`, `--card`, `--border`, `--muted`, `--primary`â€¦) in `styles.css`. The brief asked
    for minimal dependencies; this is the one deliberate exception, asked for by the user: Tailwind v4,
    `radix-ui`, `cmdk`, `sonner`, `lucide-react`, `class-variance-authority`, `clsx` and `tailwind-merge`.
    None of it runs on the server, and the server's CSP did not need to change.
45. **No emoji, anywhere.** State, desk-kind, timeline-kind and navigation glyphs are Lucide icons
    (`lib/meta.ts`). Muster's own agent labels start with an emoji ("<emoji> Callsign Â· role"), so display
    code passes them through `plainLabel()`. The two server-built strings that carried symbols (the desk
    timeline lines) were changed to plain words. Muster's exact flow line keeps its warning sign in the data;
    the Board shows it as an icon.
46. **Less decoration.** The first "alive" pass used gradients, glows, a gradient brand and a sweeping
    light. The shadcn version is flat: one-pixel borders, the zinc scale, a single radius, and colour only
    for status (success, warning, info, destructive). Status is never colour alone: each use also has an icon
    and a word, and the `mono` theme adds border styles on top.
47. **Themes map onto shadcn's `dark` class.** `data-theme` is still set (the canvas and the mono rules
    use it), and `dark` is toggled for `dark` and `mono`. The canvas reads a plain `--canvas` colour instead
    of the oklch tokens.
48. **Perf guard rails carried over.** Timeline rows are memoised (the generated icons made a full list
    re-render too costly under a stream of ~800 events a minute), the perf spec switches Playwright tracing
    off (a screencast would otherwise be measured as frame cost), and overlays that cover the canvas never
    use `backdrop-filter`.

## One screen, full screen, links

49. **The default view is the whole floor, filling the window.** A first version opened at a readable 2x
    and made you pan, which left most windows half empty and the rest hidden. `fitFill()` scales the whole
    floor to the window (never below 0.4x) and re-fits on resize. The price is a fractional scale: pixels
    are not all the same size, and below 1x the canvas smooths instead of dropping pixels. Zooming with the
    buttons, keys or wheel leaves fill mode and snaps back to whole steps, and clicking the minimap or flying
    to someone from the whole-floor view zooms in (a click on a map means "take me there"). `?close` opens
    the old zoomed view for screenshots.
50. **Full screen is a layout, not just a browser flag.** `Z` (or the expand button) requests browser full
    screen straight from the click and also hides the top bar, vital signs, crew column and timeline, leaving
    the office, a floating bar (floors, a one-line summary, Exit) and the camera box. Leaving full screen with
    Esc leaves the mode too (`fullscreenchange`). If the browser refuses full screen the layout still works.
51. **Empty margins do work.** When the window is at least 300 px wider than the floor on each side, the
    margin carries the live feed (and the desk's open items, or in full screen the crew list). The feed
    and inbox show titles and ages only, so bodies still wait for "show bodies". The timeline now starts
    collapsed in windows under 1000 px tall so the floor gets the height.
52. **Outbound links are anchors, configured at build time.** GitHub and X sit left of *Jump toâ€¦* as icon
    links (`target=_blank`, `rel=noopener noreferrer`) with tooltips. No account names are assumed: GitHub
    defaults to this repository and X to a pre-filled "share" post; `VITE_GITHUB_URL` and `VITE_X_URL`
    replace them. Nothing is fetched from either site, so the CSP and the "no outbound requests" property
    are unchanged. The brand marks are inline SVG because Lucide no longer ships them.
53. **Alerts stay out of the way.** Toasts sit below the vital signs (or at the very top in full screen),
    at most two at a time, never over the middle of the floor. One quiet first-run tip points at Ctrl K,
    `?` and `Z`, and is shown once.
54. **Accessibility is tested, not claimed.** `e2e/a11y.spec.ts` runs axe-core (WCAG 2 A and AA) over the
    office, the board, the open palette, the shortcuts dialog and the settings menu, in the dark and light
    themes. It found three real problems, all fixed: tab triggers pointing at panels that do not exist
    (`aria-controls`), a modal menu hiding focusable elements, and light-theme status colours below the
    contrast ratio. Fading alerts are excluded because axe would measure them mid-fade. Automated checks
    find only part of the problems; this is a floor, not a certificate.


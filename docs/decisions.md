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
9. **Job → project is inferred** (cwd inside the project dir, else `repo` equals the slug or the
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

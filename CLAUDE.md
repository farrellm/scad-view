# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm install
npm run setup              # REQUIRED once: downloads openscad.js + openscad.wasm into
                           # web/public/wasm/ (gitignored, ~9.6 MB, not in the repo)
npm run typecheck          # tsc --noEmit — the only static check in the project
npm run build              # vite build -> web/dist
npm start [root] [--port N] [--host H]   # serves web/dist + the API; root defaults to cwd
npm run dev [root]         # API on :8173 + Vite on :5273 (Vite proxies /api)
```

`npm start` serves the **built** `web/dist`, so rebuild after editing anything under `web/src`.

## Verification

**There is no test framework** — no vitest/jest, no test files. Do not claim tests pass.
Changes are verified by running the app and driving it. Two things make that practical:

- **Native `openscad` (`/usr/bin/openscad`) is installed and is the cross-check oracle.**
  The browser's triangle count must match it exactly:
  ```sh
  openscad -o /tmp/ref.off --export-format off --backend=manifold model.scad          # full
  openscad -o /tmp/ref.off --export-format off -D '$preview=true;$fa=12;$fs=2;$fn=0;' model.scad  # preview
  ```
- **`window.scadView = { state, viewer, renderer }`** is exposed in `web/src/main.ts` for
  automated inspection. `viewer.cameraState()` returns position/target — that is how you
  prove a live-reload did not move the camera. `renderer.constructor` can be driven directly
  to batch-render many models without clicking.

`testmodels/` holds fixtures covering the cases that matter: `colors.scad` (per-face RGB),
`main.scad` + `lib/widget.scad` (`use <>` dependency), `nested/deep.scad`
(`include <../lib/…>`), `detail.scad` (`$fn=100`, exercises the preview/full split).
`/usr/share/openscad/examples` (50 files) is a good broader sweep target.

When testing the built app, the browser caches `index.html` — **append a changing query
string** (`?v=2`) after a rebuild or you will silently test stale code.

## Architecture

Meshing runs **client-side in `openscad.wasm`**. The server never invokes OpenSCAD; it only
browses, reads, and watches files. Only `.scad` source crosses the wire.

```
click file ──> GET /api/bundle ──> server scans include/use/import/surface,
                                   returns {files, assets, missing}
                     │
                     v
        Worker: FS.writeFile(...) ─> callMain(-o /out.off) ─> FS.readFile
                     │
                     v
        OFF ──> BufferGeometry ──> three.js viewer

chokidar ──> GET /api/events (SSE) ──> client filters against its own bundle ──> re-render
```

Load-bearing decisions, each of which will look arbitrary until it bites you:

- **OFF is the transport.** `--export-format=off` yields indexed vertices plus per-face RGB
  (`3 v0 v1 v2 r g b`), so `color()` survives with no glTF/3MF dependency. The geometry is
  built **non-indexed** — per-face color forces vertex duplication anyway, and that makes
  `computeVertexNormals()` produce correct flat CSG normals for free.
- **One Worker per invocation, terminated after.** Superseding a render is just
  `terminate()`, a hard stop even mid-evaluation. This is the only thing preventing a burst
  of saves from queueing renders faster than they finish.
- **The server is stateless.** It broadcasts *every* file change under the root and does not
  track which model any client has open; each tab filters against its own dependency set.
  Several tabs on different models therefore work with no per-client bookkeeping.
- **`server/paths.mjs` is the single path-safety chokepoint.** Nothing else may join a
  request path onto the root. It rejects absolute paths and `..`, then `realpath`s to defeat
  symlinks pointing out of the tree. When the target does not exist it walks up to the
  nearest existing ancestor, so a missing file reads "not found", not "escapes the root".
- **Camera is preserved across re-renders.** `Viewer.setGeometry(..., frame)` takes `frame`
  true only when opening a *different* model. Auto-framing on every watch-triggered render
  makes the live-update workflow unusable.
- **Auto-render is always preview quality**; a full render never runs unattended. This is a
  deliberate product decision, not an oversight.

## OpenSCAD gotchas

These were all established empirically here; they are easy to get wrong from first principles.

- **The OFF header comes in two shapes.** The WASM build writes `OFF 231 454 0` on one line;
  native writes `OFF` then the counts on the next. `web/src/off.ts` accepts both. Testing
  only against native will miss this and every render will fail.
- **`-D` beats a model's own top-level assignment**, so preview quality overrides work — but
  the override string must include **`$fn=0`**, or a model that sets `$fn` at top level still
  wins over `$fa`/`$fs` and "preview" renders at full detail. See `PREVIEW_VARS` in
  `web/src/render/protocol.ts`.
- **`ECHO` output goes to stdout**, so `-o -` interleaves it with binary export data. Always
  export to a file.
- **Exit code 1 with no output is often normal**: a 2D model ("not a 3D object"), or one that
  produces no geometry ("top level object is empty"). `explainFailure()` in `main.ts`
  translates these; do not surface them as raw failures.
- **`import()`/`surface()` reference non-`.scad` files** (STLs, PNGs, fonts) that must be
  base64'd into the bundle and written into the WASM FS, or the model silently breaks.
  Only string literals can be resolved — a computed filename cannot.
- The WASM build is **single-threaded** (no `SharedArrayBuffer`/pthreads), so **no COOP/COEP
  headers are needed**.
- The glue at `/wasm/openscad.js` is loaded via a **`@vite-ignore` dynamic import** so Vite
  never bundles the 9.6 MB binary; it then resolves `openscad.wasm` beside itself through
  `import.meta.url`, needing no `locateFile` override.

## Version skew

The WASM is **OpenSCAD 2025.03.25** (pinned in `scripts/fetch-wasm.mjs`); the native binary
here is **2026.08.21**. They agree on triangle counts for ordinary models, but the WASM is
older and can OOM where native succeeds. When cross-checking produces a mismatch, suspect
the version gap before assuming a bug in this code.

## Scope boundaries

3D only; no `$OPENSCADPATH` / system-library resolution (`include <BOSL2/std.scad>` resolves
only under the served root); no customizer UI, mesh export, or in-browser editing.

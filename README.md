# scad-view

Browse OpenSCAD models that live on a server, view them in the browser, and have
the view update whenever a file changes on disk.

Meshing runs **client-side** in `openscad.wasm`, so the server never invokes
OpenSCAD — it only browses, reads, and watches files. Only `.scad` source crosses
the wire.

## Setup

```sh
npm install
npm run setup        # downloads the prebuilt OpenSCAD WASM into web/public/wasm
```

## Run

```sh
npm run build
npm start ~/models   # or any directory; defaults to the current one
# -> http://127.0.0.1:8173
```

For development, with hot reload of the frontend:

```sh
npm run dev ~/models   # API on :8173, Vite on :5273
```

Options: `--port N`, `--host H` (default `127.0.0.1`).

## Using it

- Pick a `.scad` file from the sidebar. It renders immediately at **preview**
  quality (coarse `$fa`/`$fs`, with `$preview=true` set).
- **Full render** re-runs using the model's own `$fn`/`$fa`/`$fs`.
- Saving the model — or any file it `include`s/`use`s, or any STL/PNG it
  `import()`s/`surface()`s — re-renders automatically at preview quality. A full
  render never runs unattended, and the camera never moves on a re-render.
- The log pane shows OpenSCAD's own stdout/stderr, so `echo()` output, warnings,
  and errors all land there verbatim.

## How it works

```
  browser                                    server (node)
  ┌──────────────────────────┐               ┌────────────────────────┐
  │ file tree ── click ──────┼── /api/bundle ┼─> scan include/use,    │
  │                          │               │   read entry + deps    │
  │ Worker: openscad.wasm    │<──────────────┼── {files, assets}      │
  │   callMain(-o out.off)   │               │                        │
  │      │                   │               │ chokidar ──> /api/events (SSE)
  │      v                   │<──────────────┼── {type, path}         │
  │ OFF ─> BufferGeometry    │               └────────────────────────┘
  │      ─> three.js viewer  │
  └──────────────────────────┘
```

- **OFF as the transport.** `--export-format=off` gives indexed vertices plus
  per-face RGB (`3 v0 v1 v2 r g b`), so `color()` survives and the result parses
  straight into a `BufferGeometry` with no glTF or 3MF dependency.
- **One worker per render.** Superseding a render is just `terminate()`, which
  hard-stops even a long evaluation — a burst of saves collapses to one render.
- **The server is stateless.** It broadcasts every file change under the root;
  each browser tab filters against its own dependency set, so several tabs on
  different models work with no per-client bookkeeping.
- **Path safety** lives entirely in `server/paths.mjs`. Requests are resolved and
  `realpath`'d against the root, which rejects `..`, absolute paths, and symlinks
  pointing out of the tree.

## Limitations

- **3D only.** A 2D model (`polygon`, `projection` without extrusion) has no OFF
  representation; the viewer says so rather than rendering nothing.
- **No system libraries.** `include <BOSL2/std.scad>` resolves only if the
  library sits under the served root. `$OPENSCADPATH` is not consulted.
- `import("…")` / `surface("…")` are detected as string literals; a computed
  filename cannot be resolved without evaluating the model.
- The WASM build is OpenSCAD 2025.03.25, which is older than a current native
  install and can run out of memory on very heavy models.
- No customizer UI, no mesh export, no in-browser editing.

## Layout

| Path | Role |
|---|---|
| `server/paths.mjs` | the one place client paths become filesystem paths |
| `server/deps.mjs` | include/use/import/surface scanning and bundling |
| `server/watch.mjs` | chokidar → SSE broadcast |
| `web/src/render/worker.ts` | one OpenSCAD WASM invocation |
| `web/src/off.ts` | OFF → `BufferGeometry` |
| `web/src/viewer.ts` | three.js scene and camera |
| `web/src/main.ts` | wiring, render policy, live-reload |

/// <reference lib="webworker" />
import { OUTPUT_PATH, renderArgs, type WorkerMessage, type RenderRequest } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// The Emscripten glue and its 9.6 MB binary live in public/wasm and are loaded at
// runtime, not bundled: @vite-ignore keeps Vite from trying to follow this. The
// glue then resolves openscad.wasm beside itself via import.meta.url, so no
// locateFile override is needed.
type OpenSCADModule = {
  FS: {
    writeFile(path: string, data: string | Uint8Array): void;
    readFile(path: string): Uint8Array;
    mkdir(path: string): void;
    chdir(path: string): void;
    analyzePath(path: string): { exists: boolean };
  };
  callMain(args: string[]): number;
  formatException?(e: number): string;
};
type OpenSCADFactory = (opts: Record<string, unknown>) => Promise<OpenSCADModule>;

const post = (m: WorkerMessage, transfer: Transferable[] = []) => self.postMessage(m, transfer);

/** mkdir -p inside the Emscripten FS. */
function ensureDir(fs: OpenSCADModule['FS'], dir: string) {
  if (!dir || dir === '.' || dir === '/') return;
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    if (!fs.analyzePath(cur).exists) fs.mkdir(cur);
  }
}

self.addEventListener('message', async (e: MessageEvent<RenderRequest>) => {
  const { entry, files, assets, preview, format } = e.data;
  const started = performance.now();
  const elapsed = () => performance.now() - started;

  try {
    const glueUrl = '/wasm/openscad.js'; // runtime asset: not resolvable at build time
    const mod = await import(/* @vite-ignore */ glueUrl);
    const OpenSCAD = mod.default as OpenSCADFactory;

    const instance = await OpenSCAD({
      noInitialRun: true,
      print: (text: string) => post({ kind: 'log', line: { stream: 'stdout', text } }),
      printErr: (text: string) => post({ kind: 'log', line: { stream: 'stderr', text } }),
    });

    // Mirror the server-relative layout so `include <../lib/foo.scad>` resolves
    // exactly as it does on disk.
    const write = (rel: string, data: string | Uint8Array) => {
      const p = '/' + rel;
      ensureDir(instance.FS, p.slice(0, p.lastIndexOf('/')));
      instance.FS.writeFile(p, data);
    };
    for (const [rel, content] of Object.entries(files)) write(rel, content);
    for (const [rel, b64] of Object.entries(assets ?? {})) {
      write(rel, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    }
    instance.FS.chdir('/');

    let exitCode: number;
    try {
      exitCode = instance.callMain(renderArgs(entry, preview, format));
    } catch (err) {
      // Emscripten can throw a raw C++ exception pointer.
      const detail = typeof err === 'number' && instance.formatException
        ? instance.formatException(err)
        : String(err);
      throw new Error(`OpenSCAD invocation failed: ${detail}`);
    }

    let output: ArrayBuffer | null = null;
    const outPath = OUTPUT_PATH[format];
    if (instance.FS.analyzePath(outPath).exists) {
      const bytes = instance.FS.readFile(outPath);
      // Copy out of the wasm heap so the buffer can be transferred.
      output = bytes.slice().buffer as ArrayBuffer;
    }

    post({ kind: 'done', exitCode, output, elapsedMs: elapsed() }, output ? [output] : []);
  } catch (err) {
    post({ kind: 'error', message: err instanceof Error ? err.message : String(err), elapsedMs: elapsed() });
  }
});

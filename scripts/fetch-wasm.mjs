#!/usr/bin/env node
// Downloads the official prebuilt OpenSCAD WASM build used by openscad-playground
// and unpacks it into web/public/wasm/. Idempotent: skips if already present.
import { createWriteStream } from 'node:fs';
import { mkdir, stat, readFile, writeFile, unlink } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DEST = path.join(ROOT, 'web/public/wasm');
const URL_ = 'https://files.openscad.org/playground/OpenSCAD-2025.03.25.wasm24456-WebAssembly-web.zip';
const EXPECTED = { 'openscad.js': 124567, 'openscad.wasm': 9603115 };

const exists = async (p) => { try { return await stat(p); } catch { return null; } };

async function main() {
  const have = await exists(path.join(DEST, 'openscad.wasm'));
  if (have && have.size === EXPECTED['openscad.wasm']) {
    console.log('wasm already present, skipping download');
    return;
  }
  await mkdir(DEST, { recursive: true });
  const zip = path.join(DEST, '.download.zip');

  console.log(`downloading ${URL_}`);
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

  // No unzip dependency: shell out to the system tool, which every platform we
  // care about has. Node has no built-in zip reader.
  await promisify(execFile)('unzip', ['-o', '-j', zip, 'openscad.js', 'openscad.wasm', '-d', DEST]);
  await unlink(zip);

  for (const [name, size] of Object.entries(EXPECTED)) {
    const st = await exists(path.join(DEST, name));
    if (!st) throw new Error(`missing ${name} after unpack`);
    if (st.size !== size) console.warn(`warning: ${name} is ${st.size} bytes, expected ${size}`);
    else console.log(`  ${name}  ${st.size} bytes`);
  }

  // The Emscripten glue resolves openscad.wasm via import.meta.url, which works
  // as-is when both files sit side by side under /wasm/. Sanity-check that.
  const glue = await readFile(path.join(DEST, 'openscad.js'), 'utf8');
  if (!glue.includes('import.meta.url')) {
    console.warn('warning: openscad.js does not reference import.meta.url; wasm locating may need a locateFile override');
  }
  console.log('done');
}

main().catch((e) => { console.error(e.message); process.exit(1); });

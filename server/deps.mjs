import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import { safeResolve, UnsafePathError } from './paths.mjs';

/**
 * Remove line and block comments so include/use scanning does not pick up
 * commented-out references. Double-quoted strings are respected, because a
 * string may legitimately contain "//" (e.g. a URL in an echo).
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      out += c; i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') { out += src[i]; i++; }
        if (i < src.length) { out += src[i]; i++; }
      }
      if (i < src.length) { out += src[i]; i++; }
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      out += ' '; // keep tokens on either side from fusing
    } else {
      out += c; i++;
    }
  }
  return out;
}

// include <x> / use <x>
const ANGLE_RE = /\b(?:include|use)\s*<([^>\n]*)>/g;
// import("x") / surface("x") / surface(file = "x") -- literal filenames only;
// a computed path cannot be resolved without evaluating the model.
const CALL_RE = /\b(?:import|surface)\s*\(\s*(?:file\s*=\s*)?"([^"\n]*)"/g;

const isScad = (ref) => ref.toLowerCase().endsWith('.scad');

/**
 * The files a single source references, split by how they must be shipped:
 * `.scad` sources are recursed into as text, everything else (STLs for import(),
 * PNGs for surface(), font files) is shipped verbatim as a binary asset.
 */
export function scanRefs(src) {
  const clean = stripComments(src);
  const scad = [];
  const assets = [];
  for (const m of clean.matchAll(ANGLE_RE)) {
    const ref = m[1].trim();
    if (ref) (isScad(ref) ? scad : assets).push(ref);
  }
  for (const m of clean.matchAll(CALL_RE)) {
    const ref = m[1].trim();
    if (ref) assets.push(ref);
  }
  return { scad, assets };
}

// Guard against a model importing a huge mesh: everything here is base64'd into
// a JSON response and then into the wasm heap.
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

export async function collectBundle(root, entryRel) {
  const files = {};
  const assets = {};
  const mtimes = {};
  const missing = [];
  const seen = new Set();
  let assetBytes = 0;

  /** Resolve a reference against the root, recording why it failed if it did. */
  const resolve = async (rel) => {
    try {
      return await safeResolve(root, rel);
    } catch (e) {
      if (e instanceof UnsafePathError) { missing.push({ path: rel, reason: e.message }); return null; }
      throw e;
    }
  };

  const addAsset = async (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const abs = await resolve(rel);
    if (!abs) return;
    let data, st;
    try {
      [data, st] = await Promise.all([readFile(abs), stat(abs)]);
    } catch {
      missing.push({ path: rel, reason: 'not found' });
      return;
    }
    if (assetBytes + data.byteLength > MAX_ASSET_BYTES) {
      missing.push({ path: rel, reason: `too large (bundle limit ${MAX_ASSET_BYTES / 1024 / 1024} MB)` });
      return;
    }
    assetBytes += data.byteLength;
    assets[rel] = data.toString('base64');
    mtimes[rel] = st.mtimeMs;
  };

  const queue = [entryRel];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);

    const abs = await resolve(rel);
    if (!abs) continue;

    let src, st;
    try {
      [src, st] = await Promise.all([readFile(abs, 'utf8'), stat(abs)]);
    } catch {
      missing.push({ path: rel, reason: 'not found' });
      continue;
    }

    files[rel] = src;
    mtimes[rel] = st.mtimeMs;

    const dir = path.posix.dirname(rel);
    const rebase = (ref) => path.posix.normalize(dir === '.' ? ref : `${dir}/${ref}`);
    const { scad, assets: assetRefs } = scanRefs(src);
    for (const ref of scad) {
      const childRel = rebase(ref);
      if (!seen.has(childRel)) queue.push(childRel);
    }
    for (const ref of assetRefs) await addAsset(rebase(ref));
  }

  return { entry: entryRel, files, assets, mtimes, missing };
}

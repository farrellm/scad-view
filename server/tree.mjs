import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { toRel } from './paths.mjs';

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '__pycache__']);
const isHidden = (name) => name.startsWith('.');

/**
 * Recursively list directories and *.scad files under `dir`, as a tree.
 * Directories containing no .scad file at any depth are pruned, so browsing a
 * large source tree does not bury the models in empty folders.
 */
export async function buildTree(root, dir = root, depth = 0) {
  if (depth > 12) return [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // unreadable directory: skip rather than fail the whole listing
  }

  const dirs = [];
  const files = [];
  for (const e of entries) {
    if (isHidden(e.name)) continue;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      const children = await buildTree(root, path.join(dir, e.name), depth + 1);
      if (children.length) {
        dirs.push({ name: e.name, path: toRel(root, path.join(dir, e.name)), type: 'dir', children });
      }
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.scad')) {
      files.push({ name: e.name, path: toRel(root, path.join(dir, e.name)), type: 'file' });
    }
  }

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  return [...dirs.sort(byName), ...files.sort(byName)];
}

// The single chokepoint for turning client-supplied paths into filesystem paths.
// Nothing else in the server may join a request path onto the root.
import path from 'node:path';
import { realpath } from 'node:fs/promises';

export class UnsafePathError extends Error {}

/**
 * Resolve `rel` (a client-supplied path, relative to `root`) to an absolute path
 * that is provably inside `root`. Throws UnsafePathError otherwise.
 *
 * `root` must already be realpath'd by the caller (done once at startup).
 *
 * The realpath step is what defeats symlinks pointing out of the tree; the
 * lexical checks catch the cheap cases before we touch the disk. When the target
 * does not exist yet realpath throws ENOENT, so we fall back to checking the
 * realpath'd parent directory -- that still catches a symlinked parent.
 */
export async function safeResolve(root, rel) {
  if (typeof rel !== 'string' || rel === '') throw new UnsafePathError('path is required');
  if (rel.includes('\0')) throw new UnsafePathError('path contains a null byte');
  if (path.isAbsolute(rel)) throw new UnsafePathError('path must be relative to the root');

  const abs = path.resolve(root, rel);
  if (!contains(root, abs)) throw new UnsafePathError('path escapes the root');

  let real;
  try {
    real = await realpath(abs);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // The target does not exist, so there is no symlink at the leaf to check.
    // Walk up to the nearest ancestor that does exist and check that instead:
    // that still catches a symlinked parent directory pointing out of the tree.
    // Missing intermediate directories are simply "not found", not an escape.
    let dir = path.dirname(abs);
    while (dir !== root && contains(root, dir)) {
      const resolved = await realpath(dir).catch(() => null);
      if (resolved !== null) {
        if (!contains(root, resolved)) throw new UnsafePathError('path escapes the root via a symlink');
        break;
      }
      dir = path.dirname(dir);
    }
    return abs; // caller reports it as not found
  }
  if (!contains(root, real)) throw new UnsafePathError('path escapes the root via a symlink');
  return real;
}

/** True if `abs` is `root` itself or lives underneath it. */
export function contains(root, abs) {
  return abs === root || abs.startsWith(root + path.sep);
}

/** Inverse of safeResolve: an absolute path back to a root-relative, POSIX-style path. */
export function toRel(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

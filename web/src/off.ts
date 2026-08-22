import { BufferAttribute, BufferGeometry } from 'three';

export interface ParsedOff {
  geometry: BufferGeometry;
  triangles: number;
  hasColor: boolean;
}

// OpenSCAD writes face colors as sRGB 0-255. Vertex-color buffers are read as
// linear-sRGB, so each channel needs the sRGB transfer curve applied. Input is a
// byte, so precompute all 256 answers.
const SRGB_TO_LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
// A channel is 0..255 unless the token was written with a decimal point, in
// which case the OFF spec's 0..1 float form is in play.
const srgbToLinear = (token: string): number => {
  const v = +token;
  if (!Number.isFinite(v)) return 1;
  if (token.includes('.')) {
    const c = Math.max(0, Math.min(1, v));
    return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return SRGB_TO_LINEAR[Math.max(0, Math.min(255, v | 0))];
};

/**
 * Parse the ASCII OFF that `openscad --export-format=off` produces.
 *
 * Faces carry optional per-face RGB (`3 v0 v1 v2 r g b`), which is how `color()`
 * survives the export. Per-face color forces vertex duplication, so the result is
 * a non-indexed geometry -- which also gives correct flat normals for free from
 * computeVertexNormals(), since each triangle then owns its three vertices.
 */
export function parseOff(text: string): ParsedOff {
  const lines = text.split('\n');
  let li = 0;

  const nextLine = (): string => {
    while (li < lines.length) {
      const line = lines[li++];
      const hash = line.indexOf('#');
      const s = (hash === -1 ? line : line.slice(0, hash)).trim();
      if (s) return s;
    }
    return '';
  };

  // The counts may share the header's line ("OFF 231 454 0", which the WASM
  // build emits) or sit on the next one (what the native build emits). Both are
  // legal OFF, so accept either.
  const header = nextLine();
  const headerParts = header.split(/\s+/);
  if (!/^(C|N|CN|NC|4|ST)?OFF$/.test(headerParts[0])) {
    throw new Error(`not an OFF file (header was ${JSON.stringify(header.slice(0, 20))})`);
  }

  const counts = (headerParts.length > 1 ? headerParts.slice(1) : nextLine().split(/\s+/)).map(Number);
  const vertexCount = counts[0] | 0;
  const faceCount = counts[1] | 0;
  if (!Number.isFinite(vertexCount) || !Number.isFinite(faceCount)) {
    throw new Error('malformed OFF counts line');
  }

  const verts = new Float32Array(vertexCount * 3);
  for (let v = 0; v < vertexCount; v++) {
    const parts = nextLine().split(/\s+/);
    verts[v * 3] = +parts[0];
    verts[v * 3 + 1] = +parts[1];
    verts[v * 3 + 2] = +parts[2];
  }

  // Assume triangles (what Manifold emits); grow if a polygon turns up.
  let capacity = Math.max(faceCount, 1) * 3;
  let positions = new Float32Array(capacity * 3);
  let colors = new Float32Array(capacity * 3);
  let n = 0; // vertices written
  let hasColor = false;

  const grow = (needed: number) => {
    if (n + needed <= capacity) return;
    while (n + needed > capacity) capacity *= 2;
    const p = new Float32Array(capacity * 3);
    p.set(positions.subarray(0, n * 3));
    positions = p;
    const c = new Float32Array(capacity * 3);
    c.set(colors.subarray(0, n * 3));
    colors = c;
  };

  const push = (vi: number, r: number, g: number, b: number) => {
    positions[n * 3] = verts[vi * 3];
    positions[n * 3 + 1] = verts[vi * 3 + 1];
    positions[n * 3 + 2] = verts[vi * 3 + 2];
    colors[n * 3] = r;
    colors[n * 3 + 1] = g;
    colors[n * 3 + 2] = b;
    n++;
  };

  for (let f = 0; f < faceCount; f++) {
    const line = nextLine();
    if (!line) break;
    const parts = line.split(/\s+/);
    const k = +parts[0] | 0;
    if (k < 3) continue;

    let r = 1, g = 1, b = 1;
    // Anything past the indices is color: 3 channels (RGB) or 4 (RGBA, alpha ignored).
    if (parts.length >= k + 4) {
      r = srgbToLinear(parts[k + 1]);
      g = srgbToLinear(parts[k + 2]);
      b = srgbToLinear(parts[k + 3]);
      hasColor = true;
    }

    grow((k - 2) * 3);
    const v0 = +parts[1] | 0;
    for (let t = 1; t + 1 < k; t++) { // fan-triangulate
      push(v0, r, g, b);
      push(+parts[t + 1] | 0, r, g, b);
      push(+parts[t + 2] | 0, r, g, b);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions.subarray(0, n * 3), 3));
  if (hasColor) geometry.setAttribute('color', new BufferAttribute(colors.subarray(0, n * 3), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();

  return { geometry, triangles: n / 3, hasColor };
}

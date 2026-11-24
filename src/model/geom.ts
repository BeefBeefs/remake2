/** Geometry helpers shared by the model and stage viewers. */

/** Slot order that traces a quad's outline as a convex loop: (0,1,2,3), else (0,1,3,2), else (0,2,1,3); falls back to the stored order. */
export function quadOrder(p: number[][]): number[] {
  const sub = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const convex = (o: number[]): boolean | null => {
    let n = cross(sub(p[o[1]], p[o[0]]), sub(p[o[2]], p[o[0]]));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-9) n = cross(sub(p[o[2]], p[o[1]]), sub(p[o[3]], p[o[1]]));
    if (Math.hypot(n[0], n[1], n[2]) < 1e-9) return null;
    let pos = 0, neg = 0;
    for (let i = 0; i < 4; i++) {
      const c = dot(cross(sub(p[o[(i + 1) % 4]], p[o[i]]), sub(p[o[(i + 2) % 4]], p[o[(i + 1) % 4]])), n);
      if (c >= 0) pos++; if (c <= 0) neg++;
    }
    return pos === 4 || neg === 4;
  };
  for (const o of [[0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3]]) if (convex(o)) return o;
  return [0, 1, 2, 3];
}

type V3 = number[];

/**
 * Coplanar overlap ranks for a list of triangles (the game just draws later primitives over earlier ones; a depth buffer instead
 * z-fights wherever two triangles lie in one plane, e.g. a rug or a doorway decal over the floor). rank 0 = nothing coplanar lies
 * under it; otherwise 1 + the number of overlapping coplanar triangles that are larger (ties: earlier index is lower), capped at `max`.
 */
export function coplanarRanks(tris: V3[][], max = 3): number[] {
  const info = tris.map(([a, b, c]) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) return null;
    nx /= len; ny /= len; nz /= len;
    const big = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? nx : Math.abs(ny) >= Math.abs(nz) ? ny : nz;
    if (big < 0) { nx = -nx; ny = -ny; nz = -nz; }
    return { n: [nx, ny, nz], d: nx * a[0] + ny * a[1] + nz * a[2], area: len / 2 };
  });
  const groups = new Map<string, number[]>();
  info.forEach((t, i) => {
    if (!t) return;
    const k = `${Math.round(t.n[0] * 8)},${Math.round(t.n[1] * 8)},${Math.round(t.n[2] * 8)}`;
    const g = groups.get(k);
    if (g) g.push(i); else groups.set(k, [i]);
  });
  const rank = new Array<number>(tris.length).fill(0);
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((p, q) => info[p]!.d - info[q]!.d);
    for (let x = 0; x < g.length; x++) {
      const i = g[x], ti = info[i]!;
      let r = 0;
      for (let y = x - 1; y >= 0; y--) {
        const j = g[y], tj = info[j]!;
        if (ti.d - tj.d > 1.5) break;
        if (ti.n[0] * tj.n[0] + ti.n[1] * tj.n[1] + ti.n[2] * tj.n[2] < 0.995) continue;
        if (!(tj.area > ti.area || (tj.area === ti.area && j < i))) continue;
        if (overlap(tris[i], tris[j], ti.n)) r++;
      }
      for (let y = x + 1; y < g.length; y++) {
        const j = g[y], tj = info[j]!;
        if (tj.d - ti.d > 1.5) break;
        if (ti.n[0] * tj.n[0] + ti.n[1] * tj.n[1] + ti.n[2] * tj.n[2] < 0.995) continue;
        if (!(tj.area > ti.area || (tj.area === ti.area && j < i))) continue;
        if (overlap(tris[i], tris[j], ti.n)) r++;
      }
      rank[i] = Math.min(max, r);
    }
  }
  return rank;
}

/** Do two coplanar triangles overlap with real area (touching edges / corners do not count)? Separating-axis test in the dominant plane. */
function overlap(A: V3[], B: V3[], n: number[]): boolean {
  const ax = Math.abs(n[0]) >= Math.abs(n[1]) && Math.abs(n[0]) >= Math.abs(n[2]) ? 0 : Math.abs(n[1]) >= Math.abs(n[2]) ? 1 : 2;
  const [p, q] = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1];
  const a = A.map((v) => [v[p], v[q]]), b = B.map((v) => [v[p], v[q]]);
  for (const T of [a, b]) {
    for (let i = 0; i < 3; i++) {
      const e = [T[(i + 1) % 3][0] - T[i][0], T[(i + 1) % 3][1] - T[i][1]];
      const ax2 = [-e[1], e[0]];
      const len = Math.hypot(ax2[0], ax2[1]) || 1;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const v of a) { const s = (v[0] * ax2[0] + v[1] * ax2[1]) / len; minA = Math.min(minA, s); maxA = Math.max(maxA, s); }
      for (const v of b) { const s = (v[0] * ax2[0] + v[1] * ax2[1]) / len; minB = Math.min(minB, s); maxB = Math.max(maxB, s); }
      if (maxA <= minB + 0.5 || maxB <= minA + 0.5) return false;
    }
  }
  return true;
}

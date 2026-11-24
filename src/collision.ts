/**
 * Hero collision against a stage's collision mesh, kept free of three.js so it can be run headless (tools/sim_collision.mjs).
 * World space: PS1 (x, y, z) -> (x, -y, -z); y is up. Up-facing triangles are floors, steep ones are walls.
 */
export interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

/** A steep collision triangle seen from above: its longest edge in the xz plane plus the height range it covers. */
export interface Wall { ax: number; az: number; bx: number; bz: number; y0: number; y1: number }

/** Movement constants (world units): the original's step-up test is 0x32000 in 12-bit fixed point = 50 units; falling has no limit. */
export const cfg = { stepUp: 60, heroR: 26, wallR: 10, gravity: 1800, jumpV: 600, walls: true };

const CELL = 128;
const key = (i: number, j: number): number => (i + 4096) * 8192 + (j + 4096);

export interface World {
  tris: Tri[];
  walls: Wall[];
  lowest: number;
  floorGrid: Map<number, number[]>;
  wallGrid: Map<number, number[]>;
}

/** Split collision triangles into floors and walls and index both on a coarse grid. `wallsBlock` = false builds a floor-only world. */
export function buildWorld(triangles: Tri[]): World {
  const tris: Tri[] = [];
  const walls: Wall[] = [];
  for (const tri of triangles) {
    const ux = tri.bx - tri.ax, uy = tri.by - tri.ay, uz = tri.bz - tri.az;
    const vx = tri.cx - tri.ax, vy = tri.cy - tri.ay, vz = tri.cz - tri.az;
    const ny = uz * vx - ux * vz;
    const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || 1;
    if (Math.abs(ny) / len < 0.5) {
      const px = [tri.ax, tri.bx, tri.cx], pz = [tri.az, tri.bz, tri.cz], py = [tri.ay, tri.by, tri.cy];
      let bi = 0, bl = -1;
      for (let k = 0; k < 3; k++) { const l = Math.hypot(px[(k + 1) % 3] - px[k], pz[(k + 1) % 3] - pz[k]); if (l > bl) { bl = l; bi = k; } }
      if (bl > 1) walls.push({ ax: px[bi], az: pz[bi], bx: px[(bi + 1) % 3], bz: pz[(bi + 1) % 3], y0: Math.min(...py), y1: Math.max(...py) });
    } else tris.push(tri);
  }
  const floorGrid = new Map<number, number[]>();
  tris.forEach((t, n) => {
    const x0 = Math.floor(Math.min(t.ax, t.bx, t.cx) / CELL), x1 = Math.floor(Math.max(t.ax, t.bx, t.cx) / CELL);
    const z0 = Math.floor(Math.min(t.az, t.bz, t.cz) / CELL), z1 = Math.floor(Math.max(t.az, t.bz, t.cz) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = key(i, j); const a = floorGrid.get(k); if (a) a.push(n); else floorGrid.set(k, [n]); }
  });
  const wallGrid = new Map<number, number[]>();
  walls.forEach((w, n) => {
    const x0 = Math.floor((Math.min(w.ax, w.bx) - cfg.heroR) / CELL), x1 = Math.floor((Math.max(w.ax, w.bx) + cfg.heroR) / CELL);
    const z0 = Math.floor((Math.min(w.az, w.bz) - cfg.heroR) / CELL), z1 = Math.floor((Math.max(w.az, w.bz) + cfg.heroR) / CELL);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const k = key(i, j); const a = wallGrid.get(k); if (a) a.push(n); else wallGrid.set(k, [n]); }
  });
  const lowest = tris.length ? Math.min(...tris.map((t) => Math.min(t.ay, t.by, t.cy))) : -1e9;
  return { tris, walls, lowest, floorGrid, wallGrid };
}

/** Highest floor under (x,z) that is at most `up` above `y` (what the hero can stand on or step up to), or null. */
export function groundBelow(w: World, x: number, z: number, y: number, up: number): number | null {
  let best: number | null = null;
  const lim = y + up;
  const cand = w.floorGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!cand) return null;
  for (const n of cand) {
    const t = w.tris[n];
    const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
    if (Math.abs(d) < 1e-6) continue;
    const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
    const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
    const fy = l1 * t.ay + l2 * t.by + l3 * t.cy;
    if (fy <= lim && (best === null || fy > best)) best = fy;
  }
  return best;
}

/** How far a hero circle at (x,z) with feet at `y` sinks into collision walls (0 = free). Walls lower than a step or above head height are ignored. */
export function wallDepth(w: World, x: number, z: number, y: number): number {
  let depth = 0;
  if (!cfg.walls) return 0;
  const cand = w.wallGrid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!cand) return 0;
  for (const n of cand) {
    const s = w.walls[n];
    if (s.y1 <= y + cfg.stepUp || s.y0 >= y + 110) continue;
    const ex = s.bx - s.ax, ez = s.bz - s.az;
    const l2 = ex * ex + ez * ez;
    const u = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
    const d = Math.hypot(x - (s.ax + ex * u), z - (s.az + ez * u));
    if (cfg.wallR - d > depth) depth = cfg.wallR - d;
  }
  return depth;
}

/** Hero body: position (feet) and vertical state. */
export interface Body { x: number; y: number; z: number; vy: number; airborne: boolean }

/** Try to move the body to (nx,nz); `solid` can veto (props). Returns true when it moved. */
export function tryMove(w: World, b: Body, nx: number, nz: number, solid?: (x: number, z: number) => boolean): boolean {
  if (solid?.(nx, nz)) return false;
  const wd = wallDepth(w, nx, nz, b.y);
  if (wd > 0 && wd > wallDepth(w, b.x, b.z, b.y) + 0.01) return false;
  if (b.airborne) { b.x = nx; b.z = nz; return true; }
  const fy = groundBelow(w, nx, nz, b.y, cfg.stepUp);
  if (fy === null) return false; // nothing to stand on within a step: void, or a cliff / ledge taller than a step
  b.x = nx;
  b.z = nz;
  if (fy < b.y - 12) b.airborne = true; // walked off a ledge: fall (gravity lands on the lower floor)
  else b.y = fy;
  return true;
}

/** Gravity step while airborne. Returns 'out' when the body fell far below the map (caller puts it back on safe ground). */
export function fallStep(w: World, b: Body, dt: number): 'air' | 'landed' | 'out' {
  const y0 = b.y;
  b.vy -= cfg.gravity * dt;
  const y1 = y0 + b.vy * dt;
  if (b.vy <= 0) {
    const g = groundBelow(w, b.x, b.z, y0, 2);
    if (g !== null && y1 <= g) { b.y = g; b.airborne = false; b.vy = 0; return 'landed'; }
  }
  b.y = y1;
  return y1 < w.lowest - 400 ? 'out' : 'air';
}

/** Standing still on the ground: stay glued to the floor, or start falling when it vanished. */
export function settle(w: World, b: Body): void {
  const g = groundBelow(w, b.x, b.z, b.y, cfg.stepUp);
  if (g === null || g < b.y - 12) b.airborne = true;
  else b.y = g;
}

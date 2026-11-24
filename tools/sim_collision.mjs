// Headless walk/jump reachability simulation on the real stage data, using the same collision code as play mode.
// usage: node --experimental-strip-types tools/sim_collision.mjs <stage...> [key=value ...]   (keys: stepUp heroR walls=0/1)
import fs from 'node:fs';
import { buildWorld, tryMove, fallStep, groundBelow, cfg } from '../src/collision.ts';

const args = process.argv.slice(2);
const stages = [];
for (const a of args) {
  if (a.includes('=')) { const [k, v] = a.split('='); cfg[k] = k === 'walls' ? v === '1' : Number(v); } else stages.push(Number(a));
}
const dir = new URL('../public/assets/stages/', import.meta.url).pathname;
const doors = JSON.parse(fs.readFileSync(dir + 'doors.json', 'utf8'));
const arrivals = JSON.parse(fs.readFileSync(dir + 'arrivals.json', 'utf8'));

function load(i) {
  const j = JSON.parse(fs.readFileSync(dir + `stage${String(i).padStart(2, '0')}.json`, 'utf8'));
  const c = j.collision, tris = [];
  for (const t of c.tris) {
    if (t.slice(0, 3).some((k) => k >= c.verts.length)) continue;
    const [a, b, d] = [c.verts[t[0]], c.verts[t[1]], c.verts[t[2]]];
    tris.push({ ax: a[0], ay: -a[1], az: -a[2], bx: b[0], by: -b[1], bz: -b[2], cx: d[0], cy: -d[1], cz: -d[2] });
  }
  return { j, world: buildWorld(tris) };
}
const DT = 1 / 60, CELLS = 24;
const dirs = [];
for (let k = 0; k < 8; k++) dirs.push([Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
const keyOf = (b) => `${Math.round(b.x / CELLS)},${Math.round(b.z / CELLS)},${Math.round(b.y / CELLS)}`;
const copy = (b) => ({ x: b.x, y: b.y, z: b.z, vy: b.vy, airborne: b.airborne });

function settleFall(world, b, steer) {
  // run gravity until landing (steer = [dx,dz,frames] keeps moving in the air for that many frames)
  for (let f = 0; f < 600; f++) {
    if (steer && f < steer[2]) {
      let ok = tryMove(world, b, b.x + steer[0] * 220 * DT, b.z + steer[1] * 220 * DT);
      if (!ok) { /* slide */ if (!tryMove(world, b, b.x + steer[0] * 220 * DT, b.z)) tryMove(world, b, b.x, b.z + steer[1] * 220 * DT); }
    }
    const r = fallStep(world, b, DT);
    if (r === 'landed') return true;
    if (r === 'out') return false;
  }
  return false;
}

function explore(world, start) {
  const seen = new Map();
  const q = [start];
  seen.set(keyOf(start), start);
  let jumpsUsed = 0;
  while (q.length) {
    const s = q.pop();
    const push = (b) => { const k = keyOf(b); if (!seen.has(k)) { seen.set(k, b); q.push(b); } };
    for (const [dx, dz] of dirs) {
      // walk
      const b = copy(s);
      if (tryMove(world, b, s.x + dx * CELLS, s.z + dz * CELLS)) {
        if (b.airborne ? settleFall(world, b, null) : true) push(b);
      }
      // jump (full steer, half steer, none)
      for (const frames of [12, 24, 60]) {
        const j = copy(s); j.airborne = true; j.vy = cfg.jumpV;
        if (settleFall(world, j, [dx, dz, frames])) { if (!seen.has(keyOf(j))) jumpsUsed++; push(j); }
      }
    }
  }
  return { seen, jumpsUsed };
}

for (const st of stages) {
  const { j, world } = load(st);
  const starts = [];
  const arr = arrivals[String(st)] ?? [];
  for (const a of arr) {
    for (const hint of [a.y, -a.y]) {
      const g = groundBelow(world, a.x, -a.z, hint, 2);
      if (g !== null && Math.abs(g - hint) < 60) { starts.push({ x: a.x, y: g, z: -a.z, vy: 0, airborne: false, name: `arrival ${a.id}` }); break; }
    }
  }
  // biggest floor centroid as an extra start
  let best = null, ba = 0;
  for (const t of world.tris) { const ar = Math.abs((t.bx - t.ax) * (t.cz - t.az) - (t.cx - t.ax) * (t.bz - t.az)); if (ar > ba) { ba = ar; best = t; } }
  if (best) starts.push({ x: (best.ax + best.bx + best.cx) / 3, y: (best.ay + best.by + best.cy) / 3, z: (best.az + best.bz + best.cz) / 3, vy: 0, airborne: false, name: 'biggest floor' });
  const ds = (doors[String(st)] ?? []).filter((d) => d.stage !== null && d.stage !== st && d.at);
  const merged = new Map();
  let first = null;
  for (const s of starts) {
    const { seen } = explore(world, s);
    if (!first) first = seen.size;
    for (const [k, v] of seen) merged.set(k, v);
  }
  const reach = [...merged.values()];
  const report = ds.map((d) => {
    const dx = d.at.x, dz = -d.at.z;
    let m = Infinity, lowDelta = null;
    for (const r of reach) { const h = Math.hypot(r.x - dx, r.z - dz); if (h < m && Math.min(Math.abs(r.y - d.at.y), Math.abs(r.y + d.at.y)) < 160) m = h; }
    return { stage: d.stage, dist: Math.round(m), ok: m < 120 };
  });
  console.log(`stage ${st}: floor tris ${world.tris.length}, walls ${world.walls.length}, starts ${starts.length}, reachable cells ${reach.length}, doors reachable ${report.filter((r) => r.ok).length}/${report.length}` +
    (report.some((r) => !r.ok) ? '  MISSING: ' + report.filter((r) => !r.ok).map((r) => `->${r.stage} (${r.dist})`).join(' ') : ''));
}

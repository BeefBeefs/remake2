import * as THREE from 'three';
import { coplanarRanks, quadOrder } from './geom';

/** JSON written by tools/export_stages.py (formats: docs/FORMATS.md "Room meshes"). */
export interface StageJson {
  id: number;
  atlas: number;
  /** 128x256 atlases listed in the stage's resource descriptor (indices into assets/stages/aNNN.png). */
  atlases?: number[];
  /** One entry per texture-list position (`pg & 31`): 4-bit atlas index, 8-bit page name `bSECTOR` (assets/stages/bSECTOR.png), or null. */
  pages?: (number | string | null)[];
  collision: { sector: number; verts: number[][]; tris: number[][] };
  /** Room-type stages: door/trigger + prop placements (x, y = height above PS1 y=0, z; rot 4096 = 360 deg). */
  entities?: { kind: number; sub: number; flag: number; x: number; y: number; z: number; rot: number; link: number }[];
  propsSector?: number | null;
  /** Monster/NPC model ids (0-96) whose textures the stage lists: models 16+id of data/model_table.json. */
  monsters?: number[];
  /** Monster definitions from the map module (name, level; raw stats not decoded). */
  /** Per streamed monster model: solved name (null if ambiguous) and stats from its definition. */
  monsterInfo?: { model: number; name: string | null; level?: number; hp?: number; attack?: number }[];
  monsterDefs?: { name: string; level: number; raw: number[] }[];
  /** Dialogue boxes / signs / menu strings found in the stage script stream, in file order (tools/export_stages.py). */
  texts?: string[];
  /** Quest (sound-bank group Q00..Q10) this map belongs to, its index inside the quest and the stage range of the quest. */
  quest?: number;
  area?: number;
  questRange?: [number, number];
  /** Arrival points (map module header records): where the hero appears when entering the map (x, y up, z in PS1 space; rot 4096 = 360 deg). */
  arrivals?: { id: number; x: number; y: number; z: number; rot: number }[];
  /** Story-state variants of this map (other descriptors with the same meshes but different entities / dialogue). */
  variants?: { desc: number; name: string | null; entities: NonNullable<StageJson['entities']>; texts: string[] }[];
  meshes: { sector: number; verts: number[][]; faces: { v: number[]; uv: number[][]; pg?: number; clut?: number }[] }[];
}

/** Atlases are 4-bit 256 x 256 pages with 16 palettes of 16 colours (aNNN.png = colour indices, aNNN.pal.png = 16 x 16 RGBA). */
export const ATLAS = 256;
const SLOT_ROWS = 8;

async function loadPixels(url: string): Promise<ImageData> {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('2d canvas unavailable');
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/** Static textured room geometry of one stage (walls, floors, ...), PS1 Y-down space, scaled to ~160 units. */
export class StageView {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  /** Walls are single-sided in the game (the near wall of a room vanishes when seen from outside); in play mode they are drawn front-side only. */
  readonly wallMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  triangles = 0;
  /** Extra materials for triangles lying over other coplanar ones: depth-offset layers 1..3 (floor, wall) so decals stop z-fighting. */
  private readonly layerMats: THREE.MeshBasicMaterial[] = [];
  /** coplanar overlapping triangles found / total */
  coplanar = 0;
  propCount = 0;
  /** Collision circles of the placed props (entity x, z in PS1 space, radius from the prop mesh size; flat decals are skipped). */
  readonly propSolids: { x: number; z: number; r: number }[] = [];
  markerCount = 0;
  private readonly inner = new THREE.Group();
  /** (atlas list index, palette row) pairs the faces use -> slot number in the composed texture. */
  private readonly slots = new Map<number, number>();
  private propClut = 1;
  private override: number | null = null;
  private tex?: THREE.CanvasTexture;
  private readonly meshUv: { g: THREE.BufferGeometry; raw: number[] }[] = [];

  /** @param fit scale/centre the stage to ~160 units (viewer); false keeps raw PS1 units (play mode). */
  constructor(readonly data: StageJson, fit = true) {
    const inner = this.inner;
    if (!fit) this.wallMaterial.side = THREE.FrontSide;
    inner.rotation.x = Math.PI;
    this.root.add(inner);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    // palette most used by atlas-0 faces: props carry no palette of their own, so they borrow it (guess)
    const cc = new Map<number, number>();
    for (const m of data.meshes) for (const f of m.faces) if (((f.pg ?? 0) & 31) === 0) cc.set(f.clut ?? 0, (cc.get(f.clut ?? 0) ?? 0) + 1);
    this.propClut = [...cc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    for (const m of data.meshes) {
      // 1. every triangle of the mesh with its raw UVs; quads use the slot order that is a convex outline (a few are strip-ordered)
      const T: { p: number[][]; uv: number[][]; slot: number; wall: boolean }[] = [];
      for (const f of m.faces) {
        const idx = f.v;
        if (idx.some((k) => k >= m.verts.length)) continue;
        const slots: number[] = [];
        for (let k = 0; k < 4; k++) if (!slots.some((q) => idx[q] === idx[k])) slots.push(k);
        let tris: number[][] = slots.length === 3 ? [slots] : [];
        if (slots.length === 4) { const o = quadOrder(idx.map((k) => m.verts[k])); tris = [[o[0], o[1], o[2]], [o[0], o[2], o[3]]]; }
        // hub rooms and the inn (quest 0): the room faces all say list position 0 but the room tile sheet is position 1 (position 0 is the furniture sheet the props use)
        const slot = this.slotOf(((f.pg ?? 0) & 31) + (data.quest === 0 ? 1 : 0), f.clut ?? 0);
        for (const t of tris) {
          const p = t.map((k) => m.verts[idx[k]]);
          const [a, b, c] = p;
          const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
          const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
          T.push({ p, uv: t.map((k) => f.uv[k]), slot, wall: Math.abs(ny) < 0.5 * (Math.hypot(nx, ny, nz) || 1) });
          for (const v of p) for (let q = 0; q < 3; q++) { min[q] = Math.min(min[q], v[q]); max[q] = Math.max(max[q], v[q]); }
          this.triangles++;
        }
      }
      // 2. coplanar overlaps get a depth-offset layer each (smaller triangle over the larger one)
      const rank = coplanarRanks(T.map((t) => t.p));
      this.coplanar += rank.filter((r) => r > 0).length;
      for (let r = 0; r <= 3; r++) {
        for (const wall of [false, true]) {
          const P: number[] = [], U: number[] = [];
          T.forEach((t, i) => {
            if (rank[i] !== r || t.wall !== wall) return;
            t.p.forEach((p, k) => { P.push(p[0], p[1], p[2]); U.push(t.uv[k][0], t.uv[k][1], t.slot); });
          });
          if (!P.length) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
          this.meshUv.push({ g, raw: U });
          inner.add(new THREE.Mesh(g, this.layerMaterial(r, wall)));
        }
      }
    }
    this.finishUvs();
    // A stage whose descriptor lists no textured room mesh we can decode (stage 75-ish in the old numbering):
    // show their collision triangles as a flat height-shaded surface so they are at least visible and walkable.
    if (!data.meshes.length) {
      const c = data.collision;
      const pos: number[] = [];
      const col: number[] = [];
      let y0 = Infinity, y1 = -Infinity;
      for (const v of c.verts) { y0 = Math.min(y0, v[1]); y1 = Math.max(y1, v[1]); }
      for (const t of c.tris) {
        if (t.slice(0, 3).some((k) => k >= c.verts.length)) continue;
        for (const k of t.slice(0, 3)) {
          const p = c.verts[k];
          pos.push(p[0], p[1], p[2]);
          const h = y1 > y0 ? 1 - (p[1] - y0) / (y1 - y0) : 0.5; // PS1 y is down: higher = smaller y
          col.push(0.25 + 0.5 * h, 0.4 + 0.4 * h, 0.35 + 0.2 * h);
          for (let a = 0; a < 3; a++) {
            min[a] = Math.min(min[a], p[a]);
            max[a] = Math.max(max[a], p[a]);
          }
        }
        this.triangles++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      inner.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
    }
    // centre on the bounding box and scale to fit the viewer
    if (!fit) return;
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
    const s = 160 / size;
    inner.scale.setScalar(s);
    inner.position.set(-((min[0] + max[0]) / 2) * s, ((min[1] + max[1]) / 2) * s + 60, ((min[2] + max[2]) / 2) * s);
  }

  /**
   * Place the stage's props (beds, tables, shelves …) from the entity table. Entities with flag −254 whose `kind` is a part index
   * of the props pack are props; other records (door, trigger) are skipped. Rotation sign/axis is unverified.
   */
  /** Small coloured boxes at every non-prop entity cell (door/trigger/spawn-like records), colour by `kind`. */
  addMarkers(): void {
    const colors = [0xff5555, 0x55ff55, 0x5599ff, 0xffff55, 0xff55ff, 0x55ffff, 0xffaa33, 0xaaaaaa];
    const geo = new THREE.BoxGeometry(36, 60, 36);
    const mats = new Map<number, THREE.MeshBasicMaterial>();
    for (const e of this.data.entities ?? []) {
      if (e.flag === -254) continue;
      const c = ((e.kind % 8) + 8) % 8;
      let mat = mats.get(c);
      if (!mat) mats.set(c, (mat = new THREE.MeshBasicMaterial({ color: colors[c] })));
      const m = new THREE.Mesh(geo, mat);
      m.position.set(e.x, -(e.y + 30), e.z);
      this.inner.add(m);
      this.markerCount++;
    }
  }

  async addProps(): Promise<void> {
    const { entities, propsSector } = this.data;
    if (!entities || !propsSector) return;
    const res = await fetch(`assets/stages/props${propsSector}.json`);
    if (!res.ok) return;
    const parts = (await res.json()) as Record<string, { verts: number[][]; faces: { v: number[]; uv: number[][] }[] }>;
    const geos = new Map<string, THREE.BufferGeometry>();
    const extents = new Map<string, { r: number; h: number }>();
    for (const e of entities) {
      const part = parts[String(e.kind)];
      if (e.flag !== -254 || !part) continue;
      let g = geos.get(String(e.kind));
      if (!g) {
        const pos: number[] = [];
        const uvs: number[] = [];
        const slot = this.slotOf(0, this.propClut);
        for (const f of part.faces) {
          const idx = f.v;
          if (idx.some((k) => k >= part.verts.length)) continue;
          const slots: number[] = [];
          for (let k = 0; k < 4; k++) if (!slots.some((q) => idx[q] === idx[k])) slots.push(k);
          const tris = slots.length === 4 ? [[0, 1, 2], [0, 2, 3]] : slots.length === 3 ? [slots] : [];
          for (const t of tris)
            for (const k of t) {
              const p = part.verts[idx[k]];
              pos.push(p[0], p[1], p[2]);
              uvs.push(f.uv[k][0], f.uv[k][1], slot);
            }
        }
        let r = 0, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < pos.length; i += 3) {
          r = Math.max(r, Math.hypot(pos[i], pos[i + 2]));
          y0 = Math.min(y0, pos[i + 1]);
          y1 = Math.max(y1, pos[i + 1]);
        }
        extents.set(String(e.kind), { r, h: y1 - y0 });
        g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        this.meshUv.push({ g, raw: uvs });
        this.finishUvs();
        geos.set(String(e.kind), g);
      }
      const ext = extents.get(String(e.kind));
      if (ext && ext.h >= 30 && ext.r >= 20) this.propSolids.push({ x: e.x, z: e.z, r: Math.min(90, ext.r * 0.7) });
      const m = new THREE.Mesh(g, this.material);
      m.position.set(e.x, -e.y, e.z);
      m.rotation.y = (e.rot * Math.PI * 2) / 4096;
      this.inner.add(m);
      this.propCount++;
    }
  }

  /** Material for depth layer `r` (0 = base): layers pull their fragments toward the camera so they win over the coplanar triangles below. */
  private layerMaterial(r: number, wall: boolean): THREE.MeshBasicMaterial {
    const base = wall ? this.wallMaterial : this.material;
    if (r === 0) return base;
    const k = (r - 1) * 2 + (wall ? 1 : 0);
    let m = this.layerMats[k];
    if (!m) {
      m = base.clone();
      m.polygonOffset = true;
      m.polygonOffsetFactor = -r;
      m.polygonOffsetUnits = -r * 4;
      this.layerMats[k] = m;
    }
    return m;
  }

  /** Slot index for (atlas list position, palette row); new slots are appended. */
  private slotOf(pg: number, clut: number): number {
    const li = pg & 31; // pg bits 5-7 are flags (semi-transparency etc.), 0-4 = position in the stage's atlas list
    const key = li * 16 + (typeof this.data.pages?.[li] === 'string' ? 0 : clut & 15);
    let s = this.slots.get(key);
    if (s === undefined) this.slots.set(key, (s = this.slots.size));
    return s;
  }

  private get cols(): number {
    return Math.max(1, Math.ceil(Math.max(1, this.slots.size) / SLOT_ROWS));
  }
  private get rows(): number {
    return Math.min(Math.max(1, this.slots.size), SLOT_ROWS);
  }

  /** Turn raw (u, v, slot) triples into normalised UVs; called whenever geometry was added (slots may have grown). */
  private finishUvs(): void {
    // slot layout depends on the final slot count, so UVs are (re)written on demand from raw data
    for (const { g, raw } of this.meshUv) {
      const n = raw.length / 3;
      const uv = new Float32Array(n * 2);
      const W = this.cols * ATLAS, H = this.rows * ATLAS;
      for (let i = 0; i < n; i++) {
        const slot = raw[3 * i + 2];
        const cx = Math.floor(slot / SLOT_ROWS), cy = slot % SLOT_ROWS;
        uv[2 * i] = (cx * ATLAS + raw[3 * i] + 0.5) / W;
        uv[2 * i + 1] = (cy * ATLAS + raw[3 * i + 1] + 0.5) / H;
      }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
  }

  /** Compose the coloured texture page: every used (atlas, palette) pair becomes one 256 x 256 slot. */
  async loadTextures(override: number | null = this.override): Promise<void> {
    this.override = override;
    this.finishUvs();
    const pages = this.data.pages;
    const list = this.data.atlases?.length ? this.data.atlases : [this.data.atlas];
    // what texture-list position `li` shows: an 8-bit page name, or a 4-bit atlas index
    const src = (li: number): number | string => {
      if (override !== null) return override;
      const p = pages?.[li];
      if (typeof p === 'string') return p;
      if (typeof p === 'number') return p;
      return list[Math.min(li, list.length - 1)];
    };
    const need = new Set<number | string>();
    for (const key of this.slots.keys()) need.add(src(Math.floor(key / 16)));
    const loaded = new Map<number | string, { idx: ImageData; pal?: ImageData }>();
    await Promise.all(
      [...need].map(async (a) => {
        if (typeof a === 'string') {
          loaded.set(a, { idx: await loadPixels(`assets/stages/${a}.png`) });
          return;
        }
        const name = `assets/stages/a${String(a).padStart(3, '0')}`;
        loaded.set(a, { idx: await loadPixels(`${name}.png`), pal: await loadPixels(`${name}.pal.png`) });
      }),
    );
    const W = this.cols * ATLAS, H = this.rows * ATLAS;
    const out = new ImageData(W, H);
    for (const [key, slot] of this.slots) {
      const li = Math.floor(key / 16), clut = key % 16;
      const a = loaded.get(src(li));
      if (!a) continue;
      const ox = Math.floor(slot / SLOT_ROWS) * ATLAS, oy = (slot % SLOT_ROWS) * ATLAS;
      if (!a.pal) {
        // 8-bit page: already coloured RGBA, smaller than a slot; copy as is
        for (let y = 0; y < a.idx.height && y < ATLAS; y++) {
          for (let x = 0; x < a.idx.width && x < ATLAS; x++) {
            const si = (y * a.idx.width + x) * 4, o = ((oy + y) * W + ox + x) * 4;
            out.data[o] = a.idx.data[si];
            out.data[o + 1] = a.idx.data[si + 1];
            out.data[o + 2] = a.idx.data[si + 2];
            out.data[o + 3] = a.idx.data[si + 3];
          }
        }
        continue;
      }
      for (let y = 0; y < ATLAS; y++) {
        for (let x = 0; x < ATLAS; x++) {
          const ci = a.idx.data[(y * ATLAS + x) * 4] & 15;
          const pi = (clut * 16 + ci) * 4;
          const o = ((oy + y) * W + ox + x) * 4;
          out.data[o] = a.pal.data[pi];
          out.data[o + 1] = a.pal.data[pi + 1];
          out.data[o + 2] = a.pal.data[pi + 2];
          out.data[o + 3] = a.pal.data[pi + 3];
        }
      }
    }
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')?.putImageData(out, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.tex?.dispose();
    this.tex = tex;
    this.material.map = tex;
    this.material.needsUpdate = true;
    this.wallMaterial.map = tex;
    this.wallMaterial.needsUpdate = true;
    for (const m of this.layerMats) if (m) { m.map = tex; m.needsUpdate = true; }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tex?.dispose();
    this.material.dispose();
    this.wallMaterial.dispose();
    for (const m of this.layerMats) m?.dispose();
    this.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

export async function loadStage(k: number, fit = true, variant = 0): Promise<StageView> {
  const url = `assets/stages/stage${String(k).padStart(2, '0')}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = (await res.json()) as StageJson;
  const v = variant > 0 ? data.variants?.[variant - 1] : undefined;
  if (v) { data.entities = v.entities; data.texts = v.texts; }
  return new StageView(data, fit);
}

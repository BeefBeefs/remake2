import * as THREE from 'three';

/** JSON written by tools/export_stages.py (formats: docs/FORMATS.md "Room meshes"). */
export interface StageJson {
  id: number;
  atlas: number;
  /** 128x256 atlases listed in the stage's resource descriptor (indices into assets/stages/aNNN.png). */
  atlases?: number[];
  collision: { sector: number; verts: number[][]; tris: number[][] };
  /** Room-type stages: door/trigger + prop placements (x, y = height above PS1 y=0, z; rot 4096 = 360 deg). */
  entities?: { kind: number; sub: number; flag: number; x: number; y: number; z: number; rot: number; link: number }[];
  propsSector?: number | null;
  /** Monster/NPC model ids (0-96) whose textures the stage lists: models 16+id of data/model_table.json. */
  monsters?: number[];
  /** Dialogue boxes / signs / menu strings found in the stage script stream, in file order (tools/export_stages.py). */
  texts?: string[];
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
  triangles = 0;
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
    inner.rotation.x = Math.PI;
    this.root.add(inner);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    // palette most used by atlas-0 faces: props carry no palette of their own, so they borrow it (guess)
    const cc = new Map<number, number>();
    for (const m of data.meshes) for (const f of m.faces) if (((f.pg ?? 0) & 31) === 0) cc.set(f.clut ?? 0, (cc.get(f.clut ?? 0) ?? 0) + 1);
    this.propClut = [...cc.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    for (const m of data.meshes) {
      const pos: number[] = [];
      const uvs: number[] = [];
      for (const f of m.faces) {
        const idx = f.v;
        if (idx.some((k) => k >= m.verts.length)) continue;
        const slots: number[] = [];
        for (let k = 0; k < 4; k++) if (!slots.some((q) => idx[q] === idx[k])) slots.push(k);
        const tris = slots.length === 4 ? [[0, 1, 2], [0, 2, 3]] : slots.length === 3 ? [slots] : [];
        const slot = this.slotOf(f.pg ?? 0, f.clut ?? 0);
        for (const t of tris) {
          for (const k of t) {
            const p = m.verts[idx[k]];
            pos.push(p[0], p[1], p[2]);
            for (let a = 0; a < 3; a++) {
              min[a] = Math.min(min[a], p[a]);
              max[a] = Math.max(max[a], p[a]);
            }
            uvs.push(f.uv[k][0], f.uv[k][1], slot);
          }
          this.triangles++;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      this.meshUv.push({ g, raw: uvs });
      inner.add(new THREE.Mesh(g, this.material));
    }
    this.finishUvs();
    // 18 of 96 stages have no textured room mesh in the format we decode (17-19, 30, 34, 36, 42-45, 48, 49, 66, 75, 77, 79, 81, 82):
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

  /** Slot index for (atlas list position, palette row); new slots are appended. */
  private slotOf(pg: number, clut: number): number {
    const li = pg & 31; // pg bits 5-7 are flags (semi-transparency etc.), 0-4 = position in the stage's atlas list
    const key = li * 16 + (clut & 15);
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
    const list = this.data.atlases?.length ? this.data.atlases : [this.data.atlas];
    const need = new Set<number>();
    const src = (li: number): number => override ?? list[Math.min(li, list.length - 1)];
    for (const key of this.slots.keys()) need.add(src(Math.floor(key / 16)));
    const loaded = new Map<number, { idx: ImageData; pal: ImageData }>();
    await Promise.all(
      [...need].map(async (a) => {
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
  }

  dispose(): void {
    this.root.removeFromParent();
    this.tex?.dispose();
    this.material.dispose();
    this.root.traverse((o: THREE.Object3D) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
  }
}

export async function loadStage(k: number, fit = true): Promise<StageView> {
  const url = `assets/stages/stage${String(k).padStart(2, '0')}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new StageView((await res.json()) as StageJson, fit);
}

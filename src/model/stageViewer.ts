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
  meshes: { sector: number; verts: number[][]; faces: { v: number[]; uv: number[][] }[] }[];
}

export const ATLAS_W = 128;
export const ATLAS_H = 256;

/** Static textured room geometry of one stage (walls, floors, ...), PS1 Y-down space, scaled to ~160 units. */
export class StageView {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  triangles = 0;
  propCount = 0;
  markerCount = 0;
  private readonly inner = new THREE.Group();

  /** @param fit scale/centre the stage to ~160 units (viewer); false keeps raw PS1 units (play mode). */
  constructor(readonly data: StageJson, fit = true) {
    const inner = this.inner;
    inner.rotation.x = Math.PI;
    this.root.add(inner);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const m of data.meshes) {
      const pos: number[] = [];
      const uvs: number[] = [];
      for (const f of m.faces) {
        const idx = f.v;
        if (idx.some((k) => k >= m.verts.length)) continue;
        const slots: number[] = [];
        for (let k = 0; k < 4; k++) if (!slots.some((q) => idx[q] === idx[k])) slots.push(k);
        const tris = slots.length === 4 ? [[0, 1, 2], [0, 2, 3]] : slots.length === 3 ? [slots] : [];
        for (const t of tris) {
          for (const k of t) {
            const p = m.verts[idx[k]];
            pos.push(p[0], p[1], p[2]);
            for (let a = 0; a < 3; a++) {
              min[a] = Math.min(min[a], p[a]);
              max[a] = Math.max(max[a], p[a]);
            }
            uvs.push((f.uv[k][0] + 0.5) / ATLAS_W, (f.uv[k][1] + 0.5) / ATLAS_H);
          }
          this.triangles++;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      inner.add(new THREE.Mesh(g, this.material));
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
    for (const e of entities) {
      const part = parts[String(e.kind)];
      if (e.flag !== -254 || !part) continue;
      let g = geos.get(String(e.kind));
      if (!g) {
        const pos: number[] = [];
        const uvs: number[] = [];
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
              uvs.push((f.uv[k][0] + 0.5) / ATLAS_W, (f.uv[k][1] + 0.5) / ATLAS_H);
            }
        }
        g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        geos.set(String(e.kind), g);
      }
      const m = new THREE.Mesh(g, this.material);
      m.position.set(e.x, -e.y, e.z);
      m.rotation.y = (e.rot * Math.PI * 2) / 4096;
      this.inner.add(m);
      this.propCount++;
    }
  }

  async setAtlas(url: string): Promise<void> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.flipY = false;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material.map?.dispose();
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.material.map?.dispose();
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

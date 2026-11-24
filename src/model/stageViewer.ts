import * as THREE from 'three';

/** JSON written by tools/export_stages.py (formats: docs/FORMATS.md "Room meshes"). */
export interface StageJson {
  id: number;
  atlas: number;
  /** 128x256 atlases listed in the stage's resource descriptor (indices into assets/stages/aNNN.png). */
  atlases?: number[];
  collision: { sector: number; verts: number[][]; tris: number[][] };
  meshes: { sector: number; verts: number[][]; faces: { v: number[]; uv: number[][] }[] }[];
}

export const ATLAS_W = 128;
export const ATLAS_H = 256;

/** Static textured room geometry of one stage (walls, floors, ...), PS1 Y-down space, scaled to ~160 units. */
export class StageView {
  readonly root = new THREE.Group();
  readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  triangles = 0;

  constructor(readonly data: StageJson) {
    const inner = new THREE.Group();
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
    const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
    const s = 160 / size;
    inner.scale.setScalar(s);
    inner.position.set(-((min[0] + max[0]) / 2) * s, ((min[1] + max[1]) / 2) * s + 60, ((min[2] + max[2]) / 2) * s);
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

export async function loadStage(k: number): Promise<StageView> {
  const url = `assets/stages/stage${String(k).padStart(2, '0')}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new StageView((await res.json()) as StageJson);
}

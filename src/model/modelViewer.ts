import * as THREE from 'three';

/** JSON written by tools/export_model.py (formats: docs/FORMATS.md). */
export interface ModelJson {
  meshSector: number;
  animSector: number;
  parts: {
    index: number;
    bone: number;
    verts: [number, number, number][];
    normals: [number, number, number][];
    faces: { id: number; uv: [number, number][]; v: [number, number, number, number] }[];
  }[];
  parent: number[]; // per bone; bone 0 and 1 point to themselves/0 (roots)
  poses: number[][]; // i16 rot[3] (4096 = 360deg), 0, trans[3], scale
  frames: number[][]; // per frame: pose index per bone
}

const ANGLE = (Math.PI * 2) / 4096;

/**
 * Skeleton + flat-shaded mesh for one animated model. PS1 space is Y-down, so the whole model hangs
 * under a root rotated by PI around X. Pose rotation order is X*Y*Z, which is three.js Euler order 'XYZ'.
 * Textured with a hero CLUT PNG (tools/export_hero_tex.py). Faces whose vertex indices fall outside the part's own vertex list are skipped for now
 * (open problem in PROGRESS.md: the first 7 face rows of every part).
 */
export class AnimatedModel {
  readonly root = new THREE.Group();
  private readonly bones: THREE.Object3D[] = [];
  private frame = 0;
  private acc = 0;
  fps = 8;
  skippedFaces = 0;
  totalFaces = 0;
  /** Shared by every part; swap `material.map` to change the CLUT (colour scheme). */
  readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, color: 0xffffff });
  /** Texture page size in pixels (hero textures are 256 x 64). */
  texW = 256;
  texH = 64;

  constructor(readonly data: ModelJson) {
    const inner = new THREE.Group();
    inner.rotation.x = Math.PI;
    this.root.add(inner);

    const nb = data.parent.length;
    for (let b = 0; b < nb; b++) this.bones.push(new THREE.Object3D());
    for (let b = 0; b < nb; b++) {
      const p = data.parent[b];
      if (p === b || p < 0 || p >= nb) inner.add(this.bones[b]);
      else this.bones[p].add(this.bones[b]);
    }

    data.parts.forEach((part) => {
      const pos: number[] = [];
      const uvs: number[] = [];
      for (const f of part.faces) {
        this.totalFaces++;
        const idx = f.v;
        if (idx.some((k) => k >= part.verts.length)) {
          this.skippedFaces++;
          continue;
        }
        // UVs beyond the 64-row page belong to the unresolved "R1" rows; treat them as bad faces.
        if (f.uv.some((c) => c[1] >= this.texH)) {
          this.skippedFaces++;
          continue;
        }
        const tris = idx[3] === idx[2] || idx[3] === idx[0] ? [[0, 1, 2]] : [[0, 1, 2], [0, 2, 3]];
        for (const t of tris) {
          if (new Set(t.map((k) => idx[k])).size < 3) continue; // degenerate
          for (const k of t) {
            pos.push(...part.verts[idx[k]]);
            uvs.push((f.uv[k][0] + 0.5) / this.texW, (f.uv[k][1] + 0.5) / this.texH);
          }
        }
      }
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(g, this.material);
      this.bones[part.bone]?.add(mesh);
    });
    this.setFrame(0);
  }

  /** Load one CLUT image (PNG, 256 x 64, colour 0 transparent) and apply it to the whole model. */
  async setTexture(url: string): Promise<void> {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.flipY = false; // UVs are written top-down (PS1 convention)
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    this.material.map?.dispose();
    this.material.map = tex;
    this.material.needsUpdate = true;
  }

  get frameCount(): number {
    return this.data.frames.length;
  }

  setFrame(f: number): void {
    this.frame = ((f % this.frameCount) + this.frameCount) % this.frameCount;
    const list = this.data.frames[this.frame];
    for (let b = 0; b < this.bones.length; b++) {
      const p = this.data.poses[list[b]];
      if (!p) continue;
      this.bones[b].rotation.set(p[0] * ANGLE, p[1] * ANGLE, p[2] * ANGLE, 'XYZ');
      this.bones[b].position.set(p[4], p[5], p[6]);
    }
  }

  get currentFrame(): number {
    return this.frame;
  }

  update(dt: number): void {
    this.acc += dt;
    const step = 1 / this.fps;
    while (this.acc >= step) {
      this.acc -= step;
      this.setFrame(this.frame + 1);
    }
  }
}

export async function loadModel(url: string): Promise<AnimatedModel> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new AnimatedModel((await res.json()) as ModelJson);
}

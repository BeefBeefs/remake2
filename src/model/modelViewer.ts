import * as THREE from 'three';

/** JSON written by tools/export_heroes.py (formats: docs/FORMATS.md). */
export interface HeroJson {
  hero: number;
  textureSector: number;
  parts: {
    index: number;
    verts: [number, number, number][];
    faces: { uv: [number, number][]; v: [number, number, number, number] }[];
  }[];
  anims: {
    parent: number[]; // per bone; roots point at themselves / bone 0
    partBone: number[]; // mesh part index -> bone
    poses: number[][]; // i16 rot[3] (4096 = 360deg), 0, trans[3], scale
    frames: number[][]; // per frame: pose index per bone
  }[];
}

const ANGLE = (Math.PI * 2) / 4096;

/**
 * One hero: skeleton + textured mesh, playing one of the hero's animations.
 * PS1 space is Y-down, so the model hangs under a root rotated by PI around X. Pose rotation order is X*Y*Z,
 * which is three.js Euler order 'XYZ'. Faces whose vertex indices fall outside the part's own vertex list, or whose
 * UVs leave the 64-row texture page, are skipped (open problem in PROGRESS.md: "R1" face rows).
 */
export class AnimatedModel {
  readonly root = new THREE.Group();
  private readonly inner = new THREE.Group();
  private bones: THREE.Object3D[] = [];
  private readonly meshes: { mesh: THREE.Mesh; index: number }[] = [];
  private anim = 0;
  private frame = 0;
  private acc = 0;
  fps = 8;
  skippedFaces = 0;
  totalFaces = 0;
  /** Shared by every part; swap `material.map` to change the CLUT (colour scheme). */
  readonly material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, alphaTest: 0.5 });
  /** Texture page size in pixels (hero textures are 256 x 64). */
  readonly texW = 256;
  readonly texH = 64;

  constructor(readonly data: HeroJson) {
    this.texH = 64;
    this.inner.rotation.x = Math.PI;
    this.root.add(this.inner);

    for (const part of data.parts) {
      const pos: number[] = [];
      const uvs: number[] = [];
      for (const f of part.faces) {
        this.totalFaces++;
        const idx = f.v;
        if (idx.some((k) => k >= part.verts.length)) {
          this.skippedFaces++;
          continue;
        }
        // Triangles are stored as quad rows with a repeated vertex index; the repeated slot carries a dummy UV
        // (2,123), so use the first slot of every distinct index: (a,b,b,c) -> slots 0,1,3.
        const slots: number[] = [];
        for (let k = 0; k < 4; k++) if (!slots.some((q) => idx[q] === idx[k])) slots.push(k);
        const tris = slots.length === 4 ? [[0, 1, 2], [0, 2, 3]] : slots.length === 3 ? [slots] : [];
        for (const t of tris) {
          if (t.some((k) => f.uv[k][1] >= this.texH)) {
            this.skippedFaces++;
            continue;
          }
          for (const k of t) {
            pos.push(...part.verts[idx[k]]);
            uvs.push((f.uv[k][0] + 0.5) / this.texW, (f.uv[k][1] + 0.5) / this.texH);
          }
        }
      }
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      this.meshes.push({ mesh: new THREE.Mesh(g, this.material), index: part.index });
    }
    this.setAnim(0);
  }

  get animCount(): number {
    return this.data.anims.length;
  }

  get frameCount(): number {
    return this.data.anims[this.anim].frames.length;
  }

  /** Switch animation: animations may have a different bone count, so the bone tree is rebuilt. */
  setAnim(a: number): void {
    this.anim = ((a % this.animCount) + this.animCount) % this.animCount;
    const an = this.data.anims[this.anim];
    for (const b of this.bones) b.removeFromParent();
    for (const m of this.meshes) m.mesh.removeFromParent();
    const nb = an.parent.length;
    this.bones = Array.from({ length: nb }, () => new THREE.Object3D());
    for (let b = 0; b < nb; b++) {
      const p = an.parent[b];
      if (p === b || p < 0 || p >= nb) this.inner.add(this.bones[b]);
      else this.bones[p].add(this.bones[b]);
    }
    for (const m of this.meshes) {
      const bone = this.bones[an.partBone[m.index]];
      if (bone) bone.add(m.mesh);
    }
    this.acc = 0;
    this.setFrame(0);
  }

  get currentAnim(): number {
    return this.anim;
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

  setFrame(f: number): void {
    const an = this.data.anims[this.anim];
    this.frame = ((f % this.frameCount) + this.frameCount) % this.frameCount;
    const list = an.frames[this.frame];
    for (let b = 0; b < this.bones.length; b++) {
      const p = an.poses[list[b]];
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

  dispose(): void {
    this.root.removeFromParent();
    this.material.map?.dispose();
    this.material.dispose();
    for (const m of this.meshes) m.mesh.geometry.dispose();
  }
}

export async function loadMonster(k: number): Promise<AnimatedModel> {
  const url = `assets/monsters/mon${String(k).padStart(2, '0')}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new AnimatedModel((await res.json()) as HeroJson);
}

export async function loadHero(hero: number): Promise<AnimatedModel> {
  const url = `assets/heroes/hero${String(hero).padStart(2, '0')}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new AnimatedModel((await res.json()) as HeroJson);
}

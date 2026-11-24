import * as THREE from 'three';
import { AnimatedModel, loadHero } from './model/modelViewer';
import { loadStage, StageView } from './model/stageViewer';

/**
 * First playable slice: walk a hero around one stage. Gameplay runs in three.js world space, where a PS1 point
 * (x,y,z) becomes (x,-y,-z) because the stage/hero groups are rotated by PI about X. Floors come from the stage's
 * collision mesh (up-facing triangles); keyboard (WASD / arrows, Q/E turn camera) or touch (left half = move stick,
 * right half = turn camera).
 */
interface Tri {
  ax: number; ay: number; az: number;
  bx: number; by: number; bz: number;
  cx: number; cy: number; cz: number;
}

export class PlayMode {
  private stage?: StageView;
  private hero?: AnimatedModel;
  private tris: Tri[] = [];
  private readonly pos = new THREE.Vector3();
  private heading = 0;
  private camYaw = 0;
  private moving = false;
  private curAnim = -1;
  /** One-shot action (attack/jump…): hero anim index and seconds left. */
  private action: { anim: number; left: number; total: number; jump: boolean } | null = null;
  private readonly keys = new Set<string>();
  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x0: 0 };
  active = false;
  info = '';

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (key === ' ' || key === 'j') this.act('attack');
      if (key === 'k') this.act('attack2');
      if (key === 'l') this.act('jump');
      if (key === 'h') this.act('hurt');
      if (key === 'v') this.act('victory');
      if (key === ' ') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.clientX < innerWidth / 2 && this.stick.id < 0) this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 };
      else if (this.look.id < 0) this.look = { id: e.pointerId, x0: e.clientX };
    });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.stick.id) {
        this.stick.x = Math.max(-1, Math.min(1, (e.clientX - this.stick.x0) / 60));
        this.stick.y = Math.max(-1, Math.min(1, (e.clientY - this.stick.y0) / 60));
      } else if (e.pointerId === this.look.id) {
        this.camYaw -= (e.clientX - this.look.x0) * 0.008;
        this.look.x0 = e.clientX;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) this.stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
      if (e.pointerId === this.look.id) this.look = { id: -1, x0: 0 };
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
  }

  /** Hero animation slots (confirmed by eye): 0 idle, 1 walk, 2 hurt, 3 attack, 4 jump, 6 attack 2, 7 die, 8 victory. */
  act(name: 'attack' | 'attack2' | 'jump' | 'hurt' | 'victory' | 'die'): void {
    const h = this.hero;
    if (!this.active || !h || this.action) return;
    const anim = { attack: 3, attack2: 6, jump: 4, hurt: 2, victory: 8, die: 7 }[name];
    if (anim >= h.animCount) return;
    h.setAnim(anim);
    this.curAnim = anim;
    const total = h.frameCount / h.fps;
    this.action = { anim, left: total, total, jump: name === 'jump' };
  }

  async enter(stageIndex: number, heroIndex: number): Promise<void> {
    this.exit();
    const st = await loadStage(stageIndex, false);
    const h = await loadHero(heroIndex);
    this.stage = st;
    this.hero = h;
    this.curAnim = -1;
    this.scene.add(st.root);
    this.scene.add(h.root);
    const atlas = st.data.atlases?.[0] ?? st.data.atlas;
    await st.setAtlas(`assets/stages/a${String(atlas).padStart(3, '0')}.png`);
    await h.setTexture(`assets/hero/h${String(heroIndex).padStart(2, '0')}_c0.png`);
    // collision triangles in world space; keep up-facing ones
    const c = st.data.collision;
    const w = (i: number) => c.verts[i];
    this.tris = [];
    let best = 0;
    for (const t of c.tris) {
      if (t.slice(0, 3).some((k) => k >= c.verts.length)) continue;
      const a = w(t[0]), b = w(t[1]), d = w(t[2]);
      const tri: Tri = { ax: a[0], ay: -a[1], az: -a[2], bx: b[0], by: -b[1], bz: -b[2], cx: d[0], cy: -d[1], cz: -d[2] };
      const ux = tri.bx - tri.ax, uy = tri.by - tri.ay, uz = tri.bz - tri.az;
      const vx = tri.cx - tri.ax, vy = tri.cy - tri.ay, vz = tri.cz - tri.az;
      const ny = uz * vx - ux * vz; // y component of the cross product (u x v)
      const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || 1;
      if (Math.abs(ny) / len < 0.5) continue;
      this.tris.push(tri);
      const area = Math.abs(ny);
      if (area > best) {
        best = area;
        this.pos.set((tri.ax + tri.bx + tri.cx) / 3, (tri.ay + tri.by + tri.cy) / 3, (tri.az + tri.bz + tri.cz) / 3);
      }
    }
    this.camera.far = 30000;
    this.camera.near = 5;
    this.camera.updateProjectionMatrix();
    this.active = true;
    this.info = `stage ${stageIndex}: ${this.tris.length} floor triangles — left stick/WASD move, right drag/Q E turn`;
    this.updateHero(0);
  }

  exit(): void {
    this.active = false;
    this.stage?.dispose();
    this.hero?.dispose();
    this.stage = undefined;
    this.hero = undefined;
    this.tris = [];
    this.camera.far = 500;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
  }

  /** Floor height under (x,z) closest to `y`, or null when off the walkable mesh. */
  private floorAt(x: number, z: number, y: number): number | null {
    let best: number | null = null;
    for (const t of this.tris) {
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-6) continue;
      const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
      const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
      const fy = l1 * t.ay + l2 * t.by + l3 * t.cy;
      if (best === null || Math.abs(fy - y) < Math.abs(best - y)) best = fy;
    }
    return best;
  }

  update(dt: number): void {
    if (!this.active || !this.hero) return;
    const k = this.keys;
    if (k.has('q')) this.camYaw += dt * 1.8;
    if (k.has('e')) this.camYaw -= dt * 1.8;
    let ix = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0) + this.stick.x;
    let iy = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0) + this.stick.y; // +y = back
    const mag = Math.hypot(ix, iy);
    this.moving = mag > 0.15 && !this.action;
    if (this.moving) {
      if (mag > 1) { ix /= mag; iy /= mag; }
      // camera-relative: forward = away from the camera
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      const dx = (ix * cos + iy * sin) * 220 * dt;
      const dz = (-ix * sin + iy * cos) * 220 * dt;
      const tryMove = (nx: number, nz: number): boolean => {
        const fy = this.floorAt(nx, nz, this.pos.y);
        if (fy === null || Math.abs(fy - this.pos.y) > 80) return false;
        this.pos.set(nx, fy, nz);
        return true;
      };
      if (!tryMove(this.pos.x + dx, this.pos.z + dz)) {
        if (!tryMove(this.pos.x + dx, this.pos.z)) tryMove(this.pos.x, this.pos.z + dz);
      }
      this.heading = Math.atan2(dx, dz);
    }
    if (this.action) {
      this.action.left -= dt;
      if (this.action.left <= 0) {
        this.action = null;
        this.curAnim = -1;
      }
    }
    this.updateHero(dt);
  }

  private updateHero(dt: number): void {
    const h = this.hero;
    if (!h) return;
    const want = this.action ? this.action.anim : this.moving && h.animCount > 1 ? 1 : 0;
    if (want !== this.curAnim) {
      h.setAnim(want);
      this.curAnim = want;
    }
    h.update(dt);
    h.root.position.copy(this.pos);
    if (this.action?.jump) h.root.position.y += Math.sin(Math.PI * (1 - this.action.left / this.action.total)) * 70;
    h.root.rotation.y = this.heading;
    const d = 380, pitch = 0.55;
    this.camera.position.set(
      this.pos.x + Math.sin(this.camYaw) * d * Math.cos(pitch),
      this.pos.y + 90 + Math.sin(pitch) * d,
      this.pos.z + Math.cos(this.camYaw) * d * Math.cos(pitch),
    );
    this.camera.lookAt(this.pos.x, this.pos.y + 50, this.pos.z);
  }
}

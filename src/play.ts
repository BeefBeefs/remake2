import * as THREE from 'three';
import { AnimatedModel, loadHero, loadMonster } from './model/modelViewer';
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

interface Enemy {
  model: AnimatedModel;
  hp: number;
  x: number;
  y: number;
  z: number;
  cooldown: number;
  dying: number;
  npc: boolean;
  anim: number;
  lock: number; // seconds a one-shot animation (hit/attack) keeps playing
  vx: number;
  vz: number;
}

export class PlayMode {
  private enemies: Enemy[] = [];
  private stageIndex = 0;
  private heroIndex = 0;
  private doorArmed = false;
  private travelling = false;
  private doorPos: { x: number; z: number } | null = null;
  private solids: { x: number; z: number; r: number }[] = [];
  hp = 100;
  private deadTime = -1;
  private readonly hud: HTMLDivElement;
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
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:10px;bottom:10px;color:#fff;font:14px monospace;text-shadow:0 0 3px #000;display:none;z-index:5';
    document.body.append(this.hud);
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
    if (name === 'attack' || name === 'attack2') this.strike();
    const anim = { attack: 3, attack2: 6, jump: 4, hurt: 2, victory: 8, die: 7 }[name];
    if (anim >= h.animCount) return;
    h.setAnim(anim);
    this.curAnim = anim;
    const total = h.frameCount / h.fps;
    this.action = { anim, left: total, total, jump: name === 'jump' };
  }

  async enter(stageIndex: number, heroIndex: number): Promise<void> {
    const keepHp = this.travelling ? this.hp : 100;
    this.exit();
    this.hp = keepHp;
    this.stageIndex = stageIndex;
    this.heroIndex = heroIndex;
    this.doorArmed = false;
    const st = await loadStage(stageIndex, false);
    const h = await loadHero(heroIndex);
    this.stage = st;
    this.hero = h;
    this.curAnim = -1;
    this.scene.add(st.root);
    this.scene.add(h.root);
    await st.addProps();
    const atlas = st.data.atlas;
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
    await this.spawnEnemies(st);
    const door = st.data.entities?.[0];
    this.doorPos = door && door.flag === -126 && door.kind === -1 ? { x: door.x, z: -door.z } : null;
    if (door) {
      // entity (x, y up, z) in PS1 space -> world (x, y, -z); nudge towards the room centre if the door is off the floor
      for (const step of [0, 60, 120, 200]) {
        const dx = this.pos.x - door.x, dz = this.pos.z + door.z, len = Math.hypot(dx, dz) || 1;
        const px = door.x + (dx / len) * step, pz = -door.z + (dz / len) * step;
        const fy = this.floorAt(px, pz, door.y);
        if (fy !== null) { this.pos.set(px, fy, pz); break; }
      }
    }
    this.camera.far = 30000;
    this.camera.near = 5;
    this.camera.updateProjectionMatrix();
    this.active = true;
    this.hud.style.display = 'block';
    this.info = `stage ${stageIndex}: ${this.tris.length} floor triangles — left stick/WASD move, right drag/Q E turn`;
    this.updateHero(0);
  }

  /**
   * Enemies/NPCs (heuristic!): the stage lists the monster models it streams in. Room stages: the first listed model is the NPC placed on
   * the entity that carries a link (e.g. the item expert). Dungeons: spawn cells are grouped by `kind`, the most common kind gets the first
   * listed monster, the next kind the second, and so on; at most 10 spawns closest to the start are used.
   */
  private async spawnEnemies(st: StageView): Promise<void> {
    const models = st.data.monsters ?? [];
    const ents = st.data.entities ?? [];
    this.solids = ents.filter((e, i) => i > 0 && e.flag === -254).map((e) => ({ x: e.x, z: -e.z, r: 55 }));
    if (!models.length) return;
    const spots: { x: number; z: number; y: number; model: number; npc: boolean }[] = [];
    const isRoom = ents.some((e) => e.flag === -254);
    if (isRoom) {
      const n = ents.find((e) => e.flag === -254 && e.link !== -1 && e.kind >= 0 && e.kind < 256);
      if (n) spots.push({ x: n.x, z: -n.z, y: n.y, model: models[0], npc: true });
    } else {
      const counts = new Map<number, number>();
      for (const e of ents) if (e.kind >= 0 && e.kind < 256 && e.sub === 1) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
      const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
      const door = ents[0];
      const sx = door ? door.x : 0, sz = door ? -door.z : 0;
      const cand = ents
        .filter((e) => e.kind >= 0 && e.kind < 256 && e.sub === 1 && kinds.includes(e.kind))
        .sort((a, b) => Math.hypot(a.x - sx, -a.z - sz) - Math.hypot(b.x - sx, -b.z - sz))
        .filter((e) => Math.hypot(e.x - sx, -e.z - sz) > 500)
        .slice(0, 10);
      for (const e of cand) spots.push({ x: e.x, z: -e.z, y: e.y, model: models[Math.min(kinds.indexOf(e.kind), models.length - 1)], npc: false });
    }
    for (const sp of spots) {
      try {
        const m = await loadMonster(sp.model);
        await m.setTexture(`assets/monsters/mon${String(sp.model).padStart(2, '0')}.png`);
        this.scene.add(m.root);
        this.enemies.push({ model: m, hp: 60, x: sp.x, y: sp.y, z: sp.z, cooldown: 0, dying: 0, npc: sp.npc, anim: 0, lock: 0, vx: 0, vz: 0 });
      } catch (err) {
        console.warn('monster load failed', sp.model, err);
      }
    }
  }

  /** Monster animation slots (guess, mirrors the hero layout): 0 idle, 1 walk, 2 hit, 3 attack, last = die. */
  private setEnemyAnim(en: Enemy, want: number): void {
    const n = en.model.animCount;
    const a = Math.min(want, n - 1);
    if (en.anim !== a) {
      en.anim = a;
      en.model.setAnim(a);
    }
  }

  private updateEnemies(dt: number): void {
    for (const en of this.enemies) {
      const m = en.model;
      if (en.dying > 0) {
        // play the death animation (last slot) once, then shrink away
        if (en.dying === 99) {
          this.setEnemyAnim(en, m.animCount >= 5 ? m.animCount - 1 : 2);
          en.dying = 1.6;
        }
        en.dying -= dt;
        if (m.currentFrame < m.frameCount - 1) m.update(dt);
        if (en.dying < 0.6) m.root.scale.setScalar(Math.max(0.01, en.dying / 0.6));
        continue;
      }
      const dx = this.pos.x - en.x, dz = this.pos.z - en.z, dist = Math.hypot(dx, dz);
      en.cooldown -= dt;
      en.lock -= dt;
      let moving = false;
      if (!en.npc && dist < 700 && dist > 70) {
        const nx = en.x + (dx / dist) * 90 * dt, nz = en.z + (dz / dist) * 90 * dt;
        const fy = this.floorAt(nx, nz, en.y);
        if (fy !== null && Math.abs(fy - en.y) < 80 && !this.blocked(nx, nz, en)) {
          en.x = nx; en.z = nz; en.y = fy; moving = true;
        }
      }
      if (!en.npc && dist <= 90 && en.cooldown <= 0) {
        en.cooldown = 1.2;
        en.lock = 0.7;
        this.setEnemyAnim(en, 3);
        this.hp = Math.max(0, this.hp - 8);
        this.act('hurt');
      }
      if (en.lock <= 0) this.setEnemyAnim(en, moving ? 1 : 0);
      m.update(dt);
      m.root.position.set(en.x, en.y, en.z);
      m.root.rotation.y = Math.atan2(dx, dz);
    }
    // enemies push each other apart so they do not stack on one spot
    for (let i = 0; i < this.enemies.length; i++) {
      for (let j = i + 1; j < this.enemies.length; j++) {
        const a = this.enemies[i], b = this.enemies[j];
        if (a.dying > 0 || b.dying > 0) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d > 0 && d < 60) {
          const push = (60 - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }
    for (const en of this.enemies) {
      if (en.dying <= 0 && en.hp <= 0) en.dying = 99;
    }
    const alive = this.enemies.filter((e) => !e.npc && e.hp > 0).length;
    this.hud.textContent = `HP ${this.hp}   enemies ${alive}`;
  }

  /** Prop collision: props are circles (radius ~ 60) – enemies and the hero cannot walk through them. */
  private blocked(x: number, z: number, self?: Enemy): boolean {
    for (const p of this.solids) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
    if (self) {
      for (const o of this.enemies) if (o !== self && o.npc && Math.hypot(x - o.x, z - o.z) < 60) return true;
    }
    return false;
  }

  /** Hero attack: damage enemies in front within 170 units. */
  private strike(): void {
    for (const en of this.enemies) {
      if (en.npc || en.hp <= 0) continue;
      const dx = en.x - this.pos.x, dz = en.z - this.pos.z;
      if (Math.hypot(dx, dz) < 170) {
        en.hp -= 34;
        en.lock = 0.5;
        this.setEnemyAnim(en, 2);
      }
    }
  }

  exit(): void {
    this.hud.style.display = 'none';
    for (const en of this.enemies) en.model.dispose();
    this.enemies = [];
    this.hp = 100;
    this.deadTime = -1;
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
    if (this.hp <= 0) {
      // dead: play the dying animation once (anim 7), then freeze on its last frame
      if (this.deadTime < 0) {
        this.action = null;
        this.hero.setAnim(Math.min(7, this.hero.animCount - 1));
        this.curAnim = -2;
        this.deadTime = 0;
      }
      this.deadTime += dt;
      if (this.deadTime < this.hero.frameCount / this.hero.fps) this.hero.update(dt);
      this.hud.textContent = 'You died — press Exit play and try again';
      return;
    }
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
        if (fy === null || Math.abs(fy - this.pos.y) > 80 || this.blocked(nx, nz)) return false;
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
    this.updateEnemies(dt);
    this.updateHero(dt);
    // door trigger (GUESS: the door leads to the next stage in file order; the real target is in the stage script bytecode)
    if (this.doorPos && !this.travelling) {
      const dd = Math.hypot(this.pos.x - this.doorPos.x, this.pos.z - this.doorPos.z);
      if (dd > 220) this.doorArmed = true;
      else if (dd < 90 && this.doorArmed) {
        this.travelling = true;
        const next = (this.stageIndex + 1) % 96;
        this.hud.textContent = `door → stage ${next} (guess)…`;
        void this.enter(next, this.heroIndex)
          .then(() => { this.info = `stage ${next} (via door)`; })
          .catch((e) => console.warn('door travel failed', e))
          .finally(() => { this.travelling = false; });
      }
    }
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

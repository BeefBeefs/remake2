import { questOf } from './quests';
import { music } from './audio/music';
import * as THREE from 'three';
import { AnimatedModel, loadHero, loadMonster } from './model/modelViewer';
import { loadStage, StageView } from './model/stageViewer';
import type { Sfx } from './audio/sfx';
import { buildWorld, cfg as moveCfg, fallStep, groundBelow, settle, wallDepth, tryMove as bodyMove, type Body, type Tri, type World } from './collision';

/**
 * First playable slice: walk a hero around one stage. Gameplay runs in three.js world space, where a PS1 point
 * (x,y,z) becomes (x,-y,-z) because the stage/hero groups are rotated by PI about X. Floors come from the stage's
 * collision mesh (up-facing triangles); keyboard (WASD / arrows, Q/E turn camera) or touch (left half = move stick,
 * right half = turn camera).
 */
/** Hero collision (floors, thin walls, step-up, falling, jumping) lives in collision.ts so it can be simulated headless. */

interface Enemy {
  model: AnimatedModel;
  hp: number;
  dmg: number; // damage per hit on the hero
  x: number;
  y: number;
  z: number;
  cooldown: number;
  dying: number;
  npc: boolean;
  /** the NPC entity's `link`: low 7 bits index the area's message table (messages.json) */
  link?: number;
  anim: number;
  lock: number; // seconds a one-shot animation (hit/attack) keeps playing
  vx: number;
  vz: number;
  level: number;
  /** ranged monster attack (module 4624 monster spells: Fire Breath 20, Cold Breath 20 ...): ball colour and damage, null = melee only */
  breath?: { color: number; dmg: number } | null;
}

interface Stats { str: number; int: number; wil: number; agl: number; con: number; pow: number; lck: number }
interface HeroClass { hero: number; class: string; weapon: string; attack: number; defense: number; stats?: Stats }
/** Real base attributes of the class (module 4633) with the neutral value 10 used where a class has none. */
const NEUTRAL: Stats = { str: 10, int: 10, wil: 10, agl: 10, con: 10, pow: 10, lck: 10 };
let classCache: Promise<HeroClass[]> | null = null;
const heroClasses = (): Promise<HeroClass[]> => (classCache ??= fetch('assets/heroes/classes.json').then((r) => r.json() as Promise<HeroClass[]>).catch(() => []));

interface Spell { n: number; name: string; mp: number; element: number; power: number }
let spellCache: Promise<Spell[]> | null = null;
const spellTable = (): Promise<Spell[]> => (spellCache ??= fetch('assets/spells.json').then((r) => r.json() as Promise<Spell[]>).catch(() => []));
/** Guessed spell lists per class (kit index); names are rows of the spell table in module 4624. Priest/Elf/Fairy get Healing. */
const CLASS_SPELLS: Record<number, string[]> = {
  1: ['Healing', 'Refresh'],
  3: ['Fire Bullet', 'Spark Bullet', 'Water Bullet', 'Stone Bullet', 'Lightbolt', 'Magic Missile', 'Blaze', 'Lightningbolt', 'Blizzard'],
  5: ['Spark Bullet', 'Healing'],
  7: ['Water Bullet', 'Healing'],
};
const ELEMENT_COLOR: Record<number, number> = { 2: 0xff8a2a, 3: 0x4aa8ff, 4: 0xb08a55, 5: 0xfff06a, 6: 0xffffff, 7: 0xb06aff, 8: 0xfff2b0, 9: 0x70ff90 };

export class PlayMode {
  private enemies: Enemy[] = [];
  private areaMusic: { main: string; boss: string } | null = null;
  private stageIndex = 0;
  /** air steering only after a deliberate jump: walking off a ledge drops straight down (steering over the void made the hero fall out of the map) */
  private airControl = false;
  /** message tables of all stages (tools/export_messages.py), loaded on first use */
  private messages: Record<string, string[]> | null = null;
  private heroIndex = 0;
  private doorArmed = false;
  private lastRoom = 0;
  /** arrival index of the door script that brought the hero here (0 = entrance side) */
  private pendingArrival = 0;
  private variant = 0;
  private travelling = false;
  private doors: { x: number; z: number; exit: boolean; idx?: number; target?: { stage: number; arrival: number } }[] = [];
  private solids: { x: number; z: number; r: number }[] = [];
  hp = 100;
  /** progression (guess: the original's formulas are not decoded): kills give xp and gold, levels raise HP / MP / damage; kept in localStorage */
  private level = 1;
  private xp = 0;
  private gold = 0;
  private maxHp = 100;
  /** class attributes STR INT WIL AGL CON POW LCK (real values); how they feed the numbers below follows the game's own help texts, the formulas are guesses */
  private stats: Stats = NEUTRAL;
  private maxMp = 50;
  private notice = '';
  private noticeT = 0;
  private deadTime = -1;
  private readonly hud: HTMLDivElement;
  private readonly talkBox: HTMLDivElement;
  private talkIndex = 0;
  private stage?: StageView;
  private hero?: AnimatedModel;
  private tris: Tri[] = [];
  private world: World | null = null;
  private body: Body = { x: 0, y: 0, z: 0, vy: 0, airborne: false };
  /** vertical speed (up positive) while airborne (jumping or falling off a ledge) */
  private vy = 0;
  private airborne = false;
  private safe = new THREE.Vector3();
  private safeT = 0;
  private readonly pos = new THREE.Vector3();
  private heading = Math.PI; // movement direction; models face -z at rotation 0, so the visual yaw adds PI
  private camYaw = 0;
  /** camera distance / pitch (the game's action list has Zoom in/out, Look up/down, Topview) */
  private camDist = 380;
  private camPitch = 0.55;
  private topView = false;
  private moving = false;
  private curAnim = -1;
  /** Healing Potions (the starting kits contain one: 'Restores HP to single unit'; the amount healed is not in the data we read, 40 is a guess). */
  potions = 3;
  /** Damage per hit on enemies (weapon attack x 5; the Normal Sword's 7 gives about the old flat 34) and flat damage reduction from armor. */
  private heroDamage = 34;
  private heroGuardDef = 0;
  private className = '';
  /** Ranged classes (Sorcerer, Hunter, Fairy; kit 3, 4, 7) shoot with Attack and melee with Attack 2. Colour per class. */
  private ranged: number | null = null;
  /** collision triangles that carry a floor-warp byte (stairs / door cells); destination is a guess: the nearest warp cell of the same value on another floor */
  private warpTris: { tri: Tri; v: number }[] = [];
  private warpArmed = true;
  private shots: { mesh: THREE.Mesh; vx: number; vz: number; life: number; dmg: number }[] = [];
  /** projectiles fired by monsters at the hero */
  private eshots: { mesh: THREE.Mesh; vx: number; vz: number; life: number; dmg: number }[] = [];
  /** Magic: 50 MP, regenerates 2/s. Spell lists per class are guesses (CLASS_SPELLS); MP cost / element / power come from the spell table. */
  private mp = 50;
  private baseDamage = 34;
  private spells: Spell[] = [];
  private spellIdx = 0;
  /** Sound effects (set by main.ts once the sound banks are loaded). */
  sfx: Sfx | null = null;
  /** One-shot action (attack/jump…): hero anim index and seconds left. */
  private action: { anim: number; left: number; total: number; jump: boolean } | null = null;
  private readonly keys = new Set<string>();
  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x0: 0 };
  active = false;
  info = '';
  /** Minimap: floor triangles drawn once into an offscreen canvas, then hero / enemies / doors each frame (north up, +x right, +z down). */
  private mini: HTMLCanvasElement;
  private miniBg: HTMLCanvasElement;
  private miniB = { x0: 0, z0: 0, k: 1 };

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    readonly dom: HTMLElement,
  ) {
    this.hud = document.createElement('div');
    this.hud.style.cssText = 'position:fixed;left:10px;bottom:10px;color:#fff;font:14px monospace;text-shadow:0 0 3px #000;display:none;z-index:5';
    document.body.append(this.hud);
    this.mini = document.createElement('canvas');
    this.mini.width = this.mini.height = 140;
    this.mini.style.cssText = 'position:fixed;right:10px;top:10px;width:140px;height:140px;border:1px solid #9ab;border-radius:6px;background:rgba(0,0,20,.55);display:none;z-index:5;pointer-events:none';
    document.body.append(this.mini);
    this.miniBg = document.createElement('canvas');
    this.miniBg.width = this.miniBg.height = 140;
    this.talkBox = document.createElement('div');
    this.talkBox.style.cssText = 'position:fixed;left:5%;right:5%;bottom:90px;padding:10px 14px;background:rgba(10,10,40,.88);border:2px solid #9ab;border-radius:8px;color:#fff;font:15px sans-serif;white-space:pre-wrap;display:none;z-index:6';
    this.talkBox.onclick = () => (this.talkBox.style.display = 'none');
    document.body.append(this.talkBox);
    const help = document.createElement('div');
    help.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:14px 18px;background:rgba(10,10,40,.92);border:2px solid #9ab;border-radius:8px;color:#fff;font:14px monospace;white-space:pre;display:none;z-index:8';
    help.textContent = 'Controls (press ? to close)\n\nWASD / arrows   move        Q E   turn camera\n+ / -  zoom   PgUp / PgDn  look up / down   T  top view\nSpace / J       attack      K     attack 2 (melee)\nL jump (hold a direction to cross gaps)   G guard (half damage)   V victory   H hurt\nC cast spell   Z next spell   P potion   B buy potion (30 gold)\nR / Enter       retry after dying\nWalk off a ledge to drop down; steps up to 60 units are walkable, walls block\nWalk into a yellow door dot to change area (destinations from the game data; which door goes where is partly guessed)';
    help.onclick = () => (help.style.display = 'none');
    document.body.append(help);
    addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      if (key === '?' && this.active) { help.style.display = help.style.display === 'none' ? 'block' : 'none'; return; }
      this.keys.add(key);
      if (key === ' ' || key === 'j') this.act('attack');
      if (key === 'k') this.act('attack2');
      if (key === 'l') this.act('jump');
      if (key === 'h') this.act('hurt');
      if (key === 'v') this.act('victory');
      if (key === 'g') this.act('guard');
      if (key === 'p') this.usePotion();
      if (key === 'b') this.buyPotion();
      if (key === 'c') this.cast();
      if (key === 't') this.topView = !this.topView;
      if (key === '=' || key === '+') this.camDist = Math.max(160, this.camDist - 60);
      if (key === '-') this.camDist = Math.min(1200, this.camDist + 60);
      if (key === 'z') this.spellIdx = this.spells.length ? (this.spellIdx + 1) % this.spells.length : 0;
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

  /** Cast the selected spell: healing spells restore `power` HP, attack spells fire a projectile for power x 3. */
  cast(): void {
    const sp = this.spells[this.spellIdx];
    if (!this.active || !this.hero || this.hp <= 0 || !sp || this.action || this.mp < sp.mp) return;
    this.mp -= sp.mp;
    if (sp.element === 8) {
      this.hp = Math.min(this.maxHp, this.hp + Math.round(sp.power * this.stats.con / 10));
      this.sfx?.play('talk');
    } else {
      this.shoot(ELEMENT_COLOR[sp.element] ?? 0xffffff, Math.round(sp.power * 3 * this.stats.int / 10));
      this.sfx?.play('swing');
    }
    this.act('attack2', true); // animation only
  }

  cycleSpell(): void {
    if (this.spells.length) this.spellIdx = (this.spellIdx + 1) % this.spells.length;
  }

  /** Buy a Healing Potion for 30 gold (price is a guess: the shop prices are not decoded). */
  buyPotion(): void {
    if (!this.active || this.hp <= 0) return;
    if (this.gold < 30 || this.potions >= 9) { this.notice = this.potions >= 9 ? 'Potion bag is full' : 'Not enough gold (30)'; this.noticeT = 1.5; return; }
    this.gold -= 30;
    this.potions++;
    this.notice = 'Bought a Healing Potion (-30 gold)';
    this.noticeT = 1.5;
    try { localStorage.setItem('bb_prog', JSON.stringify({ level: this.level, xp: this.xp, gold: this.gold })); } catch { /* ignore */ }
  }

  usePotion(): void {
    if (!this.active || this.hp <= 0 || this.potions <= 0 || this.hp >= this.maxHp) return;
    this.potions--;
    this.hp = Math.min(this.maxHp, this.hp + 40);
    this.sfx?.play('talk');
  }

  /** Hero animation slots (confirmed by eye): 0 idle, 1 walk, 2 hurt, 3 attack, 4 jump, 6 attack 2, 7 die, 8 victory; 5 looks like a guard (sword held across the body), unconfirmed. */
  act(name: 'attack' | 'attack2' | 'jump' | 'hurt' | 'victory' | 'die' | 'guard', animOnly = false): void {
    const h = this.hero;
    if (name === 'jump' && !animOnly) { this.jump(); return; }
    if (!this.active || !h || this.action) return;
    if (!animOnly && (name === 'attack' || name === 'attack2') && this.talk()) return;
    if (!animOnly && (name === 'attack' || name === 'attack2')) {
      this.sfx?.play('swing');
      if (name === 'attack' && this.ranged !== null) this.shoot(this.ranged);
      else this.strike();
    }
    if (name === 'jump') this.sfx?.play('jump');
    const anim = { attack: 3, attack2: 6, jump: 4, hurt: 2, victory: 8, die: 7, guard: 5 }[name];
    if (anim >= h.animCount) return;
    h.setAnim(anim);
    this.curAnim = anim;
    const total = h.frameCount / h.fps;
    this.action = { anim, left: total, total, jump: name === 'jump' };
  }

  async enter(stageIndex: number, heroIndex: number, variant = 0): Promise<void> {
    this.loadProgress();
    const keepHp = this.travelling ? this.hp : this.maxHp;
    if (!this.travelling) this.potions = 3;
    this.exit();
    this.hp = keepHp;
    this.stageIndex = stageIndex;
    this.variant = variant;
    this.heroIndex = heroIndex;
    this.doorArmed = false;
    this.doorData ??= await fetch('assets/stages/doors.json').then((r) => r.json()).catch(() => ({}));
    this.arrData ??= await fetch('assets/stages/arrivals.json').then((r) => r.json()).catch(() => ({}));
    this.messages ??= await fetch('assets/stages/messages.json').then((r) => r.json()).catch(() => ({}));
    const st = await loadStage(stageIndex, false, variant);
    const h = await loadHero(heroIndex);
    this.stage = st;
    this.hero = h;
    const cls = (await heroClasses()).find((c) => c.hero === heroIndex);
    this.baseDamage = cls ? cls.attack * 5 : 34;
    this.stats = cls?.stats ?? NEUTRAL;
    this.recalc();
    if (!this.travelling) this.hp = this.maxHp;
    this.heroGuardDef = (cls ? Math.floor(cls.defense / 2) : 0) + Math.floor(this.stats.agl / 5);   // AGL: "important for defense"
    this.className = cls ? `${cls.class} (${cls.weapon})\nSTR ${this.stats.str} INT ${this.stats.int} WIL ${this.stats.wil} AGL ${this.stats.agl} CON ${this.stats.con} POW ${this.stats.pow} LCK ${this.stats.lck}` : '';
    const table = await spellTable();
    this.spells = (CLASS_SPELLS[heroIndex % 8] ?? []).map((nm) => table.find((t) => t.name === nm)).filter((t): t is Spell => !!t);
    this.spellIdx = 0;
    if (!this.travelling) this.mp = this.maxMp;
    this.ranged = ({ 3: 0xff8a2a, 4: 0xffe45a, 7: 0x6fe8ff } as Record<number, number>)[heroIndex % 8] ?? null;
    this.curAnim = -1;
    this.scene.add(st.root);
    this.scene.add(h.root);
    await st.addProps();
    await st.loadTextures(null);
    await h.setTexture(`assets/hero/h${String(heroIndex).padStart(2, '0')}_c0.png`);
    // collision triangles in world space; keep up-facing ones
    const c = st.data.collision;
    const w = (i: number) => c.verts[i];
    this.tris = [];
    this.world = null;
    this.vy = 0;
    this.airborne = false;
    this.warpTris = [];
    this.warpArmed = false;
    const all: Tri[] = [];
    let best = 0;
    for (const t of c.tris) {
      if (t.slice(0, 3).some((k) => k >= c.verts.length)) continue;
      const a = w(t[0]), b = w(t[1]), d = w(t[2]);
      const tri: Tri = { ax: a[0], ay: -a[1], az: -a[2], bx: b[0], by: -b[1], bz: -b[2], cx: d[0], cy: -d[1], cz: -d[2] };
      all.push(tri);
      const ux = tri.bx - tri.ax, uy = tri.by - tri.ay, uz = tri.bz - tri.az;
      const vx = tri.cx - tri.ax, vy = tri.cy - tri.ay, vz = tri.cz - tri.az;
      const ny = uz * vx - ux * vz; // y component of the cross product (u x v)
      const len = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) || 1;
      if (Math.abs(ny) / len < 0.5) continue; // steep triangle: a wall (handled by the collision world)
      this.tris.push(tri);
      if (t[3]) this.warpTris.push({ tri, v: t[3] });
      const area = Math.abs(ny);
      if (area > best) {
        best = area;
        this.pos.set((tri.ax + tri.bx + tri.cx) / 3, (tri.ay + tri.by + tri.cy) / 3, (tri.az + tri.bz + tri.cz) / 3);
      }
    }
    this.world = buildWorld(all);
    await this.spawnEnemies(st);
    const door = st.data.entities?.[0];
    const doorList = (st.data.entities ?? []).filter((e) => e.flag === -126 && (e.kind === -1 || e === door || stageIndex === 0)).map((e) => ({ x: e.x, z: -e.z, exit: true }));
    // the inn (stage 0) has no (-1,-1,-126) door record; its three -126 trigger records (two at the east wall, one at the north) serve as the room doors (guess)
    this.doors = doorList;
    // real doors: every door script with a known position (the arrival record its reverse script lands on, see tools/export_doors.py)
    const real = (this.doorData?.[String(stageIndex)] ?? []).filter((d) => d.stage !== null && d.stage !== stageIndex && d.at);
    if (real.length) this.doors = real.map((d, i) => ({ x: d.at!.x, z: -d.at!.z, exit: true, idx: i, target: { stage: d.stage!, arrival: d.arrival } }));
    // (fallback) the inn's six room doors stand at its arrival records 1-6 (the spots where each room's door script returns to), script k-1 leads through door k
    const innArr = stageIndex === 0 ? this.arrData?.['0'] ?? [] : [];
    if (!real.length && innArr.length >= 7) this.doors = innArr.slice(1, 7).map((a, i) => ({ x: a.x, z: -a.z, exit: true, idx: i }));
    const hasDoor = !!(door && door.flag === -126 && door.kind === -1);
    // arrival points: the area module's arrival table (tools/export_doors.py -> arrivals.json); a door script names the arrival index,
    // starting a stage from the menu uses arrival 0 (the entrance). Face the middle of the floor.
    const arrivals = this.arrData?.[String(stageIndex)] ?? [];
    let placed = false;
    if (arrivals.length) {
      const a = arrivals[this.travelling ? Math.min(this.pendingArrival, arrivals.length - 1) : 0];
      // the table's height sign is not certain: take the floor that fits either +y or -y better
      let fy: number | null = null, fd = Infinity;
      for (const hint of [a.y, -a.y]) {
        const f = this.floorAt(a.x, -a.z, hint);
        if (f !== null && Math.abs(f - hint) < fd) { fd = Math.abs(f - hint); fy = f; }
      }
      const cx = this.pos.x, cz = this.pos.z;
      let px = a.x, pz = -a.z;
      if (fy === null) {
        // arrivals sit on the door cell, which is just outside the walkable floor: step towards the middle of the floor until there is ground
        const dx = cx - px, dz = cz - pz, len = Math.hypot(dx, dz) || 1;
        for (const step of [60, 120, 200, 300, 450, 650]) {
          const qx = px + (dx / len) * step, qz = pz + (dz / len) * step;
          for (const hint of [a.y, -a.y]) {
            const f = this.floorAt(qx, qz, hint);
            if (f !== null && Math.abs(f - hint) < fd) { fd = Math.abs(f - hint); fy = f; px = qx; pz = qz; }
          }
          if (fy !== null) break;
        }
      }
      if (fy !== null) {
        this.pos.set(px, fy, pz);
        this.heading = Math.atan2(cx - px, cz - pz);
        placed = true;
      }
    }
    if (door && !placed) {
      // entity (x, y up, z) in PS1 space -> world (x, y, -z); nudge towards the room centre if the door is off the floor
      // entity 0 is a door in rooms but a prop (pedestal/crystal) in some dungeons: do not spawn inside it
      for (const step of hasDoor ? [0, 60, 120, 200] : [160, 220, 280, 120, 0]) {
        const dx = this.pos.x - door.x, dz = this.pos.z + door.z, len = Math.hypot(dx, dz) || 1;
        const px = door.x + (dx / len) * step, pz = -door.z + (dz / len) * step;
        const fy = this.floorAt(px, pz, door.y);
        if (fy !== null) { this.pos.set(px, fy, pz); break; }
      }
    }
    // the door nearest to where the hero appears is the entrance (leads back); any other door is an exit (leads on)
    if (this.doors.length) {
      let bi = 0, bd = Infinity;
      this.doors.forEach((d, i) => { const dd = Math.hypot(d.x - this.pos.x, d.z - this.pos.z); if (dd < bd) { bd = dd; bi = i; } });
      // arriving by arrival index >= 1 (coming back through the exit side) the nearest door is the exit, the others lead back
      const viaExit = placed && this.travelling && this.pendingArrival >= 1 && (st.data.quest ?? -1) !== 0;
      for (const d of this.doors) {
        const near = Math.hypot(d.x - this.doors[bi].x, d.z - this.doors[bi].z) < 300;
        d.exit = viaExit ? near : !near;
      }
    }
    // arrival 1 and up = coming back through the area's other door: appear next to the exit door instead of the entrance
    if (!placed && this.pendingArrival >= 1 && this.travelling && (st.data.quest ?? -1) !== 0) {
      const ex = this.doors.filter((d) => d.exit).sort((a, b) => Math.hypot(b.x - this.pos.x, b.z - this.pos.z) - Math.hypot(a.x - this.pos.x, a.z - this.pos.z))[0];
      if (ex) {
        const cx = this.pos.x, cz = this.pos.z;
        const dx = cx - ex.x, dz = cz - ex.z, len = Math.hypot(dx, dz) || 1;
        for (const step of [160, 220, 280, 120, 60]) {
          const px = ex.x + (dx / len) * step, pz = ex.z + (dz / len) * step;
          const fy = this.floorAt(px, pz, this.pos.y);
          if (fy !== null) { this.pos.set(px, fy, pz); this.heading = Math.atan2(cx - px, cz - pz); break; }
        }
      }
    }
    this.pendingArrival = 0;
    this.safe.copy(this.pos);
    this.safeT = 0.4;
    this.airborne = false;
    this.vy = 0;
    this.buildMinimap();
    this.camera.far = 30000;
    this.camera.near = 5;
    this.camera.updateProjectionMatrix();
    this.active = true;
    this.hud.style.display = 'block';
    const qn = questOf(stageIndex);
    if (qn) {
      const t = music.areaTracks(qn.quest, qn.area);
      this.areaMusic = t;
      music.playArea(qn.quest, qn.area);
    } else this.areaMusic = null;
    this.info = `${qn ? `${qn.name} – area ${qn.area + 1}/${qn.areas} (stage ${stageIndex})` : `stage ${stageIndex}`}: ${this.tris.length} floor triangles — left stick/WASD move, right drag/Q E turn, ? = help`;
    this.updateHero(0);
  }

  /**
   * Enemies/NPCs (heuristic!): the stage lists the monster models it streams in. Room stages: the first listed model is the NPC placed on
   * the entity that carries a link (e.g. the item expert). Dungeons: the most common spawn kind (sub 1) marks the spawn cells; the
   * 10 closest to the start (beyond 500 units) are filled with the stage's monsters in turn.
   */
  private async spawnEnemies(st: StageView): Promise<void> {
    const models = st.data.monsters ?? [];
    const ents = st.data.entities ?? [];
    this.solids = st.propSolids.map((q) => ({ x: q.x, z: -q.z, r: q.r }));
    if (!models.length) return;
    const spots: { x: number; z: number; y: number; model: number; npc: boolean; link?: number }[] = [];
    const isRoom = ents.some((e) => e.flag === -254);
    if (isRoom) {
      const n = ents.find((e) => e.flag === -254 && e.link !== -1 && e.kind >= 0 && e.kind < 256);
      if (n) spots.push({ x: n.x, z: -n.z, y: n.y, model: models[0], npc: true, link: n.link });
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
      // the spawn cells of big dungeons are all kind 0 (stages 20-27), so the monster type is not in the cell: cycle through the stage's monster list
      cand.forEach((e, i) => spots.push({ x: e.x, z: -e.z, y: e.y, model: models[i % models.length], npc: false }));
    }
    for (const sp of spots) {
      try {
        const m = await loadMonster(sp.model);
        await m.setTexture(`assets/monsters/mon${String(sp.model).padStart(2, '0')}.png`);
        this.scene.add(m.root);
        const info = st.data.monsterInfo?.find((i) => i.model === sp.model);
        // real stats from the map module when the model's name is known (HP clamped so bosses stay beatable with the 34-damage hero)
        const hp = info?.hp && info.hp > 1 ? Math.min(300, Math.max(20, info.hp)) : 60;
        const dmg = info?.attack ? Math.min(25, Math.max(3, Math.round(info.attack / 8))) : 8;
        // ranged attackers (names guessed from the spell table's monster attacks): dragons breathe fire, frost things cold, casters throw magic
        const nm = info?.name ?? '';
        const breath = /dragon|wyvern|drake|salamander|hell ?hound|fire/i.test(nm) ? { color: 0xff6a1a, dmg: 20 } : /frost|ice|snow|yeti/i.test(nm) ? { color: 0x6ad0ff, dmg: 20 } : /shaman|wizard|mage|lich|sorcer|vampire|priest/i.test(nm) ? { color: 0xb060ff, dmg: 14 } : null;
        this.enemies.push({ model: m, level: info?.level ?? 1, breath, hp, dmg, x: sp.x, y: sp.y, z: sp.z, cooldown: 0, dying: 0, npc: sp.npc, link: sp.link, anim: 0, lock: 0, vx: 0, vz: 0 });
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

  /** Boss theme (the real area table lists one for the last area of some quests): plays while the area's strongest living monster is near the hero. */
  private updateBossMusic(): void {
    const t = this.areaMusic;
    if (!t || !t.boss) return;
    let boss: Enemy | null = null;
    for (const en of this.enemies) if (!en.npc && en.dying <= 0 && (!boss || en.hp > boss.hp)) boss = en;
    music.play(boss && Math.hypot(this.pos.x - boss.x, this.pos.z - boss.z) < 2200 ? t.boss : t.main);
  }

  private updateEnemies(dt: number): void {
    this.updateBossMusic();
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
        // same rules as the hero: step up at most moveCfg.stepUp, never walk off a ledge, and do not push deeper into a wall
        const w = this.world;
        const fy = w ? groundBelow(w, nx, nz, en.y, moveCfg.stepUp) : this.floorAt(nx, nz, en.y);
        const wallOk = !w || wallDepth(w, nx, nz, en.y) <= wallDepth(w, en.x, en.z, en.y);
        if (fy !== null && Math.abs(fy - en.y) < 80 && wallOk && !this.blocked(nx, nz, en)) {
          en.x = nx; en.z = nz; en.y = fy; moving = true;
        }
      }
      if (!en.npc && en.breath && dist > 160 && dist < 650 && en.cooldown <= 0) {
        en.cooldown = 2.6;
        en.lock = 0.7;
        this.setEnemyAnim(en, 3);
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(22, 10, 8), new THREE.MeshBasicMaterial({ color: en.breath.color }));
        mesh.position.set(en.x, en.y + 90, en.z);
        this.scene.add(mesh);
        this.eshots.push({ mesh, vx: (dx / dist) * 520, vz: (dz / dist) * 520, life: 1.6, dmg: en.breath.dmg });
      }
      if (!en.npc && dist <= 90 && en.cooldown <= 0) {
        en.cooldown = 1.2;
        en.lock = 0.7;
        this.setEnemyAnim(en, 3);
        // while the guess-guard animation plays (key G) the hit does half damage
        this.hp = Math.max(0, this.hp - Math.max(1, (this.action?.anim === 5 ? Math.ceil(en.dmg / 2) : en.dmg) - this.heroGuardDef));
        this.sfx?.play('hurt');
        this.act('hurt');
      }
      if (en.lock <= 0) this.setEnemyAnim(en, moving ? 1 : 0);
      m.update(dt);
      m.root.position.set(en.x, en.y, en.z);
      m.root.rotation.y = Math.atan2(dx, dz) + Math.PI;
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
      if (en.dying <= 0 && en.hp <= 0) { en.dying = 99; this.sfx?.play('enemyDie'); if (!en.npc) this.gainKill(en); }
    }
    const alive = this.enemies.filter((e) => !e.npc && e.hp > 0).length;
    const defs = this.stage?.data.monsterDefs ?? [];
    const here = defs.length ? `\nhere: ${defs.map((d) => d.name).join(', ')}` : '';
    this.hud.style.whiteSpace = 'pre';
    this.noticeT = Math.max(0, this.noticeT - dt);
    let doorHint = '';
    for (const d of this.doors) {
      if (!d.target || Math.hypot(d.x - this.pos.x, d.z - this.pos.z) > 320) continue;
      const q = questOf(d.target.stage);
      doorHint = `door → ${q ? `${q.name}, area ${q.area + 1}/${q.areas}` : `stage ${d.target.stage}`}\n`;
      break;
    }
    this.hud.textContent = `${doorHint}${this.noticeT > 0 ? this.notice + '\n' : ''}${this.className ? this.className + '\n' : ''}Lv ${this.level} (xp ${this.xp}/${this.level * 40}, ${this.gold} gold)\nHP ${this.hp}/${this.maxHp}   ${this.spells.length ? `MP ${Math.floor(this.mp)} ${this.spells[this.spellIdx].name} (C cast, Z next)` : ''}\npotions ${this.potions} (P use, B buy 30g)   enemies ${alive}${here}`;
  }

  /** Prop collision: props are circles (radius ~ 60) – enemies and the hero cannot walk through them. */
  private blocked(x: number, z: number, self?: Enemy): boolean {
    for (const p of this.solids) if (Math.hypot(x - p.x, z - p.z) < p.r) return true;
    if (self) {
      for (const o of this.enemies) if (o !== self && o.npc && Math.hypot(x - o.x, z - o.z) < 60) return true;
    }
    return false;
  }

  /**
   * Talk to the NPC (the attack button when the NPC is within 200 units): shows the stage's script texts one after the other
   * (conditions of the original script are not decoded yet, so all lines cycle in file order). Returns true when a line was shown.
   */
  private talk(): boolean {
    const npc = this.enemies.find((e) => e.npc);
    const texts = this.stage?.data.texts ?? [];
    if (!npc) return false;
    // the NPC's own remark first (real message table, link & 0x7f), then the stage's other texts in file order
    const own = npc.link !== undefined && npc.link >= 0 ? this.messages?.[String(this.stageIndex)]?.[npc.link & 0x7f] ?? '' : '';
    const lines = own ? [own, ...texts] : texts;
    if (!lines.length) return false;
    if (Math.hypot(npc.x - this.pos.x, npc.z - this.pos.z) > 200) return false;
    this.talkBox.textContent = lines[this.talkIndex % lines.length] + `\n\n(${(this.talkIndex % lines.length) + 1}/${lines.length} — tap to close)`;
    this.talkBox.style.display = 'block';
    this.sfx?.play('talk');
    this.talkIndex++;
    return true;
  }

  private buildMinimap(): void {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const t of this.tris) for (const [x, z] of [[t.ax, t.az], [t.bx, t.bz], [t.cx, t.cz]]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!isFinite(x0)) { this.mini.style.display = 'none'; return; }
    const k = 132 / Math.max(x1 - x0, z1 - z0, 1);
    this.miniB = { x0: x0 - (140 / k - (x1 - x0)) / 2, z0: z0 - (140 / k - (z1 - z0)) / 2, k };
    const g = this.miniBg.getContext('2d')!;
    g.clearRect(0, 0, 140, 140);
    g.fillStyle = 'rgba(150,170,200,.55)';
    const b = this.miniB;
    for (const t of this.tris) {
      g.beginPath();
      g.moveTo((t.ax - b.x0) * b.k, (t.az - b.z0) * b.k);
      g.lineTo((t.bx - b.x0) * b.k, (t.bz - b.z0) * b.k);
      g.lineTo((t.cx - b.x0) * b.k, (t.cz - b.z0) * b.k);
      g.fill();
    }
    this.mini.style.display = 'block';
  }

  private drawMinimap(): void {
    if (this.mini.style.display === 'none') return;
    const g = this.mini.getContext('2d')!;
    const b = this.miniB;
    g.clearRect(0, 0, 140, 140);
    g.drawImage(this.miniBg, 0, 0);
    const dot = (x: number, z: number, col: string, r: number): void => {
      g.fillStyle = col;
      g.fillRect((x - b.x0) * b.k - r, (z - b.z0) * b.k - r, r * 2, r * 2);
    };
    for (const d of this.doors) dot(d.x, d.z, '#ffd24a', 2.5);
    for (const e of this.enemies) if (e.hp > 0 && e.dying <= 0) dot(e.x, e.z, e.npc ? '#5fa8ff' : '#ff4d4d', 2);
    dot(this.pos.x, this.pos.z, '#5dff7a', 3);
    // camera direction (forward = away from the camera = (-sin, -cos) in world x, z)
    const hx = (this.pos.x - b.x0) * b.k, hz = (this.pos.z - b.z0) * b.k;
    g.strokeStyle = '#5dff7a';
    g.beginPath();
    g.moveTo(hx, hz);
    g.lineTo(hx - Math.sin(this.camYaw) * 12, hz - Math.cos(this.camYaw) * 12);
    g.stroke();
  }

  /** Ranged attack: a small glowing ball flying along the heading, hits the first enemy within 70 units. */
  private shoot(color: number, dmg = Math.round(this.heroDamage * 0.8)): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(18, 10, 8), new THREE.MeshBasicMaterial({ color }));
    const dx = Math.sin(this.heading), dz = Math.cos(this.heading);
    mesh.position.set(this.pos.x + dx * 60, this.pos.y + 90, this.pos.z + dz * 60);
    this.scene.add(mesh);
    this.shots.push({ mesh, vx: dx * 900, vz: dz * 900, life: 1.0, dmg });
  }

  /** HP from CON ("health and healing"), MP from POW ("recovery of magical energy"), damage from STR ("attacks"); level terms as before. */
  private recalc(): void {
    const st = this.stats;
    this.maxHp = Math.round((100 + (this.level - 1) * 12) * st.con / 10);
    this.maxMp = Math.round((50 + (this.level - 1) * 5) * st.pow / 10);
    this.heroDamage = Math.round((this.baseDamage + (this.level - 1) * 3) * st.str / 10);
  }

  private loadProgress(): void {
    try {
      const j = JSON.parse(localStorage.getItem('bb_prog') ?? 'null') as { level: number; xp: number; gold: number } | null;
      if (j && j.level >= 1) { this.level = j.level; this.xp = j.xp; this.gold = j.gold; }
    } catch { /* storage unavailable */ }
    this.recalc();
  }

  private gainKill(en: Enemy): void {
    this.xp += en.level * 8 + 4;
    this.gold += en.level * 3 + Math.floor(Math.random() * 6);
    let up = false;
    while (this.xp >= this.level * 40) {
      this.xp -= this.level * 40;
      this.level++;
      up = true;
    }
    if (up) {
      this.recalc();
      this.hp = this.maxHp;
      this.mp = this.maxMp;
      this.notice = `LEVEL UP! Lv ${this.level}`;
      this.noticeT = 3;
    }
    try { localStorage.setItem('bb_prog', JSON.stringify({ level: this.level, xp: this.xp, gold: this.gold })); } catch { /* ignore */ }
  }

  private updateShots(dt: number): void {
    for (const sh of this.eshots) {
      sh.mesh.position.x += sh.vx * dt;
      sh.mesh.position.z += sh.vz * dt;
      sh.life -= dt;
      if (Math.hypot(this.pos.x - sh.mesh.position.x, this.pos.z - sh.mesh.position.z) < 50 && Math.abs(this.pos.y + 90 - sh.mesh.position.y) < 120) {
        // monster magic: WIL ("resistance to magic") scales the damage, the physical defense (AGL) does not apply
        const md = Math.round(sh.dmg * 10 / this.stats.wil);
        this.hp = Math.max(0, this.hp - Math.max(1, this.action?.anim === 5 ? Math.ceil(md / 2) : md));
        this.sfx?.play('hurt');
        this.act('hurt');
        sh.life = 0;
      }
      if (sh.life > 0 && this.floorAt(sh.mesh.position.x, sh.mesh.position.z, this.pos.y) === null) sh.life = 0;
    }
    this.eshots = this.eshots.filter((sh) => {
      if (sh.life > 0) return true;
      this.scene.remove(sh.mesh);
      sh.mesh.geometry.dispose();
      (sh.mesh.material as THREE.Material).dispose();
      return false;
    });
    for (const sh of this.shots) {
      sh.mesh.position.x += sh.vx * dt;
      sh.mesh.position.z += sh.vz * dt;
      sh.life -= dt;
      for (const en of this.enemies) {
        if (en.npc || en.hp <= 0 || en.dying > 0) continue;
        if (Math.hypot(en.x - sh.mesh.position.x, en.z - sh.mesh.position.z) < 70) {
          en.hp -= sh.dmg;
          en.lock = 0.5;
          this.sfx?.play('hit');
          this.setEnemyAnim(en, 2);
          sh.life = 0;
          break;
        }
      }
      if (sh.life > 0 && this.floorAt(sh.mesh.position.x, sh.mesh.position.z, this.pos.y) === null) sh.life = 0;
    }
    this.shots = this.shots.filter((sh) => {
      if (sh.life > 0) return true;
      this.scene.remove(sh.mesh);
      sh.mesh.geometry.dispose();
      (sh.mesh.material as THREE.Material).dispose();
      return false;
    });
  }

  /** Hero attack: damage enemies in front within 170 units. */
  private strike(): void {
    for (const en of this.enemies) {
      if (en.npc || en.hp <= 0) continue;
      const dx = en.x - this.pos.x, dz = en.z - this.pos.z;
      if (Math.hypot(dx, dz) < 170) {
        en.hp -= this.heroDamage;
        this.sfx?.play('hit');
        en.lock = 0.5;
        this.setEnemyAnim(en, 2);
      }
    }
  }

  exit(): void {
    this.hud.style.display = 'none';
    this.mini.style.display = 'none';
    this.talkBox.style.display = 'none';
    this.talkIndex = 0;
    for (const en of this.enemies) en.model.dispose();
    this.enemies = [];
    for (const sh of this.shots) { this.scene.remove(sh.mesh); sh.mesh.geometry.dispose(); (sh.mesh.material as THREE.Material).dispose(); }
    this.shots = [];
    for (const sh of this.eshots) { this.scene.remove(sh.mesh); sh.mesh.geometry.dispose(); (sh.mesh.material as THREE.Material).dispose(); }
    this.eshots = [];
    this.hp = this.maxHp;
    this.deadTime = -1;
    this.active = false;
    this.stage?.dispose();
    this.hero?.dispose();
    this.stage = undefined;
    this.hero = undefined;
    this.tris = [];
    this.world = null;
    this.vy = 0;
    this.airborne = false;
    this.warpTris = [];
    this.camera.far = 500;
    this.camera.near = 0.1;
    this.camera.updateProjectionMatrix();
  }

  /** The floor-warp triangle under (x, z) at about height y, if any. */
  private warpAt(x: number, z: number, y: number): { tri: Tri; v: number } | null {
    for (const w of this.warpTris) {
      const t = w.tri;
      const d = (t.bz - t.cz) * (t.ax - t.cx) + (t.cx - t.bx) * (t.az - t.cz);
      if (Math.abs(d) < 1e-6) continue;
      const l1 = ((t.bz - t.cz) * (x - t.cx) + (t.cx - t.bx) * (z - t.cz)) / d;
      const l2 = ((t.cz - t.az) * (x - t.cx) + (t.ax - t.cx) * (z - t.cz)) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -0.001 || l2 < -0.001 || l3 < -0.001) continue;
      if (Math.abs(l1 * t.ay + l2 * t.by + l3 * t.cy - y) < 60) return w;
    }
    return null;
  }

  /** Stairs (guess): stepping on a warp cell moves the hero to the nearest warp cell with the same value on another floor (>150 units up or down). */
  private updateWarps(): void {
    if (!this.warpTris.length || this.stageIndex !== 0) return; // only the inn: in the dungeons the byte takes values 1-8 at many heights (zone / arrival ids), not stairs
    const here = this.warpAt(this.pos.x, this.pos.z, this.pos.y);
    if (!here) { this.warpArmed = true; return; }
    if (!this.warpArmed) return;
    const cy = (w: { tri: Tri }) => (w.tri.ay + w.tri.by + w.tri.cy) / 3;
    const cx = (w: { tri: Tri }) => (w.tri.ax + w.tri.bx + w.tri.cx) / 3;
    const cz = (w: { tri: Tri }) => (w.tri.az + w.tri.bz + w.tri.cz) / 3;
    const y0 = cy(here);
    if (y0 < 50) return; // outside cells (height 0) are door cells, not stairs
    let best: { tri: Tri; v: number } | null = null, bd = Infinity;
    for (const w of this.warpTris) {
      if (w.v !== here.v || Math.abs(cy(w) - y0) < 150 || cy(w) < 50) continue;
      const dd = Math.hypot(cx(w) - this.pos.x, cz(w) - this.pos.z);
      if (dd < bd) { bd = dd; best = w; }
    }
    if (!best) return;
    const x = cx(best), z = cz(best), fy = this.floorAt(x, z, cy(best));
    if (fy === null) return;
    this.pos.set(x, fy, z);
    this.warpArmed = false;
    this.notice = 'stairs (guess)';
    this.noticeT = 1;
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

  /** Hero state <-> collision body. */
  private toBody(): Body { const b = this.body; b.x = this.pos.x; b.y = this.pos.y; b.z = this.pos.z; b.vy = this.vy; b.airborne = this.airborne; return b; }
  private fromBody(b: Body): void { this.pos.set(b.x, b.y, b.z); this.vy = b.vy; this.airborne = b.airborne; }

  /** Jump (L): only from the ground; the hero keeps full air control so gaps in the floor can be crossed. */
  private jump(): void {
    if (this.airborne || this.hp <= 0 || this.action) return;
    this.airborne = true;
    this.airControl = true;
    this.vy = moveCfg.jumpV;
    this.sfx?.play('jump');
  }

  /** Gravity step while airborne: land on the highest floor the feet pass through; falling out of the map puts the hero back on the last safe ground. */
  private fall(dt: number): void {
    if (!this.world) return;
    const b = this.toBody();
    const r = fallStep(this.world, b, dt);
    this.fromBody(b);
    if (r === 'landed') this.airControl = false;
    if (r === 'out') {
      this.airControl = false;
      this.pos.copy(this.safe);
      this.airborne = false;
      this.vy = 0;
      this.notice = 'fell off the map — back on safe ground';
      this.noticeT = 2;
    }
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
        this.sfx?.play('heroDie');
        music.play('gameover', false);
      }
      this.deadTime += dt;
      if (this.deadTime < this.hero.frameCount / this.hero.fps) this.hero.update(dt);
      this.hud.textContent = this.deadTime > 1.2 ? 'You died — press R (or tap) to retry this area, or Exit play' : 'You died';
      if (this.deadTime > 1.2 && !this.travelling && (this.keys.has('r') || this.keys.has('enter') || this.stick.id >= 0)) {
        this.travelling = true;
        this.hp = this.maxHp; // enter() keeps the current HP while travelling
        void this.enter(this.stageIndex, this.heroIndex, this.variant)
          .catch((e) => console.warn('retry failed', e))
          .finally(() => { this.travelling = false; });
      }
      return;
    }
    this.mp = Math.min(this.maxMp, this.mp + 2 * dt * this.stats.pow / 10);
    const k = this.keys;
    if (k.has('q')) this.camYaw += dt * 1.8;
    if (k.has('e')) this.camYaw -= dt * 1.8;
    if (k.has('pageup')) this.camPitch = Math.min(1.2, this.camPitch + dt * 0.9);
    if (k.has('pagedown')) this.camPitch = Math.max(0.15, this.camPitch - dt * 0.9);
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
        if (!this.world) return false;
        const b = this.toBody();
        const ok = bodyMove(this.world, b, nx, nz, (x, z) => this.blocked(x, z));
        if (ok) this.fromBody(b);
        return ok;
      };
      if (!this.airborne || this.airControl) {
        if (!tryMove(this.pos.x + dx, this.pos.z + dz)) {
          if (!tryMove(this.pos.x + dx, this.pos.z)) tryMove(this.pos.x, this.pos.z + dz);
        }
      }
      this.heading = Math.atan2(dx, dz);
    }
    if (this.airborne) this.fall(dt);
    else {
      this.safeT -= dt;
      if (this.safeT <= 0) { this.safe.copy(this.pos); this.safeT = 0.4; }
      // stay glued to the ground when idle, or start falling if the floor under us vanished
      if (this.world) { const b = this.toBody(); settle(this.world, b); this.fromBody(b); }
    }
    if (this.action) {
      this.action.left -= dt;
      if (this.action.left <= 0) {
        this.action = null;
        this.curAnim = -1;
      }
    }
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updateHero(dt);
    this.updateWarps();
    this.drawMinimap();
    // door trigger: destinations come from the door scripts of the area module (assets/stages/doors.json, tools/export_doors.py);
    // which script belongs to which door entity is not decoded yet, so an exit door takes the next area of the quest and an entrance door the previous one,
    // the ends of a quest lead to the inn, and the inn's doors cycle through its five rooms.
    if (this.doors.length && !this.travelling) {
      let near: (typeof this.doors)[number] | null = null;
      let dmin = Infinity;
      for (const d of this.doors) {
        const dd = Math.hypot(this.pos.x - d.x, this.pos.z - d.z);
        if (dd < dmin) { dmin = dd; near = d; }
      }
      if (dmin > 220) this.doorArmed = true;
      else if (near && dmin < (near.target ? 120 : 90) && this.doorArmed) {
        this.travelling = true;
        this.sfx?.play('door');
        const i0 = this.stageIndex;
        const tgt = near.target ?? this.doorTarget(i0, near.exit, near.idx);
        const next = tgt.stage;
        this.pendingArrival = tgt.arrival;
        if (next >= 1 && next <= 5) this.lastRoom = next;
        this.hud.textContent = `door → stage ${next}…`;
        void this.enter(next, this.heroIndex, this.variant)
          .then(() => { this.info = `stage ${next} (via door)`; })
          .catch((e) => console.warn('door travel failed', e))
          .finally(() => { this.travelling = false; });
      }
    }
  }

  /** real door destinations per stage (door scripts `11 group area arrival`), loaded once */
  private arrData: Record<string, { x: number; y: number; z: number; rot: number; id: number }[]> | null = null;
  private doorData: Record<string, { quest: number; area: number; arrival: number; stage: number | null; at?: { x: number; y: number; z: number } }[]> | null = null;

  /** destination of a door: stage and arrival index (0 = the area's entrance door, 1.. = other doors, e.g. the exit door when coming back) */
  private doorTarget(i0: number, exit: boolean, idx?: number): { stage: number; arrival: number } {
    const all = (this.doorData?.[String(i0)] ?? []).filter((d): d is { quest: number; area: number; arrival: number; stage: number } => d.stage !== null && d.stage !== i0);
    const quest = this.stage?.data.quest ?? -1;
    const [q0, q1] = this.stage?.data.questRange ?? [i0, i0];
    const to = (stage: number, arrival = 0) => ({ stage, arrival });
    if (!all.length) {
      if (quest === 0) return to(i0 === 0 ? (this.lastRoom % 5) + 1 : 0, i0 === 0 ? 0 : this.lastRoom);
      return exit ? to(i0 < q1 ? i0 + 1 : 0) : to(i0 > q0 ? i0 - 1 : 0, 1);
    }
    if (quest === 0) {
      if (i0 !== 0) return all[0];
      if (idx !== undefined && this.doorData?.['0']?.[idx]?.stage != null) return this.doorData['0'][idx] as { stage: number; arrival: number };
      const rooms = [...new Set(all.map((d) => d.stage))].sort((a, b) => a - b);
      const r = rooms.find((n) => n > this.lastRoom) ?? rooms[0];
      return all.find((d) => d.stage === r) ?? all[0];
    }
    const same = all.filter((d) => d.stage >= q0 && d.stage <= q1);
    if (exit) {
      const higher = same.filter((d) => d.stage > i0).sort((a, b) => a.stage - b.stage);
      return higher[0] ?? to(0, 1);
    }
    const lower = same.filter((d) => d.stage < i0).sort((a, b) => b.stage - a.stage);
    if (lower.length) return lower[0];
    const other = all.filter((d) => d.stage < q0 || d.stage > q1);
    return other[0] ?? to(0, 1);
  }

  private updateHero(dt: number): void {
    const h = this.hero;
    if (!h) return;
    // standing still with no hostile within 700 units: the hero's extra pack animation (arms down, weapon not in hand; role guessed) as a relaxed idle
    const calm = !this.moving && h.totalAnimCount > h.animCount && !this.enemies.some((e) => !e.npc && !e.dying && e.hp > 0 && e.model.root.position.distanceTo(this.pos) < 700);
    const want = this.action ? this.action.anim : this.airborne && h.animCount > 4 ? 4 : this.moving && h.animCount > 1 ? 1 : calm ? h.animCount : 0;
    if (want !== this.curAnim) {
      h.setAnim(want);
      this.curAnim = want;
    }
    h.update(dt);
    h.root.position.copy(this.pos);
    if (this.action?.jump) h.root.position.y += Math.sin(Math.PI * (1 - this.action.left / this.action.total)) * 70; // animation-only jump (viewer buttons)
    h.root.rotation.y = this.heading + Math.PI;
    const d = this.camDist, pitch = this.topView ? 1.5 : this.camPitch;
    this.camera.position.set(
      this.pos.x + Math.sin(this.camYaw) * d * Math.cos(pitch),
      this.pos.y + 90 + Math.sin(pitch) * d,
      this.pos.z + Math.cos(this.camYaw) * d * Math.cos(pitch),
    );
    this.camera.lookAt(this.pos.x, this.pos.y + 50, this.pos.z);
  }
}

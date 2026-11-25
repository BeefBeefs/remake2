import * as THREE from 'three';
import { SndBanks } from './audio/sndBank';
import { Sfx, SFX_SLOTS, SfxSlot } from './audio/sfx';
import { AnimatedModel, loadHero, loadMonster } from './model/modelViewer';
import { loadStage, StageView } from './model/stageViewer';
import { PlayMode } from './play';
import { questOf } from './quests';
import { music } from './audio/music';
import { initMenu } from './menu';

// Placeholder scene: proves the build/asset pipeline. Real game systems land in later milestones
// (see PROGRESS.md).
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14141c);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 6, 10);
camera.lookAt(0, 0, 0);

const grid = new THREE.GridHelper(400, 40, 0x444466, 0x222233);
scene.add(grid);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(4, 8, 6);
scene.add(sun);
camera.position.set(0, 70, 260);
camera.lookAt(0, 55, 0);

// Hero model viewer: 16 heroes (mesh + skeleton + 8-9 animations each), 4 palettes per hero texture.
let model: AnimatedModel | undefined;
const hud = document.getElementById('hud');
const mk = (n: number, label: (i: number) => string) => {
  const sel = document.createElement('select');
  for (let i = 0; i < n; i++) sel.add(new Option(label(i), String(i)));
  return sel;
};
// 0-15 heroes, 16-112 the 97 monsters of the model table (data/model_table.json), 113+ the 78 stages
// (room geometry, tools/export_stages.py; the 18 headerless extra records are merged into their owning stage)
const STAGE0 = 16 + 97;
export const STAGE_COUNT = 78;
const qLabel = (k: number): string => { const q = questOf(k); return q ? `${q.name} ${q.area + 1}/${q.areas}` : ''; };
const heroSel = mk(STAGE0 + STAGE_COUNT, (i) => (i < 16 ? `hero ${i}` : i < STAGE0 ? `monster ${i - 16}` : `stage ${i - STAGE0} – ${qLabel(i - STAGE0)}`));
// Stage names (tools/export_stages.py finds ' - Name -' strings for 30 of the stages) label the dropdown entries.
fetch('assets/stages/index.json')
  .then((r) => r.json() as Promise<{ stages: { name?: string | null }[] }>)
  .then((ix) =>
    ix.stages.forEach((st, k) => {
      if (st.name) {
        heroSel.options[STAGE0 + k].text = `stage ${k} – ${st.name} (${qLabel(k)})`;
        playSel.options[k].text = `stage ${k} – ${st.name} (${qLabel(k)})`;
      }
    }),
  )
  .catch(() => undefined);
// Hero class names (character-select module of BLAZE.ALL, tools/export_classes.py) label the 16 hero entries.
fetch('assets/heroes/classes.json')
  .then((r) => r.json() as Promise<{ hero: number; class: string; weapon: string }[]>)
  .then((cl) => cl.forEach((c) => { heroSel.options[c.hero].text = `hero ${c.hero} – ${c.class}`; }))
  .catch(() => undefined);
const atlasSel = mk(271, (i) => `atlas ${i}`);
{
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.text = 'auto (per face)';
  atlasSel.prepend(auto);
}
atlasSel.style.display = 'none';
let stage: StageView | undefined;
const animSel = document.createElement('select');
const palSel = mk(4, (i) => `palette ${i}`);
const gearSel = document.createElement('select');
for (const [v, t] of [['b', 'gear B'], ['a', 'gear A'], ['both', 'gear A+B']]) gearSel.add(new Option(t, v));
const info = document.createElement('div');
hud?.append(document.createElement('hr'), heroSel, animSel, palSel, gearSel, atlasSel, info);

// First playable slice: walk the selected hero (or hero 0) around the selected stage (stage 1 if none is selected).
const play = new PlayMode(scene, camera, renderer.domElement);
const stageLabel = (i: number): string => { const q = questOf(i); return q ? `stage ${i} – ${q.name} ${q.area + 1}/${q.areas}` : `stage ${i}`; };
const playSel = mk(STAGE_COUNT, stageLabel);
playSel.value = '1';
// Story-state variants: the inn and rooms exist several times (different dialogue / entities); the picker lists the extra copies.
const variantSel = document.createElement('select');
const refreshVariants = async () => {
  variantSel.innerHTML = '';
  variantSel.add(new Option('story version 1', '0'));
  try {
    const k = Number(playSel.value);
    const st = (await (await fetch(`assets/stages/stage${String(k).padStart(2, '0')}.json`)).json()) as { variants?: unknown[] };
    (st.variants ?? []).forEach((_, i) => variantSel.add(new Option(`story version ${i + 2}`, String(i + 1))));
  } catch { /* keep the single entry */ }
  variantSel.style.display = variantSel.options.length > 1 ? '' : 'none';
};
playSel.addEventListener('change', () => void refreshVariants());
void refreshVariants();
const playBtn = document.createElement('button');
playBtn.textContent = '▶ Play stage';
hud?.append(playSel, variantSel, playBtn);
playBtn.onclick = async () => {
  if (play.active) {
    play.exit();
    grid.visible = true;
    playBtn.textContent = '▶ Play stage';
    pad.style.display = 'none';
    heroSel.onchange?.(new Event('change'));
    return;
  }
  const sel = Number(heroSel.value);
  const stageIdx = sel >= STAGE0 ? sel - STAGE0 : Number(playSel.value);
  const heroIdx = sel < 16 ? sel : 0;
  info.textContent = 'loading play mode…';
  if (model) { scene.remove(model.root); model.dispose(); model = undefined; }
  if (stage) { stage.dispose(); stage = undefined; }
  grid.visible = false;
  try {
    await play.enter(stageIdx, heroIdx, Number(variantSel.value));
    playBtn.textContent = '■ Exit play';
    pad.style.display = 'flex';
    info.textContent = play.info;
  } catch (e) {
    info.textContent = `play failed: ${e}`;
    play.exit();
    grid.visible = true;
  }
};

// Confirmed by eye on the phone (anim 1 'walk' and anim 5 not yet confirmed): see PROGRESS.md Step P.
// On-screen action buttons (touch) shown while playing; keyboard: Space/J attack, K attack 2, L jump, H hurt, V victory, G guard (slot 5, guess), P potion, C cast spell, Z next spell.
const pad = document.createElement('div');
pad.style.cssText = 'position:fixed;right:10px;bottom:14px;display:none;gap:8px;z-index:5';
for (const [label, act] of [['⚔', 'attack'], ['⚔2', 'attack2'], ['⤒', 'jump'], ['★', 'victory']] as const) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font-size:22px;width:56px;height:56px;border-radius:28px;opacity:.85';
  b.onpointerdown = (e) => {
    e.stopPropagation();
    play.act(act);
  };
  pad.append(b);
}
for (const [label, fn] of [['✨', () => play.cast()], ['↻', () => play.cycleSpell()]] as const) {
  const b = document.createElement('button');
  b.textContent = label;
  b.style.cssText = 'font-size:22px;width:56px;height:56px;border-radius:28px;opacity:.85';
  b.onpointerdown = (e) => { e.stopPropagation(); fn(); };
  pad.append(b);
}
{
  const b = document.createElement('button');
  b.textContent = '🧪';
  b.style.cssText = 'font-size:22px;width:56px;height:56px;border-radius:28px;opacity:.85';
  b.onpointerdown = (e) => { e.stopPropagation(); play.usePotion(); };
  pad.append(b);
  const buy = document.createElement('button');
  buy.textContent = '🪙';
  buy.style.cssText = 'font-size:22px;width:56px;height:56px;border-radius:28px;opacity:.85';
  buy.onpointerdown = (e) => { e.stopPropagation(); play.buyPotion(); };
  pad.append(buy);
}
document.body.append(pad);

const HERO_ANIMS = ['idle', 'walk?', 'hurt', 'attack', 'jump', 'guard?', 'attack 2', 'die', 'victory'];
const MONSTER_ANIMS = ['idle', 'walk', 'attack', 'hit'];
const isMonster = () => Number(heroSel.value) >= 16;
const texUrl = () =>
  isMonster()
    ? `assets/monsters/mon${String(Number(heroSel.value) - 16).padStart(2, '0')}.png`
    : `assets/hero/h${String(heroSel.value).padStart(2, '0')}_c${palSel.value}.png`;
const describe = (m: AnimatedModel) =>
  `${m.data.parts.length} parts, ${m.frameCount} frames, ${m.skippedFaces}/${m.totalFaces} faces skipped`;

async function showStage(k: number): Promise<void> {
  info.textContent = 'loading…';
  const st = await loadStage(k);
  if (model) {
    scene.remove(model.root);
    model.dispose();
    model = undefined;
  }
  stage?.dispose();
  stage = st;
  scene.add(st.root);
  st.addMarkers();
  await st.addProps();
  // Atlases listed in the stage's resource descriptor are marked; which one a face uses is not decoded yet (faces
  // probably pick by page bits), so try the others if it looks noisy.
  const listed = new Set(st.data.atlases ?? []);
  for (let i = 1; i < atlasSel.options.length; i++) atlasSel.options[i].text = `atlas ${i - 1}${listed.has(i - 1) ? ' ★' : ''}`;
  atlasSel.value = 'auto';
  await st.loadTextures(null);
  animSel.replaceChildren();
  info.textContent = `${st.data.meshes.length} room meshes, ${st.triangles} triangles, ${st.propCount} props, ${st.markerCount} markers`;
}
atlasSel.onchange = () => void stage?.loadTextures(atlasSel.value === 'auto' ? null : Number(atlasSel.value));

async function showHero(h: number): Promise<void> {
  const isStage = h >= STAGE0;
  atlasSel.style.display = isStage ? '' : 'none';
  palSel.style.display = isStage ? 'none' : '';
  gearSel.style.display = isStage || h >= 16 ? 'none' : '';
  animSel.style.display = isStage ? 'none' : '';
  if (isStage) return showStage(h - STAGE0);
  if (stage) {
    stage.dispose();
    stage = undefined;
  }
  info.textContent = 'loading…';
  const m = h < 16 ? await loadHero(h) : await loadMonster(h - 16);
  if (model) {
    scene.remove(model.root);
    model.dispose();
  }
  model = m;
  scene.add(m.root);
  // Guessed from frame-count patterns shared by all models (see PROGRESS.md Step J); "?" = unverified.
  const guess = h < 16 ? HERO_ANIMS : MONSTER_ANIMS;
  animSel.replaceChildren(
    ...Array.from({ length: m.totalAnimCount }, (_, i) => new Option(`anim ${i}${i >= m.animCount ? ' (extra pack: relaxed idle, arms down, weapon away - guess)' : guess[i] ? ` (${guess[i]}${h >= 16 ? '?' : ''})` : ''}`, String(i))),
  );
  palSel.value = '0';
  palSel.disabled = h >= 16;
  gearSel.value = 'b';
  gearSel.disabled = !m.gearSets;
  await m.setTexture(texUrl());
  info.textContent = describe(m);
}
heroSel.onchange = () => void showHero(Number(heroSel.value));
animSel.onchange = () => {
  model?.setAnim(Number(animSel.value));
  if (model) info.textContent = describe(model);
};
palSel.onchange = () => void model?.setTexture(texUrl());
gearSel.onchange = () => model?.setGear(gearSel.value as 'a' | 'b' | 'both');
showHero(0).catch((e) => {
  info.textContent = `model load failed: ${e}`;
  console.error(e);
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let last = 0;
renderer.setAnimationLoop((t: number) => {
  const dt = Math.min((t - last) / 1000, 0.1);
  last = t;
  if (model) {
    model.update(dt);
    model.root.rotation.y = t / 3000;
  }
  if (stage) stage.root.rotation.y = t / 6000;
  if (play.active) play.update(dt);
  renderer.render(scene, camera);
});

// --- Sound bank browser -------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
SndBanks.load()
  .then((snd) => {
    const bankSel = $<HTMLSelectElement>('bank');
    const clipSel = $<HTMLSelectElement>('clip');
    const fill = () => {
      clipSel.replaceChildren(
        ...snd.clips(bankSel.value).map((c, i) => new Option(`#${c.index} (${c.seconds.toFixed(2)}s)`, String(i))),
      );
    };
    bankSel.replaceChildren(...snd.banks().map((b) => new Option(b, b)));
    bankSel.onchange = fill;
    fill();
    $('play').onclick = () => {
      const clip = snd.clips(bankSel.value)[Number(clipSel.value)];
      if (clip) void snd.play(clip);
    };
    // play-mode sound effects: guessed defaults, reassignable to the clip selected above
    const sfx = new Sfx(snd);
    play.sfx = sfx;
    const slotSel = $<HTMLSelectElement>('slot');
    const info = () => { $('slotinfo').textContent = `${slotSel.value} = ${sfx.describe(slotSel.value as SfxSlot)}`; };
    slotSel.replaceChildren(...SFX_SLOTS.map((s) => new Option(s, s)));
    slotSel.onchange = info;
    info();
    $('assign').onclick = () => {
      const clip = snd.clips(bankSel.value)[Number(clipSel.value)];
      if (clip) { sfx.assign(slotSel.value as SfxSlot, clip); info(); void sfx.play(slotSel.value as SfxSlot); }
    };
    $<HTMLInputElement>('mute').onchange = (e) => { sfx.muted = (e.target as HTMLInputElement).checked; };
    $('status').textContent = `${snd.manifest.clips.length} sound clips loaded`;
  })
  .catch((e) => {
    $('status').textContent = `sound manifest failed: ${e}`;
  });

// Title splash (original title screen from BLAZE.ALL); click or any key dismisses it.
{
  const t = document.getElementById('title');
  music.play('title01');
  const hide = () => { t?.remove(); window.removeEventListener('keydown', hide); music.play('menu'); };
  t?.addEventListener('click', hide);
  window.addEventListener('keydown', hide);
}

// Main menu (shown once the title splash is dismissed); the viewer panel (#hud) is hidden until "Model / stage viewer" is chosen.
initMenu({
  start: (stageIdx, heroIdx) => {
    heroSel.value = String(heroIdx);
    playSel.value = String(stageIdx);
    variantSel.value = '0';
    playBtn.click();
  },
  stop: () => { if (play.active) playBtn.click(); },
  isPlaying: () => play.active,
  viewer: (show) => { if (hud) hud.style.display = show ? '' : 'none'; },
});

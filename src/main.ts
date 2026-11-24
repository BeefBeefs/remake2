import * as THREE from 'three';
import { SndBanks } from './audio/sndBank';
import { AnimatedModel, loadHero, loadMonster } from './model/modelViewer';
import { loadStage, StageView } from './model/stageViewer';
import { PlayMode } from './play';

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
// 0-15 heroes, 16-112 the 97 monsters of the model table (data/model_table.json), 113+ the 96 stages
// (room geometry, tools/export_stages.py)
const STAGE0 = 16 + 97;
const heroSel = mk(STAGE0 + 96, (i) => (i < 16 ? `hero ${i}` : i < STAGE0 ? `monster ${i - 16}` : `stage ${i - STAGE0}`));
// Stage names (tools/export_stages.py finds ' - Name -' strings for 30 of 96 stages) label the dropdown entries.
fetch('assets/stages/index.json')
  .then((r) => r.json() as Promise<{ stages: { name?: string | null }[] }>)
  .then((ix) =>
    ix.stages.forEach((st, k) => {
      if (st.name) {
        heroSel.options[STAGE0 + k].text = `stage ${k} – ${st.name}`;
        playSel.options[k].text = `stage ${k} – ${st.name}`;
      }
    }),
  )
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
const info = document.createElement('div');
hud?.append(document.createElement('hr'), heroSel, animSel, palSel, atlasSel, info);

// First playable slice: walk the selected hero (or hero 0) around the selected stage (stage 1 if none is selected).
const play = new PlayMode(scene, camera, renderer.domElement);
const playSel = mk(96, (i) => `stage ${i}`);
playSel.value = '1';
const playBtn = document.createElement('button');
playBtn.textContent = '▶ Play stage';
hud?.append(playSel, playBtn);
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
    await play.enter(stageIdx, heroIdx);
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
// On-screen action buttons (touch) shown while playing; keyboard: Space/J attack, K attack 2, L jump, H hurt, V victory.
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
document.body.append(pad);

const HERO_ANIMS = ['idle', 'walk?', 'hurt', 'attack', 'jump', '', 'attack 2', 'die', 'victory'];
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
    ...Array.from({ length: m.animCount }, (_, i) => new Option(`anim ${i}${guess[i] ? ` (${guess[i]}${h >= 16 ? '?' : ''})` : ''}`, String(i))),
  );
  palSel.value = '0';
  palSel.disabled = h >= 16;
  await m.setTexture(texUrl());
  info.textContent = describe(m);
}
heroSel.onchange = () => void showHero(Number(heroSel.value));
animSel.onchange = () => {
  model?.setAnim(Number(animSel.value));
  if (model) info.textContent = describe(model);
};
palSel.onchange = () => void model?.setTexture(texUrl());
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
    $('status').textContent = `${snd.manifest.clips.length} sound clips loaded`;
  })
  .catch((e) => {
    $('status').textContent = `sound manifest failed: ${e}`;
  });

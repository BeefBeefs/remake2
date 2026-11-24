import * as THREE from 'three';
import { SndBanks } from './audio/sndBank';
import { AnimatedModel, loadHero, loadMonster } from './model/modelViewer';

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

scene.add(new THREE.GridHelper(400, 40, 0x444466, 0x222233));
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
// 0-15 = heroes, 16.. = monsters (78 anim<->mesh pairs; texture group is a guess, pick another with "tex")
const heroSel = mk(16 + 78, (i) => (i < 16 ? `hero ${i}` : `monster ${i - 16}`));
const animSel = document.createElement('select');
const palSel = mk(4, (i) => `palette ${i}`);
const info = document.createElement('div');
hud?.append(document.createElement('hr'), heroSel, animSel, palSel, info);

const isMonster = () => Number(heroSel.value) >= 16;
const texUrl = () =>
  isMonster()
    ? `assets/monsters/mon${String(Number(heroSel.value) - 16).padStart(2, '0')}.png`
    : `assets/hero/h${String(heroSel.value).padStart(2, '0')}_c${palSel.value}.png`;
const describe = (m: AnimatedModel) =>
  `${m.data.parts.length} parts, ${m.frameCount} frames, ${m.skippedFaces}/${m.totalFaces} faces skipped`;

async function showHero(h: number): Promise<void> {
  info.textContent = 'loading…';
  const m = h < 16 ? await loadHero(h) : await loadMonster(h - 16);
  if (model) {
    scene.remove(model.root);
    model.dispose();
  }
  model = m;
  scene.add(m.root);
  animSel.replaceChildren(...Array.from({ length: m.animCount }, (_, i) => new Option(`anim ${i}`, String(i))));
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

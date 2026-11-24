import * as THREE from 'three';
import { SndBanks } from './audio/sndBank';

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

scene.add(new THREE.GridHelper(40, 40, 0x444466, 0x222233));
const hero = new THREE.Mesh(
  new THREE.BoxGeometry(1, 2, 1),
  new THREE.MeshBasicMaterial({ color: 0xc08040, wireframe: true }),
);
hero.position.y = 1;
scene.add(hero);

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

renderer.setAnimationLoop((t) => {
  hero.rotation.y = t / 1000;
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

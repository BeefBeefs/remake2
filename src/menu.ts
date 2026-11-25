import { QUESTS } from './quests';
import { music } from './audio/music';

/** Main menu shown after the title splash: New game / Continue / Quest select / Controls / Viewer. */
export interface MenuHooks {
  /** start play mode on `stage` with hero `hero` (0-15) */
  start(stage: number, hero: number): void;
  /** leave play mode (if active) and return to the viewer scene */
  stop(): void;
  isPlaying(): boolean;
  /** show or hide the developer panel (model / stage / sound viewer) */
  viewer(show: boolean): void;
}

const HERO_KEY = 'bb_hero';

export function initMenu(hooks: MenuHooks): void {
  const css = document.createElement('style');
  css.textContent = `
    #mainmenu { position: fixed; inset: 0; z-index: 9; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
      background: radial-gradient(ellipse at center, #1a2250cc, #05050acc); color: #e8e4d0; font: 16px monospace; text-align: center; }
    #mainmenu h1 { margin: 0 0 8px; font: bold 34px Georgia, serif; letter-spacing: 2px; color: #ffd24a; text-shadow: 0 2px 6px #000; }
    #mainmenu h1 small { display: block; font-size: 16px; color: #cfd6ff; letter-spacing: 6px; }
    #mainmenu button, #mainmenu select { font: inherit; min-width: 260px; padding: 9px 14px; background: #121a40; color: #fff; border: 2px solid #8ea0ff; border-radius: 6px; cursor: pointer; }
    #mainmenu button:hover:not(:disabled) { background: #27337a; }
    #mainmenu button:disabled { opacity: .4; cursor: default; }
    #mainmenu .row { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; }
    #mainmenu pre { margin: 0; padding: 12px 16px; background: #000b; border: 1px solid #556; text-align: left; font-size: 13px; white-space: pre-wrap; max-width: 90vw; }
    #menubtn { position: fixed; top: 8px; right: 8px; z-index: 6; display: none; font: 14px monospace; padding: 6px 10px; background: #000a; color: #fff; border: 1px solid #889; border-radius: 4px; cursor: pointer; }
  `;
  document.head.append(css);

  const root = document.createElement('div');
  root.id = 'mainmenu';
  const btn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = fn;
    return b;
  };
  const heroSel = document.createElement('select');
  for (let i = 0; i < 16; i++) heroSel.add(new Option(`hero ${i}`, String(i)));
  fetch('assets/heroes/classes.json')
    .then((r) => r.json() as Promise<{ hero: number; class: string; weapon: string }[]>)
    .then((cl) => cl.forEach((c) => { heroSel.options[c.hero].text = `${c.class} (${c.weapon})`; }))
    .catch(() => undefined);
  const saved = (() => { try { return localStorage.getItem(HERO_KEY); } catch { return null; } })();
  if (saved !== null && Number(saved) >= 0 && Number(saved) < 16) heroSel.value = saved;
  const hasSave = (() => { try { return localStorage.getItem('bb_prog') !== null; } catch { return false; } })();

  const go = (stage: number): void => {
    try { localStorage.setItem(HERO_KEY, heroSel.value); } catch { /* ignore */ }
    root.style.display = 'none';
    menuBtn.style.display = 'block';
    hooks.start(stage, Number(heroSel.value));
  };
  const questSel = document.createElement('select');
  let first = 0;
  const firsts: number[] = [];
  QUESTS.forEach((q, i) => { firsts.push(first); questSel.add(new Option(`${i}: ${q.name}`, String(i))); first += q.areas; });

  const controls = document.createElement('pre');
  controls.style.display = 'none';
  controls.textContent = 'WASD / arrows  move      Q E  turn camera      + / -  zoom      PgUp / PgDn  look up / down      T  top view\nSpace / J  attack     K  attack 2     L  jump     G  guard     C  cast spell     Z  next spell\nP  potion     B  buy potion (30 gold)     R / Enter  retry after dying     ?  help     Esc  back to this menu\nTouch: left half of the screen = stick, right half = camera, buttons at the bottom.';

  const h1 = document.createElement('h1');
  h1.innerHTML = 'Blaze &amp; Blade<small>ETERNAL QUEST – WEB REMAKE</small>';
  const hero = document.createElement('div');
  hero.className = 'row';
  hero.append('Hero:', heroSel);
  const quest = document.createElement('div');
  quest.className = 'row';
  quest.append(btn('Start quest', () => go(firsts[Number(questSel.value)] ?? 0)), questSel);
  const cont = btn('Continue (keeps level, xp, gold)', () => go(0));
  cont.disabled = !hasSave;
  const viewerBtn = btn('Model / stage viewer', () => { root.style.display = 'none'; menuBtn.style.display = 'block'; hooks.viewer(true); });
  // Original full-motion videos (Indeo 4 AVI on the disc, re-encoded to MP4): publisher logos and the ending with the credits.
  const movie = (label: string, file: string): HTMLButtonElement => btn(label, () => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:20;background:#000;display:flex;align-items:center;justify-content:center;';
    const v = document.createElement('video');
    v.src = `assets/movies/${file}`;
    v.autoplay = true;
    v.controls = true;
    v.style.cssText = 'max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain;image-rendering:pixelated;';
    music.stop();
    const close = (): void => { v.pause(); ov.remove(); removeEventListener('keydown', onKey, true); music.play('menu'); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    addEventListener('keydown', onKey, true);
    v.onended = close;
    const x = btn('✕', close);
    x.style.cssText = 'position:absolute;top:8px;right:8px;z-index:21;font:16px monospace;padding:6px 10px;';
    ov.append(v, x);
    document.body.append(ov);
  });
  const musicBtn = btn('', () => { musicBtn.textContent = music.toggleMute() ? 'Music: off (M)' : 'Music: on (M)'; });
  musicBtn.textContent = music.muted ? 'Music: off (M)' : 'Music: on (M)';
  addEventListener('keydown', (e) => { if ((e.key === 'm' || e.key === 'M') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLSelectElement)) musicBtn.click(); });
  const movies = document.createElement('div');
  movies.className = 'row';
  movies.append('Movies:', movie('Publisher logos', 'teps.mp4'), movie('Ending & credits', 'ending.mp4'));
  root.append(
    h1,
    hero,
    btn('New game – the Roadside Inn', () => { try { localStorage.removeItem('bb_prog'); } catch { /* ignore */ } go(0); }),
    cont,
    quest,
    btn('Controls', () => { controls.style.display = controls.style.display === 'none' ? 'block' : 'none'; }),
    controls,
    viewerBtn,
    movies,
    musicBtn,
  );
  document.body.append(root);

  const menuBtn = btn('☰ Menu', () => back());
  menuBtn.id = 'menubtn';
  document.body.append(menuBtn);
  const back = (): void => {
    if (hooks.isPlaying()) hooks.stop();
    hooks.viewer(false);
    menuBtn.style.display = 'none';
    root.style.display = 'flex';
    music.play('menu');
    cont.disabled = (() => { try { return localStorage.getItem('bb_prog') === null; } catch { return true; } })();
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.style.display === 'none') back();
  });
  hooks.viewer(false);
}

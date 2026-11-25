/**
 * Background music: the disc's Music/*.WAV (MS-ADPCM 22.05 kHz stereo) re-encoded to AAC by tools/convert_music.sh (public/assets/music).
 * File names come from Blaze.exe (//Music/Mel<quest>_<n>.WAV, Bos<quest>_01, Menu, Title01, GameOver, End01). Which track belongs to which
 * area is NOT known: the area -> track rule in `areaTrack` is a guess (see PROGRESS.md, Step BG).
 */
const KEY = 'bb_music_mute';

class Music {
  private names: string[] | null = null;
  private audio: HTMLAudioElement | null = null;
  private current = '';
  private pending: { name: string; loop: boolean } | null = null;
  volume = 0.6;
  muted = (() => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } })();

  constructor() {
    fetch('assets/music/index.json')
      .then((r) => r.json() as Promise<string[]>)
      .then((n) => { this.names = n; if (this.pending) { const p = this.pending; this.pending = null; this.play(p.name, p.loop); } })
      .catch(() => { this.names = []; });
    // browsers refuse to start audio before a user gesture: retry a refused track on the first one
    const retry = (): void => { if (this.pending && this.names) { const p = this.pending; this.pending = null; this.play(p.name, p.loop); } };
    addEventListener('pointerdown', retry, true);
    addEventListener('keydown', retry, true);
  }

  /** Track for an area of a quest: the quest's numbered melodies are shared out over its areas in order; the last area of a dungeon plays the boss theme. */
  areaTrack(quest: number, area: number, areas: number): string {
    const names = this.names ?? [];
    const q = String(quest).padStart(2, '0');
    if (quest >= 1 && areas > 1 && area === areas - 1 && names.includes(`bos${q}_01`)) return `bos${q}_01`;
    const mel = names.filter((n) => new RegExp(`^mel${q}_\\d+$`).test(n)).sort();
    if (!mel.length) return '';
    if (quest === 0) return mel[area === 0 ? 0 : 1 + ((area - 1) % Math.max(1, mel.length - 1))];
    return mel[Math.min(mel.length - 1, Math.floor((area * mel.length) / Math.max(1, areas)))];
  }

  playArea(quest: number, area: number, areas: number): void {
    const n = this.areaTrack(quest, area, areas);
    if (n) this.play(n);
  }

  play(name: string, loop = true): void {
    if (this.current === name && this.audio && !this.audio.paused) return;
    if (!this.names) { this.pending = { name, loop }; return; }
    if (!this.names.includes(name)) return;
    this.stop();
    const a = new Audio(`assets/music/${name}.m4a`);
    a.loop = loop;
    a.volume = this.muted ? 0 : this.volume;
    this.audio = a;
    this.current = name;
    a.play().catch(() => { this.pending = { name, loop }; this.audio = null; this.current = ''; });
  }

  stop(): void {
    this.pending = null;
    if (this.audio) { this.audio.pause(); this.audio = null; }
    this.current = '';
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(KEY, this.muted ? '1' : '0'); } catch { /* ignore */ }
    if (this.audio) this.audio.volume = this.muted ? 0 : this.volume;
    return this.muted;
  }
}

export const music = new Music();

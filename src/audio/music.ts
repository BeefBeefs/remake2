/**
 * Background music: the disc's Music/*.WAV (MS-ADPCM 22.05 kHz stereo) re-encoded to AAC by tools/convert_music.sh (public/assets/music).
 * File names come from Blaze.exe (//Music/Mel<quest>_<n>.WAV, Bos<quest>_01, Menu, Title01, GameOver, End01). Which track belongs to which
 * Which track belongs to which area is real data: byte 0 of the entries in each area module's header slot 25 (tools/export_music.py, PROGRESS.md Step BI).
 */
const KEY = 'bb_music_mute';

class Music {
  private names: string[] | null = null;
  private areas: Record<string, string[]> | null = null;
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
    fetch('assets/music/areas.json').then((r) => r.json() as Promise<Record<string, string[]>>).then((a) => { this.areas = a; }).catch(() => { this.areas = {}; });
    // browsers refuse to start audio before a user gesture: retry a refused track on the first one
    const retry = (): void => { if (this.pending && this.names) { const p = this.pending; this.pending = null; this.play(p.name, p.loop); } };
    addEventListener('pointerdown', retry, true);
    addEventListener('keydown', retry, true);
  }

  /** Real tracks of an area (tools/export_music.py, from the area module's script table): one name per table entry, entry 0 = the area's normal theme. */
  areaTracks(quest: number, area: number): { main: string; boss: string } {
    const l = this.areas?.[`${quest}_${area}`] ?? [];
    const main = l.find((n) => n.startsWith('mel')) ?? l[0] ?? '';
    return { main, boss: l.find((n) => n.startsWith('bos')) ?? '' };
  }

  playArea(quest: number, area: number): void {
    const n = this.areaTracks(quest, area).main;
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

import type { SndBanks, ClipInfo } from './sndBank';

/**
 * Sound effects for play mode. The meaning of the clips in the original Snd banks is NOT known (the banks are plain 8-bit PCM without names),
 * so the defaults below are guesses made from simple clip statistics (length, noisiness, attack). The sound browser on the main page can
 * reassign any slot to the clip you are listening to; assignments are stored in localStorage and win over the defaults.
 */
export const SFX_SLOTS = ['swing', 'hit', 'hurt', 'enemyDie', 'heroDie', 'jump', 'door', 'talk'] as const;
export type SfxSlot = (typeof SFX_SLOTS)[number];

const DEFAULTS: Record<SfxSlot, { bank: string; index: number }> = {
  swing: { bank: 'Base', index: 7 },
  hit: { bank: 'Base', index: 29 },
  hurt: { bank: 'Base', index: 11 },
  enemyDie: { bank: 'Base', index: 31 },
  heroDie: { bank: 'Base', index: 32 },
  jump: { bank: 'Base', index: 2 },
  door: { bank: 'Base', index: 38 },
  talk: { bank: 'Base', index: 1 },
};

const KEY = 'bb_sfx';

export class Sfx {
  private map: Record<SfxSlot, { bank: string; index: number }>;
  muted = false;

  constructor(private snd: SndBanks) {
    this.map = { ...DEFAULTS };
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<typeof DEFAULTS>;
      for (const s of SFX_SLOTS) if (saved[s]) this.map[s] = saved[s]!;
    } catch { /* storage unavailable: keep defaults */ }
  }

  assign(slot: SfxSlot, clip: ClipInfo): void {
    this.map[slot] = { bank: clip.bank, index: clip.index };
    try { localStorage.setItem(KEY, JSON.stringify(this.map)); } catch { /* ignore */ }
  }

  describe(slot: SfxSlot): string {
    const m = this.map[slot];
    return `${m.bank} #${m.index}`;
  }

  play(slot: SfxSlot, volume = 0.6): void {
    if (this.muted) return;
    const m = this.map[slot];
    const clip = this.snd.manifest.clips.find((c) => c.bank === m.bank && c.index === m.index);
    if (clip) void this.snd.play(clip, volume).catch(() => { /* audio blocked until a user gesture */ });
  }
}

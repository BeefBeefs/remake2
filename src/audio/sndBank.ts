/** Loader for WAV clips extracted from the original Snd/*.snd banks (see tools/extract_snd.py). */

export interface ClipInfo {
  file: string;
  bank: string;
  index: number;
  bytes: number;
  seconds: number;
}

export interface SndManifest {
  sampleRate: number;
  clips: ClipInfo[];
}

export class SndBanks {
  private ctx: AudioContext | null = null;
  private cache = new Map<string, AudioBuffer>();

  constructor(private baseUrl: string, readonly manifest: SndManifest) {}

  static async load(baseUrl = './assets/snd/'): Promise<SndBanks> {
    const res = await fetch(baseUrl + 'manifest.json');
    if (!res.ok) throw new Error(`manifest.json: HTTP ${res.status}`);
    return new SndBanks(baseUrl, (await res.json()) as SndManifest);
  }

  banks(): string[] {
    return [...new Set(this.manifest.clips.map((c) => c.bank))];
  }

  clips(bank: string): ClipInfo[] {
    return this.manifest.clips.filter((c) => c.bank === bank);
  }

  async play(clip: ClipInfo, volume = 1): Promise<void> {
    // AudioContext must be created/resumed from a user gesture.
    this.ctx ??= new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    let buf = this.cache.get(clip.file);
    if (!buf) {
      const data = await (await fetch(this.baseUrl + clip.file)).arrayBuffer();
      buf = await this.ctx.decodeAudioData(data);
      this.cache.set(clip.file, buf);
    }
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.buffer = buf;
    src.connect(gain).connect(this.ctx.destination);
    src.start();
  }
}

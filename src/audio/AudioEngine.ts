// Procedural chiptune audio: synthesized looping BGM + SFX via the Web Audio
// API (no audio files). A lookahead scheduler queues notes; volumes are split
// between music and SFX and persisted. AudioContext starts suspended per
// browser autoplay rules and is resumed on the first user gesture via unlock().

const STORE_KEY = "arsandi-audio";

type Wave = OscillatorType;
type Track = { bpm: number; lead: (number | null)[]; bass: (number | null)[]; wave?: Wave };

// Semitone offsets from A4 (440 Hz); null = rest. 8th-note steps, looped.
const TRACKS: Record<string, Track> = {
  title: {
    bpm: 86,
    wave: "triangle",
    lead: [4, null, 11, null, 9, null, 7, null, 4, null, 7, null, 9, 11, 12, null],
    bass: [-8, null, -8, null, -3, null, -3, null, -10, null, -10, null, -5, null, -5, null],
  },
  town: {
    bpm: 100,
    wave: "triangle",
    lead: [0, 4, 7, 4, 5, 9, 5, 2, 0, 4, 7, 9, 7, 4, 2, 0],
    bass: [-12, null, -5, null, -10, null, -3, null, -12, null, -5, null, -7, null, -7, null],
  },
  field: {
    bpm: 120,
    wave: "square",
    lead: [0, 3, 7, 10, 7, 3, 5, 8, 3, 7, 10, 12, 10, 7, 3, 0],
    bass: [-12, -12, -7, -7, -9, -9, -5, -5, -12, -12, -7, -7, -8, -8, -5, -5],
  },
  battle: {
    bpm: 150,
    wave: "square",
    lead: [0, 0, 12, 7, 0, 0, 10, 6, 0, 0, 12, 7, 3, 6, 7, 10],
    bass: [-12, -12, -12, -7, -10, -10, -10, -5, -12, -12, -12, -7, -8, -8, -7, -5],
  },
};

interface Sfx {
  freq: number;
  to?: number; // pitch slide target
  dur: number;
  wave: Wave;
  vol?: number;
}
const SFX: Record<string, Sfx | Sfx[]> = {
  move: { freq: 440, dur: 0.05, wave: "square", vol: 0.4 },
  confirm: { freq: 660, to: 990, dur: 0.12, wave: "square" },
  cancel: { freq: 400, to: 220, dur: 0.12, wave: "square", vol: 0.5 },
  hit: { freq: 180, to: 90, dur: 0.12, wave: "sawtooth" },
  crit: [
    { freq: 200, to: 110, dur: 0.1, wave: "sawtooth" },
    { freq: 880, to: 1320, dur: 0.14, wave: "square" },
  ],
  heal: { freq: 520, to: 880, dur: 0.22, wave: "triangle" },
  levelup: [
    { freq: 523, dur: 0.1, wave: "square" },
    { freq: 659, dur: 0.1, wave: "square" },
    { freq: 784, dur: 0.1, wave: "square" },
    { freq: 1047, dur: 0.2, wave: "square" },
  ],
  chest: [
    { freq: 784, dur: 0.09, wave: "triangle" },
    { freq: 1047, dur: 0.18, wave: "triangle" },
  ],
  buy: { freq: 880, to: 1100, dur: 0.1, wave: "square", vol: 0.5 },
  victory: [
    { freq: 523, dur: 0.12, wave: "square" },
    { freq: 659, dur: 0.12, wave: "square" },
    { freq: 784, dur: 0.12, wave: "square" },
    { freq: 1047, dur: 0.3, wave: "square" },
  ],
  defeat: [
    { freq: 392, to: 330, dur: 0.25, wave: "sawtooth", vol: 0.6 },
    { freq: 262, to: 196, dur: 0.4, wave: "sawtooth", vol: 0.6 },
  ],
  // summon: a rising heroic flourish leading into the cinematic
  summon: [
    { freq: 131, to: 196, dur: 0.18, wave: "sawtooth", vol: 0.6 },
    { freq: 196, to: 262, dur: 0.16, wave: "square", vol: 0.5 },
    { freq: 330, dur: 0.12, wave: "square", vol: 0.5 },
    { freq: 440, dur: 0.12, wave: "square", vol: 0.5 },
    { freq: 587, to: 880, dur: 0.4, wave: "square", vol: 0.55 },
  ],
  // boom: the ultimate's impact — a deep thud with a bright crack on top
  boom: [
    { freq: 90, to: 40, dur: 0.35, wave: "sawtooth", vol: 0.7 },
    { freq: 1320, to: 660, dur: 0.18, wave: "square", vol: 0.4 },
  ],
};

const noteFreq = (semi: number) => 440 * Math.pow(2, semi / 12);

class AudioEngine {
  musicVol = 0.45;
  sfxVol = 0.6;

  private ctx?: AudioContext;
  private master?: GainNode;
  private musicGain?: GainNode;
  private sfxGain?: GainNode;

  private track: Track | null = null;
  private trackName = "";
  private step = 0;
  private nextNoteTime = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (typeof d.music === "number") this.musicVol = d.music;
        if (typeof d.sfx === "number") this.sfxVol = d.sfx;
      }
    } catch {
      /* defaults */
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ music: this.musicVol, sfx: this.sfxVol }));
    } catch {
      /* ignore */
    }
  }

  // Resume/create the context on a user gesture (required by browsers).
  unlock(): void {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  private init(): void {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVol;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVol;
    this.sfxGain.connect(this.master);

    setInterval(() => this.scheduler(), 30);
  }

  setMusicVolume(v: number): void {
    this.musicVol = Math.max(0, Math.min(1, v));
    if (this.musicGain) this.musicGain.gain.value = this.musicVol;
    this.persist();
  }

  setSfxVolume(v: number): void {
    this.sfxVol = Math.max(0, Math.min(1, v));
    if (this.sfxGain) this.sfxGain.gain.value = this.sfxVol;
    this.persist();
  }

  playMusic(name: string): void {
    if (this.trackName === name) return;
    this.trackName = name;
    this.track = TRACKS[name] ?? null;
    this.step = 0;
    if (this.ctx) this.nextNoteTime = this.ctx.currentTime + 0.05;
  }

  stopMusic(): void {
    this.trackName = "";
    this.track = null;
  }

  playSfx(name: string): void {
    if (!this.ctx || !this.sfxGain || this.ctx.state !== "running") return;
    const def = SFX[name];
    if (!def) return;
    const notes = Array.isArray(def) ? def : [def];
    let t = this.ctx.currentTime;
    for (const n of notes) {
      this.blip(n, t, this.sfxGain);
      t += n.dur;
    }
  }

  private blip(n: Sfx, t: number, dest: GainNode): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = n.wave;
    osc.frequency.setValueAtTime(n.freq, t);
    if (n.to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.to), t + n.dur);
    const g = ctx.createGain();
    const peak = n.vol ?? 0.7;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + n.dur + 0.03);
  }

  // Lookahead scheduler — queues the next bars of the current track.
  private scheduler(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || !this.track || !this.musicGain) return;
    const spb = 60 / this.track.bpm / 2; // seconds per 8th-note step
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const i = this.step % this.track.lead.length;
      const lead = this.track.lead[i];
      const bass = this.track.bass[i % this.track.bass.length];
      if (lead !== null && lead !== undefined) {
        this.blip({ freq: noteFreq(lead + 12), dur: spb * 0.9, wave: this.track.wave ?? "square", vol: 0.35 }, this.nextNoteTime, this.musicGain);
      }
      if (bass !== null && bass !== undefined) {
        this.blip({ freq: noteFreq(bass), dur: spb * 0.95, wave: "triangle", vol: 0.45 }, this.nextNoteTime, this.musicGain);
      }
      this.nextNoteTime += spb;
      this.step += 1;
    }
  }
}

export const audio = new AudioEngine();

/**
 * Procedural sound effects and music (Web Audio API). Nothing is downloaded, so there are no
 * asset licences to worry about. Browsers only allow audio after a user gesture, so the
 * context is created on the first click or key press.
 */
import { loadSettings, onSettings, type Settings } from "./settings";

export type Sfx =
  | "gather"
  | "deliver"
  | "beacon"
  | "kill"
  | "body"
  | "bell"
  | "vote"
  | "good"
  | "bad"
  | "win"
  | "lose"
  | "chat"
  | "click"
  | "shield"
  | "error";

type Mood = "explore" | "meeting" | null;

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12); // MIDI note -> Hz

class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private settings: Settings = loadSettings();
  private mood: Mood = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private lastChat = 0;

  constructor() {
    if (typeof window === "undefined") return;
    const unlock = () => this.ensure();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    onSettings((s) => {
      this.settings = s;
      this.applyVolumes();
    });
  }

  private ensure(): AudioContext | null {
    if (this.ctx || typeof window === "undefined") return this.ctx;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.sfxGain = ctx.createGain();
    this.musicGain = ctx.createGain();
    this.sfxGain.connect(ctx.destination);
    this.musicGain.connect(ctx.destination);
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    if (this.mood) this.startLoop();
    return ctx;
  }

  private applyVolumes(): void {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.settings.sfx * 0.5, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.settings.music * 0.18, t, 0.2);
  }

  /** One enveloped oscillator note. */
  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, out: GainNode, slideTo?: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(g).connect(out);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private hiss(start: number, dur: number, vol: number, from: number, to: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.setValueAtTime(from, start);
    f.frequency.exponentialRampToValueAtTime(to, start + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(f).connect(g).connect(this.sfxGain!);
    src.start(start);
    src.stop(start + dur);
  }

  play(name: Sfx): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxGain || this.settings.sfx <= 0) return;
    const t = ctx.currentTime + 0.01;
    const out = this.sfxGain;
    switch (name) {
      case "gather":
        this.tone(660, t, 0.12, "triangle", 0.5, out, 440);
        break;
      case "deliver":
        this.tone(988, t, 0.08, "square", 0.25, out);
        this.tone(1319, t + 0.08, 0.18, "square", 0.25, out);
        break;
      case "beacon":
        this.hiss(t, 0.5, 0.35, 300, 2400);
        [523, 659, 784].forEach((f, i) => this.tone(f, t + 0.1 + i * 0.07, 0.4, "sine", 0.3, out));
        break;
      case "kill":
        this.tone(220, t, 0.35, "sawtooth", 0.45, out, 55);
        this.hiss(t, 0.18, 0.5, 4000, 800);
        break;
      case "body":
        for (let i = 0; i < 3; i++) {
          this.tone(880, t + i * 0.26, 0.12, "square", 0.3, out);
          this.tone(660, t + i * 0.26 + 0.13, 0.12, "square", 0.3, out);
        }
        break;
      case "bell":
        [523, 1046, 1568].forEach((f, i) => this.tone(f, t, 1.6 - i * 0.4, "sine", 0.4 / (i + 1), out));
        break;
      case "vote":
      case "click":
        this.tone(name === "vote" ? 1200 : 900, t, 0.05, "square", 0.15, out);
        break;
      case "good":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.09, 0.25, "triangle", 0.35, out));
        break;
      case "bad":
        [392, 330, 262].forEach((f, i) => this.tone(f, t + i * 0.14, 0.3, "triangle", 0.35, out));
        break;
      case "win":
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.12, 0.3, "square", 0.22, out));
        break;
      case "lose":
        [392, 370, 349, 262].forEach((f, i) => this.tone(f, t + i * 0.22, 0.4, "triangle", 0.35, out));
        break;
      case "chat": {
        const now = performance.now();
        if (now - this.lastChat < 250) return;
        this.lastChat = now;
        this.tone(1500, t, 0.05, "sine", 0.08, out);
        break;
      }
      case "shield":
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, t + i * 0.04, 0.5, "sine", 0.2, out));
        break;
      case "error":
        this.tone(180, t, 0.15, "square", 0.2, out);
        break;
    }
  }

  /** Background music: a short generated loop per mood (calm exploring, tense meetings). */
  setMood(mood: Mood): void {
    if (mood === this.mood) return;
    this.mood = mood;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (mood && this.ensure()) this.startLoop();
  }

  private startLoop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || this.timer) return;
    this.step = 0;
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 100);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.mood) return;
    const meeting = this.mood === "meeting";
    const beat = meeting ? 0.5 : 0.34; // seconds per step
    // Pentatonic (explore) / minor (meeting) phrases over a looping bass line.
    const lead = meeting
      ? [57, null, 60, null, 59, null, 55, null, 57, null, 52, null, 53, null, 55, null]
      : [72, 74, 76, null, 79, 76, 74, null, 72, 69, 72, null, 74, 76, 72, null];
    const bass = meeting ? [45, 45, 41, 43] : [48, 45, 41, 43];
    while (this.nextTime < ctx.currentTime + 0.4) {
      const i = this.step % lead.length;
      const n = lead[i];
      if (n != null && this.settings.music > 0) this.tone(NOTE(n), this.nextTime, beat * 0.9, meeting ? "sine" : "triangle", 0.5, this.musicGain);
      if (i % 4 === 0 && this.settings.music > 0) {
        this.tone(NOTE(bass[(i / 4) % bass.length]!), this.nextTime, beat * 3.6, "sine", 0.7, this.musicGain);
      }
      this.nextTime += beat;
      this.step++;
    }
  }
}

let engine: AudioEngine | null = null;

/** Shared engine (created lazily in the browser). */
export function audio(): AudioEngine {
  if (!engine) engine = new AudioEngine();
  return engine;
}

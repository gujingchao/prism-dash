/**
 * Every sound is synthesised at runtime with WebAudio — no audio files, so the bundle stays tiny
 * and nothing is fetched. Includes a small look-ahead step sequencer for the background track.
 */
export class AudioEngine {
  private ctx?: AudioContext;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private enabled = true;
  private musicTimer = 0;
  private nextStep = 0;
  private step = 0;
  private readonly bpm = 128;

  /** Must run inside a user gesture the first time (browser autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.8 : 0;
      this.master.connect(this.ctx.destination);
      this.music = this.ctx.createGain();
      this.music.gain.value = 0.32;
      this.music.connect(this.master);
      this.sfx = this.ctx.createGain();
      this.sfx.gain.value = 0.6;
      this.sfx.connect(this.master);
      this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ------------------------------------------------------------------ SFX

  jump(): void {
    this.tone(320, 0.16, 'square', 0.18, 0, 720);
  }

  lane(dir: number): void {
    this.tone(dir < 0 ? 520 : 600, 0.05, 'triangle', 0.12);
  }

  land(): void {
    this.hit(0.05, 900, 0.12);
  }

  gem(combo: number): void {
    // Pentatonic climb with combo.
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const f = 880 * Math.pow(2, scale[Math.min(combo, scale.length) - 1] / 12);
    this.tone(f, 0.12, 'sine', 0.22);
    this.tone(f * 2, 0.08, 'triangle', 0.08, 0.04);
  }

  nearMiss(): void {
    this.tone(1200, 0.18, 'sawtooth', 0.06, 0, 300);
  }

  shield(): void {
    [0, 4, 7, 12].forEach((s, i) => this.tone(440 * Math.pow(2, s / 12), 0.15, 'square', 0.1, i * 0.05));
  }

  shieldBreak(): void {
    this.hit(0.35, 2500, 0.35);
    this.tone(300, 0.3, 'sawtooth', 0.15, 0, 80);
  }

  crash(): void {
    this.hit(0.7, 1400, 0.55);
    this.tone(160, 0.6, 'sawtooth', 0.3, 0, 30);
  }

  milestone(): void {
    [0, 7, 12, 19].forEach((s, i) => this.tone(523 * Math.pow(2, s / 12), 0.2, 'triangle', 0.14, i * 0.07));
  }

  click(): void {
    this.tone(700, 0.05, 'square', 0.08);
  }

  // ------------------------------------------------------------------ music

  startMusic(): void {
    if (!this.ctx || this.musicTimer) return;
    this.step = 0;
    this.nextStep = this.ctx.currentTime + 0.08;
    this.music.gain.cancelScheduledValues(this.ctx.currentTime);
    this.music.gain.setValueAtTime(0.32, this.ctx.currentTime);
    // setInterval only schedules ahead; actual timing comes from the audio clock.
    this.musicTimer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(fade = 0.4): void {
    if (!this.ctx || !this.musicTimer) return;
    clearInterval(this.musicTimer);
    this.musicTimer = 0;
    const t = this.ctx.currentTime;
    this.music.gain.setTargetAtTime(0, t, fade / 3);
    this.music.gain.setValueAtTime(0.32, t + fade + 0.3);
  }

  private schedule(): void {
    const ctx = this.ctx!;
    const stepDur = 60 / this.bpm / 4; // 16th notes
    // Am – F – C – G, one bar each.
    const roots = [45, 41, 48, 43];
    while (this.nextStep < ctx.currentTime + 0.12) {
      const t = this.nextStep;
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16) % 4;
      const root = roots[bar];

      if (s % 4 === 0) this.kick(t);
      if (s % 4 === 2) this.hat(t, 0.05);
      if (s === 4 || s === 12) this.hit(0.12, 1800, 0.12, t);
      const bassNote = root + ([0, 12, 0, 12, 7, 12, 0, 10][s % 8]);
      if (s % 2 === 0) this.voice(midi(bassNote - 12), stepDur * 1.6, 'sawtooth', 0.16, t, this.music, 900);
      if (s % 3 === 0) this.voice(midi(root + 24 + [0, 3, 7, 10, 12][(this.step / 3) % 5 | 0]), stepDur * 0.9, 'square', 0.035, t, this.music, 3000);

      this.nextStep += stepDur;
      this.step++;
    }
  }

  // ------------------------------------------------------------------ synthesis primitives

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number): void {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private voice(freq: number, dur: number, type: OscillatorType, gain: number, t: number, out: AudioNode, cutoff: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(cutoff * 0.3, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filter).connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private kick(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    osc.connect(g).connect(this.music);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  private hat(t: number, dur: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp).connect(g).connect(this.music);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur);
  }

  /** Filtered noise burst (snare / impact). */
  private hit(dur: number, cutoff: number, gain: number, at?: number): void {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = at ?? ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(100, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(lp).connect(g).connect(at !== undefined ? this.music : this.sfx);
    src.start(t, Math.random() * 0.3);
    src.stop(t + dur);
  }
}

const midi = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

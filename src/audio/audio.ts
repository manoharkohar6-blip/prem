import { clamp } from '../game/vec';
import type { ThemeId } from '../game/types';

/**
 * Every sound in the game is synthesised at runtime, so the build stays
 * asset-free: whispers, footsteps, bells, stingers and the heartbeat all come
 * out of the same small WebAudio graph with a procedural reverb tail.
 */
export class HorrorAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private wet!: GainNode;
  private reverb!: ConvolverNode;
  private noiseBuffer!: AudioBuffer;
  private droneGain!: GainNode;
  private windGain!: GainNode;
  private rumbleGain!: GainNode;
  private droneOscs: OscillatorNode[] = [];
  private theme: ThemeId = 'basement';
  private beatTimer = 0;
  private whisperTimer = 5;
  private muted = false;

  get ready(): boolean {
    return this.ctx !== null;
  }

  async unlock(): Promise<void> {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.dry.connect(this.master);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.1, 2.6);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.noiseBuffer = this.noise(2.4);

    // Low asylum drone: two detuned sines under a heavy low-pass.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.075;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 240;
    droneFilter.Q.value = 2;
    this.droneGain.connect(droneFilter);
    droneFilter.connect(this.dry);
    droneFilter.connect(this.reverb);

    for (const [freq, detune] of [
      [41.5, -6],
      [55, 7],
      [82.5, -3],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      const gain = ctx.createGain();
      gain.gain.value = freq > 80 ? 0.18 : 0.5;
      osc.connect(gain);
      gain.connect(this.droneGain);
      osc.start();
      this.droneOscs.push(osc);
    }

    // Wind bed for the roof, quiet everywhere else.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.02;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.frequency.value = 520;
    windFilter.Q.value = 0.7;
    const windSource = ctx.createBufferSource();
    windSource.buffer = this.noiseBuffer;
    windSource.loop = true;
    windSource.connect(windFilter);
    windFilter.connect(this.windGain);
    this.windGain.connect(this.dry);
    this.windGain.connect(this.reverb);
    windSource.start();

    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 29;
    rumble.connect(this.rumbleGain);
    this.rumbleGain.connect(this.dry);
    rumble.start();
  }

  setTheme(theme: ThemeId): void {
    this.theme = theme;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const wind = theme === 'clocktower' ? 0.16 : theme === 'chapel' ? 0.06 : 0.025;
    this.windGain.gain.cancelScheduledValues(now);
    this.windGain.gain.linearRampToValueAtTime(wind, now + 2.5);
    const drone = theme === 'chapel' ? 0.1 : theme === 'mortuary' ? 0.06 : 0.075;
    this.droneGain.gain.linearRampToValueAtTime(drone, now + 2.5);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.linearRampToValueAtTime(muted ? 0 : 0.9, this.ctx.currentTime + 0.2);
  }

  get isMuted(): boolean {
    return this.muted;
  }

  update(dt: number, threat: number, hunterDistance: number): void {
    if (!this.ctx) return;
    this.beatTimer -= dt;
    const interval = 1.15 - clamp(threat, 0, 1) * 0.8;
    if (this.beatTimer <= 0) {
      this.beatTimer = interval;
      const loudness = 0.1 + clamp(threat, 0, 1) * 0.42;
      this.thump(0, loudness);
      this.thump(0.17, loudness * 0.65);
    }

    this.whisperTimer -= dt;
    if (this.whisperTimer <= 0) {
      this.whisperTimer = 7 + Math.random() * 16;
      this.whisper(0.7 + Math.random() * 0.6);
    }

    const proximity = clamp(1 - hunterDistance / 16, 0, 1);
    this.rumbleGain.gain.linearRampToValueAtTime(proximity * 0.22, this.ctx.currentTime + 0.25);
  }

  footstep(intensity: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.8 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 340 + Math.random() * 380;
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    const peak = 0.05 + intensity * 0.16;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverb);
    source.start(now);
    source.stop(now + 0.2);
  }

  creak(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(58, now + 0.7);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 480;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.07, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.8);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 0.85);
  }

  bell(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    for (const [ratio, level, decay] of [
      [1, 0.11, 3.4],
      [2.76, 0.05, 2.2],
      [5.4, 0.03, 1.4],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 174 * ratio;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);
      osc.connect(gain);
      gain.connect(this.dry);
      gain.connect(this.reverb);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    }
  }

  stinger(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 900;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.35, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.dry);
    noiseGain.connect(this.reverb);
    noise.start(now);
    noise.stop(now + 1);

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(48, now + 0.85);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 0.95);
  }

  pickup(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.exponentialRampToValueAtTime(1180, now + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    osc.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverb);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  objective(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [330, 494].forEach((freq, index) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const start = now + index * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.1, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      osc.connect(gain);
      gain.connect(this.dry);
      gain.connect(this.reverb);
      osc.start(start);
      osc.stop(start + 1.2);
    });
  }

  trap(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.dry);
    gain.connect(this.reverb);
    source.start(now);
    source.stop(now + 0.4);
  }

  // ---------------------------------------------------------------- helpers

  private thump(delay: number, loudness: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(66, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(loudness, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain);
    gain.connect(this.dry);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  private whisper(pan: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.playbackRate.value = 0.6 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100 + Math.random() * 700, now);
    filter.frequency.linearRampToValueAtTime(700 + Math.random() * 900, now + 1.6);
    filter.Q.value = 7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.035, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.9);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan > 1 ? 0.6 : -0.6;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.dry);
    panner.connect(this.reverb);
    source.start(now);
    source.stop(now + 2);
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx as AudioContext;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }
}

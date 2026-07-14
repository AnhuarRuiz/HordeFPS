// Procedurally synthesized SFX via the Web Audio API — no asset files. Every
// sound is a short noise burst and/or oscillator sweep shaped with a gain
// envelope through a BiquadFilter.

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.55;
  masterGain.connect(ctx.destination);
  return ctx;
}

// Browsers block audio until a user gesture; call this from the first click.
export function unlockAudio() {
  const c = getContext();
  if (c && c.state === 'suspended') c.resume();
}

function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = c.sampleRate;
  noiseBuffer = c.createBuffer(1, length, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

interface NoiseOpts {
  duration: number;
  filterType?: BiquadFilterType;
  freq: number;
  q?: number;
  gainPeak?: number;
  attack?: number;
}

function noiseBurst(c: AudioContext, dest: AudioNode, opts: NoiseOpts) {
  const { duration, filterType = 'bandpass', freq, q = 1, gainPeak = 0.6, attack = 0.002 } = opts;
  const src = c.createBufferSource();
  src.buffer = getNoiseBuffer(c);
  const filter = c.createBiquadFilter();
  filter.type = filterType;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = c.createGain();
  const now = c.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(now);
  src.stop(now + duration + 0.02);
}

interface ToneOpts {
  freqStart: number;
  freqEnd?: number;
  type?: OscillatorType;
  duration: number;
  gainPeak?: number;
  attack?: number;
}

function tone(c: AudioContext, dest: AudioNode, opts: ToneOpts) {
  const { freqStart, freqEnd = freqStart, type = 'sine', duration, gainPeak = 0.4, attack = 0.002 } = opts;
  const osc = c.createOscillator();
  osc.type = type;
  const now = c.currentTime;
  osc.frequency.setValueAtTime(freqStart, now);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), now + duration);
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(gainPeak, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

// Simple linear falloff so distant zombies read quieter than nearby ones.
function distanceGain(distance: number): number {
  return Math.max(0, 1 - distance / 22);
}

export function playPistolShot() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.09, freq: 1600, q: 0.7, gainPeak: 0.5 });
  tone(c, masterGain, { freqStart: 180, freqEnd: 60, type: 'triangle', duration: 0.08, gainPeak: 0.35 });
}

export function playRifleShot() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.1, freq: 2200, q: 0.6, gainPeak: 0.6 });
  tone(c, masterGain, { freqStart: 140, freqEnd: 45, type: 'sawtooth', duration: 0.09, gainPeak: 0.4 });
}

export function playDryFire() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.03, freq: 3000, q: 2, gainPeak: 0.2, attack: 0.001 });
}

export function playReloadClick() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.04, freq: 2400, q: 3, gainPeak: 0.3, attack: 0.001 });
}

export function playKnifeSwing() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.12, filterType: 'highpass', freq: 800, q: 0.5, gainPeak: 0.25 });
}

export function playKnifeHit() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.08, freq: 500, q: 1, gainPeak: 0.5 });
}

export function playZombieGroan(distance: number) {
  const c = getContext();
  if (!c || !masterGain) return;
  const g = distanceGain(distance);
  if (g < 0.08) return;
  const gain = c.createGain();
  gain.gain.value = g;
  gain.connect(masterGain);
  const pitch = 70 + Math.random() * 50;
  tone(c, gain, { freqStart: pitch, freqEnd: pitch * 0.7, type: 'sawtooth', duration: 0.5 + Math.random() * 0.3, gainPeak: 0.35 });
}

export function playZombieHit(distance: number, headshot: boolean) {
  const c = getContext();
  if (!c || !masterGain) return;
  const g = distanceGain(distance);
  if (g < 0.05) return;
  const gain = c.createGain();
  gain.gain.value = g;
  gain.connect(masterGain);
  noiseBurst(c, gain, { duration: headshot ? 0.14 : 0.1, freq: headshot ? 900 : 400, q: 0.8, gainPeak: 0.6 });
}

export function playZombieDeath(distance: number) {
  const c = getContext();
  if (!c || !masterGain) return;
  const g = distanceGain(distance);
  if (g < 0.05) return;
  const gain = c.createGain();
  gain.gain.value = g;
  gain.connect(masterGain);
  tone(c, gain, { freqStart: 90, freqEnd: 30, type: 'sawtooth', duration: 0.55, gainPeak: 0.4 });
}

export function playImpact() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.05, filterType: 'lowpass', freq: 700, q: 0.6, gainPeak: 0.25 });
}

export function playPlayerHurt() {
  const c = getContext();
  if (!c || !masterGain) return;
  noiseBurst(c, masterGain, { duration: 0.15, freq: 300, q: 0.6, gainPeak: 0.35 });
  tone(c, masterGain, { freqStart: 110, freqEnd: 50, type: 'sine', duration: 0.15, gainPeak: 0.3 });
}

export function playPurchase() {
  const c = getContext();
  if (!c || !masterGain) return;
  tone(c, masterGain, { freqStart: 660, freqEnd: 880, type: 'square', duration: 0.09, gainPeak: 0.25 });
}

export function playDenied() {
  const c = getContext();
  if (!c || !masterGain) return;
  tone(c, masterGain, { freqStart: 220, freqEnd: 140, type: 'square', duration: 0.12, gainPeak: 0.25 });
}

export function playWaveStart() {
  const c = getContext();
  if (!c || !masterGain) return;
  const dest = masterGain;
  tone(c, dest, { freqStart: 300, freqEnd: 500, type: 'sawtooth', duration: 0.2, gainPeak: 0.3 });
  setTimeout(() => tone(c, dest, { freqStart: 500, freqEnd: 700, type: 'sawtooth', duration: 0.25, gainPeak: 0.3 }), 150);
}

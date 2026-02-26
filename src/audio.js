// ─── audio.js ─────────────────────────────────────────────────────────────────
// Centralized audio module.
// Usage:
//   import { initAudio, playSound, resumeAudioContext,
//            startMusic, pauseMusic, resumeMusic, stopMusic } from './audio.js';

const ctx = new AudioContext();
const sounds = {};

let musicEl = null;         // <Audio> element for background music
let musicVolume = 0.4;
let sfxVolume   = 1.0;

// ── Load all SFX up front ─────────────────────────────────────────────────────
export async function initAudio() {
  const sfxFiles = {
    shoot:        './assets/sfx/shoot.wav',
    hit:          './assets/sfx/hit.wav',
    elite_hit:    './assets/sfx/elite_hit.wav',
    elite_shoot:  './assets/sfx/elite_shoot.wav',
    standard_hit: './assets/sfx/standard_hit.wav',
    explode:      './assets/sfx/explode.wav',
    explodeElite: './assets/sfx/explode_elite.wav',
    coin:         './assets/sfx/coin.wav',
    heal:         './assets/sfx/heal.wav',
    levelup:      './assets/sfx/levelup.wav',
    dash:         './assets/sfx/dash.wav',
    gameover:     './assets/sfx/gameover.wav',
    victory:      './assets/sfx/victory.wav',
  };

  await Promise.allSettled(
    Object.entries(sfxFiles).map(async ([name, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        sounds[name] = await ctx.decodeAudioData(buf);
      } catch (e) {
        console.warn(`[audio] Could not load "${name}" from ${url}:`, e.message);
      }
    })
  );

  // Set up music element
  musicEl = new Audio('./assets/music/theme.mp3');
  musicEl.loop    = true;
  musicEl.volume  = musicVolume;
  musicEl.preload = 'auto';
}

// ── Resume AudioContext after user gesture (required by browsers) ─────────────
export function resumeAudioContext() {
  if (ctx.state === 'suspended') ctx.resume();
}

// ── Play a named SFX ──────────────────────────────────────────────────────────
// name:   key from sfxFiles above
// volume: 0.0 – 1.0  (multiplied by global sfxVolume)
// pitch:  playback rate, 1.0 = normal, vary slightly for variety
export function playSound(name, volume = 1.0, pitch = 1.0) {
  const buf = sounds[name];
  if (!buf || ctx.state === 'suspended') return;

  const src  = ctx.createBufferSource();
  const gain = ctx.createGain();
  src.buffer = buf;
  src.playbackRate.value = pitch;
  gain.gain.value = Math.min(1, volume * sfxVolume);
  src.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

// ── Music controls ────────────────────────────────────────────────────────────
export function startMusic() {
  if (!musicEl) return;
  musicEl.currentTime = 0;
  musicEl.play().catch(() => {}); // silently ignore if blocked
}

export function pauseMusic() {
  if (!musicEl) return;
  musicEl.pause();
}

export function resumeMusic() {
  if (!musicEl) return;
  musicEl.play().catch(() => {});
}

export function stopMusic() {
  if (!musicEl) return;
  musicEl.pause();
  musicEl.currentTime = 0;
}

// ── Volume helpers (hook these up to your control panel if desired) ───────────
export function setSfxVolume(v)   { sfxVolume   = Math.max(0, Math.min(1, v)); }
export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicEl) musicEl.volume = musicVolume;
}

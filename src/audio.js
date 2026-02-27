// ─── audio.js ─────────────────────────────────────────────────────────────────
// Centralized audio module.
// Usage:
//   import { initAudio, playSound, resumeAudioContext,
//            startMusic, pauseMusic, resumeMusic, stopMusic } from './audio.js';

const ctx = new AudioContext();
const sounds = {};

let musicEl = null;
let musicVolume  = 0.4;
let sfxVolume    = 1.0;
let muted        = false;
let _musicWanted = false; // true when music should be playing

// ── Resume AudioContext after user gesture (required by browsers) ─────────────
export function resumeAudioContext() {
  if (ctx.state === 'suspended') ctx.resume();
  // If music was requested before a user gesture, play it now
  if (_musicWanted && !muted && musicEl && musicEl.paused) {
    musicEl.play().catch(() => {});
  }
}

// Whenever the AudioContext transitions to 'running' (e.g. after any user gesture),
// automatically start music if it was requested but blocked
ctx.addEventListener('statechange', () => {
  if (ctx.state === 'running' && _musicWanted && !muted && musicEl && musicEl.paused) {
    musicEl.play().catch(() => {});
  }
});

// ── Load all SFX up front ─────────────────────────────────────────────────────
export async function initAudio() {
  const sfxFiles = {
    countdown:    './assets/sfx/countdown.wav',
    shoot:        './assets/sfx/shoot.wav',
    player_hit:   './assets/sfx/player_hit.wav',
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
  musicEl = new Audio('./assets/music/theme.wav');
  musicEl.loop    = true;
  musicEl.volume  = musicVolume;
  musicEl.preload = 'auto';

  // If startMusic() was called before we finished loading, play now
  if (_musicWanted && !muted) {
    musicEl.play().catch(() => {});
  }
}

// ── Play a named SFX ──────────────────────────────────────────────────────────
// name:   key from sfxFiles above
// volume: 0.0 – 1.0  (multiplied by global sfxVolume)
// pitch:  playback rate, 1.0 = normal, vary slightly for variety
export function playSound(name, volume = 1.0, pitch = 1.0) {
  const buf = sounds[name];
  if (!buf || ctx.state === 'suspended' || muted) return;

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
  _musicWanted = true;
  if (!muted && !musicEl.paused) return; // already playing, don't restart
  musicEl.currentTime = 0;
  if (!muted) musicEl.play().catch(() => {});
}

export function pauseMusic() {
  if (!musicEl) return;
  musicEl.pause();
  // don't clear _musicWanted — game is just paused, not stopped
}

export function resumeMusic() {
  if (!musicEl) return;
  if (!muted) musicEl.play().catch(() => {});
}

export function stopMusic() {
  if (!musicEl) return;
  _musicWanted = false;
  musicEl.pause();
  musicEl.currentTime = 0;
}

// ── Mute toggle ───────────────────────────────────────────────────────────────
export function toggleMute() {
  muted = !muted;
  if (musicEl) {
    if (muted) musicEl.pause();
    else if (_musicWanted) musicEl.play().catch(() => {});
  }
  return muted;
}

export function setMuted(v) {
  muted = !!v;
  if (musicEl) {
    if (muted) musicEl.pause();
    else if (_musicWanted) musicEl.play().catch(() => {});
  }
}

// ── Volume helpers ────────────────────────────────────────────────────────────
export function setSfxVolume(v)   { sfxVolume   = Math.max(0, Math.min(1, v)); }
export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicEl) musicEl.volume = musicVolume;
}

export function getMuted()       { return muted; }
export function getSfxVolume()   { return sfxVolume; }
export function getMusicVolume() { return musicVolume; }

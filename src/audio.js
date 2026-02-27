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
  if (_musicWanted && !muted && musicEl && musicEl.paused) {
    musicEl.play().catch(() => {});
  }
}

// ── Splash sound — plays as soon as AudioContext is running ───────────────────
export function playSplashSound() {
  let played = false;

  function tryPlay() {
    if (played) return;
    const buf = sounds['splash'];
    if (!buf) return; // not loaded yet — will retry via statechange
    if (ctx.state !== 'running') return; // still locked — will retry via statechange
    played = true;
    const src  = ctx.createBufferSource();
    const gain = ctx.createGain();
    src.buffer = buf;
    gain.gain.value = 1.0;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start();
  }

  // Try immediately (works if AudioContext already running, e.g. returning visitor)
  tryPlay();

  // Also retry the moment AudioContext unlocks (first user gesture)
  ctx.addEventListener('statechange', function handler() {
    if (played) { ctx.removeEventListener('statechange', handler); return; }
    tryPlay();
    if (played) ctx.removeEventListener('statechange', handler);
  });
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
    splash:       './assets/sfx/splash.wav',
    menu:         './assets/sfx/menu.wav',
    menu_select:  './assets/sfx/menu_select.wav',
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

// ── Per-sound volume overrides ────────────────────────────────────────────────
const soundVolumes = {
  countdown:    1.0,
  shoot:        1.0,
  player_hit:   1.0,
  elite_hit:    1.0,
  elite_shoot:  1.0,
  standard_hit: 1.0,
  explode:      1.0,
  explodeElite: 1.0,
  coin:         1.0,
  heal:         1.0,
  levelup:      1.0,
  dash:         1.0,
  gameover:     1.0,
  victory:      1.0,
};

export function getSoundVolume(name)    { return soundVolumes[name] ?? 1.0; }
export function setSoundVolume(name, v) { soundVolumes[name] = Math.max(0, Math.min(1, v)); }
export function getAllSoundVolumes()    { return { ...soundVolumes }; }
export function setAllSoundVolumes(map){ Object.keys(map).forEach(k => setSoundVolume(k, map[k])); }

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
  gain.gain.value = Math.min(1, volume * sfxVolume * (soundVolumes[name] ?? 1.0));
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


// ── Menu audio UI wiring (main menu) ───────────────────────────────────────────
// Safe to call even if the menu isn't present (e.g., during gameplay).
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function pct(v){ return Math.round(clamp01(v) * 100) + '%'; }

function bindMenuAudioUI(){
  const muteEl  = document.getElementById('menu-mute');
  const mRange  = document.getElementById('menu-music');
  const sRange  = document.getElementById('menu-sfx');
  const mValEl  = document.getElementById('menu-music-val');
  const sValEl  = document.getElementById('menu-sfx-val');
  const mNum    = document.getElementById('menu-music-num');
  const sNum    = document.getElementById('menu-sfx-num');

  if (!muteEl && !mRange && !sRange) return;

  const sync = () => {
    if (muteEl) muteEl.checked = getMuted();
    if (mRange) mRange.value = getMusicVolume();
    if (sRange) sRange.value = getSfxVolume();
    if (mValEl) mValEl.textContent = pct(getMusicVolume());
    if (sValEl) sValEl.textContent = pct(getSfxVolume());
    if (mNum) mNum.value = (+getMusicVolume()).toFixed(2);
    if (sNum) sNum.value = (+getSfxVolume()).toFixed(2);
  };

  muteEl?.addEventListener('change', () => {
    setMuted(!!muteEl.checked);
    sync();
  });

  mRange?.addEventListener('input', () => {
    const v = clamp01(parseFloat(mRange.value || '0'));
    setMusicVolume(v);
    if (mValEl) mValEl.textContent = pct(v);
    if (mNum) mNum.value = (+v).toFixed(2);
  });
  mNum?.addEventListener('change', () => {
    const v = clamp01(parseFloat(mNum.value || '0'));
    if (mRange) {
      mRange.value = v;
      mRange.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setMusicVolume(v);
      if (mValEl) mValEl.textContent = pct(v);
    }
  });

  sRange?.addEventListener('input', () => {
    const v = clamp01(parseFloat(sRange.value || '0'));
    setSfxVolume(v);
    if (sValEl) sValEl.textContent = pct(v);
    if (sNum) sNum.value = (+v).toFixed(2);
  });
  sNum?.addEventListener('change', () => {
    const v = clamp01(parseFloat(sNum.value || '0'));
    if (sRange) {
      sRange.value = v;
      sRange.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      setSfxVolume(v);
      if (sValEl) sValEl.textContent = pct(v);
    }
  });

  sync();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', bindMenuAudioUI, { once: true });
}

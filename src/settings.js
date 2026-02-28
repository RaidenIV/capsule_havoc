// ─── ui/settings.js ─────────────────────────────────────────────────────────
// Settings panel (audio only for now). Persists to localStorage.

import { loadJSON, saveJSON } from './storage.js';
import { setMuted, setMusicVolume, setSfxVolume, getMuted, getMusicVolume, getSfxVolume, resumeAudioContext } from '../audio.js';

const KEY = 'capsuleHavoc.audio.v1';

export function applySavedAudioSettings() {
  const s = loadJSON(KEY, null);
  if (!s) return;
  if (typeof s.muted === 'boolean') setMuted(s.muted);
  if (typeof s.music === 'number') setMusicVolume(s.music);
  if (typeof s.sfx === 'number') setSfxVolume(s.sfx);
}

export function bindAudioSettingsUI(root) {
  const mute = root.querySelector('#menu-mute');
  const music = root.querySelector('#menu-music');
  const sfx = root.querySelector('#menu-sfx');
  const musicVal = root.querySelector('#menu-music-val');
  const sfxVal = root.querySelector('#menu-sfx-val');

  function syncFromEngine() {
    mute.checked = !!getMuted();
    music.value = String(getMusicVolume());
    sfx.value = String(getSfxVolume());
    if (musicVal) musicVal.textContent = Math.round(getMusicVolume() * 100) + '%';
    if (sfxVal) sfxVal.textContent = Math.round(getSfxVolume() * 100) + '%';
  }

  function persist() {
    saveJSON(KEY, {
      muted: getMuted(),
      music: getMusicVolume(),
      sfx: getSfxVolume()
    });
  }

  mute.addEventListener('change', () => {
    resumeAudioContext(); // user gesture
    setMuted(mute.checked);
    persist();
  });

  music.addEventListener('input', () => {
    resumeAudioContext();
    setMusicVolume(parseFloat(music.value));
    if (musicVal) musicVal.textContent = Math.round(getMusicVolume() * 100) + '%';
    persist();
  });

  sfx.addEventListener('input', () => {
    resumeAudioContext();
    setSfxVolume(parseFloat(sfx.value));
    if (sfxVal) sfxVal.textContent = Math.round(getSfxVolume() * 100) + '%';
    persist();
  });

  syncFromEngine();
  return { syncFromEngine };
}

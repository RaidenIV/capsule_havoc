// ─── main.js ──────────────────────────────────────────────────────────────────
// Entry point. Imports all modules, wires callbacks between them,
// then kicks off the game loop.

import { state }           from './state.js';
import { ELITE_TYPES }     from './constants.js';
import { onRendererResize } from './renderer.js';
import { onBloomResize }   from './bloom.js';
import { updateXP }        from './xp.js';
import { updateHealthBar } from './player.js';
import { spawnLevelElites, setLevelUpCallback, setVictoryCallback } from './enemies.js';
import { syncOrbitBullets } from './weapons.js';
import { triggerVictory, restartGame, getHighScores, clearHighScores } from './gameFlow.js';
import { initInput }       from './input.js';
import { tick }            from './loop.js';
import { togglePanel, togglePause, updatePauseBtn } from './panel/index.js';
import { initAudio, resumeAudioContext, setMuted, setMusicVolume, setSfxVolume, getMuted, getMusicVolume, getSfxVolume } from './audio.js';

// ── Wire cross-module callbacks (breaks enemies ↔ weapons circular deps) ──────
setVictoryCallback(triggerVictory);

setLevelUpCallback((newLevel) => {
  syncOrbitBullets();
  ELITE_TYPES.filter(et => et.minLevel <= newLevel)
             .forEach(et => spawnLevelElites(et));
});

// ── Wire input callbacks ──────────────────────────────────────────────────────
initInput({
  togglePanel,
  togglePause,
  restartGame,
  onFirstKey: resumeAudioContext,  // satisfies browser autoplay policy
});

// ── Expose restart globally for the HTML restart button onclick ───────────────
window.restartGame = restartGame;

// ── Window resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  onRendererResize();
  onBloomResize();
});


// ── Main menu (Start / High Scores / Settings) ───────────────────────────────
const menuEl        = document.getElementById('main-menu');
const startBtn      = document.getElementById('btn-start');
const scoresBtn     = document.getElementById('btn-scores');
const settingsBtn   = document.getElementById('btn-settings');

const scoresPanel   = document.getElementById('panel-scores');
const scoresBackBtn = document.getElementById('btn-scores-back');
const scoresClearBtn= document.getElementById('btn-scores-clear');
const hsListEl      = document.getElementById('hs-list');
const hsMetaEl      = document.getElementById('hs-meta');

const settingsPanel = document.getElementById('panel-settings');
const settingsBackBtn = document.getElementById('btn-settings-back');
const mutedEl       = document.getElementById('set-muted');
const musicEl       = document.getElementById('set-music');
const musicValEl    = document.getElementById('set-music-val');
const sfxEl         = document.getElementById('set-sfx');
const sfxValEl      = document.getElementById('set-sfx-val');

const AUDIO_KEY = 'ch_audio_v1';

function setMenuOpen(open) {
  if (!menuEl) return;
  document.body.classList.toggle('menu-open', open);
  menuEl.hidden = !open;
  menuEl.setAttribute('aria-hidden', open ? 'false' : 'true');
  state.uiMode = open ? 'menu' : 'playing';
  state.paused = open ? true : state.paused;
}

function showActionsOnly() {
  scoresPanel.hidden = true;
  settingsPanel.hidden = true;
}

function fmtDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year:'2-digit', month:'short', day:'2-digit' });
  } catch { return ''; }
}

function renderHighScores() {
  const scores = getHighScores();
  if (hsMetaEl) hsMetaEl.textContent = scores.length ? `Top ${Math.min(scores.length, 20)} runs (sorted by kills, then time).` : 'No runs yet.';
  if (!hsListEl) return;

  if (!scores.length) {
    hsListEl.innerHTML = `<div class="hs-row"><div class="hs-rank">—</div><div class="hs-main"><div class="hs-score">No scores saved</div><div class="hs-subline">Finish a run to record a score.</div></div><div class="hs-date"></div></div>`;
    return;
  }

  hsListEl.innerHTML = scores.map((s, i) => {
    const kills = (s.kills ?? 0);
    const time  = (s.time ?? 0);
    const coins = (s.coins ?? 0);
    const res   = (s.result === 'victory') ? 'Victory' : 'Destroyed';
    const tmmss = (typeof time === 'number') ? (Math.floor(time/60).toString().padStart(2,'0') + ':' + Math.floor(time%60).toString().padStart(2,'0')) : '--:--';
    return `
      <div class="hs-row">
        <div class="hs-rank">#${i+1}</div>
        <div class="hs-main">
          <div class="hs-score">${kills} kills <span style="opacity:.7;font-weight:700">·</span> ${tmmss} <span style="opacity:.7;font-weight:700">·</span> ${coins} coins</div>
          <div class="hs-subline">${res}</div>
        </div>
        <div class="hs-date">${fmtDate(s.date)}</div>
      </div>
    `;
  }).join('');
}

function showScores() {
  showActionsOnly();
  scoresPanel.hidden = false;
  renderHighScores();
}

function showSettings() {
  showActionsOnly();
  settingsPanel.hidden = false;

  if (mutedEl) mutedEl.checked = !!getMuted();
  if (musicEl) musicEl.value = String(getMusicVolume());
  if (sfxEl)   sfxEl.value   = String(getSfxVolume());
  if (musicValEl) musicValEl.textContent = `${Math.round(getMusicVolume()*100)}%`;
  if (sfxValEl)   sfxValEl.textContent   = `${Math.round(getSfxVolume()*100)}%`;
}

function loadAudioSettings() {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (typeof s.muted === 'boolean') setMuted(s.muted);
    if (typeof s.musicVolume === 'number') setMusicVolume(s.musicVolume);
    if (typeof s.sfxVolume === 'number') setSfxVolume(s.sfxVolume);
  } catch {}
}

function saveAudioSettings() {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify({
      muted: getMuted(),
      musicVolume: getMusicVolume(),
      sfxVolume: getSfxVolume(),
    }));
  } catch {}
}

// Wire menu buttons
startBtn?.addEventListener('click', () => {
  resumeAudioContext();
  setMenuOpen(false);
  // Full reset + initial spawn + countdown
  restartGame();
});

scoresBtn?.addEventListener('click', () => { resumeAudioContext(); showScores(); });
settingsBtn?.addEventListener('click', () => { resumeAudioContext(); showSettings(); });

scoresBackBtn?.addEventListener('click', () => showActionsOnly());
settingsBackBtn?.addEventListener('click', () => showActionsOnly());

scoresClearBtn?.addEventListener('click', () => {
  clearHighScores();
  renderHighScores();
});

mutedEl?.addEventListener('change', () => {
  resumeAudioContext();
  setMuted(!!mutedEl.checked);
  saveAudioSettings();
});

musicEl?.addEventListener('input', () => {
  resumeAudioContext();
  const v = Math.max(0, Math.min(1, parseFloat(musicEl.value)));
  setMusicVolume(v);
  if (musicValEl) musicValEl.textContent = `${Math.round(v*100)}%`;
  saveAudioSettings();
});

sfxEl?.addEventListener('input', () => {
  resumeAudioContext();
  const v = Math.max(0, Math.min(1, parseFloat(sfxEl.value)));
  setSfxVolume(v);
  if (sfxValEl) sfxValEl.textContent = `${Math.round(v*100)}%`;
  saveAudioSettings();
});

// ── Initial boot (show menu, keep sim paused) ─────────────────────────────────
setMenuOpen(true);
showActionsOnly();
updateHealthBar();
updateXP(0);

// Start render loop immediately so the scene is visible behind the menu
state.paused = true;
tick();

// Init audio + apply persisted settings
initAudio().then(() => {
  loadAudioSettings();
  // Settings panel (if opened) should reflect persisted values
  // (menu is already open by default)
});

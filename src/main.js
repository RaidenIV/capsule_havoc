// ─── main.js ──────────────────────────────────────────────────────────────────
// Entry point. Imports all modules, wires callbacks between them,
// then kicks off the game loop.

import { state }           from './state.js';
import { ELITE_TYPES }     from './constants.js';
import { onRendererResize } from './renderer.js';
import { onBloomResize }   from './bloom.js';
import { updateXP }        from './xp.js';
import { updateHealthBar } from './player.js';
import { spawnEnemyAtEdge, spawnLevelElites, setLevelUpCallback, setVictoryCallback } from './enemies.js';
import { syncOrbitBullets } from './weapons.js';
import { triggerVictory, restartGame, startCountdown } from './gameFlow.js';
import { initInput }       from './input.js';
import { tick }            from './loop.js';
import { togglePanel, togglePause, updatePauseBtn } from './panel/index.js';
import { initAudio, resumeAudioContext, setMuted, setSfxVolume, setMusicVolume, getMuted, getSfxVolume, getMusicVolume } from './audio.js';

// ── Wire cross-module callbacks (breaks enemies ↔ weapons circular deps) ──────
setVictoryCallback(triggerVictory);

setLevelUpCallback((newLevel) => {
  syncOrbitBullets();
  ELITE_TYPES.filter(et => et.minLevel <= newLevel)
             .forEach(et => spawnLevelElites(et));
});


// ── Expose restart globally for the HTML restart button onclick ───────────────
window.restartGame = restartGame;

// ── Window resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  onRendererResize();
  onBloomResize();
});

// ── Boot into menu screen ────────────────────────────────────────────────────
const body = document.body;

function setMode(mode) {
  state.uiMode = mode;
  body.classList.toggle('mode-menu', mode === 'menu');
  body.classList.toggle('mode-playing', mode === 'playing');
}

function $(id) { return document.getElementById(id); }

function renderHighScores() {
  const listEl = $('score-list');
  if (!listEl) return;
  const scores = (window.getHighScores?.() || []);
  if (!scores.length) {
    listEl.innerHTML = '<div style="opacity:.7; padding:10px;">No scores yet.</div>';
    return;
  }
  listEl.innerHTML = scores.map((s, i) => {
    const mm = Math.floor((s.time || 0) / 60).toString().padStart(2,'0');
    const ss = Math.floor((s.time || 0) % 60).toString().padStart(2,'0');
    const when = new Date(s.ts || Date.now()).toLocaleDateString();
    return `
      <div class="score-item">
        <div class="score-rank">#${i+1}</div>
        <div>
          <div><strong>${s.result || ''}</strong> — ${mm}:${ss} — ${s.kills || 0} kills — ${s.coins || 0} coins</div>
          <div class="score-meta">${when}</div>
        </div>
        <div class="score-points">${(s.score ?? 0).toLocaleString()}</div>
      </div>`;
  }).join('');
}

function openPanel(which) {
  const scoresP = $('menu-panel-scores');
  const settingsP = $('menu-panel-settings');
  if (scoresP) scoresP.classList.toggle('show', which === 'scores');
  if (settingsP) settingsP.classList.toggle('show', which === 'settings');
  if (which === 'scores') renderHighScores();
}

function closePanels() {
  $('menu-panel-scores')?.classList.remove('show');
  $('menu-panel-settings')?.classList.remove('show');
}

function syncAudioUI() {
  const mute = $('audio-mute');
  const mus  = $('audio-music');
  const sfx  = $('audio-sfx');
  const musV = $('audio-music-val');
  const sfxV = $('audio-sfx-val');

  if (!mute || !mus || !sfx) return;
  mute.checked = getMuted();
  mus.value = String(getMusicVolume());
  sfx.value = String(getSfxVolume());
  if (musV) musV.textContent = Number(mus.value).toFixed(2);
  if (sfxV) sfxV.textContent = Number(sfx.value).toFixed(2);
}

async function startFromMenu() {
  closePanels();
  setMode('playing');

  // Ensure audio graph exists; then resume context on the gesture.
  await initAudio();
  resumeAudioContext();

  // Wire input once (so menu doesn't accidentally restart / pause)
  if (!state.inputInitialized) {
    initInput({
      togglePanel,
      togglePause,
      restartGame,
      onFirstKey: resumeAudioContext,
    });
    state.inputInitialized = true;
  }

  // Start render loop once
  if (!state.loopStarted) {
    tick();
    state.loopStarted = true;
  }

  // Fresh run: restart (spawns enemies + countdown)
  restartGame({ skipInitialSpawn: false, startCountdown: true });
}

// Expose high score fns for menu renderer
import { getHighScores, clearHighScores } from './gameFlow.js';
window.getHighScores = getHighScores;

document.addEventListener('DOMContentLoaded', async () => {
  setMode('menu');

  // Init audio graph (no playback until user gesture)
  await initAudio();

  // Menu buttons
  $('menu-start')?.addEventListener('click', startFromMenu);
  $('menu-scores')?.addEventListener('click', () => openPanel('scores'));
  $('menu-settings')?.addEventListener('click', () => { openPanel('settings'); syncAudioUI(); });

  document.querySelectorAll('[data-menu-close]')?.forEach(btn => {
    btn.addEventListener('click', () => closePanels());
  });

  $('scores-clear')?.addEventListener('click', () => {
    clearHighScores();
    renderHighScores();
  });

  // Audio controls
  $('audio-mute')?.addEventListener('change', (e) => setMuted(!!e.target.checked));
  $('audio-music')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setMusicVolume(v);
    $('audio-music-val').textContent = v.toFixed(2);
  });
  $('audio-sfx')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setSfxVolume(v);
    $('audio-sfx-val').textContent = v.toFixed(2);
  });

  // Still keep resize handlers alive for menu responsiveness
  updateHealthBar();
  updateXP(0);
});

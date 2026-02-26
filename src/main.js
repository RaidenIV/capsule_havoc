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
import { initAudio, resumeAudioContext } from './audio.js';

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

// ── Initial game start ────────────────────────────────────────────────────────
updateHealthBar();
updateXP(0);
for (let i = 0; i < 20; i++) spawnEnemyAtEdge();
tick();
// Await audio init then start countdown so musicEl exists when countdown ends
initAudio().then(() => {
  requestAnimationFrame(() => requestAnimationFrame(() => startCountdown()));
});

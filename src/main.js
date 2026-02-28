// ─── main.js ──────────────────────────────────────────────────────────────────
// Entry point. Imports all modules, wires callbacks between them,
// then kicks off the game loop.

import { state }           from './state.js';
import { onRendererResize } from './renderer.js';
import { onBloomResize }   from './bloom.js';
import { updateXP }        from './xp.js';
import { updateHealthBar } from './player.js';
import { setLevelUpCallback } from './enemies.js';
import { restartGame, startCountdown } from './gameFlow.js';
import { initInput }       from './input.js';
import { tick }            from './loop.js';
import { togglePanel, togglePause, updatePauseBtn } from './panel/index.js';
import { initAudio, resumeAudioContext, playSound, playSplashSound } from './audio.js';
import { stopMusic } from './audio.js';
import { initMenuUI } from './ui/menu.js';

// ── Wire cross-module callbacks (breaks enemies ↔ weapons circular deps) ──────
setLevelUpCallback((newLevel) => {
  playSound('levelup', 0.8);
});
  syncOrbitBullets();
  ELITE_TYPES.filter(et => et.minLevel <= newLevel)
             .forEach(et => spawnLevelElites(et));
});

// ── Wire input callbacks ──────────────────────────────────────────────────────
const guardedTogglePanel = () => { if (state.uiMode === 'playing') togglePanel(); };
const guardedTogglePause = () => { if (state.uiMode === 'playing') togglePause(); };

initInput({
  togglePanel: guardedTogglePanel,
  togglePause: guardedTogglePause,
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

// ── Menu-driven start ─────────────────────────────────────────────────
updateHealthBar();
updateXP(0);

// Show menu first; defer tick()/spawns/countdown until Start is pressed.
state.uiMode = 'menu';
state.paused = true;

// Keep menu hidden until splash finishes (if splash element exists)
const menuScreenEl = document.getElementById('menu-screen');
const splashEl     = document.getElementById('splash-screen');

if (splashEl && menuScreenEl) {
  menuScreenEl.style.visibility = 'hidden';

  // Play splash sound — fires immediately if AudioContext is already running,
  // or as soon as the user's first gesture unlocks it
  playSplashSound();

  setTimeout(() => {
    splashEl.classList.add('fade-out');
    splashEl.addEventListener('animationend', () => {
      splashEl.remove();
      menuScreenEl.style.visibility = '';
    }, { once: true });
  }, 2000);
}

const menuUI = initMenuUI({
  onStart: async () => {
    // Switch screens
    menuUI.hideMenu();
    state.uiMode = 'playing';

    // Ensure audio is ready before countdown ends (musicEl exists)
    await initAudio();

    // Fresh run (but don't auto-start countdown until after audio init above)
    restartGame({ startCountdown: false, skipInitialSpawn: false });

    // Start the main loop once
    if (!state.loopStarted) {
      state.loopStarted = true;
      tick();
    }

    // Start countdown on next frames so UI/layout is stable
    requestAnimationFrame(() => requestAnimationFrame(() => startCountdown()));
  }
});

// ── Expose showMainMenu for the pause menu quit button ────────────────────────
// Defined after menuUI so the closure captures it correctly.
window.showMainMenu = () => {
  stopMusic();
  state.gameOver = false;
  state.paused   = true;
  state.uiMode   = 'menu';
  menuUI.showMenu();
};

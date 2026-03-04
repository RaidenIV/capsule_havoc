// ─── main.js ──────────────────────────────────────────────────────────────────
// Entry point. Imports all modules, wires callbacks between them,
// then kicks off the game loop.

import { state }            from './state.js';
import { onRendererResize } from './renderer.js';
import { onBloomResize }    from './bloom.js';
import { updateXP }         from './xp.js';
import { updateHealthBar }  from './player.js';
import { setLevelUpCallback, setVictoryCallback } from './enemies.js';
import { triggerVictory, restartGame, startCountdown } from './gameFlow.js';
import { initInput }        from './input.js';
import { tick }             from './loop.js';
import { togglePanel, togglePause } from './panel/index.js';
import { initAudio, resumeAudioContext, playSound, playSplashSound, stopMusic } from './audio.js';
import { initMenuUI }       from './ui/menu.js';
import { initHudCoin }      from './hudCoin.js';
import { runBootScreen }    from './ui/boot.js';

// ── Wire cross-module callbacks (breaks enemies ↔ weapons circular deps) ──────
setVictoryCallback(triggerVictory);

// NOTE: Weapon upgrades are no longer level-based (they're purchased in the shop),
// but we still keep the level-up SFX for feedback if XP/levels remain for UI.
setLevelUpCallback(() => {
  playSound('levelup', 0.8);
});

// ── Wire input callbacks ──────────────────────────────────────────────────────
const guardedTogglePanel = () => { if (state.uiMode === 'playing') togglePanel(); };
const guardedTogglePause = () => { if (state.uiMode === 'playing') togglePause(); };

initInput({
  togglePanel: guardedTogglePanel,
  togglePause: guardedTogglePause,
  restartGame,
  onFirstKey: resumeAudioContext, // satisfies browser autoplay policy
});

// ── Expose restart globally for the HTML restart button onclick ───────────────
window.restartGame = restartGame;

// ── Window resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  onRendererResize();
  onBloomResize();
});

// ── Initial UI + state ────────────────────────────────────────────────────────
updateHealthBar();
updateXP(0);
initHudCoin();

// Defer game loop + spawns until Start is pressed.
state.uiMode = 'boot';
state.paused = true;

// Keep menu + splash hidden until boot/start sequence runs
const menuScreenEl = document.getElementById('menu-screen');
const splashEl     = document.getElementById('splash-screen');

if (menuScreenEl) menuScreenEl.style.visibility = 'hidden';
if (splashEl) {
  splashEl.classList.add('boot-hidden');
}

// Initialize menu UI (creates DOM wiring), but keep it hidden until after splash.
const menuUI = initMenuUI({
  onStart: async () => {
    // This is the "Start Game" from the menu, not the initial PRESS START flow.
    menuUI.hideMenu();
    state.uiMode = 'playing';

    // Ensure audio is ready before countdown ends
    await initAudio();

    // Fresh run
    restartGame({ startCountdown: false, skipInitialSpawn: true });

    // Start the main loop once
    if (!state.loopStarted) {
      state.loopStarted = true;
      tick();
    }

    // Start countdown on next frames so UI/layout is stable
    requestAnimationFrame(() => requestAnimationFrame(() => startCountdown()));
  }
});

// ── Boot → Splash → Menu flow (guarantees audio works) ─────────────────────────
runBootScreen({
  onStart: async () => {
    // First user gesture: unlock audio deterministically and preload buffers.
    resumeAudioContext();
    await initAudio();

    // Show logo splash + play SFX
    if (splashEl) {
      splashEl.classList.remove('boot-hidden');
      // Force layout so splashIn animation reliably runs on show
      void splashEl.offsetHeight;

      playSplashSound();

      // Hold for 2s, then fade out and reveal menu
      setTimeout(() => {
        splashEl.classList.add('fade-out');
        splashEl.addEventListener('animationend', () => {
          splashEl.remove();
          if (menuScreenEl) menuScreenEl.style.visibility = '';
          state.uiMode = 'menu';
          state.paused = true;
          menuUI.showMenu();
        }, { once: true });
      }, 2000);
    } else {
      // No splash element — just show menu
      if (menuScreenEl) menuScreenEl.style.visibility = '';
      state.uiMode = 'menu';
      state.paused = true;
      menuUI.showMenu();
    }
  }
});

// ── Expose showMainMenu for pause menu "Quit to Menu" ─────────────────────────
window.showMainMenu = () => {
  stopMusic();
  state.gameOver = false;
  state.paused   = true;
  state.uiMode   = 'menu';
  menuUI.showMenu();
};

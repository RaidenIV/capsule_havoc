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
import { runBootSequence }  from './ui/boot.js';
import { initHudCoin }      from './hudCoin.js';

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

// Also unlock audio on the first pointer/touch gesture (many players never press a key on the menu).
window.addEventListener('pointerdown', resumeAudioContext, { once: true, passive: true });

// ── Expose restart globally for the HTML restart button onclick ───────────────
window.restartGame = restartGame;

// ── Window resize ─────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  onRendererResize();
  onBloomResize();
});

// ── Menu-driven start ─────────────────────────────────────────────────────────
updateHealthBar();
updateXP(0);
initHudCoin();

// Boot → Splash → Menu
state.uiMode = 'menu';
state.paused = true;

const bootEl       = document.getElementById('boot-screen');
const menuScreenEl = document.getElementById('menu-screen');
const splashEl     = document.getElementById('splash-screen');

// Hide menu & splash until boot/start is complete
if (menuScreenEl) menuScreenEl.style.visibility = 'hidden';
if (splashEl) {
  splashEl.style.visibility = 'hidden';
  splashEl.classList.remove('show','fade-out');
}

// Run terminal boot sequence. The PRESS START gesture unlocks audio.
runBootSequence({
  onStart: async () => {
    // Unlock + init audio on the gesture that clicked PRESS START
    await initAudio();
    await resumeAudioContext();

    // Show logo splash and play SFX
    if (splashEl) {
      splashEl.style.visibility = '';
      splashEl.classList.add('show');
      playSplashSound();

      // 1s fade-in + 1s hold => start fade-out at t=2000ms, remove at 3000ms
      window.setTimeout(() => splashEl.classList.add('fade-out'), 2000);
      splashEl.addEventListener('animationend', (ev) => {
        // only remove after fade-out completes
        if (ev.animationName === 'splashOut') {
          splashEl.remove();
          if (menuScreenEl) menuScreenEl.style.visibility = '';
        }
      }, { once: true });
    } else {
      if (menuScreenEl) menuScreenEl.style.visibility = '';
    }
  }
});

const menuUI = initMenuUI({
  onStart: async () => {
    // Switch screens
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

// ── Expose showMainMenu for pause menu "Quit to Menu" ─────────────────────────
window.showMainMenu = () => {
  stopMusic();
  state.gameOver = false;
  state.paused   = true;
  state.uiMode   = 'menu';
  menuUI.showMenu();
};

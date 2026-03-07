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
import { initAudio, resumeAudioContext, playSound, playSplashSound, stopMusic, startMusic } from './audio.js';
import { initMenuUI }       from './ui/menu.js';
import { initBootUI }       from './ui/boot.js';
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

// Show menu first; defer tick()/spawns/countdown until Start is pressed.
state.uiMode = 'menu';
state.paused = true;

// ── Boot → Splash → Menu sequence (audio-safe) ─────────────────────────────
const menuScreenEl = document.getElementById('menu-screen');
const splashEl     = document.getElementById('splash-screen');
const bootEl       = document.getElementById('boot-screen');

async function runBootSplashSequence(){
  // Default: hide menu until we decide to show it
  if (menuScreenEl) menuScreenEl.style.visibility = 'hidden';

  // Hide splash with display:none so the splashIn CSS animation doesn't run
  // on page load. We'll force it to replay when we actually show the element.
  if (splashEl) splashEl.style.display = 'none';

  // If boot screen exists, run it. Otherwise, behave as if START was pressed.
  await new Promise((resolve) => {
    if (!bootEl) return resolve();

    initBootUI({
      onStart: () => resolve()
    });
  });

  // User gesture happened (PRESS START). Initialize audio buffers now.
  await initAudio(); // splash.wav loads and plays inside initAudio immediately

  // initMenuUI sets _musicWanted=true, so audio.js auto-starts music the moment
  // initAudio creates the <audio> element. Cancel that now — we start the menu
  // theme ourselves only once the menu is actually on screen.
  stopMusic();

  // 1.5-second pause before the logo appears.
  await new Promise(r => setTimeout(r, 1500));

  if (splashEl) {
    // Restore display, then force a reflow so the browser registers the element
    // as newly visible before the animation starts — this restarts splashIn cleanly.
    splashEl.style.display = '';
    void splashEl.offsetWidth; // reflow trigger

    setTimeout(() => {
      splashEl.classList.add('fade-out');
      splashEl.addEventListener('animationend', () => {
        splashEl.remove();
        if (menuScreenEl) menuScreenEl.style.visibility = '';
        startMusic('menu'); // menu is now visible — safe to start theme
      }, { once: true });
    }, 2000);
  } else {
    if (menuScreenEl) menuScreenEl.style.visibility = '';
    startMusic('menu');
  }
}

runBootSplashSequence();

// NOTE: menuUI must be declared before wiring callbacks to avoid TDZ issues
// if initMenuUI triggers synchronous work before the const assignment completes.
let menuUI;
menuUI = initMenuUI({
  onStart: async (character = 'blue') => {
    state.selectedCharacter = character === 'red' ? 'red' : 'blue';
    state.characterBaseHpMult = state.selectedCharacter === 'blue' ? 1.10 : 1.0;
    state.characterBaseDamageMult = state.selectedCharacter === 'red' ? 1.10 : 1.0;
    state.characterPrimaryWeapon = state.selectedCharacter === 'blue' ? 'laser' : 'slash';

    // Switch screens
    menuUI.hideMenu();
    stopMusic(); // stop menu_theme before game audio takes over
    state.uiMode = 'playing';

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

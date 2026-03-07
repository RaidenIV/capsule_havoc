// ─── ui/menu.js ─────────────────────────────────────────────────────────────
// Modular main menu controller. Owns screen switching and button wiring.

import { renderHighScores } from './scores.js';
import { clearHighScores } from './highScores.js';
import { bindAudioSettingsUI, applySavedAudioSettings } from './settings.js';
import { playSound, startMusic } from '../audio.js';
import { initMenuParticles } from './menuParticles.js';

export function initMenuUI({ onStart }) {
  const menu = document.getElementById('menu-screen');
  const pageMain = menu.querySelector('[data-page="main"]');
  const pageScores = menu.querySelector('[data-page="scores"]');
  const pageSettings = menu.querySelector('[data-page="settings"]');

  const btnStart = menu.querySelector('#menu-start');
  const btnScores = menu.querySelector('#menu-scores');
  const btnSettings = menu.querySelector('#menu-settings');

  const btnBackScores = menu.querySelector('#menu-back-scores');
  const btnBackSettings = menu.querySelector('#menu-back-settings');

  const btnClearScores = menu.querySelector('#menu-clear-scores');
  const scoresList = menu.querySelector('#scores-list');

  // Load persisted audio settings *before* user hits start (affects first music play).
  applySavedAudioSettings();
  const settingsApi = bindAudioSettingsUI(menu);
  const particleFx = initMenuParticles(menu);

  function showPage(name) {
    pageMain.classList.toggle('active', name === 'main');
    pageScores.classList.toggle('active', name === 'scores');
    pageSettings.classList.toggle('active', name === 'settings');

    if (name === 'scores') renderHighScores(scoresList);
    if (name === 'settings') settingsApi.syncFromEngine();
  }

  function showMenu() {
    document.body.classList.add('mode-menu');
    document.body.classList.remove('mode-playing');
    menu.classList.add('show');
    particleFx.start();
    showPage('main');
     // Play menu theme whenever we enter the main menu.
    startMusic('menu');
  }


  function hideMenu() {
    // Pre-hide HUD elements inline before switching class, so there's
    // never a frame where mode-playing shows them before the countdown hides them.
    const HUD_IDS = ['ui','hud-top-left','coin-hud','xp-hud','fpsOverlay','livesHud','instructions','tab-hint'];
    HUD_IDS.forEach(id => { const el = document.getElementById(id); if (el) el.style.visibility = 'hidden'; });
    particleFx.stop();
    document.body.classList.remove('mode-menu');
    document.body.classList.add('mode-playing');
    menu.classList.remove('show');
  }

  btnStart.addEventListener('click', () => onStart());
  btnScores.addEventListener('click', () => showPage('scores'));
  btnSettings.addEventListener('click', () => showPage('settings'));

  btnBackScores.addEventListener('click', () => showPage('main'));
  btnBackSettings.addEventListener('click', () => showPage('main'));

  btnClearScores.addEventListener('click', () => {
    clearHighScores();
    renderHighScores(scoresList);
  });

  // Hover + click sounds on all menu buttons
  menu.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('mouseenter', () => playSound('menu',        0.4));
    btn.addEventListener('click',      () => playSound('menu_select', 0.5));
  });

  // default
  showMenu();

  return { showMenu, hideMenu, showPage };
}

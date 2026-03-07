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
  const characterModal = menu.querySelector('#character-modal');
  const btnCharacterBack = menu.querySelector('#character-back');
  const btnCharacterBlue = menu.querySelector('#character-blue');
  const btnCharacterRed = menu.querySelector('#character-red');

  // Load persisted audio settings *before* user hits start (affects first music play).
  applySavedAudioSettings();
  const settingsApi = bindAudioSettingsUI(menu);
  const particleFx = initMenuParticles(menu);

  function closeCharacterModal() {
    if (!characterModal) return;
    characterModal.classList.remove('show');
    characterModal.setAttribute('aria-hidden', 'true');
  }

  function openCharacterModal() {
    if (!characterModal) return;
    characterModal.classList.add('show');
    characterModal.setAttribute('aria-hidden', 'false');
  }

  function showPage(name) {
    pageMain.classList.toggle('active', name === 'main');
    pageScores.classList.toggle('active', name === 'scores');
    pageSettings.classList.toggle('active', name === 'settings');
    closeCharacterModal();

    if (name === 'scores') renderHighScores(scoresList);
    if (name === 'settings') settingsApi.syncFromEngine();
  }

  function showMenu() {
    document.body.classList.add('mode-menu');
    document.body.classList.remove('mode-playing');
    menu.classList.add('show');
    particleFx.start();
    showPage('main');
    closeCharacterModal();
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
    closeCharacterModal();
    menu.classList.remove('show');
  }

  btnStart.addEventListener('click', () => openCharacterModal());
  btnScores.addEventListener('click', () => showPage('scores'));
  btnSettings.addEventListener('click', () => showPage('settings'));

  btnBackScores.addEventListener('click', () => showPage('main'));
  btnBackSettings.addEventListener('click', () => showPage('main'));
  btnCharacterBack?.addEventListener('click', () => closeCharacterModal());
  btnCharacterBlue?.addEventListener('click', () => onStart('blue'));
  btnCharacterRed?.addEventListener('click', () => onStart('red'));

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

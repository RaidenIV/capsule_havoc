// ─── input.js ─────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { DASH_SPEED, DASH_DURATION, DASH_COOLDOWN } from './constants.js';
import { ISO_FWD, ISO_RIGHT } from './renderer.js';
import * as THREE from 'three';
import { playSound, toggleMute } from './audio.js';

// Injected callbacks to avoid circular imports
let _togglePanel   = null;
let _restartGame   = null;
let _togglePause   = null;
let _onFirstKey    = null;
let _firstKeyFired = false;

export function initInput({ togglePanel, restartGame, togglePause, onFirstKey }) {
  _togglePanel  = togglePanel;
  _restartGame  = restartGame;
  _togglePause  = togglePause;
  _onFirstKey   = onFirstKey || null;
}

const _dv = new THREE.Vector3();


function getDashStats(tier){
  const t = Math.max(0, Math.min(5, tier | 0));
  const speedMult = [0, 0.50, 0.62, 0.75, 0.88, 1.00][t] || 0.50;
  const cooldown = [0, 1.40, 1.20, 1.00, 0.82, 0.68][t] || DASH_COOLDOWN;
  return { speedMult, cooldown };
}


window.addEventListener('keydown', e => {
  // Resume AudioContext on first interaction (browser autoplay policy)
  if (!_firstKeyFired && _onFirstKey) { _onFirstKey(); _firstKeyFired = true; }

  if (e.key === 'Tab') {
    e.preventDefault();
    const countdownShowing = document.getElementById('countdown')?.classList.contains('show');
    if (!countdownShowing && _togglePanel) _togglePanel();
    return;
  }

  if (e.key === 'Escape' && !state.gameOver) {
    e.preventDefault();
    // If the dev panel is open, close it first, then open pause.
    if (state.panelOpen && _togglePanel) _togglePanel();
    if (_togglePause) _togglePause();
    return;
  }
  if (e.key.toLowerCase() === 'm') {
    toggleMute();
    return;
  }
  if (state.paused) return;

  // Abilities (design doc)
  if (e.key.toLowerCase() === 'e') {
    if ((state.upg?.burst || 0) > 0) state.burstRequested = true;
  }
  if (e.key.toLowerCase() === 'q') {
    if ((state.upg?.timeSlow || 0) > 0) state.slowRequested = true;
  }

  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup')    state.keys.w = true;
  if (k === 's' || k === 'arrowdown')  state.keys.s = true;
  if (k === 'a' || k === 'arrowleft')  state.keys.a = true;
  if (k === 'd' || k === 'arrowright') state.keys.d = true;

  if (e.key === 'Shift' && !state.gameOver && state.hasDash) {
    e.preventDefault();
    if (state.dashCooldown <= 0 && state.dashTimer <= 0) {
      _dv.set(0, 0, 0);
      if (state.keys.w) _dv.addScaledVector(ISO_FWD,    1);
      if (state.keys.s) _dv.addScaledVector(ISO_FWD,   -1);
      if (state.keys.a) _dv.addScaledVector(ISO_RIGHT, -1);
      if (state.keys.d) _dv.addScaledVector(ISO_RIGHT,  1);
      if (_dv.lengthSq() > 0) { _dv.normalize(); state.lastMoveX = _dv.x; state.lastMoveZ = _dv.z; }
      state.dashVX        = state.lastMoveX;
      state.dashVZ        = state.lastMoveZ;
      state.dashTimer     = DASH_DURATION;
      const dashTier = (state.upg?.dash || 0);
      const dashStats = getDashStats(dashTier);
      state.dashSpeed = DASH_SPEED * dashStats.speedMult;
      state.dashCooldownMax = dashStats.cooldown;
      state.dashCooldown = state.dashCooldownMax;
      state.dashGhostTimer = 0;
      playSound('dash', 0.55, 0.95 + Math.random() * 0.1);
    }
  }
});

// Also unlock audio on first click (covers mouse users who haven't pressed a key yet)
window.addEventListener('click', () => {
  if (!_firstKeyFired && _onFirstKey) { _onFirstKey(); _firstKeyFired = true; }
}, { once: true });

window.addEventListener('keyup', e => {
  const k = e.key.toLowerCase();
  if (k === 'w' || k === 'arrowup')    state.keys.w = false;
  if (k === 's' || k === 'arrowdown')  state.keys.s = false;
  if (k === 'a' || k === 'arrowleft')  state.keys.a = false;
  if (k === 'd' || k === 'arrowright') state.keys.d = false;
});

// ─── input.js ─────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { DASH_DURATION, DASH_COOLDOWN } from './constants.js';
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
      state.dashCooldown  = DASH_COOLDOWN;
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

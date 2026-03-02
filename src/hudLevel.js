// ─── hudLevel.js ────────────────────────────────────────────────────────────
// Minimal wrapper to keep level HUD concerns separate.

import { state } from './state.js';

const levelEl = document.getElementById('level-value');

export function updateHudLevel(){
  if (levelEl) levelEl.textContent = String(state.playerLevel || 1);
}

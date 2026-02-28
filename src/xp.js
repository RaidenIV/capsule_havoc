// ─── xp.js ───────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { XP_THRESHOLDS, XP_PER_KILL_BY_LEVEL, COIN_VALUE_BY_LEVEL, LEVEL_ENEMY_CONFIG, WEAPON_CONFIG } from './constants.js';

// DOM refs (populated in ui.js but needed here for updates)
const xpLevelEl   = document.getElementById('xp-level');
const xpCurEl     = document.getElementById('xp-cur');
const xpNextEl    = document.getElementById('xp-next');
const xpBarFillEl = document.getElementById('xp-bar-fill');

export function getXPPerKill()  { return XP_PER_KILL_BY_LEVEL[Math.min(state.playerLevel, XP_PER_KILL_BY_LEVEL.length - 1)]; }
export function getCoinValue()  { return LEVEL_ENEMY_CONFIG[Math.min(state.playerLevel, LEVEL_ENEMY_CONFIG.length - 1)][1]; }
export function getEnemyHP()    { const cfg = LEVEL_ENEMY_CONFIG[Math.min(state.playerLevel, LEVEL_ENEMY_CONFIG.length - 1)]; return Math.round(30 * (1 + cfg[0])); }
export function getWeaponConfig() { return WEAPON_CONFIG[Math.min(state.playerLevel, WEAPON_CONFIG.length - 1)]; }
export function getBulletDamage() { return Math.round(10 * getWeaponConfig()[2]); }
export function getFireInterval() { return getWeaponConfig()[0]; }
export function getWaveBullets()  { return getWeaponConfig()[1]; }

export function updateXP(amount) {
  const MAX = XP_THRESHOLDS.length - 1;
  state.playerXP += amount;
  while (state.playerLevel < MAX && state.playerXP >= XP_THRESHOLDS[state.playerLevel + 1]) {
    state.playerLevel++;
  }
  const isMax     = state.playerLevel >= MAX;
  const cur       = XP_THRESHOLDS[state.playerLevel];
  const next      = isMax ? XP_THRESHOLDS[MAX] : XP_THRESHOLDS[state.playerLevel + 1];
  const progress  = state.playerXP - cur;
  const range     = next - cur;
  const pct       = isMax ? 100 : Math.min(100, (progress / range) * 100);

  if (xpLevelEl)   xpLevelEl.textContent   = state.playerLevel;
  if (xpCurEl)     xpCurEl.textContent     = isMax ? state.playerXP : progress;
  if (xpNextEl)    xpNextEl.textContent    = isMax ? 'MAX' : range;
  if (xpBarFillEl) { xpBarFillEl.style.width = pct + '%'; xpBarFillEl.classList.toggle('max', isMax); }
}

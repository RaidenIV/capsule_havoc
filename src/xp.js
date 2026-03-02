// ─── xp.js ───────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { WEAPON_CONFIG, getPlayerMaxHPForLevel, isBossLevel } from './constants.js';
import { expToNext } from './leveling.js';

// DOM refs
const xpLevelLabelEl = document.getElementById('xp-level-label');
const xpFillEl       = document.getElementById('xp-fill') || document.getElementById('xp-bar-fill');
const xpLevelElLegacy= document.getElementById('xp-level');
const xpCurElLegacy  = document.getElementById('xp-cur');
const xpNextElLegacy = document.getElementById('xp-next');

export function getWeaponConfig() {
  const t = (state.weaponTier ?? 0);
  if (t <= 0) return [9999, 0, 0, 0, 0, 0, 0];
  const idx = Math.min(Math.max(t - 1, 0), WEAPON_CONFIG.length - 1);
  return WEAPON_CONFIG[idx];
}
export function getBulletDamage() { return Math.round(10 * getWeaponConfig()[2]); }
export function getFireInterval() { return getWeaponConfig()[0]; }
export function getWaveBullets()  { return getWeaponConfig()[1]; }

function syncXPUI() {
  const L = Math.max(1, Math.floor(state.playerLevel || 1));
  const need = expToNext(L);
  const cur  = Math.max(0, Math.floor(state.playerXP || 0));
  const isMax = (L >= 100) || (need <= 0);

  const pct = isMax ? 100 : Math.min(100, (cur / need) * 100);

  if (xpLevelLabelEl) xpLevelLabelEl.textContent = `LV ${L}`;
  if (xpLevelElLegacy) xpLevelElLegacy.textContent = L;
  if (xpCurElLegacy) xpCurElLegacy.textContent = isMax ? 'MAX' : cur;
  if (xpNextElLegacy) xpNextElLegacy.textContent = isMax ? 'MAX' : need;
  if (xpFillEl) { xpFillEl.style.width = pct + '%'; xpFillEl.classList.toggle('max', isMax); }
}

export function updateXP(amount) {
  const add = Math.max(0, Math.floor(amount || 0));
  if (!Number.isFinite(add) || add <= 0) { syncXPUI(); return; }

  if (!state.playerLevel || state.playerLevel < 1) state.playerLevel = 1;
  if (!Number.isFinite(state.playerXP) || state.playerXP < 0) state.playerXP = 0;

  state.playerXP += add;

  while (state.playerLevel < 100) {
    const need = expToNext(state.playerLevel);
    if (need <= 0) break;
    if (state.playerXP < need) break;

    state.playerXP -= need;
    const prevLevel = state.playerLevel;
    state.playerLevel++;

    // Player HP scaling (design doc)
    const prevMax = state.playerMaxHP || getPlayerMaxHPForLevel(prevLevel);
    const newMax  = getPlayerMaxHPForLevel(state.playerLevel);
    const pct = prevMax > 0 ? (state.playerHP / prevMax) : 1;
    state.playerMaxHP = newMax;
    state.playerHP = Math.max(1, pct * newMax);

    // Shop after every level up (but avoid interrupting boss waves)
    if (!isBossLevel(state.playerLevel)) state.pendingShop = true;
  }

  syncXPUI();
}

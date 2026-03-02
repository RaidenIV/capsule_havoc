// ─── xp.js ───────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { WEAPON_CONFIG, getPlayerMaxHPForLevel, isBossLevel } from './constants.js';
import { expToNext } from './leveling.js';
import { getDamageMultiplier, getXPMultiplier } from './activeEffects.js';

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
export function getBulletDamage() {
  const base = state.playerBaseDMG || 10;
  const dmgTier = Math.max(0, state.upg?.dmg || 0);
  const mult = 1 + 0.15 * dmgTier;
  const tierMult = getWeaponConfig()[2] || 1;
  const eff = getDamageMultiplier();
  return Math.round(base * mult * tierMult * eff);
}
export function getFireInterval() {
  const base = getWeaponConfig()[0] || 0.85;
  const frTier = Math.max(0, state.upg?.fireRate || 0);
  const mult = Math.pow(0.90, frTier); // -10% per tier
  return Math.max(0.06, base * mult);
}
export function getWaveBullets()  {
  // Base wave count comes from weapon tier config; multishot handled in weapons.js as additional pellets.
  return getWeaponConfig()[1] || 0;
}

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
  // XP Growth (+15% per tier) + Curse (+10% per tier)
  const growthTier = Math.max(0, state.upg?.xpGrowth || 0);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const mult = (1 + 0.15 * growthTier) * (1 + 0.10 * curseTier) * getXPMultiplier();
  const add = Math.max(0, Math.floor((amount || 0) * mult));
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

    // Player HP scaling (design doc) + Max Health upgrade
    const prevMax = state.playerMaxHP || getPlayerMaxHPForLevel(prevLevel);
    const newBase  = getPlayerMaxHPForLevel(state.playerLevel);
    const hpTier = Math.max(0, state.upg?.maxHealth || 0);
    const newMax  = Math.round(newBase * (1 + 0.10 * hpTier));
    const pct = prevMax > 0 ? (state.playerHP / prevMax) : 1;
    state.playerMaxHP = newMax;
    state.playerHP = Math.max(1, pct * newMax);

    // Base damage scaling (Section 6: +5 damage per level)
    state.playerBaseDMG = 10 + 5 * Math.max(0, (state.playerLevel || 1) - 1);

    // Shop after every level up (but avoid interrupting boss waves)
    if (!isBossLevel(state.playerLevel)) state.pendingShop = true;
  }

  syncXPUI();
}

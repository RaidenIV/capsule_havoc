// ─── xp.js ───────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { getPlayerMaxHPForLevel } from './constants.js';
import { expToNext } from './leveling.js';
import { getDamageMultiplier, getXPMultiplier } from './activeEffects.js';

// DOM refs
const xpLevelLabelEl = document.getElementById('xp-level-label');
const xpFillEl       = document.getElementById('xp-fill') || document.getElementById('xp-bar-fill');
const xpLevelElLegacy= document.getElementById('xp-level');
const xpCurElLegacy  = document.getElementById('xp-cur');
const xpNextElLegacy = document.getElementById('xp-next');

function hasLaserLoadout() {
  return state.characterPrimaryWeapon === 'laser' || state.selectedCharacter === 'blue' || (state.weaponTier || 0) >= 1;
}

function getLaserPatternTier() {
  return Math.max(0, Math.min(5, state.upg?.laserFire || 0));
}

function getLaserVolleyCount() {
  if (!hasLaserLoadout()) return 0;
  return [6, 7, 8, 9, 10, 10][getLaserPatternTier()] || 0;
}

export function getWeaponConfig() {
  const waveBullets = getLaserVolleyCount();
  const orbitCount = [0, 2, 3, 4, 5, 6][Math.min(Math.max(0, state.upg?.orbit || 0), 5)] || 0;
  const orbitRadius = 1.9 + Math.max(0, state.upg?.orbitRange || 0) * 0.22;
  const orbitSpeed = 1.7 + Math.max(0, state.upg?.orbitSpeed || 0) * 0.20;
  return [getFireInterval(), waveBullets, 1.0, orbitCount, orbitRadius, orbitSpeed, 0x00eeff];
}
export function getBulletDamage() {
  const base = state.playerBaseDMG || 10;
  const dmgTier = Math.max(0, state.upg?.dmg || 0);
  const mult = 1 + 0.10 * dmgTier;
  const eff = getDamageMultiplier();
  return Math.round(base * mult * eff);
}
export function getFireInterval() {
  return hasLaserLoadout() ? 1.0 : 9999;
}
export function getWaveBullets()  {
  return getLaserVolleyCount();
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

    // Base damage scaling (Section 6: DMG(L) = 10 + floor((L-1)² / 50))
    // Quadratic — reaches 204 DMG at level 100 vs 10 at level 1.
    state.playerBaseDMG = 10 + Math.floor(Math.pow(Math.max(0, state.playerLevel - 1), 2) / 50);

    // Queue a shop after every level-up. Use a counter so multi-level gains
    // cannot collapse into a single shop open.
    state.pendingShop = Math.max(0, Number(state.pendingShop) || 0) + 1;
  }

  syncXPUI();
}

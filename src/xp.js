// ─── xp.js ───────────────────────────────────────────────────────────────────
import { state } from './state.js';
import { getPlayerMaxHPForLevel, getPlayerBaseDamageForLevel, LEVEL_UP_HEAL_FRACTION, getXPGrowthBonusForTier } from './constants.js';
import { expToNext } from './leveling.js';
import { getDamageMultiplier, getXPMultiplier } from './activeEffects.js';
import { notifyPowerup } from './hudEffects.js';

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

const STANDARD_COSTS = [10, 50, 250, 1000, 2000];
const MULTISHOT_COSTS = [1000, 2000];
const SHOP_UPGRADES = [
  { key: 'laserFire', costs: STANDARD_COSTS },
  { key: 'orbit', costs: STANDARD_COSTS },
  { key: 'dmg', costs: STANDARD_COSTS },
  { key: 'fireRate', costs: STANDARD_COSTS },
  { key: 'projSpeed', costs: STANDARD_COSTS },
  { key: 'piercing', costs: STANDARD_COSTS },
  { key: 'multishot', costs: MULTISHOT_COSTS },
  { key: 'targetedFire', costs: STANDARD_COSTS },
  { key: 'targetedCooldown', costs: STANDARD_COSTS, requires: { key: 'targetedFire', minTier: 1 } },
  { key: 'lightning', costs: STANDARD_COSTS },
  { key: 'moveSpeed', costs: STANDARD_COSTS },
  { key: 'dash', costs: STANDARD_COSTS },
  { key: 'magnet', costs: STANDARD_COSTS },
  { key: 'shield', costs: STANDARD_COSTS },
  { key: 'maxHealth', costs: STANDARD_COSTS },
  { key: 'regen', costs: STANDARD_COSTS },
  { key: 'xpGrowth', costs: STANDARD_COSTS },
  { key: 'coinBonus', costs: STANDARD_COSTS },
  { key: 'luck', costs: STANDARD_COSTS },
];
const RED_LASER_LOCKOUT = new Set(['laserFire', 'fireRate', 'projSpeed', 'piercing', 'multishot']);

function getShopTierForKey(key) {
  if (key === 'targetedCooldown' || key === 'targetedDamage' || key === 'targetedRange') {
    return Math.max(0, state.upg?.targetedCooldown || 0, state.upg?.targetedDamage || 0, state.upg?.targetedRange || 0);
  }
  if (key === 'lightning' || key === 'lightningDamage' || key === 'lightningCooldown') {
    return Math.max(0, state.upg?.lightning || 0, state.upg?.lightningDamage || 0, state.upg?.lightningCooldown || 0);
  }
  return Math.max(0, state.upg?.[key] || 0);
}

function meetsShopRequirement(upg) {
  if (!upg?.requires) return true;
  const minTier = Number.isFinite(upg.requires.minTier) ? upg.requires.minTier : 1;
  return getShopTierForKey(upg.requires.key) >= minTier;
}

function isUpgradeAllowedForLoadout(key) {
  const loadout = state.characterPrimaryWeapon === 'laser'
    ? 'laser'
    : (state.characterPrimaryWeapon === 'slash' || state.selectedCharacter === 'red' ? 'slash' : (state.selectedCharacter === 'blue' ? 'laser' : null));
  if (loadout === 'slash' && RED_LASER_LOCKOUT.has(key)) return false;
  return true;
}

function isTierOneOnlyWindow(level) {
  return Math.max(1, Math.floor(level || state.playerLevel || 1)) <= 3;
}

function getShopCostForTierLite(upg, currentTier, freeShop, level) {
  if (freeShop && currentTier === 0 && upg.key !== 'multishot') return 0;
  const baseCost = upg.costs[currentTier] ?? Number.POSITIVE_INFINITY;
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  if (currentTier === 0 && upg.costs === STANDARD_COSTS && L >= 3) return Math.max(baseCost, 20);
  return baseCost;
}

function getCheapestEligibleUpgradeCost(level) {
  const freeShop = !state.firstLevelUpShopHandled && Math.max(1, Math.floor(level || state.playerLevel || 1)) <= 2;
  let cheapest = Number.POSITIVE_INFINITY;
  for (const upg of SHOP_UPGRADES) {
    const cur = getShopTierForKey(upg.key);
    if (cur >= upg.costs.length) continue;
    if (!meetsShopRequirement(upg) || !isUpgradeAllowedForLoadout(upg.key)) continue;
    if (isTierOneOnlyWindow(level) && (cur !== 0 || upg.key === 'multishot')) continue;
    const cost = getShopCostForTierLite(upg, cur, freeShop, level);
    if (Number.isFinite(cost) && cost < cheapest) cheapest = cost;
  }
  return cheapest;
}

export function getWeaponConfig() {
  const waveBullets = getLaserVolleyCount();
  const orbitCount = [0, 2, 3, 4, 5, 6][Math.min(Math.max(0, state.upg?.orbit || 0), 5)] || 0;
  const orbitTier = Math.min(Math.max(0, state.upg?.orbit || 0), 5);
  const orbitRadius = 1.9 + Math.max(0, orbitTier - 1) * 0.35 + Math.max(0, state.upg?.orbitRange || 0) * 0.22;
  const orbitSpeed = (1.7 * 2.0) * (1 + 0.15 * orbitTier) + Math.max(0, state.upg?.orbitSpeed || 0) * 0.20;
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
  if (!hasLaserLoadout()) return 9999;
  const base = 1.0;
  const fireRateTier = Math.max(0, state.upg?.fireRate || 0);
  return Math.max(0.35, base * Math.pow(0.90, fireRateTier));
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
  // XP Growth tiers: +10/+20/+30/+40/+50%  + Curse (+10% per tier)
  const growthTier = Math.max(0, state.upg?.xpGrowth || 0);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const growthBonus = getXPGrowthBonusForTier(growthTier);
  const mult = (1 + growthBonus) * (1 + 0.10 * curseTier) * getXPMultiplier();
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
    const prevMax = Math.max(1, state.playerMaxHP || getPlayerMaxHPForLevel(prevLevel));
    const prevHP = Math.max(0, state.playerHP || prevMax);
    const wasFull = prevHP >= (prevMax - 0.001);
    const newBase  = getPlayerMaxHPForLevel(state.playerLevel);
    const hpTier = Math.max(0, state.upg?.maxHealth || 0);
    const newMax  = Math.round(newBase * (1 + 0.10 * hpTier));
    const levelUpHeal = Math.max(1, Math.round(newMax * LEVEL_UP_HEAL_FRACTION));
    state.playerMaxHP = newMax;
    state.playerHP = wasFull ? newMax : Math.min(newMax, Math.round(prevHP + levelUpHeal));

    // Controlled late-run damage growth so the player scales up without flattening
    // higher-tier enemies. Upgrades, multishot, orbit, targeted fire, and effects
    // still stack on top of this base value.
    state.playerBaseDMG = getPlayerBaseDamageForLevel(state.playerLevel);

    const cheapestUpgradeCost = getCheapestEligibleUpgradeCost(state.playerLevel);
    if (Number.isFinite(cheapestUpgradeCost) && cheapestUpgradeCost > 0 && (state.coins || 0) < cheapestUpgradeCost) {
      const bonusCoins = cheapestUpgradeCost - (state.coins || 0);
      state.coins += bonusCoins;
      const coinEl = document.getElementById('coin-count');
      if (coinEl) coinEl.textContent = state.coins;
      notifyPowerup(`Level Bonus +${bonusCoins} Coins`, null);
    }

    // Queue a shop for every level-up, including boss levels. Using a numeric queue
    // avoids skipped shops when a single XP gain grants multiple levels.
    state.pendingShop = Math.max(0, Number(state.pendingShop) || 0) + 1;
  }

  syncXPUI();
}

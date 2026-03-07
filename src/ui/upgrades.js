// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
// Draft-style upgrade shop with 3 rolled choices per shop (Luck can add a 4th
// later in the run), plus boss-chest rewards and timed Chaos state support.

import { state } from '../state.js';
import { playSound } from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';
import { getFireInterval, getWaveBullets, getBulletDamage } from '../xp.js';
import { updateHealthBar } from '../player.js';
import { initHudCoin } from '../hudCoin.js';
import { recomputeLuck, getFourthOptionChance } from '../luck.js';

function $(id) { return document.getElementById(id); }
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
function shuffle(arr){
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
function choice(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

const COST_BY_TIER = [10, 50, 250, 1000, 2000];
const CHAOS_DURATION_SEC = 60;

function getTier(key){
  return Math.max(0, state.upg?.[key] || 0);
}

function getLoadoutWeapon(){
  if (state.characterPrimaryWeapon === 'laser' || state.characterPrimaryWeapon === 'slash') return state.characterPrimaryWeapon;
  if (state.selectedCharacter === 'blue') return 'laser';
  if (state.selectedCharacter === 'red') return 'slash';
  return null;
}

function meetsRequirement(upgDef){
  const req = upgDef?.requires;
  if (!req) return true;
  const minTier = Number.isFinite(req.minTier) ? req.minTier : 1;
  return getTier(req.key) >= minTier;
}

function getUpgradeCost(upgDef, nextTier){
  if (nextTier <= 1 && upgDef.freeStarter) return 0;
  const idx = clamp((nextTier | 0) - 1, 0, COST_BY_TIER.length - 1);
  return COST_BY_TIER[idx] ?? COST_BY_TIER[COST_BY_TIER.length - 1];
}

function getDashStatsForTier(tier){
  const t = clamp(tier | 0, 0, 5);
  return {
    distancePct: [0, 50, 62, 75, 88, 100][t] || 50,
    cooldown: [0, 1.40, 1.20, 1.00, 0.82, 0.68][t] || 1.40,
  };
}

function getSlashStatsForTier(tier){
  const t = clamp(tier | 0, 0, 5);
  return {
    damagePct: Math.max(0, (t - 1) * 20),
    reachPct: Math.max(0, (t - 1) * 5),
    speedPct: Math.max(0, Math.round((1 - Math.pow(0.92, Math.max(0, t - 1))) * 100)),
  };
}

function getActiveChaosTier(){
  return (state.chaosTimer || 0) > 0 ? Math.max(0, state.curseTier || 0) : 0;
}

function getChaosDesc(tier){
  const t = clamp(tier | 0, 1, 3);
  return `Enemies +${t * 20}% HP/DMG → +${t * 25}% coins, +${t * 10}% XP for 60s`;
}

function activateChaos(tier){
  const t = clamp(tier | 0, 1, 3);
  const prev = (state.chaosTimer || 0) > 0 ? Math.max(0, state.curseTier || 0) : 0;
  state.curseTier = Math.max(prev, t);
  state.chaosTimer = CHAOS_DURATION_SEC;
}

const CATEGORIES = [
  {
    id: 'weapons',
    label: 'Weapons',
    upgrades: [
      { key: 'laserFire', name: 'Laser Shot', maxTier: 5, freeStarter: true,
        desc: t => t === 1 ? 'Unlocks the base laser weapon for free' : `Improves laser tier to ${t}` },
      { key: 'slash', name: 'Slash', maxTier: 5, freeStarter: true,
        desc: t => t === 1 ? 'Unlocks the base slash weapon for free' : `+${getSlashStatsForTier(t).damagePct}% slash damage • +${getSlashStatsForTier(t).reachPct}% reach • ${getSlashStatsForTier(t).speedPct}% faster` },
      { key: 'orbit', name: 'Orbit Weapon', maxTier: 5,
        desc: t => t === 1 ? 'Unlocks orbiting bullets' : `Improves orbit weapon to Tier ${t}` },
      { key: 'dmg', name: 'Damage', maxTier: 5,
        desc: t => `+15% all player damage (Tier ${t})` },
      { key: 'fireRate', name: 'Fire Rate', maxTier: 5, requires: { key: 'laserFire', minTier: 1 },
        desc: t => `Laser cooldown -${t * 10}%` },
      { key: 'projSpeed', name: 'Projectile Speed', maxTier: 4, requires: { key: 'laserFire', minTier: 1 },
        desc: t => `Laser projectile speed +${t * 20}%` },
      { key: 'piercing', name: 'Piercing', maxTier: 3, requires: { key: 'laserFire', minTier: 1 },
        desc: t => `Lasers pierce +${t} enemy${t === 1 ? '' : 'ies'} per shot` },
      { key: 'multishot', name: 'Multishot', maxTier: 3, requires: { key: 'laserFire', minTier: 1 },
        desc: t => `+${t} extra projectile${t === 1 ? '' : 's'} per volley direction` },
    ],
  },
  {
    id: 'movement',
    label: 'Movement',
    upgrades: [
      { key: 'moveSpeed', name: 'Move Speed', maxTier: 5,
        desc: t => `+${t * 8}% movement speed` },
      { key: 'dash', name: 'Dash', maxTier: 5,
        desc: t => {
          const ds = getDashStatsForTier(t);
          return t === 1
            ? `Unlocks dash • ${ds.distancePct}% base distance • ${ds.cooldown.toFixed(2)}s cooldown`
            : `Dash ${ds.distancePct}% distance • ${ds.cooldown.toFixed(2)}s cooldown`;
        } },
      { key: 'magnet', name: 'Magnet Radius', maxTier: 4,
        desc: t => `+${(t * 1.25).toFixed(2)} pickup attraction range` },
    ],
  },
  {
    id: 'abilities',
    label: 'Abilities',
    upgrades: [
      { key: 'shield', name: 'Shield', maxTier: 3,
        desc: t => ['Rechargeable 1.5-radius bubble shield', 'Shield recharge -35%', '2-hit bubble shield'][t - 1] },
      { key: 'burst', name: 'Area Burst [E]', maxTier: 4,
        desc: t => ['Unlocks Area Burst', '+Burst damage', '+Burst damage', '+Large radius burst'][t - 1] },
      { key: 'timeSlow', name: 'Time Slow [Q]', maxTier: 3,
        desc: t => ['Unlocks Time Slow', '+Longer Time Slow', '+Stronger Time Slow'][t - 1] },
    ],
  },
  {
    id: 'powerups',
    label: 'Power Ups',
    upgrades: [
      { key: 'maxHealth', name: 'Max Health', maxTier: 5,
        desc: t => `+${t * 10}% max HP` },
      { key: 'regen', name: 'Health Regen', maxTier: 4,
        desc: t => `+${t} HP/sec regeneration` },
      { key: 'xpGrowth', name: 'XP Growth', maxTier: 4,
        desc: t => `+${t * 15}% XP from kills` },
      { key: 'coinBonus', name: 'Coin Bonus', maxTier: 3,
        desc: t => `+${t * 20}% coins from kills` },
      { key: 'luck', name: 'Luck', maxTier: 3,
        desc: t => `+${t * 10} Luck — improves chest rolls and late-shop 4th option chance` },
    ],
  },
];

const ALL_UPGRADES = CATEGORIES.flatMap(cat => cat.upgrades);
const RED_LASER_LOCKOUT = new Set(['laserFire', 'fireRate', 'projSpeed', 'piercing', 'multishot']);
const BLUE_SLASH_LOCKOUT = new Set(['slash']);

function isUpgradeAllowedForLoadout(upg){
  const loadout = getLoadoutWeapon();
  if (loadout === 'slash' && RED_LASER_LOCKOUT.has(upg.key)) return false;
  if (loadout === 'laser' && BLUE_SLASH_LOCKOUT.has(upg.key)) return false;
  return true;
}

function getEligibleUpgrades(category){
  return category.upgrades.filter(upg => {
    const cur = getTier(upg.key);
    return cur < upg.maxTier && meetsRequirement(upg) && isUpgradeAllowedForLoadout(upg);
  });
}

function getDesiredOptionCount(level){
  recomputeLuck();
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  const canRollFourth = L >= 20 && (state.luck || 0) >= 10;
  if (!canRollFourth) return 3;
  return Math.random() < getFourthOptionChance() ? 4 : 3;
}

function getForcedStarterChoices(level){
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  if (L > 3) return [];
  const forced = [];
  const laser = CATEGORIES[0].upgrades.find(u => u.key === 'laserFire');
  const slash = CATEGORIES[0].upgrades.find(u => u.key === 'slash');
  if (laser && getTier('laserFire') === 0 && isUpgradeAllowedForLoadout(laser)) forced.push({ category: 'weapons', upgrade: laser, forcedStarter: true });
  if (slash && getTier('slash') === 0 && isUpgradeAllowedForLoadout(slash)) forced.push({ category: 'weapons', upgrade: slash, forcedStarter: true });
  return forced;
}

function rollShopChoices(level){
  const desired = getDesiredOptionCount(level);
  const forced = getForcedStarterChoices(level);
  const picks = [];
  const usedKeys = new Set();
  const usedCategories = new Set();

  for (const item of forced) {
    if (picks.length >= desired) break;
    picks.push(item);
    usedKeys.add(item.upgrade.key);
    usedCategories.add(item.category);
  }

  const remainingCategories = shuffle(CATEGORIES.filter(cat => !usedCategories.has(cat.id) && getEligibleUpgrades(cat).length > 0));
  for (const cat of remainingCategories) {
    if (picks.length >= desired) break;
    const options = getEligibleUpgrades(cat).filter(upg => !usedKeys.has(upg.key));
    if (!options.length) continue;
    const pick = choice(options);
    picks.push({ category: cat.id, upgrade: pick, forcedStarter: false });
    usedKeys.add(pick.key);
    usedCategories.add(cat.id);
  }

  if (picks.length < desired) {
    const fallbackPool = shuffle(ALL_UPGRADES.filter(upg => {
      const cur = getTier(upg.key);
      return cur < upg.maxTier && !usedKeys.has(upg.key) && meetsRequirement(upg) && isUpgradeAllowedForLoadout(upg);
    }));
    while (picks.length < desired && fallbackPool.length) {
      const upg = fallbackPool.shift();
      picks.push({ category: 'bonus', upgrade: upg, forcedStarter: false });
      usedKeys.add(upg.key);
    }
  }

  return picks.slice(0, desired);
}

function getShopBottomHint(level){
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  const luck = Math.round(state.luck || 0);
  if (L < 20) return 'Luck can reveal a 4th option starting around midgame (level 20+). Tier 1 starter weapons are always free.';
  if (luck < 10) return 'Luck 10+ starts rolling for a 4th shop option. Tier 1 non-starter upgrades cost 10 coins.';
  const pct = Math.round(getFourthOptionChance() * 100);
  return `Luck can reveal a 4th option on shop open. Current chance: ${pct}% • Tier 1 starter weapons are free.`;
}

function applyUpgradeEffect(key, newTier) {
  switch (key) {
    case 'dash':
      if (newTier >= 1) state.hasDash = true;
      break;

    case 'luck':
      try { recomputeLuck(); } catch {}
      break;

    case 'maxHealth': {
      const base = Math.max(1, state.basePlayerMaxHP || 100);
      const newMax = Math.round(base * (1 + 0.10 * newTier));
      const prevMax = Math.max(1, state.playerMaxHP || base);
      const pct = (state.playerHP || prevMax) / prevMax;
      state.playerMaxHP = newMax;
      state.playerHP = Math.max(1, Math.round(pct * newMax));
      try { updateHealthBar(); } catch {}
      break;
    }

    case 'shield':
      if (newTier >= 1 && (state.shieldCharges || 0) <= 0) {
        state.shieldCharges = 1;
        state.shieldRecharge = 0;
      }
      if (newTier >= 3) state.shieldCharges = Math.max(state.shieldCharges, 2);
      break;

    case 'laserFire':
      state.weaponTier = Math.max(state.weaponTier || 0, newTier);
      break;

    case 'slash':
      state._slashTimer = 0;
      break;

    case 'orbit':
    case 'dmg':
    case 'fireRate':
    case 'projSpeed':
    case 'multishot':
      try { syncOrbitBullets(); } catch {}
      break;

    default:
      break;
  }
}

let _statsPanel = null;
let _shopChoices = [];
let _shopLevel = 1;
let _purchaseLocked = false;
let _onClose = null;

function ensureStatsPanel(){
  if (_statsPanel) return _statsPanel;
  const overlay = $('upgradeOverlay');
  if (!overlay) return null;
  const panel = document.createElement('div');
  panel.id = 'upgradeStatsPanel';
  panel.innerHTML = `
    <div style="font-weight:900;letter-spacing:0.08em;font-size:13px;opacity:0.9;margin-bottom:10px;">PLAYER STATS</div>
    <div id="upgradeStatsBody" style="display:flex;flex-direction:column;gap:8px;"></div>
  `;
  overlay.appendChild(panel);
  _statsPanel = panel;
  return panel;
}

function _statRow(label, value){
  return `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;">
      <div style="opacity:0.85;font-weight:700;font-size:13px;">${label}</div>
      <div style="font-weight:900;font-size:14px;white-space:nowrap;">${value}</div>
    </div>`;
}

function _statSection(label){
  return `<div style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);font-weight:900;font-size:11px;letter-spacing:0.10em;opacity:0.72;">${label}</div>`;
}

function updateStatsPanel(){
  const panel = ensureStatsPanel();
  if (!panel) return;
  const body = panel.querySelector('#upgradeStatsBody');
  if (!body) return;

  const hp = Math.round(state.playerHP || 0);
  const maxHp = Math.round(state.playerMaxHP || 100);
  const bulletDmg = Math.round(getBulletDamage());
  const waveDirs = Math.max(0, getWaveBullets());
  const fire = getFireInterval();
  const loadout = getLoadoutWeapon();
  const laserTier = getTier('laserFire');
  const slashTier = getTier('slash');
  const orbitTier = getTier('orbit');
  const dmgTier = getTier('dmg');
  const fireRateTier = getTier('fireRate');
  const msTier = getTier('multishot');
  const psTier = getTier('projSpeed');
  const pierce = getTier('piercing');
  const moveTier = getTier('moveSpeed');
  const dashTier = getTier('dash');
  const magnetTier = getTier('magnet');
  const shieldTier = getTier('shield');
  const burstTier = getTier('burst');
  const timeSlowTier = getTier('timeSlow');
  const maxHealthTier = getTier('maxHealth');
  const regenTier = getTier('regen');
  const xpGrowthTier = getTier('xpGrowth');
  const coinBonusTier = getTier('coinBonus');
  const luckTier = getTier('luck');
  const armorHits = Math.max(0, state.armorHits || 0);
  const chaosTier = getActiveChaosTier();
  const chaosTimer = Math.max(0, Math.ceil(state.chaosTimer || 0));
  const slashStats = getSlashStatsForTier(Math.max(1, slashTier));
  const slashDmg = Math.max(1, Math.round(bulletDmg * 1.8 * (1 + 0.20 * Math.max(0, slashTier - 1))));
  const slashInterval = slashTier > 0 ? Math.max(0.35, 1.0 * Math.pow(0.92, Math.max(0, slashTier - 1))) : 1.0;
  const totalProjectiles = Math.max(1, waveDirs) * (1 + msTier);
  const dashStats = dashTier > 0 ? getDashStatsForTier(dashTier) : null;
  const shieldCharges = shieldTier >= 3 ? 2 : (shieldTier >= 1 ? 1 : 0);
  const shieldRecharge = shieldTier > 0 ? (shieldTier >= 2 ? 12.0 * 0.65 : 12.0) : 0;
  const burstDmg = burstTier > 0 ? ((burstTier >= 4) ? 180 : (70 + burstTier * 30)) : 0;
  const burstRadius = burstTier > 0 ? ((burstTier >= 4) ? 11.0 : 5.5) : 0;
  const timeSlowDuration = timeSlowTier > 0 ? (timeSlowTier >= 2 ? 5.0 : 3.0) : 0;
  const timeSlowScale = timeSlowTier >= 3 ? 0.25 : (timeSlowTier >= 1 ? 0.5 : 1.0);

  const rows = [
    _statSection('CORE'),
    _statRow('HP', `${hp} / ${maxHp}`),
  ];

  rows.push(_statSection('WEAPONS'));
  if ((loadout === 'slash') || slashTier > 0) {
    rows.push(_statRow('Slash DMG', `${slashDmg}`));
    rows.push(_statRow('Slash Rate', `${slashInterval.toFixed(2)}s`));
    rows.push(_statRow('Slash Reach', `+${slashStats.reachPct}%`));
  }
  if ((loadout === 'laser') || laserTier > 0 || (state.weaponTier || 0) >= 1) {
    rows.push(_statRow('Laser DMG', `${bulletDmg} / shot`));
    rows.push(_statRow('Volley', `${Math.max(1, totalProjectiles)} proj`));
    rows.push(_statRow('Fire Interval', `${fire.toFixed(2)}s`));
  }
  if (orbitTier > 0) rows.push(_statRow('Orbit DMG', `${bulletDmg} / hit`));
  if (burstTier > 0) {
    rows.push(_statRow('Burst DMG', `${burstDmg}`));
    rows.push(_statRow('Burst Radius', `${burstRadius.toFixed(1)}`));
  }

  const ownedRows = [];
  if (dmgTier > 0) ownedRows.push(_statRow('Damage Bonus', `+${dmgTier * 15}%`));
  if (fireRateTier > 0 && ((laserTier > 0) || loadout === 'laser')) ownedRows.push(_statRow('Fire Rate Bonus', `-${fireRateTier * 10}% CD`));
  if (msTier > 0 && ((laserTier > 0) || loadout === 'laser')) ownedRows.push(_statRow('Multishot', `+${msTier} / dir`));
  if (psTier > 0 && ((laserTier > 0) || loadout === 'laser')) ownedRows.push(_statRow('Proj Speed', `+${psTier * 20}%`));
  if (pierce > 0) ownedRows.push(_statRow('Piercing', `+${pierce}`));
  if (moveTier > 0) ownedRows.push(_statRow('Move Speed', `+${moveTier * 8}%`));
  if (dashTier > 0 && dashStats) ownedRows.push(_statRow('Dash', `${dashStats.distancePct}% dist • ${dashStats.cooldown.toFixed(2)}s`));
  if (magnetTier > 0) ownedRows.push(_statRow('Magnet Radius', `+${(magnetTier * 1.25).toFixed(2)}`));
  if (shieldTier > 0) ownedRows.push(_statRow('Shield', `${shieldCharges} hit • 1.5 radius • ${shieldRecharge.toFixed(1)}s recharge`));
  if (timeSlowTier > 0) ownedRows.push(_statRow('Time Slow', `${(timeSlowScale * 100).toFixed(0)}% speed • ${timeSlowDuration.toFixed(0)}s`));
  if (maxHealthTier > 0) ownedRows.push(_statRow('Max HP Bonus', `+${maxHealthTier * 10}%`));
  if (regenTier > 0) ownedRows.push(_statRow('Regen', `${regenTier} HP/s`));
  if (xpGrowthTier > 0) ownedRows.push(_statRow('XP Growth', `+${xpGrowthTier * 15}%`));
  if (coinBonusTier > 0) ownedRows.push(_statRow('Coin Bonus', `+${coinBonusTier * 20}%`));
  if (luckTier > 0) ownedRows.push(_statRow('Luck', `+${luckTier * 10}`));
  if (chaosTier > 0) ownedRows.push(_statRow('Chaos', `T${chaosTier} • ${chaosTimer}s`));
  if (armorHits > 0) ownedRows.push(_statRow('Armor Hits', `${armorHits}`));

  if (ownedRows.length > 0) {
    rows.push(_statSection('OWNED UPGRADES'));
    rows.push(...ownedRows);
  }

  body.innerHTML = rows.join('');
}

function ensureShopStyles() {
  if (document.getElementById('shop-dynamic-styles')) return;
  const style = document.createElement('style');
  style.id = 'shop-dynamic-styles';
  style.textContent = `
    #upgradeStatsPanel {
      position:absolute; left:18px; top:92px; width:260px; max-height:calc(100% - 140px);
      overflow:auto; padding:14px; border-radius:18px; background:#06080f;
      border:1px solid rgba(0,229,255,0.12); box-shadow:0 12px 34px rgba(0,0,0,0.40);
      backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); color:#fff; z-index:5;
      font-family: Rajdhani, system-ui, sans-serif;
    }
    .shop-draft-head {
      margin: 0 0 12px; padding: 0 0 10px; border-bottom: 1px solid rgba(255,255,255,0.08);
      display:flex; flex-direction:column; gap:6px;
    }
    .shop-draft-title {
      font-family: var(--mono, monospace); font-size:11px; letter-spacing:.22em; text-transform:uppercase;
      color: rgba(0,229,255,0.8);
    }
    .shop-draft-sub {
      font-family: var(--mono, monospace); font-size:10px; letter-spacing:.06em; color: rgba(255,255,255,0.4);
      line-height:1.4;
    }
    .upgrade-row.is-locked-choice { opacity: 0.55; }
    .upgrade-row.is-bought-choice { border-color: rgba(0,255,120,0.28); box-shadow: 0 0 0 1px rgba(0,255,120,0.12) inset; }
    .upgrade-row.is-forced-choice { border-color: rgba(255,215,80,0.30); }
    .upg-tierline { margin-top:6px; display:flex; gap:3px; align-items:center; }
    .upg-pip { width:14px; height:2px; border-radius:1px; background:rgba(255,255,255,0.12); }
    .upg-pip.filled { background:rgba(0,229,255,0.72); }
    .shop-luck-note {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);
      font-family: var(--mono, monospace); font-size:10px; color: rgba(255,255,255,0.42); line-height:1.45;
    }
    .shop-cat-pill {
      display:inline-flex; align-items:center; gap:6px; margin-bottom:6px; padding:2px 8px; border-radius:999px;
      background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.08);
      font-family: var(--mono, monospace); font-size:9px; letter-spacing:.14em; text-transform:uppercase; color:rgba(255,255,255,0.45);
    }
    #chestOverlay {
      display:none; position:fixed; inset:0; z-index:120;
      background:rgba(0,2,8,0.92); backdrop-filter:blur(10px);
      align-items:center; justify-content:center;
    }
    #chestOverlay.show { display:flex; }
    #chestOverlay .chest-box {
      background:#06080f; border:1px solid rgba(0,229,255,0.18);
      border-radius:10px; padding:28px; min-width:320px; max-width:500px; width:90%;
      display:flex; flex-direction:column; gap:16px;
      box-shadow:0 40px 100px rgba(0,0,0,0.9);
      position:relative; overflow:hidden;
    }
    #chestOverlay .chest-box::before {
      content:''; position:absolute; top:0; left:0; right:0; height:1px;
      background:linear-gradient(90deg,transparent,rgba(0,229,255,0.7) 50%,transparent);
    }
    #chestOverlay h2 {
      font-family:var(--mono,monospace); font-size:11px; font-weight:700;
      letter-spacing:.28em; text-transform:uppercase; margin:0; text-align:center;
    }
    #chestOverlay .chest-sub {
      font-family:var(--mono,monospace); font-size:10px; letter-spacing:.12em;
      color:rgba(255,255,255,0.28); text-align:center; margin-top:-10px;
    }
    #chestOverlay .chest-items { display:flex; flex-direction:column; gap:6px; }
    #chestOverlay .chest-item {
      padding:11px 14px; border-radius:6px;
      background:transparent; border:1px solid rgba(255,255,255,0.08);
      cursor:pointer; transition:background .12s, border-color .12s;
    }
    #chestOverlay .chest-item:hover {
      background:rgba(0,229,255,0.05); border-color:rgba(0,229,255,0.25);
    }
    #chestOverlay .chest-item .ci-name {
      font-family:Rajdhani,system-ui,sans-serif; font-size:14px; font-weight:700;
      letter-spacing:.05em; color:rgba(255,255,255,0.88);
    }
    #chestOverlay .chest-item .ci-desc {
      font-family:var(--mono,monospace); font-size:10px;
      color:rgba(255,255,255,0.3); margin-top:3px; line-height:1.4;
    }
    #chestOverlay .chest-close {
      font-family:var(--mono,monospace); font-size:9px; letter-spacing:.18em;
      text-transform:uppercase; color:rgba(255,255,255,0.18);
      text-align:center; cursor:pointer; transition:color .12s;
    }
    #chestOverlay .chest-close:hover { color:rgba(255,80,80,0.6); }
  `;
  document.head.appendChild(style);
}

function updateCoinsUI() {
  const el = $('upgradeCoins');
  if (el) el.textContent = String(state.coins || 0);
}

function renderShop() {
  const list = $('upgradeList');
  if (!list) return;
  updateCoinsUI();
  list.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'shop-draft-head';
  const title = document.createElement('div');
  title.className = 'shop-draft-title';
  title.textContent = _purchaseLocked ? 'Upgrade Selected' : 'Choose an Upgrade';
  const sub = document.createElement('div');
  sub.className = 'shop-draft-sub';
  sub.textContent = _purchaseLocked
    ? 'One upgrade may be bought each shop. Continue when ready.'
    : `${_shopChoices.length} option${_shopChoices.length === 1 ? '' : 's'} rolled for this shop.`;
  head.appendChild(title);
  head.appendChild(sub);
  list.appendChild(head);

  const coins = state.coins || 0;

  _shopChoices.forEach(choiceItem => {
    const upg = choiceItem.upgrade;
    const currentTier = getTier(upg.key);
    const nextTier = currentTier + 1;
    const nextCost = getUpgradeCost(upg, nextTier);
    const isMaxed = currentTier >= upg.maxTier;
    const affordable = coins >= nextCost;
    const lockedByPurchase = _purchaseLocked && choiceItem.key !== _purchaseLocked;

    const row = document.createElement('div');
    row.className = 'upgrade-row';
    if (choiceItem.bought) row.classList.add('is-bought-choice');
    if (isMaxed) row.classList.add('is-maxed');
    if (!affordable && !choiceItem.bought) row.classList.add('cannot-afford');
    if (lockedByPurchase) row.classList.add('is-locked-choice');
    if (choiceItem.forcedStarter) row.classList.add('is-forced-choice');

    const left = document.createElement('div');
    left.style.flex = '1';

    const catEl = document.createElement('div');
    catEl.className = 'shop-cat-pill';
    catEl.textContent = choiceItem.forcedStarter ? 'Starter Weapon' : (choiceItem.category || 'bonus');

    const nameEl = document.createElement('div');
    nameEl.className = 'upg-name';
    nameEl.textContent = `${upg.name} → Tier ${nextTier}`;

    const descEl = document.createElement('div');
    descEl.className = 'upg-meta';
    descEl.textContent = isMaxed ? 'Maxed' : upg.desc(nextTier);

    left.appendChild(catEl);
    left.appendChild(nameEl);
    left.appendChild(descEl);

    if (upg.maxTier > 1) {
      const pips = document.createElement('div');
      pips.className = 'upg-tierline';
      for (let i = 0; i < upg.maxTier; i++) {
        const pip = document.createElement('div');
        pip.className = 'upg-pip' + (i < currentTier ? ' filled' : '');
        pips.appendChild(pip);
      }
      left.appendChild(pips);
    }

    const btn = document.createElement('button');
    btn.className = 'upg-buy' + (choiceItem.bought ? ' owned' : '');
    const disabled = isMaxed || lockedByPurchase || choiceItem.bought || !affordable;
    btn.disabled = disabled;

    if (choiceItem.bought) {
      btn.textContent = 'BOUGHT';
    } else if (isMaxed) {
      btn.textContent = 'MAXED';
    } else if (nextCost <= 0) {
      btn.textContent = 'FREE';
    } else {
      const label = document.createElement('span');
      label.textContent = affordable ? 'BUY' : 'NEED';
      const pill = document.createElement('span');
      pill.className = 'upgrade-coins';
      const costEl = document.createElement('span');
      costEl.textContent = String(nextCost);
      pill.appendChild(costEl);
      btn.appendChild(label);
      btn.appendChild(pill);
    }

    btn.addEventListener('click', () => {
      if (btn.disabled || _purchaseLocked) return;
      if ((state.coins || 0) < nextCost) return;
      state.coins -= nextCost;
      state.upg[upg.key] = nextTier;
      applyUpgradeEffect(upg.key, nextTier);
      playSound?.('purchase', 0.8);
      choiceItem.bought = true;
      _purchaseLocked = choiceItem.key;
      updateCoinsUI();
      updateStatsPanel();
      renderShop();
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  });

  const note = document.createElement('div');
  note.className = 'shop-luck-note';
  note.textContent = getShopBottomHint(_shopLevel);
  list.appendChild(note);

  const btn = $('upgradeContinueBtn');
  if (btn) btn.textContent = _purchaseLocked ? 'CONTINUE' : 'SKIP';
  updateStatsPanel();
}

export function openUpgradeShop(level, onClose) {
  _onClose = typeof onClose === 'function' ? onClose : null;
  _shopLevel = Math.max(1, Math.floor(level || state.playerLevel || 1));
  _shopChoices = rollShopChoices(_shopLevel).map(item => ({
    key: item.upgrade.key,
    category: item.category,
    upgrade: item.upgrade,
    bought: false,
    forcedStarter: !!item.forcedStarter,
  }));
  _purchaseLocked = false;

  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  state.upgradeOpen = true;
  state.paused = true;

  try { document.body.classList.add('is-shop'); } catch {}
  try { initHudCoin('upgrade-coin-canvas'); } catch {}
  ensureShopStyles();
  renderShop();
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');

  const btn = $('upgradeContinueBtn');
  if (btn) {
    btn.onclick = () => {
      closeUpgradeShopIfOpen();
      if (_onClose) _onClose();
    };
  }
}

export function closeUpgradeShopIfOpen() {
  const overlay = $('upgradeOverlay');
  if (!overlay) return;
  try { if (_statsPanel) { _statsPanel.remove(); _statsPanel = null; } } catch {}
  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  state.upgradeOpen = false;
  state.paused = false;
  _shopChoices = [];
  _purchaseLocked = false;
  try { document.body.classList.remove('is-shop'); } catch {}
}

function rollChestItemCount() {
  const luck = state.luck || 0;
  const p1 = luck <= 0  ? 0.70 : luck <= 10 ? 0.45 : luck <= 20 ? 0.20 : 0.00;
  const p5 = luck <= 0  ? 0.05 : luck <= 10 ? 0.15 : luck <= 20 ? 0.25 : 0.368;
  const r = Math.random();
  if (r < p5) return 5;
  if (r < p5 + (1 - p1 - p5)) return 3;
  return 1;
}

function pickChestItems(count, chestTier) {
  const tierCap = { standard: 2, rare: 4, epic: 5 }[chestTier] || 2;
  const upgradeCandidates = ALL_UPGRADES.filter(upg => {
    const cur = getTier(upg.key);
    return cur < upg.maxTier && (cur + 1) <= tierCap && meetsRequirement(upg) && isUpgradeAllowedForLoadout(upg);
  }).map(upg => ({ type: 'upgrade', upgrade: upg }));

  const chaosTierCap = { standard: 1, rare: 2, epic: 3 }[chestTier] || 1;
  const chaosCandidate = Math.random() < 0.70 ? [{ type: 'chaos', tier: 1 + Math.floor(Math.random() * chaosTierCap) }] : [];

  const pool = shuffle([...upgradeCandidates, ...chaosCandidate]);
  return pool.slice(0, Math.min(count, pool.length));
}

function ensureChestOverlay() {
  if ($('chestOverlay')) return;
  ensureShopStyles();
  const el = document.createElement('div');
  el.id = 'chestOverlay';
  el.innerHTML = `
    <div class="chest-box">
      <h2 id="chestOverlayTitle">CHEST REWARD</h2>
      <div class="chest-sub" id="chestOverlaySub">Choose one reward to keep</div>
      <div class="chest-items" id="chestItems"></div>
      <div class="chest-close" id="chestSkipBtn">Skip (discard all)</div>
    </div>
  `;
  document.body.appendChild(el);
  $('chestSkipBtn').addEventListener('click', closeChestOverlay);
}

function closeChestOverlay() {
  const el = $('chestOverlay');
  if (el) el.classList.remove('show');
  state.upgradeOpen = false;
  state.paused = false;
  try { document.body.classList.remove('is-shop'); } catch {}
}

export function openChestReward(tier = 'standard') {
  ensureChestOverlay();
  ensureShopStyles();
  const count = rollChestItemCount();
  const items = pickChestItems(count, tier);
  const overlay = $('chestOverlay');
  const title = $('chestOverlayTitle');
  const sub = $('chestOverlaySub');
  const list = $('chestItems');
  if (!overlay || !list) return;

  if (!items.length) {
    const payout = count * 50;
    state.coins += payout;
    const coinEl = document.getElementById('coin-count');
    if (coinEl) coinEl.textContent = state.coins;
    playSound?.('coin', 0.6, 1.0);
    return;
  }

  const tierLabel = { standard: 'Standard Chest', rare: 'Rare Chest', epic: 'Epic Chest' }[tier] || 'Chest';
  const tierColor = { standard: '#ffe566', rare: '#55ccff', epic: '#cc55ff' }[tier] || '#ffe566';
  title.textContent = tierLabel;
  title.style.color = tierColor;
  sub.textContent = `${items.length} reward${items.length === 1 ? '' : 's'} found — choose one`;

  list.innerHTML = '';
  state.upgradeOpen = true;
  state.paused = true;

  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'chest-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'ci-name';

    const descEl = document.createElement('div');
    descEl.className = 'ci-desc';

    if (item.type === 'chaos') {
      nameEl.textContent = `Chaos → Tier ${item.tier}`;
      descEl.textContent = getChaosDesc(item.tier);
      div.addEventListener('click', () => {
        activateChaos(item.tier);
        playSound?.('chest_item_select', 0.7);
        closeChestOverlay();
      });
    } else {
      const upg = item.upgrade;
      const cur = getTier(upg.key);
      const nextT = cur + 1;
      const cost = getUpgradeCost(upg, nextT);
      nameEl.textContent = `${upg.name} → Tier ${nextT}`;
      descEl.textContent = `${upg.desc(nextT)}${cost > 0 ? `  (shop value: ${cost} coins)` : '  (starter tier: free)'}`;
      div.addEventListener('click', () => {
        state.upg[upg.key] = nextT;
        applyUpgradeEffect(upg.key, nextT);
        playSound?.('chest_item_select', 0.7);
        try { updateStatsPanel(); } catch {}
        closeChestOverlay();
      });
    }

    div.appendChild(nameEl);
    div.appendChild(descEl);
    list.appendChild(div);
  });

  overlay.classList.add('show');
}

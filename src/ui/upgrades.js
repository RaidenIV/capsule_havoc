// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
// Draft-style upgrade shop: 3 random choices per shop from the 4 category pools,
// with a Luck-based 4th option possible later in the run.

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

function getTier(key){
  return Math.max(0, state.upg?.[key] || 0);
}

function getLoadoutWeapon(){
  if (state.characterPrimaryWeapon === 'laser' || state.characterPrimaryWeapon === 'slash') {
    return state.characterPrimaryWeapon;
  }
  if (state.selectedCharacter === 'blue') return 'laser';
  if (state.selectedCharacter === 'red') return 'slash';
  return null;
}

function meetsRequirement(upgDef){
  const req = upgDef?.requires;
  if (!req) return true;
  const needKey = req.key;
  const minTier = Number.isFinite(req.minTier) ? req.minTier : 1;
  return getTier(needKey) >= minTier;
}

const STANDARD_COSTS = [10, 50, 250, 1000, 2000];
const MULTISHOT_COSTS = [1000, 2000];

const CATEGORIES = [
  {
    id: 'weapons', label: 'Weapons',
    upgrades: [
      { key: 'laserFire', name: 'Laser Fire', costs: STANDARD_COSTS,
        desc: t => [
          '7 laser projectiles',
          '8 laser projectiles',
          '9 laser projectiles',
          '10 laser projectiles',
          '10 projectiles + rotating firing positions',
        ][t - 1] || `Tier ${t}` },
      { key: 'orbit', name: 'Orbit Weapon', costs: STANDARD_COSTS,
        desc: t => t === 1 ? 'Unlocks orbiting bullets' : `Adds orbit strength (Tier ${t})` },
      { key: 'dmg', name: 'Damage', costs: STANDARD_COSTS,
        desc: t => `+10% weapon damage (Tier ${t})` },
      { key: 'fireRate', name: 'Fire Rate', costs: STANDARD_COSTS,
        desc: t => `-10% shot cooldown (Tier ${t})` },
      { key: 'projSpeed', name: 'Projectile Speed', costs: STANDARD_COSTS,
        desc: t => `+20% projectile speed (Tier ${t})` },
      { key: 'piercing', name: 'Piercing', costs: STANDARD_COSTS,
        desc: t => `+1 enemy pierced per shot (Tier ${t})` },
      { key: 'multishot', name: 'Multi-Shot', costs: MULTISHOT_COSTS,
        desc: t => t === 1 ? '2 shot burst' : '3 shot burst' },
    ],
  },
  {
    id: 'movement', label: 'Movement',
    upgrades: [
      { key: 'moveSpeed', name: 'Move Speed', costs: STANDARD_COSTS,
        desc: t => `+8% movement speed (Tier ${t})` },
      { key: 'dash', name: 'Dash', costs: STANDARD_COSTS,
        desc: t => [
          'Unlocks dash (Shift key)',
          'Improves dash speed and cooldown',
          'Adds i-frames during dash',
          'Further improves dash speed and cooldown',
          'Max dash speed and shortest cooldown',
        ][t - 1] || `Tier ${t}` },
      { key: 'magnet', name: 'Magnet Radius', costs: STANDARD_COSTS,
        desc: t => `+1.25 item attraction range (Tier ${t})` },
    ],
  },
  {
    id: 'abilities', label: 'Abilities',
    upgrades: [
      { key: 'shield', name: 'Shield', costs: STANDARD_COSTS,
        desc: t => [
          'Rechargeable bubble shield (1 hit)',
          'Faster shield recharge',
          '2-hit bubble shield',
          'Much faster shield recharge',
          '3-hit bubble shield',
        ][t - 1] || `Tier ${t}` },
      { key: 'burst', name: 'Area Burst [E]', costs: STANDARD_COSTS,
        desc: t => [
          '+Radial damage pulse',
          '+25% radius & damage',
          '-30% cooldown',
          '+Knockback on burst',
          '+50% radius & damage',
        ][t - 1] || `Tier ${t}` },
      { key: 'timeSlow', name: 'Time Slow [Q]', costs: STANDARD_COSTS,
        desc: t => [
          '50% enemy speed for 3s',
          'Extends duration to 5s',
          'Deepens slow to 25% speed',
          'Cuts cooldown by 50%',
          'Deepens slow to 15% speed',
        ][t - 1] || `Tier ${t}` },
    ],
  },
  {
    id: 'powerups', label: 'Power Ups',
    upgrades: [
      { key: 'maxHealth', name: 'Max Health', costs: STANDARD_COSTS,
        desc: t => `+10% max HP (Tier ${t})` },
      { key: 'regen', name: 'Health Regen', costs: STANDARD_COSTS,
        desc: t => `+${t} HP/sec regeneration` },
      { key: 'xpGrowth', name: 'XP Growth', costs: STANDARD_COSTS,
        desc: t => `+15% XP from kills (Tier ${t})` },
      { key: 'coinBonus', name: 'Coin Bonus', costs: STANDARD_COSTS,
        desc: t => `+20% coins per kill (Tier ${t})` },
      { key: 'curse', name: 'Curse ⚠', costs: STANDARD_COSTS,
        desc: t => `Enemies +20% HP/DMG → +25% coins, +10% XP (Tier ${t})` },
      { key: 'luck', name: 'Luck', costs: STANDARD_COSTS,
        desc: t => `+5 Luck — better chests & 4th shop option chance (Tier ${t})` },
    ],
  },
];

const ALL_UPGRADES = CATEGORIES.flatMap(cat => cat.upgrades);
const RED_LASER_LOCKOUT = new Set(['laserFire', 'fireRate', 'projSpeed', 'piercing', 'multishot']);
const BLUE_SLASH_LOCKOUT = new Set(['slash', 'slashRate', 'slashRadius', 'slashArc', 'slashDamage']);

function isUpgradeAllowedForLoadout(upg){
  const loadout = getLoadoutWeapon();
  if (loadout === 'slash' && RED_LASER_LOCKOUT.has(upg.key)) return false;
  if (loadout === 'laser' && BLUE_SLASH_LOCKOUT.has(upg.key)) return false;
  return true;
}

function isTierOneOnlyWindow(level){
  return Math.max(1, Math.floor(level || state.playerLevel || 1)) <= 3;
}

function isEligibleForShopWindow(upg, level){
  const cur = getTier(upg.key);
  if (cur >= upg.costs.length) return false;
  if (!meetsRequirement(upg) || !isUpgradeAllowedForLoadout(upg)) return false;
  if (isTierOneOnlyWindow(level)) {
    return cur === 0 && upg.key !== 'multishot';
  }
  return true;
}

function getEligibleUpgrades(category, level){
  return category.upgrades.filter(upg => isEligibleForShopWindow(upg, level));
}

function getDesiredOptionCount(level){
  recomputeLuck();
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  const canRollFourth = L >= 20 && (state.luck || 0) >= 10;
  if (!canRollFourth) return 3;
  return Math.random() < getFourthOptionChance() ? 4 : 3;
}

function rollShopChoices(level){
  const desired = getDesiredOptionCount(level);
  const categories = shuffle(CATEGORIES.filter(cat => getEligibleUpgrades(cat, level).length > 0));
  const picks = [];
  const usedKeys = new Set();

  for (const cat of categories) {
    if (picks.length >= Math.min(desired, CATEGORIES.length)) break;
    const options = getEligibleUpgrades(cat, level).filter(upg => !usedKeys.has(upg.key));
    if (!options.length) continue;
    const pick = choice(options);
    picks.push({ category: cat.id, upgrade: pick });
    usedKeys.add(pick.key);
  }

  if (picks.length < desired) {
    const fallbackPool = shuffle(ALL_UPGRADES.filter(upg => {
      return !usedKeys.has(upg.key) && isEligibleForShopWindow(upg, level);
    }));
    while (picks.length < desired && fallbackPool.length) {
      const upg = fallbackPool.shift();
      picks.push({ category: 'bonus', upgrade: upg });
      usedKeys.add(upg.key);
    }
  }

  return picks;
}

function getShopBottomHint(level){
  const L = Math.max(1, Math.floor(level || state.playerLevel || 1));
  const luck = Math.round(state.luck || 0);
  if (L < 20) return 'Luck can reveal a 4th option starting at level 20.';
  if (luck < 10) return 'Reach Luck 10+ to start rolling for a 4th option.';
  const pct = Math.round(getFourthOptionChance() * 100);
  return `Luck can reveal a 4th option on shop open. Current chance: ${pct}%`;
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
      if (newTier >= 5) state.shieldCharges = Math.max(state.shieldCharges, 3);
      break;

    case 'laserFire':
      state.weaponTier = Math.max(state.weaponTier || 0, newTier);
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
let _firstLevelUpFreeShop = false;

function ensureStatsPanel(){
  if (_statsPanel) return _statsPanel;
  const overlay = $('upgradeOverlay');
  if (!overlay) return null;
  const panel = document.createElement('div');
  panel.id = 'upgradeStatsPanel';
  panel.innerHTML = `
    <div style="font-weight:900;letter-spacing:0.08em;font-size:13px;opacity:0.9;margin-bottom:10px;">PLAYER STATS</div>
    <div id="upgradeStatsBody"></div>
  `;
  overlay.appendChild(panel);
  _statsPanel = panel;
  return panel;
}

function _statRow(label, value){
  return `
    <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;break-inside:avoid;page-break-inside:avoid;padding:1px 0;">
      <div style="opacity:0.85;font-weight:700;font-size:12px;line-height:1.15;">${label}</div>
      <div style="font-weight:900;font-size:12px;line-height:1.15;text-align:right;white-space:normal;overflow-wrap:anywhere;max-width:56%;">${value}</div>
    </div>`;
}

function _statSection(label){
  return `
    <div style="column-span:all;break-inside:avoid;page-break-inside:avoid;margin:6px 0 4px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);font-weight:900;font-size:10px;letter-spacing:0.10em;opacity:0.72;">${label}</div>`;
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
  const curseTier = getTier('curse');
  const armorHits = Math.max(0, state.armorHits || 0);
  const slashDmg = Math.max(1, Math.round(bulletDmg * 1.8));
  const totalProjectiles = Math.max(1, waveDirs) * (1 + msTier);
  const dashCd = dashTier > 0 ? (dashTier >= 5 ? 0.68 : dashTier >= 4 ? 0.82 : dashTier >= 3 ? 1.00 : dashTier >= 2 ? 1.20 : 1.40) : 0;
  const shieldCharges = shieldTier >= 5 ? 3 : (shieldTier >= 3 ? 2 : (shieldTier >= 1 ? 1 : 0));
  const shieldRecharge = shieldTier > 0 ? (shieldTier >= 4 ? 12.0 * 0.45 : (shieldTier >= 2 ? 12.0 * 0.65 : 12.0)) : 0;
  const burstDmg = burstTier > 0 ? (burstTier >= 5 ? 220 : ((burstTier >= 4) ? 180 : (70 + burstTier * 30))) : 0;
  const burstRadius = burstTier > 0 ? (burstTier >= 5 ? 13.2 : ((burstTier >= 4) ? 11.0 : (burstTier >= 2 ? 6.9 : 5.5))) : 0;
  const timeSlowDuration = timeSlowTier > 0 ? (timeSlowTier >= 2 ? 5.0 : 3.0) : 0;
  const timeSlowScale = timeSlowTier >= 5 ? 0.15 : (timeSlowTier >= 3 ? 0.25 : (timeSlowTier >= 1 ? 0.5 : 1.0));

  const rows = [
    _statSection('CORE'),
    _statRow('HP', `${hp} / ${maxHp}`),
  ];

  rows.push(_statSection('WEAPONS'));
  if (loadout !== 'laser') rows.push(_statRow('Slash DMG', `${slashDmg}`));
  if (laserTier > 0 || loadout === 'laser' || (state.weaponTier || 0) >= 1) {
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
  if (dmgTier > 0) ownedRows.push(_statRow('Damage Bonus', `+${dmgTier * 10}%`));
  if (fireRateTier > 0 && (laserTier > 0 || loadout === 'laser')) ownedRows.push(_statRow('Fire Rate Bonus', `-${fireRateTier * 10}% CD`));
  if (msTier > 0 && (laserTier > 0 || loadout === 'laser')) ownedRows.push(_statRow('Multishot', `+${msTier} / dir`));
  if (psTier > 0 && (laserTier > 0 || loadout === 'laser')) ownedRows.push(_statRow('Proj Speed', `+${psTier * 20}%`));
  if (pierce > 0) ownedRows.push(_statRow('Piercing', `+${pierce}`));
  if (moveTier > 0) ownedRows.push(_statRow('Move Speed', `+${moveTier * 8}%`));
  if (dashTier > 0) ownedRows.push(_statRow('Dash CD', `${dashCd.toFixed(2)}s`));
  if (magnetTier > 0) ownedRows.push(_statRow('Magnet Radius', `+${(magnetTier * 1.25).toFixed(2)}`));
  if (shieldTier > 0) ownedRows.push(_statRow('Shield', `${shieldCharges} hit • ${shieldRecharge.toFixed(1)}s recharge`));
  if (timeSlowTier > 0) ownedRows.push(_statRow('Time Slow', `${(timeSlowScale * 100).toFixed(0)}% speed • ${timeSlowDuration.toFixed(0)}s`));
  if (maxHealthTier > 0) ownedRows.push(_statRow('Max HP Bonus', `+${maxHealthTier * 10}%`));
  if (regenTier > 0) ownedRows.push(_statRow('Regen', `${regenTier} HP/s`));
  if (xpGrowthTier > 0) ownedRows.push(_statRow('XP Growth', `+${xpGrowthTier * 15}%`));
  if (coinBonusTier > 0) ownedRows.push(_statRow('Coin Bonus', `+${coinBonusTier * 20}%`));
  if (luckTier > 0) ownedRows.push(_statRow('Luck', `+${luckTier * 5}`));
  if (curseTier > 0) ownedRows.push(_statRow('Curse', `T${curseTier}`));
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
      position:absolute; left:18px; top:74px; width:420px; max-height:none;
      overflow:hidden; padding:12px 14px; border-radius:18px; background:#06080f;
      border:1px solid rgba(0,229,255,0.12); box-shadow:0 12px 34px rgba(0,0,0,0.40);
      backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); color:#fff; z-index:5;
      font-family: Rajdhani, system-ui, sans-serif;
    }
    #upgradeStatsBody {
      columns:2; column-gap:14px;
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
    .upg-tierline { margin-top:6px; display:flex; gap:3px; align-items:center; }
    .upg-pip { width:14px; height:2px; border-radius:1px; background:rgba(255,255,255,0.12); }
    .upg-pip.filled { background:rgba(0,229,255,0.72); }
    .shop-luck-note {
      margin-top: 12px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.08);
      font-family: var(--mono, monospace); font-size:10px; color: rgba(255,255,255,0.42); line-height:1.45;
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

function getDisplayedUpgradeCost(upg, currentTier){
  if (_firstLevelUpFreeShop && currentTier === 0 && upg.key !== 'multishot') return 0;
  return upg.costs[currentTier] ?? 0;
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
    const maxTier = upg.costs.length;
    const nextCost = getDisplayedUpgradeCost(upg, currentTier);
    const isMaxed = currentTier >= maxTier;
    const affordable = nextCost <= 0 || coins >= nextCost;
    const lockedByPurchase = _purchaseLocked && choiceItem.key !== _purchaseLocked;

    const row = document.createElement('div');
    row.className = 'upgrade-row';
    if (choiceItem.bought) row.classList.add('is-bought-choice');
    if (isMaxed) row.classList.add('is-maxed');
    if (!affordable && !choiceItem.bought) row.classList.add('cannot-afford');
    if (lockedByPurchase) row.classList.add('is-locked-choice');

    const left = document.createElement('div');
    left.style.flex = '1';
    const nameEl = document.createElement('div');
    nameEl.className = 'upg-name';
    nameEl.textContent = `${upg.name}`;
    const descEl = document.createElement('div');
    descEl.className = 'upg-meta';
    descEl.textContent = isMaxed ? 'Maxed' : upg.desc(currentTier + 1);
    left.appendChild(nameEl);
    left.appendChild(descEl);

    if (maxTier > 1) {
      const pips = document.createElement('div');
      pips.className = 'upg-tierline';
      for (let i = 0; i < maxTier; i++) {
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
    } else {
      const label = document.createElement('span');
      label.textContent = nextCost <= 0 ? 'FREE' : (affordable ? 'BUY' : 'NEED');
      btn.appendChild(label);
      if (nextCost > 0) {
        const pill = document.createElement('span');
        pill.className = 'upgrade-coins';
        const costEl = document.createElement('span');
        costEl.textContent = String(nextCost);
        pill.appendChild(costEl);
        btn.appendChild(pill);
      }
    }

    btn.addEventListener('click', () => {
      if (btn.disabled || _purchaseLocked) return;
      if ((state.coins || 0) < nextCost) return;
      state.coins -= nextCost;
      state.upg[upg.key] = currentTier + 1;
      applyUpgradeEffect(upg.key, currentTier + 1);
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
  }));
  _purchaseLocked = false;
  _firstLevelUpFreeShop = !state.firstLevelUpShopHandled && _shopLevel <= 2;

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
  if (_firstLevelUpFreeShop) state.firstLevelUpShopHandled = true;
  _firstLevelUpFreeShop = false;
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
  const candidates = ALL_UPGRADES.filter(upg => {
    const cur = getTier(upg.key);
    return cur < upg.costs.length && (cur + 1) <= tierCap && meetsRequirement(upg) && isUpgradeAllowedForLoadout(upg);
  });
  if (!candidates.length) return [];
  return shuffle(candidates).slice(0, Math.min(count, candidates.length));
}

function ensureChestOverlay() {
  if ($('chestOverlay')) return;
  ensureShopStyles();
  const el = document.createElement('div');
  el.id = 'chestOverlay';
  el.innerHTML = `
    <div class="chest-box">
      <h2 id="chestOverlayTitle">CHEST REWARD</h2>
      <div class="chest-sub" id="chestOverlaySub">Choose one upgrade to keep</div>
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
  sub.textContent = `${items.length} item${items.length > 1 ? 's' : ''} found — choose one to keep`;

  list.innerHTML = '';
  state.upgradeOpen = true;
  state.paused = true;

  items.forEach(upg => {
    const cur = getTier(upg.key);
    const nextT = cur + 1;
    const cost = upg.costs[cur] || 0;
    const div = document.createElement('div');
    div.className = 'chest-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'ci-name';
    nameEl.textContent = `${upg.name}  →  Tier ${nextT}`;

    const descEl = document.createElement('div');
    descEl.className = 'ci-desc';
    descEl.textContent = `${upg.desc(nextT)}  (shop value: ${cost} coins)`;

    div.appendChild(nameEl);
    div.appendChild(descEl);
    div.addEventListener('click', () => {
      state.upg[upg.key] = nextT;
      applyUpgradeEffect(upg.key, nextT);
      playSound?.('chest_item_select', 0.7);
      try { updateStatsPanel(); } catch {}
      closeChestOverlay();
    });

    list.appendChild(div);
  });

  overlay.classList.add('show');
}

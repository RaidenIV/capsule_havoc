// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
// Full 4-tab upgrade shop (Weapons / Movement / Abilities / Power Ups)
// + Chest reward overlay
// Based on game_design_doc.md Section 9 & 10

import { state }           from '../state.js';
import { playSound }       from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';
import { getFireInterval, getWaveBullets, getBulletDamage } from '../xp.js';
import { updateHealthBar } from '../player.js';
import { initHudCoin }     from '../hudCoin.js';
import { recomputeLuck, getFourthOptionChance, getLuck }   from '../luck.js';
import { getPlayerMaxHPForLevel } from '../constants.js';


function getTier(key){
  return Math.max(0, state.upg?.[key] || 0);
}

function meetsRequirement(upgDef){
  const req = upgDef?.requires;
  if (!req) return true;
  const needKey = req.key;
  const minTier = Number.isFinite(req.minTier) ? req.minTier : 1;
  return getTier(needKey) >= minTier;
}
// ─────────────────────────────────────────────────────────────────────────────
// Shop definition (Section 9)
// Flat upgrade pool used by the random-choice shop draft.
// Each entry: { key, name, costs[], desc(tier), family? }
// ─────────────────────────────────────────────────────────────────────────────
const UPGRADE_POOL = [
  // Weapons
  { key: 'laserFire', name: 'Laser Fire', costs: [250, 900, 2200, 5500, 12000], family: 'laser',
    desc: t => t === 1 ? 'Unlocks automatic laser fire' : `Improves laser pattern (Tier ${t})` },
  { key: 'orbit', name: 'Orbit Weapon', costs: [250, 750, 1800, 4200, 9000],
    desc: t => t === 1 ? 'Unlocks orbiting bullets' : `Adds orbit strength (Tier ${t})` },
  { key: 'dmg', name: 'Damage', costs: [50, 150, 400, 1000, 2500],
    desc: t => `+15% weapon damage (Tier ${t})` },
  { key: 'fireRate', name: 'Fire Rate', requires: { key: 'laserFire', minTier: 1 }, costs: [75, 200, 500, 1200, 3000], family: 'laser',
    desc: t => `-10% shot cooldown (Tier ${t})` },
  { key: 'projSpeed', name: 'Projectile Speed', requires: { key: 'laserFire', minTier: 1 }, costs: [100, 300, 800, 2000], family: 'laser',
    desc: t => `+20% projectile speed (Tier ${t})` },
  { key: 'piercing', name: 'Piercing', costs: [200, 600, 1500], family: 'laser',
    desc: t => `+1 enemy pierced per shot (Tier ${t})` },
  { key: 'multishot', name: 'Multishot', requires: { key: 'laserFire', minTier: 1 }, costs: [500, 1500, 4000], family: 'laser',
    desc: t => `+1 extra projectile per shot (Tier ${t})` },

  // Movement
  { key: 'moveSpeed', name: 'Move Speed', costs: [60, 180, 450, 1100, 2800],
    desc: t => `+8% movement speed (Tier ${t})` },
  { key: 'dash', name: 'Dash', costs: [300, 700, 1800],
    desc: t => ['Unlocks dash (Shift key)', 'Reduces cooldown by 30%', 'Adds i-frames during dash'][t-1] },
  { key: 'magnet', name: 'Magnet Radius', costs: [80, 250, 650, 1600],
    desc: t => `+1.25 coin attraction range (Tier ${t})` },

  // Abilities
  { key: 'shield', name: 'Shield', costs: [400, 1000, 2500],
    desc: t => ['Rechargeable bubble shield (1.5 radius, 1 hit)', '-35% recharge time', '2-hit bubble shield (1.5 radius)'][t-1] },
  { key: 'burst', name: 'Area Burst [E]', costs: [350, 900, 2200, 5500],
    desc: t => ['+Radial damage pulse', '+25% radius & damage', '-30% cooldown', '+Knockback on burst'][t-1] },
  { key: 'timeSlow', name: 'Time Slow [Q]', costs: [600, 1500, 3800],
    desc: t => ['50% slow for 3s on enemies', 'Extends duration to 5s', 'Deepens slow to 25% speed'][t-1] },

  // Power Ups
  { key: 'maxHealth', name: 'Max Health', costs: [40, 120, 350, 900, 2200],
    desc: t => `+10% max HP (Tier ${t})` },
  { key: 'regen', name: 'Health Regen', costs: [100, 300, 750, 1800],
    desc: t => `+${t} HP/sec regeneration` },
  { key: 'xpGrowth', name: 'XP Growth', costs: [150, 400, 1000, 2500],
    desc: t => `+15% XP from kills (Tier ${t})` },
  { key: 'coinBonus', name: 'Coin Bonus', costs: [200, 600, 1500],
    desc: t => `+20% coins per kill (Tier ${t})` },
  { key: 'curse', name: 'Curse ⚠', costs: [500, 1500, 4000],
    desc: t => `Enemies +20% HP/DMG → +25% coins, +10% XP (Tier ${t})` },
  { key: 'luck', name: 'Luck', costs: [250, 700, 1800],
    desc: t => `+5 Luck — better chests & 4th shop option chance (Tier ${t})` },
];

const ALL_UPGRADES = UPGRADE_POOL;

function getCharacterId(){
  const selected = state.selectedCharacter;
  if (selected === 'blue' || selected === 'red') return selected;
  if (state.characterPrimaryWeapon === 'laser') return 'blue';
  if (state.characterPrimaryWeapon === 'slash') return 'red';
  return 'red';
}

function allowsUpgradeForCharacter(upgDef){
  const family = upgDef?.family || '';
  const characterId = getCharacterId();
  if (characterId === 'blue' && family === 'slash') return false;
  if (characterId === 'red'  && family === 'laser') return false;
  return true;
}

function getCandidateUpgrades({ tierCap = Number.POSITIVE_INFINITY, excludeKeys = [] } = {}){
  const blocked = new Set(excludeKeys);
  return ALL_UPGRADES.filter(upg => {
    const cur = Math.max(0, state.upg?.[upg.key] || 0);
    return (
      !blocked.has(upg.key) &&
      cur < upg.costs.length &&
      (cur + 1) <= tierCap &&
      meetsRequirement(upg) &&
      allowsUpgradeForCharacter(upg)
    );
  });
}
// ─────────────────────────────────────────────────────────────────────────────
// Side-effects when an upgrade is purchased
// ─────────────────────────────────────────────────────────────────────────────
function applyUpgradeEffect(key, newTier) {
  switch (key) {
    case 'dash':
      if (newTier >= 1) state.hasDash = true;
      break;

    case 'luck':
      try { recomputeLuck(); } catch {}
      break;

    case 'maxHealth': {
      const base   = getPlayerMaxHPForLevel(state.playerLevel || 1);
      const newMax = Math.round(base * (1 + 0.10 * newTier));
      const pct    = (state.playerMaxHP || 100) > 0
        ? state.playerHP / state.playerMaxHP
        : 1;
      state.playerMaxHP = newMax;
      state.playerHP    = Math.max(1, Math.round(pct * newMax));
      try { updateHealthBar(); } catch {}
      break;
    }

    case 'shield':
      // Grant initial shield charge if none exist yet
      if (newTier >= 1 && (state.shieldCharges || 0) <= 0) {
        state.shieldCharges  = 1;
        state.shieldRecharge = 0;
      }
      if (newTier >= 3) state.shieldCharges = Math.max(state.shieldCharges, 2);
      break;

    case 'laserFire':
      // Laser Fire tiers directly drive weaponTier (used by projectile firing)
      state.weaponTier = Math.max(state.weaponTier || 0, newTier);
      break;

    case 'orbit':
      try { syncOrbitBullets(); } catch {}
      break;

    case 'dmg':
    case 'fireRate':
    case 'projSpeed':
    case 'multishot':
      // Weapon changes that affect orbit rings / bullet logic
      try { syncOrbitBullets(); } catch {}
      break;

    default:
      break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────────────────────────────────────

let _statsPanel = null;
function ensureStatsPanel(){
  if (_statsPanel) return _statsPanel;
  const overlay = $('upgradeOverlay');
  if (!overlay) return null;

  const panel = document.createElement('div');
  panel.id = 'upgradeStatsPanel';
  panel.style.cssText = `
    position:absolute;
    left: 18px;
    right: auto;
    top: 92px;
    width: 260px;
    max-height: calc(100% - 140px);
    overflow:auto;
    padding: 14px 14px;
    border-radius: 18px;
    background: rgba(0,0,0,0.38);
    border: 1px solid rgba(255,255,255,0.14);
    box-shadow: 0 12px 34px rgba(0,0,0,0.40);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    color: #fff;
    font-family: Rajdhani, system-ui, sans-serif;
    z-index: 5;
  `;
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
  return `
    <div style="margin-top:6px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.10);font-weight:900;font-size:11px;letter-spacing:0.10em;opacity:0.72;">${label}</div>`;
}

function updateStatsPanel(){
  const panel = ensureStatsPanel();
  if (!panel) return;
  const body = panel.querySelector('#upgradeStatsBody');
  if (!body) return;

  const hp = Math.round(state.playerHP);
  const maxHp = Math.round(state.playerMaxHP || 100);
  const bulletDmg = Math.round(getBulletDamage());
  const waveDirs = Math.max(1, getWaveBullets());
  const fire = getFireInterval();

  const laserTier = Math.max(0, state.upg?.laserFire || 0);
  const orbitTier = Math.max(0, state.upg?.orbit || 0);
  const dmgTier = Math.max(0, state.upg?.dmg || 0);
  const fireRateTier = Math.max(0, state.upg?.fireRate || 0);
  const msTier = Math.max(0, (state.upg?.multishot ?? state.upg?.multiShot ?? 0));
  const psTier = Math.max(0, (state.upg?.projSpeed ?? 0));
  const pierce = Math.max(0, (state.upg?.piercing ?? 0));

  const moveTier = Math.max(0, (state.upg?.moveSpeed || 0));
  const dashTier = Math.max(0, (state.upg?.dash || 0));
  const magnetTier = Math.max(0, (state.upg?.magnet || 0));

  const shieldTier = Math.max(0, (state.upg?.shield || 0));
  const burstTier = Math.max(0, (state.upg?.burst || 0));
  const timeSlowTier = Math.max(0, (state.upg?.timeSlow || 0));

  const maxHealthTier = Math.max(0, (state.upg?.maxHealth || 0));
  const regenTier = Math.max(0, (state.upg?.regen || 0));
  const xpGrowthTier = Math.max(0, (state.upg?.xpGrowth || 0));
  const coinBonusTier = Math.max(0, (state.upg?.coinBonus || 0));
  const luckTier = Math.max(0, (state.upg?.luck || 0));
  const curseTier = Math.max(0, (state.upg?.curse || 0));

  const armorHits = Math.max(0, state.armorHits || 0);
  const lives = Math.max(0, state.extraLives || 0);
  const pelletsPerDir = 1 + msTier;
  const totalProjectiles = waveDirs * pelletsPerDir;
  const slashDmg = Math.max(1, Math.round(bulletDmg * 1.8));
  const burstDmg = burstTier > 0 ? ((burstTier >= 4) ? 180 : (70 + burstTier * 30)) : 0;
  const burstRadius = burstTier > 0 ? ((burstTier >= 4) ? 11.0 : 5.5) : 0;
  const dashCd = dashTier > 0
    ? (dashTier >= 2 ? 1.4 * 0.70 : 1.4)
    : 0;
  const shieldCharges = shieldTier >= 3 ? 2 : (shieldTier >= 1 ? 1 : 0);
  const shieldRecharge = shieldTier > 0 ? (shieldTier >= 2 ? 12.0 * 0.65 : 12.0) : 0;
  const timeSlowDuration = timeSlowTier > 0 ? (timeSlowTier >= 2 ? 5.0 : 3.0) : 0;
  const timeSlowScale = timeSlowTier >= 3 ? 0.25 : (timeSlowTier >= 1 ? 0.5 : 1.0);

  const rows = [
    _statSection('CORE'),
    _statRow('HP', `${hp} / ${maxHp}`),
    _statRow('Slash DMG', `${slashDmg}`),
  ];

  rows.push(_statSection('WEAPONS'));
  if (laserTier > 0) {
    rows.push(_statRow('Laser DMG', `${bulletDmg} / shot`));
    rows.push(_statRow('Volley', `${totalProjectiles} proj`));
    rows.push(_statRow('Fire Interval', `${fire.toFixed(2)}s`));
  }
  if (orbitTier > 0) rows.push(_statRow('Orbit DMG', `${bulletDmg} / hit`));
  if (burstTier > 0) {
    rows.push(_statRow('Burst DMG', `${burstDmg}`));
    rows.push(_statRow('Burst Radius', `${burstRadius.toFixed(1)}`));
  }

  const ownedRows = [];
  if (dmgTier > 0) ownedRows.push(_statRow('Damage Bonus', `+${dmgTier * 15}%`));
  if (fireRateTier > 0 && laserTier > 0) ownedRows.push(_statRow('Fire Rate Bonus', `-${fireRateTier * 10}% CD`));
  if (msTier > 0 && laserTier > 0) ownedRows.push(_statRow('Multishot', `+${msTier} / dir`));
  if (psTier > 0 && laserTier > 0) ownedRows.push(_statRow('Proj Speed', `+${psTier * 20}%`));
  if (pierce > 0) ownedRows.push(_statRow('Piercing', `+${pierce}`));
  if (moveTier > 0) ownedRows.push(_statRow('Move Speed', `+${moveTier * 8}%`));
  if (dashTier > 0) ownedRows.push(_statRow('Dash CD', `${dashCd.toFixed(2)}s`));
  if (magnetTier > 0) ownedRows.push(_statRow('Magnet Radius', `+${(magnetTier * 1.25).toFixed(2)}`));
  if (shieldTier > 0) ownedRows.push(_statRow('Shield', `${shieldCharges} hit • 1.5 radius • ${shieldRecharge.toFixed(1)}s recharge`));
  if (timeSlowTier > 0) ownedRows.push(_statRow('Time Slow', `${(timeSlowScale * 100).toFixed(0)}% speed • ${timeSlowDuration.toFixed(0)}s`));
  if (maxHealthTier > 0) ownedRows.push(_statRow('Max HP Bonus', `+${maxHealthTier * 10}%`));
  if (regenTier > 0) ownedRows.push(_statRow('Regen', `${regenTier} HP/s`));
  if (xpGrowthTier > 0) ownedRows.push(_statRow('XP Growth', `+${xpGrowthTier * 15}%`));
  if (coinBonusTier > 0) ownedRows.push(_statRow('Coin Bonus', `+${coinBonusTier * 20}%`));
  if (luckTier > 0) ownedRows.push(_statRow('Luck', `+${luckTier * 5}`));
  if (curseTier > 0) ownedRows.push(_statRow('Curse', `T${curseTier}`));
  if (armorHits > 0) ownedRows.push(_statRow('Armor Hits', `${armorHits}`));
  if (lives > 0) ownedRows.push(_statRow('Extra Life', `${lives}`));

  if (ownedRows.length > 0) {
    rows.push(_statSection('OWNED UPGRADES'));
    rows.push(...ownedRows);
  }

  body.innerHTML = rows.join('');
}
function $(id) { return document.getElementById(id); }

// ─────────────────────────────────────────────────────────────────────────────
// Shop state
// ─────────────────────────────────────────────────────────────────────────────
let _onClose = null;
let _shopDraft = [];
let _bonusOptionChance = 0;
let _bonusOptionGranted = false;

// ─────────────────────────────────────────────────────────────────────────────
// Inject minimal shop CSS (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
function ensureShopStyles() {
  if (document.getElementById('shop-dynamic-styles')) return;
  const style = document.createElement('style');
  style.id = 'shop-dynamic-styles';
  style.textContent = `
    .shop-draft-list {
      display:flex;
      flex-direction:column;
      gap:12px;
      min-height: 320px;
    }
    .shop-draft-card {
      display:flex;
      gap:14px;
      align-items:center;
      justify-content:space-between;
      padding:14px 16px;
      border-radius:14px;
      background:rgba(255,255,255,0.03);
      border:1px solid rgba(255,255,255,0.08);
      box-shadow:0 10px 24px rgba(0,0,0,0.22);
    }
    .shop-draft-card.spent {
      opacity:0.68;
      border-color:rgba(0,229,255,0.10);
    }
    .shop-draft-copy { flex:1; min-width:0; }
    .shop-draft-head {
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
    }
    .shop-draft-tier {
      font-family:var(--mono,monospace);
      font-size:10px;
      letter-spacing:.14em;
      text-transform:uppercase;
      color:rgba(0,229,255,0.78);
    }
    .shop-draft-sub {
      margin-top:4px;
      font-family:var(--mono,monospace);
      font-size:10px;
      line-height:1.45;
      color:rgba(255,255,255,0.46);
    }
    .shop-draft-state {
      margin-top:6px;
      font-family:var(--mono,monospace);
      font-size:10px;
      letter-spacing:.12em;
      text-transform:uppercase;
      color:rgba(255,255,255,0.32);
    }
    .shop-draft-state.ok { color:rgba(0,255,140,0.72); }
    .shop-draft-state.locked { color:rgba(255,190,90,0.72); }
    .shop-draft-tiers {
      display:flex;
      gap:4px;
      margin-top:8px;
      align-items:center;
    }
    .shop-draft-pip {
      width:16px;
      height:3px;
      border-radius:999px;
      background:rgba(255,255,255,0.10);
    }
    .shop-draft-pip.filled { background:rgba(0,229,255,0.72); }
    .shop-draft-pip.maxed { background:rgba(255,255,255,0.22); }
    .shop-draft-footer {
      margin-top:8px;
      padding-top:10px;
      border-top:1px solid rgba(255,255,255,0.07);
      font-family:var(--mono,monospace);
      font-size:10px;
      line-height:1.5;
      color:rgba(255,255,255,0.38);
    }
    .shop-draft-footer strong {
      color:rgba(255,255,255,0.76);
      font-weight:700;
    }
    .curse-warning {
      font-family:var(--mono,monospace); color:rgba(255,120,60,0.8);
      font-size:9px; margin-top:6px; letter-spacing:.06em;
    }
    #upgradeStatsPanel {
      background:#06080f !important;
      border:1px solid rgba(0,229,255,0.12) !important;
      border-radius:8px !important;
      box-shadow:0 8px 30px rgba(0,0,0,0.6) !important;
    }
    #chestOverlay {
      display:none; position:fixed; inset:0; z-index:120;
      background:rgba(0,2,8,0.92); backdrop-filter:blur(10px);
      align-items:center; justify-content:center;
    }
    #chestOverlay.show { display:flex; }
    #chestOverlay .chest-box {
      background:#06080f; border:1px solid rgba(0,229,255,0.18);
      border-radius:10px; padding:28px 28px; min-width:320px; max-width:500px; width:90%;
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
      letter-spacing:.28em; text-transform:uppercase; color:rgba(255,220,50,0.85);
      margin:0; text-align:center;
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
// ─────────────────────────────────────────────────────────────────────────────
// Random shop draft helpers
// ─────────────────────────────────────────────────────────────────────────────
function shuffleInPlace(arr){
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rollShopDraft(){
  const chance = getFourthOptionChance();
  const baseCount = 3;
  const wantExtra = Math.random() < chance;
  const count = baseCount + (wantExtra ? 1 : 0);
  const pool = shuffleInPlace(getCandidateUpgrades());
  _bonusOptionChance = chance;
  _bonusOptionGranted = wantExtra && pool.length > baseCount;
  _shopDraft = pool.slice(0, Math.min(count, pool.length)).map(upg => ({
    key: upg.key,
    offeredTier: Math.max(0, state.upg?.[upg.key] || 0) + 1,
    purchased: false,
  }));
}

function getUpgradeDef(key){
  return ALL_UPGRADES.find(upg => upg.key === key) || null;
}

function renderShop() {
  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  ensureShopStyles();

  const list = $('upgradeList');
  if (!list) return;
  list.innerHTML = '';
  list.classList.add('shop-draft-list');

  const title = overlay.querySelector('.upgrade-title');
  if (title) title.textContent = 'UPGRADE DRAFT';

  const coins = state.coins || 0;

  if (!_shopDraft.length) {
    const empty = document.createElement('div');
    empty.className = 'shop-draft-card spent';
    empty.innerHTML = `
      <div class="shop-draft-copy">
        <div class="upg-name">NO ELIGIBLE UPGRADES</div>
        <div class="shop-draft-sub">Everything currently available is already maxed or locked by your current loadout.</div>
      </div>`;
    list.appendChild(empty);
  }

  _shopDraft.forEach(entry => {
    const upg = getUpgradeDef(entry.key);
    if (!upg) return;

    const currentTier = Math.max(0, state.upg?.[upg.key] || 0);
    const maxTier = upg.costs.length;
    const rolledTier = entry.offeredTier;
    const nextCost = rolledTier <= maxTier ? (upg.costs[rolledTier - 1] ?? 0) : 0;
    const canAfford = coins >= nextCost;
    const isMaxed = currentTier >= maxTier;
    const boughtThisShop = !!entry.purchased;

    const card = document.createElement('div');
    card.className = 'shop-draft-card' + (boughtThisShop ? ' spent' : '');

    const left = document.createElement('div');
    left.className = 'shop-draft-copy';

    const head = document.createElement('div');
    head.className = 'shop-draft-head';

    const nameEl = document.createElement('div');
    nameEl.className = 'upg-name';
    nameEl.textContent = upg.name;

    const tierEl = document.createElement('div');
    tierEl.className = 'shop-draft-tier';
    tierEl.textContent = `Tier ${Math.min(rolledTier, maxTier)} / ${maxTier}`;

    head.appendChild(nameEl);
    head.appendChild(tierEl);

    const descEl = document.createElement('div');
    descEl.className = 'shop-draft-sub';
    descEl.textContent = isMaxed ? 'Maxed' : upg.desc(Math.min(rolledTier, maxTier));

    const stateEl = document.createElement('div');
    stateEl.className = 'shop-draft-state';
    if (boughtThisShop) {
      stateEl.classList.add('ok');
      stateEl.textContent = `Tier ${Math.min(rolledTier, maxTier)} acquired · next tier can appear in a future shop`;
    } else if (isMaxed) {
      stateEl.classList.add('ok');
      stateEl.textContent = 'Already maxed';
    } else if (!canAfford) {
      stateEl.classList.add('locked');
      stateEl.textContent = 'Not enough coins for this draft pick';
    } else {
      stateEl.textContent = 'Available this shop only';
    }

    left.appendChild(head);
    left.appendChild(descEl);
    left.appendChild(stateEl);

    if (maxTier > 1) {
      const pips = document.createElement('div');
      pips.className = 'shop-draft-tiers';
      for (let i = 0; i < maxTier; i++) {
        const pip = document.createElement('div');
        let cls = 'shop-draft-pip';
        if (i < currentTier) cls += isMaxed ? ' maxed' : ' filled';
        pip.className = cls;
        pips.appendChild(pip);
      }
      left.appendChild(pips);
    }

    if (upg.key === 'curse' && currentTier > 0) {
      const warn = document.createElement('div');
      warn.className = 'curse-warning';
      warn.textContent = `⚠ Enemies have +${currentTier * 20}% HP and damage`;
      left.appendChild(warn);
    }

    const btn = document.createElement('button');
    btn.className = 'upg-buy' + ((boughtThisShop || isMaxed) ? ' owned' : '');
    btn.disabled = boughtThisShop || isMaxed || !canAfford;

    if (boughtThisShop) {
      btn.textContent = 'BOUGHT';
    } else if (isMaxed) {
      btn.textContent = 'MAXED';
    } else {
      const label = document.createElement('span');
      label.textContent = canAfford ? 'BUY' : 'NEED';
      const pill = document.createElement('span');
      pill.className = 'upgrade-coins';
      const costEl = document.createElement('span');
      costEl.textContent = String(nextCost);
      pill.appendChild(costEl);
      btn.appendChild(label);
      btn.appendChild(pill);
    }

    btn.addEventListener('click', () => {
      if (btn.disabled || !upg) return;
      if ((state.coins || 0) < nextCost) return;

      state.coins -= nextCost;
      state.upg[upg.key] = Math.max(state.upg?.[upg.key] || 0, rolledTier);
      entry.purchased = true;

      applyUpgradeEffect(upg.key, rolledTier);
      playSound?.('purchase', 0.8);

      try { updateStatsPanel(); } catch {}
      updateCoinsUI();
      renderShop();
    });

    card.appendChild(left);
    card.appendChild(btn);
    list.appendChild(card);
  });

  const note = document.createElement('div');
  note.className = 'shop-draft-footer';
  const chancePct = Math.round((_bonusOptionChance || 0) * 100);
  note.innerHTML = _bonusOptionGranted
    ? `<strong>Luck revealed a 4th option in this shop.</strong> Future shop chance: ${chancePct}% (Luck: ${Math.round(getLuck())}).`
    : `<strong>Luck can reveal a 4th option.</strong> Current chance: ${chancePct}% (Luck: ${Math.round(getLuck())}).`;
  list.appendChild(note);

  try { updateStatsPanel(); } catch {}
}

function updateCoinsUI() {
  const el = $('upgradeCoins');
  if (el) el.textContent = String(state.coins || 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Open / close
// ─────────────────────────────────────────────────────────────────────────────
export function openUpgradeShop(level, onClose) {
  _onClose = typeof onClose === 'function' ? onClose : null;

  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  state.upgradeOpen = true;
  state.paused      = true;


  try { document.body.classList.add('is-shop'); } catch {}
  try { initHudCoin('upgrade-coin-canvas'); } catch {}

  updateCoinsUI();
  rollShopDraft();
  renderShop();
  updateStatsPanel();

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

  // Remove stats panel (recreated on next open)
  try { if (_statsPanel) { _statsPanel.remove(); _statsPanel = null; } } catch {}

  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');
  _shopDraft = [];

  state.upgradeOpen = false;
  state.paused      = false;

  try { document.body.classList.remove('is-shop'); } catch {}

  try { document.body.classList.remove('is-shop'); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Chest reward overlay (Section 10)
// ─────────────────────────────────────────────────────────────────────────────

// Determine item count from Luck (design doc table)
function rollChestItemCount() {
  const luck = state.luck || 0;
  // Probability tables for item counts 1, 3, 5
  // Luck:  0      10     20     30
  const p1 = luck <= 0  ? 0.70 : luck <= 10 ? 0.45 : luck <= 20 ? 0.20 : 0.00;
  const p5 = luck <= 0  ? 0.05 : luck <= 10 ? 0.15 : luck <= 20 ? 0.25 : 0.368;
  const r  = Math.random();
  if (r < p5) return 5;
  if (r < p5 + (1 - p1 - p5)) return 3;
  return 1;
}

// Pick `count` upgrades from the pool that aren't yet maxed
function pickChestItems(count, chestTier) {
  // Max shop tier offered per chest tier (design doc Section 10)
  const tierCap = { standard: 2, rare: 4, epic: 5 }[chestTier] || 2;

  // Candidates: upgrades that have a next tier to purchase, respect loadout filters, and are within the tier cap
  const candidates = getCandidateUpgrades({ tierCap });

  if (!candidates.length) return []; // all maxed → coin payout handled by caller

  // Shuffle
  const pool = [...candidates];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

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
  state.paused      = false;

  try { document.body.classList.remove('is-shop'); } catch {}
}

export function openChestReward(tier = 'standard') {
  ensureChestOverlay();
  ensureShopStyles();

  const count   = rollChestItemCount();
  const items   = pickChestItems(count, tier);

  const overlay = $('chestOverlay');
  const title   = $('chestOverlayTitle');
  const sub     = $('chestOverlaySub');
  const list    = $('chestItems');

  if (!overlay || !list) return;

  // Coin payout if nothing available
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

  title.textContent   = tierLabel;
  title.style.color   = tierColor;
  sub.textContent     = `${items.length} item${items.length > 1 ? 's' : ''} found — choose one to keep`;

  list.innerHTML = '';
  state.upgradeOpen = true;
  state.paused      = true;

  items.forEach(upg => {
    const cur     = state.upg?.[upg.key] || 0;
    const nextT   = cur + 1;
    const cost    = upg.costs[cur] || 0;

    const div = document.createElement('div');
    div.className = 'chest-item';

    const nameEl = document.createElement('div');
    nameEl.className = 'ci-name';
    nameEl.textContent = `${upg.name}  →  Tier ${nextT}`;

    const descEl = document.createElement('div');
    descEl.className = 'ci-desc';
    descEl.textContent = upg.desc(nextT) + `  (shop value: ${cost} coins)`;

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

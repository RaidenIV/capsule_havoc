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
import { recomputeLuck }   from '../luck.js';
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
// Each entry: { key, name, costs[], desc(tier) }
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  {
    id: 'weapons', label: 'Weapons',
    upgrades: [
{ key: 'laserFire', name: 'Laser Fire',         costs: [ 250, 900, 2200, 5500, 12000],
  desc: t => t === 1
    ? 'Unlocks automatic laser fire'
    : `Improves laser pattern (Tier ${t})` },
{ key: 'orbit',     name: 'Orbit Weapon',       costs: [250, 750, 1800, 4200, 9000],
  desc: t => t === 1
    ? 'Unlocks orbiting bullets'
    : `Adds orbit strength (Tier ${t})` },
      { key: 'dmg',       name: 'Damage',            costs: [50, 150, 400, 1000, 2500],
        desc: t => `+15% weapon damage (Tier ${t})` },
      { key: 'fireRate',  name: 'Fire Rate',          requires: { key: 'laserFire', minTier: 1 },  costs: [75, 200, 500, 1200, 3000],
        desc: t => `-10% shot cooldown (Tier ${t})` },
      { key: 'projSpeed', name: 'Projectile Speed',   costs: [100, 300, 800, 2000],
    requires: { key: 'laserFire', minTier: 1 },
        desc: t => `+20% projectile speed (Tier ${t})` },
      { key: 'piercing',  name: 'Piercing',           costs: [200, 600, 1500],
        desc: t => `+1 enemy pierced per shot (Tier ${t})` },
      { key: 'multishot', name: 'Multishot',          costs: [500, 1500, 4000],
    requires: { key: 'laserFire', minTier: 1 },
        desc: t => `+1 extra projectile per shot (Tier ${t})` },
    ],
  },
  {
    id: 'movement', label: 'Movement',
    upgrades: [
      { key: 'moveSpeed', name: 'Move Speed',         costs: [60, 180, 450, 1100, 2800],
        desc: t => `+8% movement speed (Tier ${t})` },
      { key: 'dash',      name: 'Dash',               costs: [300, 700, 1800],
        desc: t => ['Unlocks dash (Shift key)', 'Reduces cooldown by 30%', 'Adds i-frames during dash'][t-1] },
      { key: 'magnet',    name: 'Magnet Radius',      costs: [80, 250, 650, 1600],
        desc: t => `+1.25 coin attraction range (Tier ${t})` },
    ],
  },
  {
    id: 'abilities', label: 'Abilities',
    upgrades: [
      { key: 'shield',    name: 'Shield',             costs: [400, 1000, 2500],
        desc: t => ['Rechargeable bubble shield (2.0 radius, 1 hit)', '-35% recharge time', '2-hit bubble shield (2.0 radius)'][t-1] },
      { key: 'burst',     name: 'Area Burst [E]',     costs: [350, 900, 2200, 5500],
        desc: t => ['+Radial damage pulse', '+25% radius & damage', '-30% cooldown', '+Knockback on burst'][t-1] },
      { key: 'timeSlow',  name: 'Time Slow [Q]',      costs: [600, 1500, 3800],
        desc: t => ['50% slow for 3s on enemies', 'Extends duration to 5s', 'Deepens slow to 25% speed'][t-1] },
    ],
  },
  {
    id: 'powerups', label: 'Power Ups',
    upgrades: [
      { key: 'maxHealth', name: 'Max Health',         costs: [40, 120, 350, 900, 2200],
        desc: t => `+10% max HP (Tier ${t})` },
      { key: 'regen',     name: 'Health Regen',       costs: [100, 300, 750, 1800],
        desc: t => `+${t} HP/sec regeneration` },
      { key: 'xpGrowth',  name: 'XP Growth',          costs: [150, 400, 1000, 2500],
        desc: t => `+15% XP from kills (Tier ${t})` },
      { key: 'coinBonus', name: 'Coin Bonus',         costs: [200, 600, 1500],
        desc: t => `+20% coins per kill (Tier ${t})` },
      { key: 'curse',     name: 'Curse ⚠',           costs: [500, 1500, 4000],
        desc: t => `Enemies +20% HP/DMG → +25% coins, +10% XP (Tier ${t})` },
      { key: 'luck',      name: 'Luck',               costs: [250, 700, 1800],
        desc: t => `+5 Luck — better chests & 4th level option (Tier ${t})` },
    ],
  },
];

// Flat list of all upgrades (used by chest reward item picker)
const ALL_UPGRADES = TABS.flatMap(tab => tab.upgrades);

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
  if (shieldTier > 0) ownedRows.push(_statRow('Shield', `${shieldCharges} hit • 2.0 radius • ${shieldRecharge.toFixed(1)}s recharge`));
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
let _activeTab = 'weapons';
let _onClose   = null;

// ─────────────────────────────────────────────────────────────────────────────
// Inject minimal tab + shop CSS (idempotent)
// ─────────────────────────────────────────────────────────────────────────────
function ensureShopStyles() {
  if (document.getElementById('shop-dynamic-styles')) return;
  const style = document.createElement('style');
  style.id = 'shop-dynamic-styles';
  style.textContent = `
    /* ── Tab bar ── */
    #shopTabs {
      display:flex; gap:0; margin-bottom:12px; flex-wrap:nowrap;
      position:sticky; top:0; z-index:10;
      background:#06080f;
      padding:10px 0 0;
      border-bottom: 1px solid rgba(255,255,255,0.07);
    }
    .shop-tab-btn {
      flex:1; padding:8px 10px 9px;
      background:transparent; border:none; border-bottom:2px solid transparent;
      color:rgba(255,255,255,0.3); font-family:var(--mono,monospace);
      font-size:10px; font-weight:700; letter-spacing:.18em;
      text-transform:uppercase; cursor:pointer;
      transition:color .12s, border-color .12s;
      margin-bottom:-1px;
    }
    .shop-tab-btn:hover  { color:rgba(255,255,255,0.65); }
    .shop-tab-btn.active { color:#00e5ff; border-bottom-color:#00e5ff; }
    .shop-tab-content    { display:none; }
    .shop-tab-content.active { display:block; }

    /* ── Tier badge inline ── */
    .upg-tier {
      font-family:var(--mono,monospace); font-size:9px;
      color:rgba(0,229,255,0.4); margin-left:7px; letter-spacing:.08em;
    }

    /* ── Tier dots ── */
    .upg-tiers { display:flex; gap:3px; margin-top:5px; align-items:center; }
    .upg-pip {
      width:14px; height:2px; border-radius:1px;
      background:rgba(255,255,255,0.1);
    }
    .upg-pip.filled { background:rgba(0,229,255,0.7); }
    .upg-pip.maxed  { background:rgba(255,255,255,0.2); }

    /* ── Inline coin badge inside buy btn ── */
    .upg-buy .upgrade-coins {
      display:inline-flex; align-items:center; gap:4px;
      padding:0; border:none; background:none;
    }
    .upg-buy .upgrade-coins .coin-icon {
      width:8px; height:8px; border-radius:50%; flex-shrink:0;
      background:radial-gradient(circle at 35% 30%,#fff7c0,#ffd84a 50%,#c8860a);
    }

    .upgrade-hdr .upgrade-coins {
      padding:0;
      border:none;
      background:none;
      box-shadow:none;
    }

    /* ── Stats panel ── */
    #upgradeStatsPanel {
      background:#06080f !important;
      border:1px solid rgba(0,229,255,0.12) !important;
      border-radius:8px !important;
      box-shadow:0 8px 30px rgba(0,0,0,0.6) !important;
    }

    /* ── Chest overlay ── */
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
    .curse-warning {
      font-family:var(--mono,monospace); color:rgba(255,120,60,0.8);
      font-size:9px; margin-top:3px; letter-spacing:.06em;
    }
  `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build or re-inject the tab bar into the overlay
// ─────────────────────────────────────────────────────────────────────────────
function ensureTabBar(overlay) {
  if (overlay.querySelector('#shopTabs')) return;

  // Insert tab bar before upgradeList
  const tabBar = document.createElement('div');
  tabBar.id = 'shopTabs';

  TABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'shop-tab-btn' + (tab.id === _activeTab ? ' active' : '');
    btn.dataset.tab = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => {
      _activeTab = tab.id;
      renderShop();
  updateStatsPanel();
    });
    tabBar.appendChild(btn);
  });

  const upgradeList = $('upgradeList');
  if (upgradeList) {
    upgradeList.parentNode.insertBefore(tabBar, upgradeList);
  } else {
    overlay.appendChild(tabBar);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main shop render
// ─────────────────────────────────────────────────────────────────────────────
function renderShop() {
  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  ensureShopStyles();
  ensureTabBar(overlay);

  // Update tab button states
  overlay.querySelectorAll('.shop-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === _activeTab);
  });

  const list = $('upgradeList');
  if (!list) return;
  list.innerHTML = '';

  const tabDef = TABS.find(t => t.id === _activeTab);
  if (!tabDef) return;

  const coins = state.coins || 0;

  const upgradesSorted = [...tabDef.upgrades].filter(meetsRequirement).sort((a, b) => {
    const ta = Math.max(0, state.upg?.[a.key] || 0);
    const tb = Math.max(0, state.upg?.[b.key] || 0);
    const ma = a.costs.length;
    const mb = b.costs.length;
    const ca = ta >= ma ? Number.POSITIVE_INFINITY : (a.costs[ta] ?? Number.POSITIVE_INFINITY);
    const cb = tb >= mb ? Number.POSITIVE_INFINITY : (b.costs[tb] ?? Number.POSITIVE_INFINITY);
    if (ca !== cb) return ca - cb;
    return (a.name || '').localeCompare(b.name || '');
  });

  upgradesSorted.forEach(upg => {
    const currentTier = Math.max(0, state.upg?.[upg.key] || 0);
    const maxTier     = upg.costs.length;
    const isMaxed     = currentTier >= maxTier;
    const nextCost    = isMaxed ? 0 : upg.costs[currentTier];
    const canAfford   = coins >= nextCost;

    const row = document.createElement('div');
    row.className = 'upgrade-row' +
      (isMaxed ? ' is-maxed' : (!canAfford ? ' cannot-afford' : ''));

    // Left side
    const left = document.createElement('div');
    left.style.flex = '1';

    const nameEl = document.createElement('div');
    nameEl.className = 'upg-name';
    nameEl.innerHTML = upg.name;
    if (currentTier > 0) {
      const tierBadge = document.createElement('span');
      tierBadge.className = 'upg-tier';
      tierBadge.textContent = `[${currentTier}/${maxTier}]`;
      nameEl.appendChild(tierBadge);
    }

    const descEl = document.createElement('div');
    descEl.className = 'upg-meta';
    if (isMaxed) {
      descEl.textContent = 'Maxed';
      descEl.style.color = '#00ff66aa';
    } else {
      descEl.textContent = upg.desc(currentTier + 1);
    }

    left.appendChild(nameEl);
    left.appendChild(descEl);

    // Tier pip track
    if (maxTier > 1) {
      const pips = document.createElement('div');
      pips.className = 'upg-tiers';
      for (let i = 0; i < maxTier; i++) {
        const pip = document.createElement('div');
        pip.className = 'upg-pip' + (i < currentTier ? (isMaxed ? ' maxed' : ' filled') : '');
        pips.appendChild(pip);
      }
      left.appendChild(pips);
    }

    // Curse warning
    if (upg.key === 'curse' && currentTier > 0) {
      const warn = document.createElement('div');
      warn.className = 'curse-warning';
      warn.textContent = `⚠ Enemies have +${currentTier * 20}% HP and damage`;
      left.appendChild(warn);
    }

    // Buy button
    const btn = document.createElement('button');
    btn.className = 'upg-buy' + (isMaxed ? ' owned' : '');
    btn.disabled  = isMaxed || !canAfford;

    if (isMaxed) {
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
      if (btn.disabled) return;
      const c = state.coins || 0;
      if (c < nextCost) return;

      state.coins -= nextCost;
      state.upg[upg.key] = currentTier + 1;

      applyUpgradeEffect(upg.key, currentTier + 1);
      playSound?.('purchase', 0.8);


      try { updateStatsPanel(); } catch {}
      updateCoinsUI();
      renderShop();
  updateStatsPanel();
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  });

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

  // Candidates: upgrades that have a next tier to purchase and are within the tier cap
  const candidates = ALL_UPGRADES.filter(upg => {
    const cur = state.upg?.[upg.key] || 0;
    return cur < upg.costs.length && (cur + 1) <= tierCap;
  });

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

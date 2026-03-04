// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
// Full 4-tab upgrade shop (Weapons / Movement / Abilities / Power Ups)
// + Chest reward overlay
// Based on game_design_doc.md Section 9 & 10

import { state }           from '../state.js';
import { playSound }       from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';
import { getFireInterval, getWaveBullets, getBulletDamage } from '../xp.js';
import { updateHealthBar } from '../player.js';
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
        desc: t => ['Rechargeable 1-hit shield', '-35% recharge time', '2-hit shield'][t-1] },
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
    right: 18px;
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

function updateStatsPanel(){
  const panel = ensureStatsPanel();
  if (!panel) return;
  const body = panel.querySelector('#upgradeStatsBody');
  if (!body) return;

  const hp = Math.round(state.playerHP);
  const maxHp = Math.round(state.playerMaxHP || 100);
  const dmg = Math.round(getBulletDamage());
  const shots = Math.max(1, getWaveBullets());
  const fire = getFireInterval();

  const laserTier = Math.max(0, state.upg?.laserFire || 0);
  const orbitTier = Math.max(0, state.upg?.orbit || 0);

  const msTier = Math.max(0, (state.upg?.multishot ?? state.upg?.multiShot ?? 0));
  const psTier = Math.max(0, (state.upg?.projSpeed ?? 0));
  const pierce = Math.max(0, (state.upg?.piercing ?? 0));

  const moveTier = Math.max(0, (state.upg?.move || 0));
  const dashTier = Math.max(0, (state.upg?.dash || 0));
  const magnetTier = Math.max(0, (state.upg?.magnet || 0));

  const shieldTier = Math.max(0, (state.upg?.shield || 0));
  const armorHits = Math.max(0, state.armorHits || 0);
  const lives = Math.max(0, state.extraLives || 0);

  const luck = Math.max(0, state.luck || 0);
  const curse = Math.max(0, state.curseTier || 0);

  body.innerHTML = [
    _statRow('HP', `${hp} / ${maxHp}`),
    _statRow('Damage', `${dmg}`),
    _statRow('Shots', `${shots}x`),
    _statRow('Fire Interval', `${fire.toFixed(2)}s`),
    _statRow('Laser Tier', `${laserTier}`),
    _statRow('Orbit Tier', `${orbitTier}`),
    _statRow('Multishot', `+${msTier}`),
    _statRow('Proj Speed', `T${psTier}`),
    _statRow('Piercing', `T${pierce}`),
    _statRow('Move Speed', `T${moveTier}`),
    _statRow('Dash', `T${dashTier}`),
    _statRow('Magnet', `T${magnetTier}`),
    _statRow('Shield', `T${shieldTier}`),
    _statRow('Armor', `${armorHits}`),
    _statRow('Extra Life', `${lives}`),
    _statRow('Luck', `${luck}`),
    _statRow('Curse', `${curse}`),
  ].join('');
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
    #shopTabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; position:sticky; top:0; z-index:10; background:rgba(10,12,18,0.95); backdrop-filter:blur(8px); padding:6px 0 8px; margin-left:-2px; margin-right:-2px; }
    .shop-tab-btn {
      flex:1; min-width:80px; padding:7px 10px;
      background:rgba(255,255,255,0.07); border:1px solid rgba(255,255,255,0.15);
      border-radius:8px; color:#aaa; font-size:12px; font-weight:700;
      text-transform:uppercase; letter-spacing:.05em; cursor:pointer;
      transition:background .15s,color .15s,border-color .15s;
    }
    .shop-tab-btn:hover  { background:rgba(0,229,255,0.12); color:#00e5ff; border-color:#00e5ff44; }
    .shop-tab-btn.active { background:rgba(0,229,255,0.18); color:#00e5ff; border-color:#00e5ff; }
    .shop-tab-content    { display:none; }
    .shop-tab-content.active { display:block; }
    .upg-section-label {
      font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase;
      color:#555; margin:14px 0 6px; padding-bottom:4px;
      border-bottom:1px solid rgba(255,255,255,0.07);
    }
    .upgrade-row {
      display:flex; align-items:center; justify-content:space-between;
      padding:9px 10px; border-radius:8px; margin-bottom:5px;
      background:rgba(255,255,255,0.04); gap:10px;
    }
    .upgrade-row:hover { background:rgba(255,255,255,0.07); }
    .upg-name  { font-size:13px; font-weight:700; color:#ddd; margin-bottom:2px; }
    .upg-meta  { font-size:11px; color:#777; }
    .upg-tier  { font-size:11px; color:#00e5ff88; margin-left:4px; }
    .upg-buy {
      display:flex; align-items:center; gap:6px;
      padding:6px 12px; border-radius:6px; border:1px solid rgba(0,229,255,0.3);
      background:rgba(0,229,255,0.1); color:#00e5ff; font-size:12px; font-weight:700;
      cursor:pointer; white-space:nowrap; transition:background .12s, opacity .12s;
      flex-shrink:0;
    }
    .upg-buy:hover:not(:disabled) { background:rgba(0,229,255,0.22); }
    .upg-buy:disabled { opacity:0.38; cursor:not-allowed; }
    .upg-buy.owned { border-color:rgba(0,255,102,0.3); background:rgba(0,255,102,0.08); color:#00ff66; }
    .upgrade-coins { display:flex; align-items:center; gap:3px; font-size:11px; }
    .upgrade-coins .coin-icon {
      display:inline-block; width:8px; height:8px; border-radius:50%;
      background:#ffe566; box-shadow:0 0 4px #f0a80088;
    }
    /* Chest overlay */
    #chestOverlay {
      display:none; position:fixed; inset:0; z-index:120;
      background:rgba(0,0,0,0.82); align-items:center; justify-content:center;
    }
    #chestOverlay.show { display:flex; }
    #chestOverlay .chest-box {
      background:#0e0e18; border:1px solid rgba(255,255,255,0.12); border-radius:16px;
      padding:28px 32px; min-width:340px; max-width:520px; width:90%;
      display:flex; flex-direction:column; gap:14px;
    }
    #chestOverlay h2 { font-size:20px; font-weight:800; color:#ffe566; margin:0; text-align:center; }
    #chestOverlay .chest-sub { font-size:12px; color:#666; text-align:center; margin-top:-8px; }
    #chestOverlay .chest-items { display:flex; flex-direction:column; gap:8px; }
    #chestOverlay .chest-item {
      padding:10px 14px; border-radius:8px;
      background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
      cursor:pointer; transition:background .12s, border-color .12s;
    }
    #chestOverlay .chest-item:hover { background:rgba(0,229,255,0.12); border-color:#00e5ff44; }
    #chestOverlay .chest-item .ci-name { font-size:13px; font-weight:700; color:#ddd; }
    #chestOverlay .chest-item .ci-desc { font-size:11px; color:#777; margin-top:2px; }
    #chestOverlay .chest-close { font-size:12px; color:#555; text-align:center; cursor:pointer; }
    #chestOverlay .chest-close:hover { color:#aaa; }
    .curse-warning { color:#ff8844; font-size:10px; margin-top:2px; }
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
    row.className = 'upgrade-row';

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
      const coinDot = document.createElement('span');
      coinDot.className = 'coin-icon';
      const costEl = document.createElement('span');
      costEl.textContent = String(nextCost);
      pill.appendChild(coinDot);
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
      closeChestOverlay();
    });

    list.appendChild(div);
  });

  overlay.classList.add('show');
}
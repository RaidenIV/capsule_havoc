// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
// Full 4-tab upgrade shop (Weapons / Movement / Abilities / Power Ups)
// + Chest reward overlay
// Based on game_design_doc.md Section 9 & 10

import { state }           from '../state.js';
import { playSound }       from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';
import { updateHealthBar } from '../player.js';
import { recomputeLuck }   from '../luck.js';
import { getPlayerMaxHPForLevel } from '../constants.js';

// ─────────────────────────────────────────────────────────────────────────────
// Shop definition (Section 9)
// Each entry: { key, name, costs[], desc(tier) }
// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  {
    id: 'weapons', label: 'Weapons',
    upgrades: [
      { key: 'dmg',       name: 'Damage',            costs: [50, 150, 400, 1000, 2500],
        desc: t => `+15% weapon damage (Tier ${t})` },
      { key: 'fireRate',  name: 'Fire Rate',          costs: [75, 200, 500, 1200, 3000],
        desc: t => `-10% shot cooldown (Tier ${t})` },
      { key: 'projSpeed', name: 'Projectile Speed',   costs: [100, 300, 800, 2000],
        desc: t => `+20% projectile speed (Tier ${t})` },
      { key: 'piercing',  name: 'Piercing',           costs: [200, 600, 1500],
        desc: t => `+1 enemy pierced per shot (Tier ${t})` },
      { key: 'multishot', name: 'Multishot',          costs: [500, 1500, 4000],
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
    /* ── Upgrade Shop (improved UI) ─────────────────────────────────────── */
    #shopTabs{
      display:flex;
      gap:8px;
      margin: 0 0 14px;
      padding: 8px;
      border-radius: 14px;
      position: sticky;
      top: 0;
      z-index: 10;
      background: rgba(10,12,18,0.55);
      border: 1px solid rgba(255,255,255,0.10);
      backdrop-filter: blur(14px);
      box-shadow: 0 10px 30px rgba(0,0,0,0.30), inset 0 1px 0 rgba(255,255,255,0.10);
    }

    .shop-tab-btn{
      flex: 1;
      min-width: 110px;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.78);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
      cursor: pointer;
      display:flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      transition: transform .12s ease, background .12s ease, border-color .12s ease, color .12s ease;
      user-select:none;
    }
    .shop-tab-btn:hover{
      transform: translateY(-1px);
      background: rgba(0,229,255,0.10);
      border-color: rgba(0,229,255,0.35);
      color: rgba(0,229,255,0.95);
    }
    .shop-tab-btn:active{ transform: translateY(0px); }

    .shop-tab-btn.active{
      background: linear-gradient(180deg, rgba(0,229,255,0.22), rgba(0,229,255,0.10));
      border-color: rgba(0,229,255,0.60);
      color: rgba(0,229,255,0.98);
      box-shadow: 0 10px 24px rgba(0,229,255,0.12);
    }

    .shop-tab-ico{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      width: 18px;
      height: 18px;
      border-radius: 8px;
      background: rgba(255,255,255,0.08);
      border: 1px solid rgba(255,255,255,0.10);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.10);
      font-size: 12px;
      line-height: 1;
    }

    .upgrade-row{
      display:flex;
      align-items: stretch;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 12px;
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04));
      border: 1px solid rgba(255,255,255,0.12);
      box-shadow: 0 10px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.10);
    }

    .upgrade-row:hover{
      border-color: rgba(255,255,255,0.18);
      background: linear-gradient(180deg, rgba(255,255,255,0.10), rgba(255,255,255,0.05));
    }

    .upgrade-row.maxed{
      border-color: rgba(0,255,102,0.22);
      box-shadow: 0 10px 24px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,255,102,0.16), inset 0 1px 0 rgba(255,255,255,0.10);
    }

    .upg-left{ flex:1; min-width: 0; }

    .upg-name{
      font-size: 14px;
      font-weight: 900;
      color: rgba(255,255,255,0.94);
      letter-spacing: .04em;
      display:flex;
      align-items:center;
      gap:8px;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .upg-tier{
      font-size: 11px;
      font-weight: 800;
      color: rgba(0,229,255,0.70);
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid rgba(0,229,255,0.22);
      background: rgba(0,229,255,0.08);
      letter-spacing: .06em;
      flex-shrink: 0;
    }

    .upg-meta{
      font-size: 12px;
      color: rgba(255,255,255,0.64);
      line-height: 1.25;
    }

    .curse-warning{
      margin-top: 8px;
      padding: 8px 10px;
      border-radius: 12px;
      background: rgba(255, 60, 60, 0.10);
      border: 1px solid rgba(255, 60, 60, 0.22);
      color: rgba(255, 160, 160, 0.92);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .03em;
    }

    .upg-buy{
      display:flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 14px;
      border: 1px solid rgba(0,229,255,0.35);
      background: linear-gradient(180deg, rgba(0,229,255,0.18), rgba(0,229,255,0.08));
      color: rgba(0,229,255,0.96);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .10em;
      text-transform: uppercase;
      cursor:pointer;
      min-width: 120px;
      box-shadow: 0 12px 22px rgba(0,229,255,0.10);
      transition: transform .12s ease, background .12s ease, opacity .12s ease, box-shadow .12s ease;
    }

    .upg-buy:hover:not(:disabled){
      transform: translateY(-1px);
      background: linear-gradient(180deg, rgba(0,229,255,0.26), rgba(0,229,255,0.10));
      box-shadow: 0 18px 26px rgba(0,229,255,0.14);
    }

    .upg-buy:disabled{
      opacity: 0.38;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }

    .upg-buy.owned{
      border-color: rgba(0,255,102,0.30);
      background: linear-gradient(180deg, rgba(0,255,102,0.16), rgba(0,255,102,0.06));
      color: rgba(0,255,102,0.95);
      box-shadow: 0 12px 22px rgba(0,255,102,0.08);
    }

    .upg-buy .buy-label{
      display:flex;
      align-items:center;
      justify-content:center;
    }

    .upg-buy .cost-pill{
      display:flex;
      align-items:center;
      justify-content:center;
      gap:6px;
      padding: 6px 10px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(0,0,0,0.22);
      color: rgba(255,255,255,0.90);
      font-weight: 800;
      letter-spacing: .02em;
      text-transform: none;
      font-size: 12px;
    }

    .cost-pill .coin-icon{
      display:inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #ffe566;
      box-shadow: 0 0 6px #f0a80088, inset 0 1px 0 rgba(255,255,255,0.30);
    }

    @media (max-width: 520px){
      .shop-tab-btn{ min-width: 90px; padding: 9px 10px; }
      .upg-buy{ min-width: 108px; padding: 9px 10px; }
      .upg-name{ font-size: 13px; }
      .upg-meta{ font-size: 11px; }
    }

    /* Chest overlay stays handled below (existing rules) */
    `;
  document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build or re-inject the tab bar into the overlay
// ─────────────────────────────────────────────────────────────────────────────
function ensureTabBar(overlay) {
  if (overlay.querySelector('#shopTabs')) return;

  // Insert tab bar before upgradeList
  const TAB_ICONS = { weapon: '⚡', movement: '🏃', abilities: '✨', powerups: '💠' };

  const tabBar = document.createElement('div');
  tabBar.id = 'shopTabs';

  TABS.forEach(tab => {
    const btn = document.createElement('button');
    btn.className = 'shop-tab-btn' + (tab.id === _activeTab ? ' active' : '');
    btn.dataset.tab = tab.id;
    const ico = document.createElement('span');
    ico.className = 'shop-tab-ico';
    ico.textContent = TAB_ICONS[tab.id] || '•';
    const label = document.createElement('span');
    label.textContent = tab.label;
    btn.appendChild(ico);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      _activeTab = tab.id;
      renderShop();
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

  tabDef.upgrades.forEach(upg => {
    const currentTier = Math.max(0, state.upg?.[upg.key] || 0);
    const maxTier     = upg.costs.length;
    const isMaxed     = currentTier >= maxTier;
    const nextCost    = isMaxed ? 0 : upg.costs[currentTier];
    const canAfford   = coins >= nextCost;

    const row = document.createElement('div');
    row.className = 'upgrade-row' + (isMaxed ? ' maxed' : '');

    // Left side
    const left = document.createElement('div');
    left.className = 'upg-left';

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
      label.className = 'buy-label';
      label.textContent = canAfford ? 'BUY' : 'NEED';

      const pill = document.createElement('span');
      pill.className = 'cost-pill';
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
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  });
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

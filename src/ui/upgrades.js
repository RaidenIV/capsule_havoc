// ─── ui/upgrades.js ─────────────────────────────────────────────────────────
// Design-doc upgrade shop + chest rewards.
// - Shop opens after every level-up (coins are spent here)
// - Boss drops chests; opening a chest offers 1/3/5 free upgrade items
//
// This module only handles UI + upgrade bookkeeping; gameplay effects are
// applied by updating state fields consumed by other modules.

import { state } from '../state.js';
import { playSound } from '../audio.js';
import { updateHealthBar, updateDashBar } from '../player.js';

let _onClose = null;
let _mode = 'shop'; // 'shop' | 'chest'

function $(id){ return document.getElementById(id); }

// ── Upgrade catalog (prices from design doc Section 9) ──────────────────────
const CATALOG = Object.freeze({
  weapons: [
    { key: 'dmg',       name: 'DAMAGE',           tiers: [50,150,400,1000,2500],  desc: '+15% base damage / tier' },
    { key: 'fireRate',  name: 'FIRE RATE',        tiers: [75,200,500,1200,3000],  desc: '-10% shot cooldown / tier' },
    { key: 'projSpeed', name: 'PROJECTILE SPEED', tiers: [100,300,800,2000],      desc: '+20% bullet speed / tier' },
    { key: 'piercing',  name: 'PIERCING',         tiers: [200,600,1500],          desc: '+1 pierce / tier (max 3)' },
    { key: 'multishot', name: 'MULTISHOT',        tiers: [500,1500,4000],         desc: '+1 projectile / tier (2→4)' },
  ],
  movement: [
    { key: 'moveSpeed', name: 'MOVE SPEED',       tiers: [60,180,450,1100,2800],  desc: '+8% move speed / tier' },
    { key: 'dash',      name: 'DASH',             tiers: [300,700,1800],          desc: 'T1 unlock · T2 -30% CD · T3 i-frames' },
    { key: 'magnet',    name: 'MAGNET RADIUS',    tiers: [80,250,650,1600],       desc: 'Wider coin pull radius' },
  ],
  abilities: [
    { key: 'shield',    name: 'SHIELD',           tiers: [400,1000,2500],         desc: 'Rechargeable hit-shield' },
    { key: 'burst',     name: 'AREA BURST',       tiers: [350,900,2200,5500],     desc: 'E: radial damage pulse' },
    { key: 'timeSlow',  name: 'TIME SLOW',        tiers: [600,1500,3800],         desc: 'Q: global slow (3–5s)' },
  ],
  power: [
    { key: 'maxHealth', name: 'MAX HEALTH',       tiers: [40,120,350,900,2200],   desc: '+10% max HP / tier' },
    { key: 'regen',     name: 'HEALTH REGEN',     tiers: [100,300,750,1800],      desc: '+1 HP/sec / tier' },
    { key: 'xpGrowth',  name: 'XP GROWTH',        tiers: [150,400,1000,2500],     desc: '+15% XP / tier' },
    { key: 'coinBonus', name: 'COIN BONUS',       tiers: [200,600,1500],          desc: '+20% coin value / tier' },
    { key: 'curse',     name: 'CURSE',            tiers: [500,1500,4000],         desc: '+20% enemy HP/DMG, +25% coins, +10% XP' },
    { key: 'luck',      name: 'LUCK',             tiers: [250,700,1800],          desc: '+5 Luck / tier' },
  ],
});

const TAB_ORDER = [
  { id: 'weapons', label: 'WEAPONS' },
  { id: 'movement', label: 'MOVEMENT' },
  { id: 'abilities', label: 'ABILITIES' },
  { id: 'power', label: 'POWER UPS' },
];

function clampInt(n, lo, hi){ return Math.max(lo, Math.min(hi, n|0)); }

// ── Luck helpers (Section 11) ───────────────────────────────────────────────
export function recalcLuck(){
  const shopLuck = (state.upg?.luck || 0) * 5;
  const curse = clampInt(state.upg?.curse || 0, 0, 3);
  const curseLuck = curse === 1 ? 3 : curse === 2 ? 6 : curse === 3 ? 10 : 0;
  const bossLuck = state.bossLuck || 0;
  state.luck = shopLuck + curseLuck + bossLuck;
}

function chanceFourthOption(luck){
  if (luck < 10) return 0;
  if (luck < 15) return 0.15;
  if (luck < 20) return 0.30;
  if (luck < 25) return 0.50;
  if (luck < 30) return 0.70;
  return 0.90;
}

function chestItemRollCount(luck){
  // Based on table in Section 10.
  // We approximate with piecewise linear interpolation between Luck 0/10/20/30.
  const L = Math.max(0, Math.min(30, luck));
  const lerp = (a,b,t)=>a+(b-a)*t;
  function probsAt(x){
    if (x <= 10) {
      const t = x/10;
      return {
        p1: lerp(0.70,0.45,t),
        p3: lerp(0.25,0.40,t),
        p5: lerp(0.05,0.15,t),
      };
    }
    if (x <= 20) {
      const t = (x-10)/10;
      return {
        p1: lerp(0.45,0.20,t),
        p3: lerp(0.40,0.55,t),
        p5: lerp(0.15,0.25,t),
      };
    }
    const t = (x-20)/10;
    return {
      p1: lerp(0.20,0.00,t),
      p3: lerp(0.55,0.632,t),
      p5: lerp(0.25,0.368,t),
    };
  }
  const p = probsAt(L);
  const r = Math.random();
  if (r < p.p1) return 1;
  if (r < p.p1 + p.p3) return 3;
  return 5;
}

function updateCoinsUI(){
  const el = $('upgradeCoins');
  if (el) el.textContent = String(state.coins || 0);
}

function ensureOverlay(){
  const ov = $('upgradeOverlay');
  const list = $('upgradeList');
  if (!ov || !list) return false;
  return true;
}

function clearOverlay(){
  const list = $('upgradeList');
  if (list) list.innerHTML = '';
}

function setTitle(text){
  const t = document.querySelector('#upgradeOverlay .upgrade-title');
  if (t) t.textContent = text;
}

function setFooterButtons({ primaryLabel='CONTINUE', onPrimary=null, secondaryLabel=null, onSecondary=null }){
  const btn = $('upgradeContinueBtn');
  if (btn){
    btn.textContent = primaryLabel;
    btn.onclick = null;
    btn.onclick = () => onPrimary?.();
  }

  // Optional secondary button (created once)
  const footer = btn?.parentElement;
  if (!footer) return;
  let sec = $('upgradeSecondaryBtn');
  if (!secondaryLabel) {
    if (sec) sec.remove();
    return;
  }
  if (!sec) {
    sec = document.createElement('button');
    sec.id = 'upgradeSecondaryBtn';
    sec.className = 'upgrade-continue';
    sec.style.marginRight = '10px';
    footer.insertBefore(sec, btn);
  }
  sec.textContent = secondaryLabel;
  sec.onclick = () => onSecondary?.();
}

// ── Upgrade application (stat-side effects) ─────────────────────────────────
export function applyUpgradeSideEffects(){
  // Dash unlock is tied to dash tier.
  state.hasDash = (state.upg?.dash || 0) > 0;
  updateDashBar?.();

  // Curse tier is mirrored for convenience.
  state.curseTier = clampInt(state.upg?.curse || 0, 0, 3);
  recalcLuck();

  // Max HP tiers (+10% each)
  const base = 100 + 5 * Math.max(0, (state.playerLevel || 1) - 1);
  const hpMult = 1 + 0.10 * clampInt(state.upg?.maxHealth || 0, 0, 5);
  state.playerMaxHP = Math.round(base * hpMult);
  state.playerHP = Math.min(state.playerHP, state.playerMaxHP);
  updateHealthBar?.();
}

function buyTier(upgKey, cost, { free=false } = {}){
  if (!state.upg) state.upg = {};
  const cur = state.upg[upgKey] || 0;
  if (!free) {
    if ((state.coins || 0) < cost) return false;
    state.coins -= cost;
  }
  state.upg[upgKey] = cur + 1;
  playSound?.('purchase', 0.8);
  updateCoinsUI();
  applyUpgradeSideEffects();
  return true;
}

function makeTabs(activeTab, onSelect){
  const list = $('upgradeList');
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';
  wrap.style.padding = '6px 2px 10px 2px';
  wrap.style.flexWrap = 'wrap';

  TAB_ORDER.forEach(t => {
    const b = document.createElement('button');
    b.className = 'upg-buy';
    b.style.padding = '10px 12px';
    b.style.borderRadius = '10px';
    b.style.opacity = (t.id === activeTab) ? '1' : '0.65';
    b.textContent = t.label;
    b.onclick = () => onSelect?.(t.id);
    wrap.appendChild(b);
  });
  list.appendChild(wrap);
}

function renderShop(activeTab){
  clearOverlay();
  setTitle('UPGRADE SHOP');
  updateCoinsUI();
  makeTabs(activeTab, (t) => renderShop(t));

  // Optional quick-picks block (3 or 4 suggested items) based on luck.
  recalcLuck();
  const picks = document.createElement('div');
  picks.className = 'upg-section';
  const h = document.createElement('div');
  h.className = 'cp-section-label upg-section-label';
  h.textContent = `LEVEL-UP PICKS${Math.random() < chanceFourthOption(state.luck) ? ' (4)' : ''}`;
  picks.appendChild(h);
  $('upgradeList').appendChild(picks);
  renderQuickPicks(picks);

  // Full tab list
  const section = document.createElement('div');
  section.className = 'upg-section';
  const sh = document.createElement('div');
  sh.className = 'cp-section-label upg-section-label';
  sh.textContent = TAB_ORDER.find(x=>x.id===activeTab)?.label || 'UPGRADES';
  section.appendChild(sh);
  $('upgradeList').appendChild(section);

  const items = CATALOG[activeTab] || [];
  items.forEach(item => {
    const cur = state.upg?.[item.key] || 0;
    const max = item.tiers.length;
    const nextIdx = cur;
    const ownedMax = cur >= max;
    const cost = ownedMax ? null : item.tiers[nextIdx];
    const affordable = !ownedMax && (state.coins || 0) >= cost;

    const row = document.createElement('div');
    row.className = 'upgrade-row';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = `${item.name}  (T${Math.min(cur+1,max)}/${max})`;
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = ownedMax ? 'MAXED' : item.desc;
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled = ownedMax || !affordable;
    btn.textContent = ownedMax ? 'MAX' : (affordable ? 'BUY' : 'NEED');
    if (!ownedMax) {
      const pill = document.createElement('span');
      pill.className = 'upgrade-coins';
      const coin = document.createElement('span');
      coin.className = 'coin-icon';
      coin.style.animation = 'none';
      const count = document.createElement('span');
      count.className = 'coin-count';
      count.textContent = String(cost);
      pill.appendChild(coin);
      pill.appendChild(count);
      btn.appendChild(pill);
    }
    btn.onclick = () => {
      if (ownedMax) return;
      if (buyTier(item.key, cost)) renderShop(activeTab);
    };

    row.appendChild(left);
    row.appendChild(btn);
    section.appendChild(row);
  });

  setFooterButtons({
    primaryLabel: 'CONTINUE',
    onPrimary: () => closeUpgradeShopIfOpen(),
  });
}

function pickNextUpgradeable(maxTierAllowed){
  // Flat pool across tabs, but only upgrades that aren't maxed and within max tier.
  const pool = [];
  for (const tab of Object.keys(CATALOG)) {
    for (const item of CATALOG[tab]) {
      const cur = state.upg?.[item.key] || 0;
      const max = Math.min(item.tiers.length, maxTierAllowed);
      if (cur < max) pool.push(item);
    }
  }
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function renderQuickPicks(container){
  // Suggest 3 upgrades (4 with luck chance). These are NOT free; they're just curated.
  const count = 3 + (Math.random() < chanceFourthOption(state.luck) ? 1 : 0);
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const item = pickNextUpgradeable(99);
    if (!item || seen.has(item.key)) continue;
    seen.add(item.key);
    const cur = state.upg?.[item.key] || 0;
    const max = item.tiers.length;
    if (cur >= max) continue;
    const cost = item.tiers[cur];
    const affordable = (state.coins || 0) >= cost;

    const row = document.createElement('div');
    row.className = 'upgrade-row';
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = `${item.name} (Next Tier)`;
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = item.desc;
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled = !affordable;
    btn.textContent = affordable ? 'BUY' : 'NEED';
    const pill = document.createElement('span');
    pill.className = 'upgrade-coins';
    const coin = document.createElement('span');
    coin.className = 'coin-icon';
    coin.style.animation = 'none';
    const c = document.createElement('span');
    c.className = 'coin-count';
    c.textContent = String(cost);
    pill.appendChild(coin); pill.appendChild(c);
    btn.appendChild(pill);
    btn.onclick = () => { if (buyTier(item.key, cost)) renderShop('weapons'); };

    row.appendChild(left);
    row.appendChild(btn);
    container.appendChild(row);
  }
}

function chestMaxTierForTier(chestTier){
  if (chestTier === 'standard') return 2;
  if (chestTier === 'rare') return 4;
  return 5; // epic
}

function renderChest(chestTier){
  clearOverlay();
  updateCoinsUI();
  recalcLuck();

  const maxTier = chestMaxTierForTier(chestTier);
  setTitle(`${chestTier.toUpperCase()} CHEST`);

  const list = $('upgradeList');
  const sec = document.createElement('div');
  sec.className = 'upg-section';
  const h = document.createElement('div');
  h.className = 'cp-section-label upg-section-label';
  h.textContent = `CHOOSE ONE REWARD  •  Luck ${state.luck}  •  Max Tier T${maxTier}`;
  sec.appendChild(h);
  list.appendChild(sec);

  const rollCount = chestItemRollCount(state.luck);
  const options = [];
  const used = new Set();
  for (let i = 0; i < rollCount; i++) {
    let pick = null;
    for (let tries = 0; tries < 20; tries++) {
      const it = pickNextUpgradeable(maxTier);
      if (!it) break;
      if (!used.has(it.key)) { pick = it; break; }
    }
    if (pick) { used.add(pick.key); options.push(pick); }
  }

  if (!options.length) {
    // All upgrades maxed (or capped by chest tier) → coin payout.
    const payout = 500;
    state.coins = (state.coins || 0) + payout;
    updateCoinsUI();
    const msg = document.createElement('div');
    msg.className = 'upg-meta';
    msg.style.padding = '10px 6px';
    msg.textContent = `All eligible upgrades are maxed. Chest converted to +${payout} coins.`;
    sec.appendChild(msg);
    setFooterButtons({ primaryLabel: 'CONTINUE', onPrimary: () => closeUpgradeShopIfOpen() });
    return;
  }

  options.forEach(item => {
    const cur = state.upg?.[item.key] || 0;
    const cost = item.tiers[cur] ?? 0;
    const row = document.createElement('div');
    row.className = 'upgrade-row';
    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = `${item.name}  (FREE Tier ${cur+1})`;
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = item.desc;
    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.textContent = 'TAKE';
    btn.onclick = () => {
      buyTier(item.key, cost, { free: true });
      closeUpgradeShopIfOpen();
    };
    row.appendChild(left);
    row.appendChild(btn);
    sec.appendChild(row);
  });

  setFooterButtons({ primaryLabel: 'SKIP', onPrimary: () => closeUpgradeShopIfOpen() });
}

export function openUpgradeShop(){
  if (!ensureOverlay()) return;
  _mode = 'shop';
  state.upgradeOpen = true;
  const ov = $('upgradeOverlay');
  ov?.classList.add('show');
  ov?.setAttribute('aria-hidden','false');
  applyUpgradeSideEffects();
  renderShop('weapons');
}

export function openChestReward(chestTier='standard', onClose=null){
  if (!ensureOverlay()) return;
  _mode = 'chest';
  _onClose = onClose;
  state.upgradeOpen = true;
  const ov = $('upgradeOverlay');
  ov?.classList.add('show');
  ov?.setAttribute('aria-hidden','false');
  applyUpgradeSideEffects();
  renderChest(chestTier);
}

export function closeUpgradeShopIfOpen(){
  const ov = $('upgradeOverlay');
  if (!ov) return;
  ov.classList.remove('show');
  ov.setAttribute('aria-hidden','true');
  state.upgradeOpen = false;
  clearOverlay();
  const cb = _onClose;
  _onClose = null;
  cb?.();
}

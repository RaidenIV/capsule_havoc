// ─── ui/upgrades.js ─────────────────────────────────────────────────────────
// Upgrade Shop overlay shown between waves.

import { state } from '../state.js';
import { WEAPON_CONFIG } from '../constants.js';
import { syncOrbitBullets } from '../weapons.js';

let _open = false;
let _onContinue = null;

function $(id) { return document.getElementById(id); }

function costForTier(tier) {
  // Tier 1 is the base weapon and is free.
  // Tier N costs 2^(N-1): 2, 4, 8, ...
  if (tier <= 1) return 0;
  return 2 ** (tier - 1);
}

function fmtCoins(n) {
  const v = Math.max(0, Math.floor(n || 0));
  return v.toString();
}

function renderShop() {
  const overlay = $('upgradeShop');
  if (!overlay) return;

  const coinsEl = $('shopCoinsVal');
  if (coinsEl) coinsEl.textContent = fmtCoins(state.coins);

  const list = $('shopList');
  if (!list) return;

  const current = Math.max(1, state.weaponTier || 1);
  const maxTier = Math.max(1, WEAPON_CONFIG.length);

  list.innerHTML = '';

  for (let tier = 2; tier <= maxTier; tier++) {
    const cost = costForTier(tier);
    const owned = tier <= current;
    const canAfford = state.coins >= cost;

    const row = document.createElement('div');
    row.className = 'shop-row';

    const label = document.createElement('div');
    label.className = 'shop-label';
    label.innerHTML = `<div class="shop-tier">TIER ${tier}</div>`;

    const meta = document.createElement('div');
    meta.className = 'shop-meta';
    const [fireInterval, waveBullets, dmgMult] = WEAPON_CONFIG[Math.min(tier - 1, WEAPON_CONFIG.length - 1)];
    meta.textContent = `Fire ${fireInterval.toFixed(2)}s • Bullets ${waveBullets} • DMG x${dmgMult.toFixed(2)}`;
    label.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'shop-buy';

    if (owned) {
      btn.disabled = true;
      btn.textContent = 'OWNED';
      btn.classList.add('owned');
    } else if (!canAfford) {
      btn.disabled = true;
      btn.classList.add('cant');
      btn.innerHTML = `<span>NEED</span><span class="coin-ui"><span class="coin-spin" aria-hidden="true"></span><span class="coin-num">${fmtCoins(cost)}</span></span>`;
    } else {
      btn.disabled = false;
      btn.innerHTML = `<span>BUY</span><span class="coin-ui"><span class="coin-spin" aria-hidden="true"></span><span class="coin-num">${fmtCoins(cost)}</span></span>`;
      btn.addEventListener('click', () => {
        // Buy ONLY the selected tier, not the chain.
        const latestTier = Math.max(1, state.weaponTier || 1);
        if (tier <= latestTier) return;
        const latestCost = costForTier(tier);
        if (state.coins < latestCost) return;

        state.coins -= latestCost;
        state.weaponTier = tier;

        // Apply immediately
        syncOrbitBullets();

        renderShop();
      });
    }

    row.appendChild(label);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

export function openUpgradeShop(waveIndex, onContinue) {
  const overlay = $('upgradeShop');
  if (!overlay) return;

  _open = true;
  _onContinue = typeof onContinue === 'function' ? onContinue : null;

  $('shopWave') && ($('shopWave').textContent = `WAVE ${waveIndex} COMPLETE`);

  overlay.classList.add('show');
  renderShop();

  const btn = $('shopContinue');
  if (btn) {
    btn.onclick = () => {
      // Ensure game resumes after closing the shop
      state.upgradeOpen = false;
      state.paused = false;
      closeUpgradeShopIfOpen();
      if (_onContinue) _onContinue();
    };
  }
}

export function closeUpgradeShopIfOpen() {
  const overlay = $('upgradeShop');
  if (!overlay) return;
  overlay.classList.remove('show');
  // Defensive: if anything set paused, release it on close
  state.paused = false;
  state.upgradeOpen = false;
  _open = false;
  _onContinue = null;
}

export function isUpgradeShopOpen() {
  return _open;
}

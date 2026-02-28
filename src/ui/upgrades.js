// ─── ui/upgrades.js ───────────────────────────────────────────────────────────
// Upgrade shop overlay shown between waves.
// - Pauses the game while open.
// - Next wave starts only when player clicks CONTINUE.
// - Purchases apply immediately.

import { state } from '../state.js';
import { syncOrbitBullets } from '../weapons.js';

let _root = null;
let _onContinue = null;

function ensureRoot() {
  if (_root) return _root;

  _root = document.getElementById('upgrade-overlay');
  if (!_root) {
    _root = document.createElement('div');
    _root.id = 'upgrade-overlay';
    _root.style.display = 'none';
    _root.innerHTML = `
      <div class="upgrade-card">
        <div class="upgrade-title">UPGRADE SHOP</div>
        <div class="upgrade-sub" id="upgrade-sub">Spend coins to buy weapon tiers.</div>
        <div class="upgrade-coins-hud"><span class="coin-icon" aria-hidden="true"></span><span class="coin-count" id="upgrade-coins-val">0</span></div>
        <div class="upgrade-list" id="upgrade-list"></div>
        <div class="upgrade-footer">
          <button class="upgrade-continue" id="upgrade-continue">CONTINUE</button>
        </div>
      </div>
    `;
    document.body.appendChild(_root);
  }

  // Continue button
  _root.querySelector('#upgrade-continue')?.addEventListener('click', () => {
    closeUpgradeShopIfOpen(true);
  });

  return _root;
}

function tierCost(tier) {
  // Tier 1 = 2, tier 2 = 4, ... tier 10 = 1024
  return Math.pow(2, Math.max(1, Math.min(10, tier)));
}

function owned(tier) {
  const cur = Math.max(state.weaponTier || 0, state.weaponTierPurchased || 0, 0);
  return tier <= cur;
}

function applyTier(tier) {
  // Record and apply immediately.
  state.weaponTier = Math.max(state.weaponTier || 0, tier);

  // Back-compat: some modules may still reference playerLevel for weapon tables.
  if (typeof state.playerLevel === 'number') {
    state.playerLevel = Math.max(state.playerLevel, tier);
  }

  // Sync orbit bullets based on current tier/level
  try { syncOrbitBullets(); } catch (e) { /* ignore if not available */ }
}

function renderList() {
  const root = ensureRoot();
  const list = root.querySelector('#upgrade-list');
  const coinsVal = root.querySelector('#upgrade-coins-val');
  if (coinsVal) coinsVal.textContent = String(state.coins ?? 0);

  if (!list) return;
  list.innerHTML = '';

  for (let tier = 1; tier <= 10; tier++) {
    const cost = tierCost(tier);
    const coins = state.coins ?? 0;
    const canAfford = coins >= cost;
    const isOwned = owned(tier);

    const row = document.createElement('div');
    row.className = 'upgrade-row' + (isOwned ? ' owned' : '');
    row.innerHTML = `
      <div class="upgrade-row-left">
        <div class="upgrade-tier">Tier ${tier}</div>
        <div class="upgrade-desc">Improves fire rate, waves, damage, and orbit rings.</div>
      </div>
      <button class="upgrade-buy ${isOwned ? 'owned' : (canAfford ? '' : 'cant-afford')}" ${isOwned ? 'disabled' : (canAfford ? '' : 'disabled')} data-tier="${tier}">
        ${isOwned ? 'OWNED' : (canAfford ? 'BUY' : 'NEED')}
        <span class="upgrade-cost">
          <span class="coin-icon" aria-hidden="true"></span>
          <span class="coin-count">${cost}</span>
        </span>
      </button>
    `;
    list.appendChild(row);
  }

  list.querySelectorAll('.upgrade-buy').forEach(btn => {
    btn.addEventListener('click', () => {
      const tier = Number(btn.getAttribute('data-tier'));
      if (!Number.isFinite(tier)) return;
      if (owned(tier)) return;

      const cost = tierCost(tier);
    const coins = state.coins ?? 0;
    const canAfford = coins >= cost;
      const coins = state.coins ?? 0;
      if (coins < cost) return;

      // IMPORTANT: Buy ONLY the selected tier (no cumulative auto-buy of lower tiers).
      state.coins = coins - cost;
      applyTier(tier);
      renderList();
    });
  });
}

export function openUpgradeShop(waveNum = 1, onContinue = null) {
  const root = ensureRoot();
  _onContinue = typeof onContinue === 'function' ? onContinue : null;

  const sub = root.querySelector('#upgrade-sub');
  if (sub) sub.textContent = `Wave ${waveNum} cleared. Spend coins to upgrade, then CONTINUE.`;

  // Pause game while shop is open
  state.upgradeOpen = true;
  state.paused = true;

  root.style.display = 'flex';
  root.classList.add('show');

  renderList();
}

export function closeUpgradeShopIfOpen(fireContinue = false) {
  if (!_root) return;

  _root.classList.remove('show');
  _root.style.display = 'none';

  // Resume gameplay
  state.upgradeOpen = false;
  state.paused = false;

  const cb = _onContinue;
  _onContinue = null;

  if (fireContinue && cb) cb();
}
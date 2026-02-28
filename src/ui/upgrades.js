// ─── ui/upgrades.js ─────────────────────────────────────────────────────────
// Wave upgrade shop overlay (coin spending). Opens after boss pack per wave.
// - Pauses simulation while open (state.upgradeOpen).
// - Next wave starts only after CONTINUE.
// - Weapon upgrades are purchasable tiers; higher tiers cost more (2..1024).

import { state } from '../state.js';
import { syncOrbitBullets } from '../weapons.js';

let _overlay = null;
let _onContinue = null;

function $(id) { return document.getElementById(id); }

function tierCost(tier) {
  // tier 1 is baseline (free / already owned). Tier 2 cost = 2, tier 3 cost = 4 ... tier 11 cost = 1024
  if (tier <= 1) return 0;
  const pow = Math.min(10, Math.max(1, tier - 1)); // 1..10
  return 2 ** pow;
}

function ensureOverlay() {
  _overlay = $('upgrade-overlay');
  if (!_overlay) return null;
  return _overlay;
}

function render() {
  const ov = ensureOverlay();
  if (!ov) return;

  const coinsEl = $('upg-coins');
  if (coinsEl) coinsEl.textContent = String(state.coins ?? 0);

  const list = $('upg-list');
  if (!list) return;

  list.innerHTML = '';
  const maxTier = 11;

  for (let tier = 2; tier <= maxTier; tier++) {
    const cost = tierCost(tier);
    const owned = (state.weaponTier ?? 1) >= tier;
    const canAfford = (state.coins ?? 0) >= cost;

    const row = document.createElement('div');
    row.className = 'upg-row';

    const left = document.createElement('div');
    left.className = 'upg-left';
    left.innerHTML = `<div class="upg-title">Weapon Tier ${tier}</div>
                      <div class="upg-sub">Improves fire interval, wave count, damage, and orbit rings</div>`;

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled = owned || !canAfford;

    if (owned) {
      btn.textContent = 'OWNED';
      btn.classList.add('owned');
    } else if (!canAfford) {
      btn.innerHTML = `NEED <span class="coin-pill"><span class="coin-icon"></span><span class="coin-count">${cost}</span></span>`;
      btn.classList.add('locked');
    } else {
      btn.innerHTML = `BUY <span class="coin-pill"><span class="coin-icon"></span><span class="coin-count">${cost}</span></span>`;
    }

    btn.addEventListener('click', () => {
      const coins = state.coins ?? 0;
      if (owned) return;
      if (coins < cost) return;

      // Purchase ONLY the selected tier
      state.coins = coins - cost;
      state.weaponTier = tier;

      // Apply immediately (orbit rings)
      try { syncOrbitBullets(); } catch {}

      render();
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

export function openUpgradeShop(waveNum, onContinue) {
  const ov = ensureOverlay();
  _onContinue = typeof onContinue === 'function' ? onContinue : null;
  if (!ov) return;

  // Pause sim while open
  state.upgradeOpen = true;
  state.paused = false; // keep pause overlay logic separate; sim is frozen by upgradeOpen in tick()

  const waveEl = $('upg-wave');
  if (waveEl) waveEl.textContent = `WAVE ${waveNum} COMPLETE`;

  ov.classList.add('show');

  const cont = $('upg-continue');
  if (cont && !cont._bound) {
    cont._bound = true;
    cont.addEventListener('click', () => {
      closeUpgradeShopIfOpen();
      // Ensure the sim resumes
      state.upgradeOpen = false;
      state.paused = false;
      if (_onContinue) _onContinue();
    });
  }

  render();
}

export function closeUpgradeShopIfOpen() {
  const ov = ensureOverlay();
  if (!ov) return;
  ov.classList.remove('show');
}

// ─── ui/upgrades.js ─────────────────────────────────────────────────────────
// Between-wave upgrade shop. The game pauses while this overlay is open.

import { state } from '../state.js';
import { WEAPON_CONFIG, UPGRADE_COST_BY_TIER } from '../constants.js';
import { syncOrbitBullets } from '../weapons.js';
import { playSound } from '../audio.js';

let overlay, coinsEl, listEl, closeBtn, titleEl;
let _onClose = null;

function fmtPct(v) {
  return Math.round(v * 100) + '%';
}

function tierSummary(tier) {
  const c = WEAPON_CONFIG[tier];
  const fire = c[0];
  const bullets = c[1];
  const dmgMult = c[2];
  const orbitCount = c[3];
  const orbitRadius = c[4];
  const orbitSpeed = c[5];
  return {
    fire,
    bullets,
    dmgMult,
    orbitCount,
    orbitRadius,
    orbitSpeed,
  };
}

function render() {
  if (!overlay) return;
  if (coinsEl) coinsEl.textContent = state.coins.toString();

  if (!listEl) return;
  listEl.innerHTML = '';

  for (let tier = 1; tier <= 10; tier++) {
    const row = document.createElement('div');
    row.className = 'upgrade-row';

    const left = document.createElement('div');
    left.className = 'upgrade-left';

    const name = document.createElement('div');
    name.className = 'upgrade-name';
    name.textContent = 'Weapon Tier ' + tier;

    const meta = document.createElement('div');
    meta.className = 'upgrade-meta';

    const s = tierSummary(tier);
    meta.textContent =
      `Fire ${s.fire.toFixed(3)}s • Bullets ${s.bullets} • Damage x${s.dmgMult}` +
      (s.orbitCount > 0 ? ` • Orbit ${s.orbitCount}` : '');

    left.appendChild(name);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.className = 'upgrade-right';

    const cost = UPGRADE_COST_BY_TIER[tier] ?? (tier * 10);
    const costEl = document.createElement('div');
    costEl.className = 'upgrade-cost';
    costEl.textContent = cost + ' coins';

    const btn = document.createElement('button');
    btn.className = 'upgrade-buy-btn';

    const owned = tier <= state.weaponTier;
    const isNext = tier === state.weaponTier + 1;

    if (owned) {
      btn.textContent = 'OWNED';
      btn.disabled = true;
      row.classList.add('owned');
    } else if (!isNext) {
      btn.textContent = 'LOCKED';
      btn.disabled = true;
      row.classList.add('locked');
    } else {
      btn.textContent = 'BUY';
      btn.disabled = state.coins < cost;
      btn.addEventListener('click', () => {
        if (state.coins < cost) return;
        state.coins -= cost;
        state.weaponTier = tier;
        playSound('click', 0.35, 1.0);
        syncOrbitBullets();
        render();
        // Also update HUD coin text if present
        const hudCoin = document.getElementById('coin-count');
        if (hudCoin) hudCoin.textContent = state.coins.toString();
      });
    }

    right.appendChild(costEl);
    right.appendChild(btn);

    row.appendChild(left);
    row.appendChild(right);
    listEl.appendChild(row);
  }
}

export function initUpgradeUI() {
  overlay = document.getElementById('upgradeOverlay');
  coinsEl = document.getElementById('upgradeCoins');
  listEl = document.getElementById('upgradeList');
  closeBtn = document.getElementById('upgradeCloseBtn');
  titleEl = document.getElementById('upgradeTitle');

  if (!overlay) return;

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      closeUpgradeShopIfOpen();
      if (_onClose) { const cb = _onClose; _onClose = null; cb(); }
    });
  }
}

export function openUpgradeShop(waveNum, onClose) {
  if (!overlay) initUpgradeUI();
  if (!overlay) return;

  _onClose = onClose || null;
  if (titleEl) titleEl.textContent = `UPGRADES — AFTER WAVE ${waveNum}`;

  overlay.classList.add('show');
  state.upgradeOpen = true;
  render();
}

export function closeUpgradeShopIfOpen() {
  if (!overlay) return;
  overlay.classList.remove('show');
  state.upgradeOpen = false;
  _onClose = null;
}

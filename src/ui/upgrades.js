// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
import { state } from '../state.js';
import { WEAPON_CONFIG } from '../constants.js';
import { syncOrbitBullets } from '../weapons.js';
import { getFireInterval } from '../xp.js';

let _overlay, _coinsEl, _tierListEl, _continueBtn, _titleEl;
let _onContinue = null;

function $(id) { return document.getElementById(id); }

function ensureDom() {
  _overlay = $('upgrade-overlay');
  _coinsEl = $('upgrade-coins');
  _tierListEl = $('upgrade-tier-list');
  _continueBtn = $('upgrade-continue-btn');
  _titleEl = $('upgrade-title');

  if (!_overlay || !_coinsEl || !_tierListEl || !_continueBtn) return false;

  _continueBtn.onclick = () => {
    closeUpgradeShopIfOpen();
    if (typeof _onContinue === 'function') _onContinue();
  };
  return true;
}

function tierCost(tierIdx) {
  if (tierIdx <= 0) return 0;
  // costs: 2, 4, 8, ... 1024
  return Math.pow(2, tierIdx);
}

function tierLabel(tierIdx) {
  return `Tier ${tierIdx}`;
}

function describeTier(tierIdx) {
  const cfg = WEAPON_CONFIG[Math.min(tierIdx, WEAPON_CONFIG.length - 1)];
  const fire = cfg[0];
  const wave = cfg[1];
  const dmgM = cfg[2];
  const orbitCount = cfg[3];
  return {
    fire, wave, dmgM, orbitCount
  };
}

function render() {
  if (!_overlay) return;

  if (_coinsEl) _coinsEl.textContent = String(state.coins);

  _tierListEl.innerHTML = '';

  const cur = state.weaponTier ?? 0;
  const maxTier = WEAPON_CONFIG.length - 1;

  for (let t = 1; t <= maxTier; t++) {
    const row = document.createElement('div');
    row.className = 'upgrade-tier';

    const left = document.createElement('div');
    left.className = 'upgrade-tier-left';

    const name = document.createElement('div');
    name.className = 'upgrade-tier-name';
    name.textContent = tierLabel(t);

    const meta = document.createElement('div');
    meta.className = 'upgrade-tier-meta';
    const d = describeTier(t);
    meta.textContent = `Fire ${d.fire.toFixed(3)}s · Bullets ${d.wave} · DMG x${d.dmgM} · Orbit ${d.orbitCount}`;

    left.appendChild(name);
    left.appendChild(meta);

    const right = document.createElement('div');
    right.className = 'upgrade-tier-right';

    const cost = tierCost(t);
    const btn = document.createElement('button');
    btn.className = 'upgrade-buy-btn';
    btn.textContent = (t <= cur) ? 'OWNED' : `BUY (${cost})`;

    if (t <= cur) {
      btn.disabled = true;
      row.classList.add('owned');
    } else if (state.coins < cost) {
      btn.disabled = true;
      row.classList.add('locked');
    } else {
      btn.disabled = false;
      btn.onclick = () => {
        if (state.coins < cost) return;
        state.coins -= cost;
        state.weaponTier = t;

        // Apply immediately
        syncOrbitBullets();
        state.shootTimer = Math.min(state.shootTimer, getFireInterval());

        const coinCountEl = $('coin-count');
        if (coinCountEl) coinCountEl.textContent = String(state.coins);

        render();
      };
    }

    right.appendChild(btn);
    row.appendChild(left);
    row.appendChild(right);
    _tierListEl.appendChild(row);
  }
}

export function openUpgradeShop(waveIndex, onContinue) {
  if (!ensureDom()) return;

  _onContinue = onContinue;

  if (_titleEl) _titleEl.textContent = `UPGRADES — AFTER WAVE ${waveIndex}`;
  render();

  _overlay.classList.add('show');
  _overlay.setAttribute('aria-hidden', 'false');
}

export function closeUpgradeShopIfOpen() {
  if (!ensureDom()) return;
  _overlay.classList.remove('show');
  _overlay.setAttribute('aria-hidden', 'true');
  _onContinue = null;
}

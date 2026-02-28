// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
import { state } from '../state.js';
import { WEAPON_TIER_COSTS, WEAPON_CONFIG } from '../constants.js';
import { syncOrbitBullets } from '../weapons.js';

let _overlay, _list, _coinsEl, _continueBtn, _onClose = null;

function g(id){ return document.getElementById(id); }

function ensureRefs() {
  _overlay = g('upgrade-overlay');
  _list = g('upgrade-list');
  _coinsEl = g('shop-coins');
  _continueBtn = g('upgrade-continue-btn');
}

function fmt(n){ return String(n|0); }

function tierName(tier){
  return 'WEAPON TIER ' + tier;
}

function tierDesc(tier){
  const cfg = WEAPON_CONFIG[Math.min(Math.max(tier-1,0), WEAPON_CONFIG.length-1)];
  const fire = cfg[0], wave = cfg[1], dmg = cfg[2];
  return `Fire ${(1/fire).toFixed(2)} rps · ${wave} bullets · dmg ×${dmg}`;
}

function setCoinsUI() {
  if (_coinsEl) _coinsEl.textContent = fmt(state.coins);
}

function renderList() {
  if (!_list) return;
  _list.innerHTML = '';

  const curTier = state.weaponTier || 1;
  for (let tier = 2; tier <= WEAPON_TIER_COSTS.length; tier++) {
    const cost = WEAPON_TIER_COSTS[tier-1];
    const canBuy = state.coins >= cost && tier > curTier;

    const row = document.createElement('div');
    row.className = 'upgrade-item';

    const left = document.createElement('div');
    left.className = 'left';

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = tierName(tier);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = tierDesc(tier);

    left.appendChild(name);
    left.appendChild(desc);

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled = !canBuy;

    // Label + (coin + cost)
    const label = document.createElement('span');
    label.textContent = canBuy ? 'BUY' : (tier <= curTier ? 'OWNED' : 'NEED');

    const pill = document.createElement('span');
    pill.className = 'coin-pill';
    pill.style.padding = '6px 10px';

    const icon = document.createElement('span');
    icon.className = 'coin-icon'; // static in buy buttons (CSS disables animation)

    const val = document.createElement('span');
    val.className = 'coin-value';
    val.textContent = fmt(cost);

    pill.appendChild(icon);
    pill.appendChild(val);

    btn.appendChild(label);
    btn.appendChild(pill);

    btn.addEventListener('click', () => {
      // Buy ONLY the selected tier (no auto-buy of lower tiers)
      const c = WEAPON_TIER_COSTS[tier-1];
      if (tier <= (state.weaponTier || 1)) return;
      if (state.coins < c) return;

      state.coins -= c;
      state.weaponTier = tier;

      // apply immediately
      syncOrbitBullets();

      setCoinsUI();
      renderList();
    });

    row.appendChild(left);
    row.appendChild(btn);
    _list.appendChild(row);
  }
}

export function openUpgradeShop(waveNum, onClose) {
  ensureRefs();
  _onClose = onClose || null;
  if (!_overlay) return;

  setCoinsUI();
  renderList();

  _overlay.classList.add('show');
  _overlay.setAttribute('aria-hidden', 'false');

  // Continue closes shop
  if (_continueBtn) {
    _continueBtn.onclick = () => {
      closeUpgradeShopIfOpen();
      if (_onClose) _onClose();
    };
  }
}

export function closeUpgradeShopIfOpen() {
  ensureRefs();
  if (!_overlay) return;
  _overlay.classList.remove('show');
  _overlay.setAttribute('aria-hidden', 'true');
}

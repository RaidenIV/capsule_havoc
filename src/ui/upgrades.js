// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
import { state } from '../state.js';
import { WEAPON_TIER_COSTS } from '../constants.js';
import { playSound } from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';

let _onClose = null;

function $(id){ return document.getElementById(id); }

const TIER_DESCS = {
  2: '1.2/s fire rate · 1.5× damage',
  3: '2.4/s fire rate · 1.5× damage · 6 orbit bullets',
  4: '2.4/s fire rate · 2.0× damage · 8 orbit bullets',
  5: '2.4/s fire rate · 2.0× damage · 10 orbit bullets',
  6: '4.7/s fire rate · 4.0× damage · 10 orbit bullets',
  7: '4.7/s fire rate · 4.0× damage · 12 orbit bullets',
  8: '4.7/s fire rate · 8.0× damage · 12 orbit bullets',
  9: '9.4/s fire rate · 8.0× damage · 12 orbit bullets',
  10: '9.4/s fire rate · 16.0× damage · 14 orbit bullets',
  11: '9.4/s fire rate · 16.0× damage · 16 orbit bullets',
};

function renderList(){
  const list = $('upgradeList');
  if (!list) return;

  list.innerHTML = '';

  // ── Dash upgrade ──────────────────────────────────────────────────────────
  {
    const dashOwned = !!state.hasDash;
    const dashCost  = 1;
    const affordable = (state.coins || 0) >= dashCost;

    const row  = document.createElement('div');
    row.className = 'upgrade-row';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = 'DASH';
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = dashOwned ? 'OWNED' : 'SHIFT to dash in movement direction · invincibility frames';
    left.appendChild(name);
    left.appendChild(meta);

    const btn  = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled  = dashOwned || !affordable;

    const label = document.createElement('span');
    label.textContent = dashOwned ? 'OWNED' : (affordable ? 'BUY' : 'NEED');

    const pill  = document.createElement('span');
    pill.className = 'upgrade-coins';
    pill.style.padding = '6px 10px';
    const coin  = document.createElement('span');
    coin.className = 'coin-icon';
    coin.style.animation = 'none';
    const count = document.createElement('span');
    count.className = 'coin-count';
    count.textContent = String(dashCost);
    pill.appendChild(coin);
    pill.appendChild(count);

    btn.appendChild(label);
    btn.appendChild(pill);

    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const coins = state.coins || 0;
      if (coins < dashCost) return;
      state.coins   = coins - dashCost;
      state.hasDash = true;
      playSound?.('purchase', 0.8);
      updateCoinsUI();
      renderList();
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  }

  const currentTier = Math.max(1, state.weaponTier || 1);
  const maxTier = WEAPON_TIER_COSTS.length + 1; // tier 1 is base (free), costs start at tier 2

  for (let tier = 2; tier <= maxTier; tier++){
    const cost = WEAPON_TIER_COSTS[tier - 2] ?? WEAPON_TIER_COSTS[WEAPON_TIER_COSTS.length - 1];
    const affordable = (state.coins || 0) >= cost;
    const owned = tier <= currentTier;

    const row = document.createElement('div');
    row.className = 'upgrade-row';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = 'WEAPON TIER ' + tier;
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = owned ? 'OWNED' : (TIER_DESCS[tier] || 'Unlock stronger fire rate / waves / orbit');

    left.appendChild(name);
    left.appendChild(meta);

    const btn = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled = owned || !affordable;

    const label = document.createElement('span');
    label.textContent = owned ? 'OWNED' : (affordable ? 'BUY' : 'NEED');

    const pill = document.createElement('span');
    pill.className = 'upgrade-coins';
    pill.style.padding = '6px 10px';
    const coin = document.createElement('span');
    coin.className = 'coin-icon';
    const count = document.createElement('span');
    count.className = 'coin-count';
    count.textContent = String(cost);
    pill.appendChild(coin);
    pill.appendChild(count);

    // Buy buttons do NOT animate coins (per preference)
    coin.style.animation = 'none';

    btn.appendChild(label);
    btn.appendChild(pill);

    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const coins = state.coins || 0;
      if (coins < cost) return;

      state.coins = coins - cost;
      state.weaponTier = tier;
      try { syncOrbitBullets(); } catch {}
      playSound?.('purchase', 0.8);
      updateCoinsUI();
      renderList();
    });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  }
}

function updateCoinsUI(){
  const el = $('upgradeCoins');
  if (el) el.textContent = String(state.coins || 0);
}

export function openUpgradeShop(waveNum, onClose){
  _onClose = typeof onClose === 'function' ? onClose : null;

  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  state.upgradeOpen = true;
  state.paused = true;

  updateCoinsUI();
  renderList();

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

export function closeUpgradeShopIfOpen(){
  const overlay = $('upgradeOverlay');
  if (!overlay) return;

  overlay.classList.remove('show');
  overlay.setAttribute('aria-hidden', 'true');

  state.upgradeOpen = false;
  state.paused = false;
}

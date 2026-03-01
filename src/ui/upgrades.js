// ─── ui/upgrades.js ──────────────────────────────────────────────────────────
import { state } from '../state.js';
import { WEAPON_TIER_COSTS } from '../constants.js';
import { playSound } from '../audio.js';
import { syncOrbitBullets } from '../weapons.js';
import { applyCosmetics } from '../materials.js';

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

  function addCategory(title){
    const h = document.createElement('div');
    h.className = 'upgrade-cat';
    h.textContent = title;
    list.appendChild(h);
  }

  function makeRow({ nameText, metaText, buttonText, cost, disabled, onBuy }){
    const row  = document.createElement('div');
    row.className = 'upgrade-row';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'upg-name';
    name.textContent = nameText;
    const meta = document.createElement('div');
    meta.className = 'upg-meta';
    meta.textContent = metaText;
    left.appendChild(name);
    left.appendChild(meta);

    const btn  = document.createElement('button');
    btn.className = 'upg-buy';
    btn.disabled  = !!disabled;

    const label = document.createElement('span');
    label.textContent = buttonText;

    const pill  = document.createElement('span');
    pill.className = 'upgrade-coins';
    pill.style.padding = '6px 10px';
    const coin  = document.createElement('span');
    coin.className = 'coin-icon';
    coin.style.animation = 'none';
    const count = document.createElement('span');
    count.className = 'coin-count';
    count.textContent = String(cost);
    pill.appendChild(coin);
    pill.appendChild(count);

    btn.appendChild(label);
    btn.appendChild(pill);
    btn.addEventListener('click', () => { if (!btn.disabled) onBuy?.(); });

    row.appendChild(left);
    row.appendChild(btn);
    list.appendChild(row);
  }


  // ── Weapons ───────────────────────────────────────────────────────────────
  addCategory('WEAPONS');
  {
    const currentTier = Math.max(0, state.weaponTier || 0);
    const maxTier = WEAPON_TIER_COSTS.length; // tiers 1..maxTier purchasable; tier 0 = none
    for (let tier = 1; tier <= maxTier; tier++){
      const cost = WEAPON_TIER_COSTS[tier - 1] ?? WEAPON_TIER_COSTS[WEAPON_TIER_COSTS.length - 1];
      const affordable = (state.coins || 0) >= cost;
      const owned = tier <= currentTier;
      makeRow({
        nameText: 'WEAPON TIER ' + tier,
        metaText: owned ? 'OWNED' : (TIER_DESCS[tier] || 'Unlock stronger fire rate / waves / orbit'),
        buttonText: owned ? 'OWNED' : (affordable ? 'BUY' : 'NEED'),
        cost,
        disabled: owned || !affordable,
        onBuy: () => {
          const coins = state.coins || 0;
          if (coins < cost) return;
          state.coins = coins - cost;
          state.weaponTier = tier;
          try { syncOrbitBullets(); } catch {}
          playSound?.('purchase', 0.8);
          updateCoinsUI();
          renderList();
        }
      });
    }
  }

  // ── Movement ──────────────────────────────────────────────────────────────
  addCategory('MOVEMENT');
  {
    const dashOwned = !!state.hasDash;
    const dashCost  = 1;
    const affordable = (state.coins || 0) >= dashCost;
    makeRow({
      nameText: 'DASH',
      metaText: dashOwned ? 'OWNED' : 'SHIFT to dash in movement direction · invincibility frames',
      buttonText: dashOwned ? 'OWNED' : (affordable ? 'BUY' : 'NEED'),
      cost: dashCost,
      disabled: dashOwned || !affordable,
      onBuy: () => {
        const coins = state.coins || 0;
        if (coins < dashCost) return;
        state.coins   = coins - dashCost;
        state.hasDash = true;
        playSound?.('purchase', 0.8);
        updateCoinsUI();
        renderList();
      }
    });

    const lvl = state.pickupRangeLvl || 0;
    const max = 5;
    const cost = 2 * Math.pow(2, lvl); // 2,4,8,16,32
    const affordable2 = (state.coins || 0) >= cost;
    const owned = lvl >= max;
    makeRow({
      nameText: 'PICKUP RANGE',
      metaText: owned ? 'MAXED' : `+${(lvl + 1) * 1.25}m coin attraction (current +${(lvl) * 1.25}m)`,
      buttonText: owned ? 'MAX' : (affordable2 ? 'BUY' : 'NEED'),
      cost,
      disabled: owned || !affordable2,
      onBuy: () => {
        const coins = state.coins || 0;
        if (coins < cost) return;
        state.coins = coins - cost;
        state.pickupRangeLvl = Math.min(max, (state.pickupRangeLvl || 0) + 1);
        playSound?.('purchase', 0.8);
        updateCoinsUI();
        renderList();
      }
    });
  }

  // ── Lives ─────────────────────────────────────────────────────────────────
  addCategory('LIVES');
  {
    const owned = (state.extraLives || 0) >= 3;
    const cost = 10 * Math.pow(2, (state.extraLives || 0)); // 10,20,40
    const affordable = (state.coins || 0) >= cost;
    makeRow({
      nameText: 'EXTRA LIFE',
      metaText: owned ? 'MAXED (3)' : `Buy an extra life (current ${state.extraLives || 0})`,
      buttonText: owned ? 'MAX' : (affordable ? 'BUY' : 'NEED'),
      cost,
      disabled: owned || !affordable,
      onBuy: () => {
        const coins = state.coins || 0;
        if (coins < cost) return;
        state.coins = coins - cost;
        state.extraLives = Math.min(3, (state.extraLives || 0) + 1);
        playSound?.('purchase', 0.8);
        updateCoinsUI();
        renderList();
      }
    });
  }

  // ── Cosmetics ─────────────────────────────────────────────────────────────
  addCategory('COSMETICS');
  {
    const current = state.cosmetic?.playerColor || 'default';
    const options = [
      { key: 'cyan',    label: 'PLAYER COLOR — CYAN' },
      { key: 'magenta', label: 'PLAYER COLOR — MAGENTA' },
      { key: 'gold',    label: 'PLAYER COLOR — GOLD' },
    ];
    options.forEach((o, idx) => {
      const owned = current === o.key;
      const cost = 5;
      const affordable = (state.coins || 0) >= cost;
      makeRow({
        nameText: o.label,
        metaText: owned ? 'ACTIVE' : 'Cosmetic only',
        buttonText: owned ? 'ACTIVE' : (affordable ? 'APPLY' : 'NEED'),
        cost,
        disabled: owned || !affordable,
        onBuy: () => {
          const coins = state.coins || 0;
          if (coins < cost) return;
          state.coins = coins - cost;
          if (!state.cosmetic) state.cosmetic = { playerColor: 'default' };
          state.cosmetic.playerColor = o.key;
          try { applyCosmetics(); } catch {}
          playSound?.('purchase', 0.8);
          updateCoinsUI();
          renderList();
        }
      });
    });
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

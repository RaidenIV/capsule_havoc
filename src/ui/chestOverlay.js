// ─── ui/chestOverlay.js ─────────────────────────────────────────────────────
// Chest UI flow isolated from upgrades UI (design doc Section 10).
// Responsible for:
//  - Opening animation + skip rules
//  - Presenting reward choices

import { state } from '../state.js';
import { playSound } from '../audio.js';
import { ensureShopStyles } from './upgrades.js';
import { rollChestItemCount, pickChestItems, applyChestChoice } from '../chests.js';

function $(id){ return document.getElementById(id); }
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

let _built = false;
let _openAnimating = false;

function ensureChestOverlay(){
  if (_built) return;
  ensureShopStyles();

  const el = document.createElement('div');
  el.id = 'chestOverlay';
  el.className = 'overlay';
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `
    <div class="chest-box">
      <div class="chest-anim" id="chestAnim">
        <div class="chest-lid"></div>
        <div class="chest-body"></div>
        <div class="chest-glow"></div>
      </div>
      <h2 id="chestOverlayTitle">CHEST REWARD</h2>
      <div class="chest-sub" id="chestOverlaySub">Choose one upgrade to keep</div>
      <div class="chest-items" id="chestItems"></div>
      <div class="chest-footer">
        <button id="chestSkipBtn" class="btn-secondary" style="display:none;">Skip</button>
      </div>
    </div>
  `;
  document.body.appendChild(el);

  // Inject minimal chest styles (scoped and non-invasive)
  const style = document.createElement('style');
  style.textContent = `
    #chestOverlay .chest-box{ max-width: 860px; }
    #chestOverlay .chest-anim{ width: 160px; height: 120px; margin: 0 auto 10px auto; position: relative; }
    #chestOverlay .chest-body{ position:absolute; left:0; right:0; bottom:0; height:62px; border-radius:14px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.18); box-shadow: 0 12px 40px rgba(0,0,0,0.45); }
    #chestOverlay .chest-lid{ position:absolute; left:0; right:0; top:18px; height:44px; border-radius:14px; background: rgba(255,255,255,0.10); border: 1px solid rgba(255,255,255,0.16); transform-origin: 50% 90%; transform: rotateX(0deg); }
    #chestOverlay .chest-glow{ position:absolute; left:50%; top:50%; width: 120px; height: 120px; transform: translate(-50%,-50%); border-radius: 999px; filter: blur(18px); opacity: 0; background: radial-gradient(circle, rgba(255,255,255,0.40), rgba(255,255,255,0.0) 70%); }
    #chestOverlay.opening .chest-lid{ animation: chestOpen 620ms ease-out forwards; }
    #chestOverlay.opening .chest-glow{ animation: chestGlow 620ms ease-out forwards; }
    @keyframes chestOpen{ 0%{ transform: rotateX(0deg); } 100%{ transform: rotateX(-70deg); } }
    @keyframes chestGlow{ 0%{ opacity: 0; } 100%{ opacity: 1; } }
    #chestOverlay .chest-footer{ display:flex; justify-content:center; margin-top: 10px; }
  `;
  document.head.appendChild(style);

  _built = true;
}

function show(){
  const overlay = $('chestOverlay');
  if (!overlay) return;
  overlay.classList.add('show');
  overlay.setAttribute('aria-hidden', 'false');
}

function hide(){
  const overlay = $('chestOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  overlay.classList.remove('opening');
  overlay.setAttribute('aria-hidden', 'true');
}

function canSkipAnimation(){
  // After 20 chests, allow skipping; defaults to instant.
  return (state.chestOpenCount || 0) >= 20;
}

function buildChoiceButton(upg){
  const cur = state.upg?.[upg.key] || 0;
  const next = cur + 1;
  const max = upg.costs.length;
  const title = `${upg.name}  (Tier ${next}/${max})`;
  const desc = typeof upg.desc === 'function' ? upg.desc(next) : '';

  const btn = document.createElement('button');
  btn.className = 'upgrade-card';
  btn.innerHTML = `
    <div class="u-top">
      <div class="u-name">${title}</div>
      <div class="u-cost">FREE</div>
    </div>
    <div class="u-desc">${desc}</div>
  `;
  btn.onclick = () => {
    applyChestChoice(upg);
    playSound('ui_confirm', 0.6, 1.0);
    state.paused = false;
    hide();
  };
  return btn;
}

function showRewards(chest){
  const itemsEl = $('chestItems');
  if (!itemsEl) return;
  itemsEl.innerHTML = '';

  const count = rollChestItemCount();
  const { items, debug } = pickChestItems(count, chest);

  // Debug output for weighting rules.
  console.log('[Chest] Rewards', {
    tier: chest?.tier,
    dropLevel: chest?.dropLevel,
    maxTierAllowed: chest?.maxTierAllowed,
    count,
    debug,
  });

  if (!items.length) {
    // Nothing to offer → coins fallback.
    const btn = document.createElement('button');
    btn.className = 'upgrade-card';
    btn.innerHTML = `
      <div class="u-top"><div class="u-name">Coin Payout</div><div class="u-cost">FREE</div></div>
      <div class="u-desc">All upgrades are maxed (or capped by this chest). You receive coins instead.</div>
    `;
    btn.onclick = () => {
      state.coins += 250;
      const c = document.getElementById('coin-count');
      if (c) c.textContent = state.coins;
      playSound('coin', 0.65, 1.05);
      state.paused = false;
      hide();
    };
    itemsEl.appendChild(btn);
    return;
  }

  for (const upg of items) itemsEl.appendChild(buildChoiceButton(upg));
}

export function openChestOverlay(chest){
  ensureChestOverlay();
  state.paused = true;
  state.chestOpenCount = (state.chestOpenCount || 0) + 1;
  show();

  const overlay = $('chestOverlay');
  const skipBtn = $('chestSkipBtn');
  const allowSkip = canSkipAnimation();
  if (skipBtn) {
    skipBtn.style.display = allowSkip ? 'inline-flex' : 'none';
    skipBtn.onclick = () => {
      _openAnimating = false;
      if (overlay) overlay.classList.remove('opening');
      showRewards(chest);
    };
  }

  // If skippable, default to instant (doc: defaults to instant once threshold reached).
  if (allowSkip) {
    showRewards(chest);
    return;
  }

  if (overlay) overlay.classList.add('opening');
  _openAnimating = true;
  playSound('chest_open', 0.75, 1.0);
  window.setTimeout(() => {
    if (!_openAnimating) return;
    showRewards(chest);
  }, 650);
}

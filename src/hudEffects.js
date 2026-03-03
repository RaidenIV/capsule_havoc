// ─── hudEffects.js ──────────────────────────────────────────────────────────
// Minimal HUD for timed effects (design doc). Safe no-op if DOM not present.

import { state } from './state.js';

let _root = null;

function ensure(){
  if (_root) return _root;
  _root = document.getElementById('hudEffects');
  if (_root) return _root;

  // Create a lightweight container if none exists.
  const wrap = document.createElement('div');
  wrap.id = 'hudEffects';
  wrap.style.position = 'absolute';
  wrap.style.left = '16px';
  wrap.style.top = '84px';
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';
  wrap.style.pointerEvents = 'none';
  wrap.style.zIndex = '20';
  document.body.appendChild(wrap);
  _root = wrap;
  return _root;
}

function badge(label, seconds){
  const el = document.createElement('div');
  el.style.padding = '6px 10px';
  el.style.borderRadius = '10px';
  el.style.background = 'rgba(0,0,0,0.55)';
  el.style.border = '1px solid rgba(255,255,255,0.12)';
  el.style.color = '#fff';
  el.style.fontFamily = 'Rajdhani, system-ui, sans-serif';
  el.style.fontWeight = '700';
  el.style.fontSize = '14px';
  el.textContent = `${label} ${seconds.toFixed(0)}s`;
  return el;
}

export function updateHudEffects(){
  const root = ensure();
  if (!root) return;
  root.innerHTML = '';

  const e = state.effects || {};
  const entries = [
    ['⚔️ Double Damage', e.doubleDamage],
    ['🛡️ Invincible', e.invincibility],
    ['💰 Coins ×2', e.coinValue2x],
    ['⭐ XP ×2', e.xp2x],
    ['⏱️ Time Freeze', e.clock],
    ['🕳️ Black Hole', e.blackHole],
  ].filter(([,t]) => (t||0) > 0);

  for (const [label, t] of entries) {
    root.appendChild(badge(label, t));
  }

  // Armor as hit count remaining
  if ((state.armorHits || 0) > 0) {
    const el = badge('🪖 Armor', state.armorHits);
    el.textContent = `🪖 Armor ×${state.armorHits}`;
    root.appendChild(el);
  }
}

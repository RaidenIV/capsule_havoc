// ─── hudEffects.js ──────────────────────────────────────────────────────────
// Design doc Section 14.5 — HUD timers + expiry flash + icons/pips.

import { state } from './state.js';
import { getArmorHits, ARMOR_MAX_PIPS } from './armor.js';

const host = document.getElementById('hud-effects');

const EFFECT_META = {
  doubleDamage:  { label: 'DMG',  icon: '✦' },
  invincibility: { label: 'INV',  icon: '⛨' },
  coinValue:     { label: 'COIN', icon: '⛁' },
  xpBoost:       { label: 'XP',   icon: '⬆' },
  clockSlow:     { label: 'SLOW', icon: '⏱' },
  blackHole:     { label: 'BH',   icon: '◉' },
};

function ensureStyles(){
  if (document.getElementById('hudEffectsStyle')) return;
  const s = document.createElement('style');
  s.id = 'hudEffectsStyle';
  s.textContent = `
    #hud-effects{ position:absolute; left:14px; top:96px; display:flex; flex-direction:column; gap:8px; z-index:6; pointer-events:none; }
    .hudfx-row{ display:flex; align-items:center; gap:10px; }
    .hudfx-chip{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius: 12px;
      background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);
      font-family: Rajdhani, system-ui, sans-serif; color: rgba(255,255,255,0.92); letter-spacing: 0.5px;
    }
    .hudfx-ic{ width: 18px; text-align:center; opacity: 0.9; }
    .hudfx-lab{ font-weight: 600; font-size: 12px; opacity: 0.95; }
    .hudfx-bar{ width: 120px; height: 6px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow:hidden; }
    .hudfx-fill{ height:100%; width:100%; background: rgba(255,255,255,0.82); transform-origin: 0 50%; }
    .hudfx-time{ width: 38px; text-align:right; font-size: 12px; opacity: 0.9; }
    .hudfx-flash .hudfx-fill{ animation: fxFlash 240ms linear infinite; }
    @keyframes fxFlash{ 0%{ opacity: 1; } 50%{ opacity: 0.35; } 100%{ opacity: 1; } }
    .hudfx-pips{ display:flex; align-items:center; gap:6px; }
    .hudfx-pip{ width: 10px; height: 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.22);
      background: rgba(255,255,255,0.10); }
    .hudfx-pip.on{ background: rgba(255,255,255,0.85); }
    .hudfx-life{ margin-left: 8px; font-size: 14px; opacity: 0.9; }
  `;
  document.head.appendChild(s);
}

function fmt(t){ return Math.max(0, t).toFixed(0); }

export function updateHudEffects(){
  if (!host) return;
  ensureStyles();

  const effects = state.effects || {};
  const rows = [];

  // Timed effects
  for (const [key, meta] of Object.entries(EFFECT_META)) {
    const t = effects[key] || 0;
    const d = state.effectsDur?.[key] || 0;
    if (t <= 0 || d <= 0) continue;
    const pct = Math.max(0, Math.min(1, t / d));
    rows.push({ key, meta, t, d, pct });
  }

  host.innerHTML = '';

  // Armor pips + extra life icon always visible if you have them
  const armor = getArmorHits();
  const life = state.extraLives || 0;
  if (armor > 0 || life > 0) {
    const row = document.createElement('div');
    row.className = 'hudfx-row';
    const chip = document.createElement('div');
    chip.className = 'hudfx-chip';
    chip.innerHTML = `<div class="hudfx-lab">DEF</div>`;

    const pips = document.createElement('div');
    pips.className = 'hudfx-pips';
    for (let i = 1; i <= ARMOR_MAX_PIPS; i++) {
      const pip = document.createElement('div');
      pip.className = 'hudfx-pip' + (i <= armor ? ' on' : '');
      pips.appendChild(pip);
    }
    chip.appendChild(pips);

    if (life > 0) {
      const l = document.createElement('div');
      l.className = 'hudfx-life';
      l.textContent = '❤';
      chip.appendChild(l);
    }

    row.appendChild(chip);
    host.appendChild(row);
  }

  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'hudfx-row' + (r.t <= 1.0 ? ' hudfx-flash' : '');

    const chip = document.createElement('div');
    chip.className = 'hudfx-chip';
    chip.innerHTML = `
      <div class="hudfx-ic">${r.meta.icon}</div>
      <div class="hudfx-lab">${r.meta.label}</div>
      <div class="hudfx-bar"><div class="hudfx-fill" style="transform: scaleX(${r.pct});"></div></div>
      <div class="hudfx-time">${fmt(r.t)}</div>
    `;
    row.appendChild(chip);
    host.appendChild(row);
  }
}

// ─── hudEffects.js ──────────────────────────────────────────────────────────
// Design doc Section 14.5 — HUD timers + expiry flash + icons/pips.

import { state } from './state.js';
import { getArmorHits, ARMOR_MAX_PIPS } from './armor.js';

const host = document.getElementById('hud-effects');

let _toastHost = null;
let _toastSeq = 0;

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

    /* Glassmorphic pickup notification */
    #hud-toast-host{ position:absolute; left:50%; top:18%; transform: translateX(-50%);
      display:flex; flex-direction:column; gap:10px; align-items:center; z-index: 20; pointer-events:none; }
    .hudtoast{ min-width: 260px; max-width: 520px;
      padding: 12px 16px; border-radius: 16px;
      background: rgba(0,0,0,0.34);
      border: 1px solid rgba(255,255,255,0.14);
      backdrop-filter: blur(10px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.35);
      font-family: Rajdhani, system-ui, sans-serif;
      color: rgba(255,255,255,0.94);
      display:flex; align-items:center; gap: 12px;
      letter-spacing: 0.3px;
      opacity: 0;
      transform: translateY(-8px) scale(0.98);
      animation: hudtoastInOut 2400ms ease forwards;
    }
    .hudtoast-ic{ width: 28px; height: 28px; border-radius: 12px;
      display:flex; align-items:center; justify-content:center;
      background: rgba(255,255,255,0.10);
      border: 1px solid rgba(255,255,255,0.12);
      font-size: 14px;
    }
    .hudtoast-txt{ display:flex; flex-direction:column; line-height: 1.05; }
    .hudtoast-k{ font-size: 12px; opacity: 0.82; font-weight: 600; }
    .hudtoast-v{ font-size: 18px; font-weight: 700; }
    @keyframes hudtoastInOut{
      0%   { opacity: 0; transform: translateY(-8px) scale(0.98); }
      12%  { opacity: 1; transform: translateY(0px) scale(1.0); }
      82%  { opacity: 1; transform: translateY(0px) scale(1.0); }
      100% { opacity: 0; transform: translateY(10px) scale(0.98); }
    }
  `;
  document.head.appendChild(s);
}

function ensureToastHost(){
  ensureStyles();
  if (_toastHost && _toastHost.isConnected) return _toastHost;
  _toastHost = document.getElementById('hud-toast-host');
  if (_toastHost) return _toastHost;
  _toastHost = document.createElement('div');
  _toastHost.id = 'hud-toast-host';
  document.body.appendChild(_toastHost);
  return _toastHost;
}

/**
 * Glassmorphic on-screen notification for powerups.
 * @param {{ title: string, kind?: string, icon?: string }} arg
 */
export function notifyPowerup(arg){
  if (!arg || !arg.title) return;
  const h = ensureToastHost();
  const id = (++_toastSeq);

  const toast = document.createElement('div');
  toast.className = 'hudtoast';
  toast.dataset.toastId = String(id);

  const ic = document.createElement('div');
  ic.className = 'hudtoast-ic';
  ic.textContent = arg.icon ?? '✦';

  const txt = document.createElement('div');
  txt.className = 'hudtoast-txt';
  const k = document.createElement('div');
  k.className = 'hudtoast-k';
  k.textContent = (arg.kind ?? 'POWERUP').toUpperCase();
  const v = document.createElement('div');
  v.className = 'hudtoast-v';
  v.textContent = arg.title;
  txt.appendChild(k);
  txt.appendChild(v);

  toast.appendChild(ic);
  toast.appendChild(txt);

  while (h.children.length >= 3) h.removeChild(h.firstChild);
  h.appendChild(toast);

  toast.addEventListener('animationend', () => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, { once: true });
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

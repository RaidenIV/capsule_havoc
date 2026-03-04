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
  updatePersistentToast();
  // Keep only persistent indicators (no timed-effect badges).
  const root = ensure();
  if (!root) return;
  root.innerHTML = '';

  // Armor as hit count remaining (pips)
  const hits = (state.armorHits || 0);
  if (hits > 0) {
    const el = document.createElement('div');
    el.style.display = 'flex';
    el.style.gap = '6px';
    el.style.alignItems = 'center';
    el.style.padding = '6px 10px';
    el.style.borderRadius = '12px';
    el.style.background = 'rgba(0,0,0,0.45)';
    el.style.border = '1px solid rgba(255,255,255,0.12)';
    el.style.fontFamily = 'Rajdhani, system-ui, sans-serif';
    el.style.color = '#fff';
    el.style.fontWeight = '800';
    el.style.fontSize = '14px';
    el.textContent = '🪖 ';
    for (let i = 0; i < Math.min(hits, 3); i++) {
      const pip = document.createElement('span');
      pip.textContent = '●';
      pip.style.opacity = '0.95';
      el.appendChild(pip);
    }
    root.appendChild(el);
  }

  // Extra life icon if banked
  if ((state.extraLife || 0) > 0) {
    const el = document.createElement('div');
    el.style.padding = '6px 10px';
    el.style.borderRadius = '12px';
    el.style.background = 'rgba(0,0,0,0.45)';
    el.style.border = '1px solid rgba(255,255,255,0.12)';
    el.style.color = '#fff';
    el.style.fontFamily = 'Rajdhani, system-ui, sans-serif';
    el.style.fontWeight = '800';
    el.style.fontSize = '14px';
    el.textContent = '➕ Extra Life';
    root.appendChild(el);
  }
}



let _toastStyleEl = null;
function ensureToastStyles(){
  if (_toastStyleEl) return;
  _toastStyleEl = document.createElement('style');
  _toastStyleEl.textContent = `
    #powerup-toast{ position:absolute; left:50%; top:160px; transform: translateX(-50%); z-index: 30; pointer-events:none; }
    .putoast{ display:flex; align-items:center; gap:10px; padding:10px 14px; border-radius: 16px;
      background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      backdrop-filter: blur(10px);
      font-family: Rajdhani, system-ui, sans-serif; color: rgba(255,255,255,0.95);
      letter-spacing: 0.6px; }
    .putoast-ic{ font-size: 16px; opacity: 0.95; }
    .putoast-txt{ font-weight: 700; font-size: 15px; }
    .putoast-time{ font-weight: 600; font-size: 14px; opacity: 0.88; margin-left: 2px; }
    .putoast-in{ animation: putoastIn 140ms ease-out both; }
    .putoast-out{ animation: putoastOut 180ms ease-in both; }
    @keyframes putoastIn{ from{ opacity: 0; transform: translateY(-6px) scale(0.98);} to{ opacity: 1; transform: translateY(0) scale(1);} }
    @keyframes putoastOut{ from{ opacity: 1; transform: translateY(0) scale(1);} to{ opacity: 0; transform: translateY(-6px) scale(0.98);} }
  `;
  document.head.appendChild(_toastStyleEl);
}
let _toastHost = null;
let _toastTimer = null;
let _toastPersist = null; // { label, key }

function ensureToastHost(){
  if (_toastHost) return _toastHost;
  _toastHost = document.getElementById('powerup-toast');
  if (_toastHost) return _toastHost;
  _toastHost = document.createElement('div');
  _toastHost.id = 'powerup-toast';
  document.body.appendChild(_toastHost);
  return _toastHost;
}

function getEffectRemaining(key){
  try {
    const v = state?.effects?.[key];
    return (Number.isFinite(v) && v > 0) ? v : 0;
  } catch { return 0; }
}

function renderToast(label, secondsOrNull){
  const host = ensureToastHost();
  if (!host) return;

  // Build DOM (no unicode icons) so fonts never render "tofu" boxes.
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'putoast putoast-in';

  const ic = document.createElement('div');
  ic.className = 'putoast-ic';
  ic.textContent = 'PWR';

  const txt = document.createElement('div');
  txt.className = 'putoast-txt';
  txt.textContent = `PWR • ${String(label || 'Power Up')}`;

  const time = document.createElement('div');
  time.className = 'putoast-time';
  if (Number.isFinite(secondsOrNull) && secondsOrNull > 0) {
    time.textContent = `(${Math.round(secondsOrNull)}s)`;
  } else {
    time.textContent = '';
  }

  wrap.appendChild(ic);
  wrap.appendChild(txt);
  wrap.appendChild(time);
  host.appendChild(wrap);
}

function updatePersistentToast(){
  if (!_toastPersist) return;
  const rem = getEffectRemaining(_toastPersist.key);
  const host = ensureToastHost();
  if (rem <= 0) {
    _toastPersist = null;
    if (host) host.innerHTML = '';
    return;
  }
  const el = host?.firstElementChild;
  const t = el?.querySelector?.('.putoast-time');
  if (t) t.textContent = ` (${Math.round(rem)}s)`;
}


export function notifyPowerup(label, seconds, effectKey){
  ensureToastStyles();
  const host = ensureToastHost();
  if (!host) return;

  const isTimed = (typeof effectKey === 'string' && effectKey.length && Number.isFinite(seconds) && seconds > 0);
  if (isTimed) {
    _toastPersist = { label, key: effectKey };
    if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
    renderToast(label, Math.round(getEffectRemaining(effectKey)));
    return;
  }

  _toastPersist = null;
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

  renderToast(label, (Number.isFinite(seconds) && seconds > 0) ? Math.round(seconds) : null);

  _toastTimer = setTimeout(() => {
    const el = host.firstElementChild;
    if (!el) return;
    el.classList.remove('putoast-in');
    el.classList.add('putoast-out');
    setTimeout(() => { if (host) host.innerHTML = ''; }, 190);
  }, 1400);
}

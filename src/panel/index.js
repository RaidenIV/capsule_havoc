// ─── panel/index.js ───────────────────────────────────────────────────────────
// Full control panel: open/close, tabs, all sliders, export/import.
// Separated into logical sections but kept in one file to avoid excessive
// cross-file bindings for what is purely UI code.

import * as THREE from 'three';
import { scene, renderer } from '../renderer.js';
import { state } from '../state.js';
import {
  ambientLight, sunLight, fillLight, rimLight, orbitLights,
} from '../lighting.js';
import {
  threshMat, compositeMat, globalBloom, bulletBloom, explBloom,
} from '../bloom.js';
import {
  playerMat, enemyMat, bulletMat, playerBaseColor,
  playerGeoParams, enemyGeoParams, bulletGeoParams,
  playerGeo, enemyGeo, bulletGeo,
  setPlayerGeo, setEnemyGeo, setBulletGeo,
  floorY, syncEnemyMats,
} from '../materials.js';
import { playerMesh, hbObj, dashBarObj } from '../player.js';
import { explConfig } from '../particles.js';
import { ground, grid } from '../terrain.js';
import { updateXP } from '../xp.js';
import { XP_THRESHOLDS } from '../constants.js';
import { syncOrbitBullets } from '../weapons.js';
import { restartGame } from '../gameFlow.js';
import { pauseMusic, resumeMusic } from '../gameFlow.js';
import { setSfxVolume, setMusicVolume, setMuted, getMuted, getSfxVolume, getMusicVolume,
         setSoundVolume, getSoundVolume, getAllSoundVolumes, playSound } from '../audio.js';
import { clock } from '../loop.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const cpEl    = document.getElementById('cp');
const uiEl    = document.getElementById('ui');
const hintEl  = document.getElementById('tab-hint');
const pauseEl = document.getElementById('pause-overlay');
const notifEl = document.getElementById('notif');
const xpHudEl = document.getElementById('xp-hud');

function g(id)         { return document.getElementById(id); }
function setR(id, val, dec = 2) {
  const el = g(id); if (el) el.value = val;
  const v  = g(id + '-v'); if (v) v.value = Number(val).toFixed(dec);
}
function setC(id, hex) { const el = g(id); if (el) el.value = hex; }

// ── Default values for Reset buttons ─────────────────────────────────────────
const DEFS = {
  player:    { color:'#0044cc', metal:0.67, rough:0.0, cc:1.0, ccr:0.0, env:0.0, ec:'#000000', ei:1.0 },
  enemy:     { color:'#888888', metal:0.67, rough:0.0, cc:1.0, ccr:0.0, env:0.0, ec:'#000000', ei:1.0 },
  bullet:    { color:'#ffff00', metal:0.0,  rough:0.0, cc:1.0, ccr:0.0, env:3.0, ec:'#ffffff', ei:0.0 },
  bbullet:   { enabled:true, thresh:0.3, str:0.9 },
  geoPlayer: { radius:0.4,   length:1.2,  capSegs:8, radial:16 },
  geoEnemy:  { radius:0.4,   length:1.2,  capSegs:8, radial:16 },
  geoBullet: { radius:0.045, length:0.55, capSegs:4, radial:6  },
  scene:     { fnear:1, ffar:200 },
  light:     { amb:0, sun:15, fill:0, rim:0, ospd:0, oint:80 },
  bloom:     { thresh:1.0, str:0.0, exp:0.3 },
  destrStd:  { count:40,  size:0.25, speed:1.0,  glow:12.0, bthresh:0.0, bstr:0.2 },
  destrElite:{ count:100, size:0.5,  speed:1.75, glow:12.0, bthresh:0.0, bstr:0.2 },
};

const matRefs = { player: playerMat, enemy: enemyMat, bullet: bulletMat };

function geoParamsFor(type) {
  if (type === 'player') return playerGeoParams;
  if (type === 'enemy')  return enemyGeoParams;
  return bulletGeoParams;
}

// ── Section visibility ─────────────────────────────────────────────────────────
function updateSectionVisibility() {
  const t = state.activeTab;
  document.querySelectorAll('.sec[data-scope="scene"]').forEach(el   => el.style.display = t === 'scene' ? '' : 'none');
  document.querySelectorAll('.sec[data-scope="capsule"]').forEach(el => el.style.display = (t === 'scene' || t === 'destr' || t === 'enemy-behavior' || t === 'audio') ? 'none' : '');
  document.querySelectorAll('.sec[data-scope="destr"]').forEach(el   => el.style.display = t === 'destr' ? '' : 'none');
  document.querySelectorAll('.sec[data-scope="audio"]').forEach(el   => el.style.display = t === 'audio' ? '' : 'none');
  const bb = g('bullet-bloom-sec'); if (bb) bb.style.display = t === 'bullet' ? '' : 'none';
  const eb = g('enemy-behavior-sec'); if (eb) eb.style.display = t === 'enemy-behavior' ? '' : 'none';
}

// ── Load panel state from Three.js objects → DOM inputs ───────────────────────
function loadPanel() {
  updateSectionVisibility();
  const t = state.activeTab;
  if (t === 'scene') {
    setR('s-fnear', scene.fog.near, 0); setR('s-ffar', scene.fog.far, 0);
    g('s-grid').checked = grid.visible; g('s-floor').checked = ground.visible;
    setR('l-amb', ambientLight.intensity); setR('l-sun', sunLight.intensity);
    setR('l-fill', fillLight.intensity);  setR('l-rim', rimLight.intensity);
    setR('l-ospd', orbitLights[0].speed); setR('l-oint', orbitLights[0].light.intensity, 0);
    setR('b-thresh', threshMat.uniforms.threshold.value);
    setR('b-str',    compositeMat.uniforms.strength.value);
    setR('b-exp',    renderer.toneMappingExposure);
    return;
  }
  if (t === 'destr') {
    setR('dx-count',  explConfig.std.count,  0); setR('dx-size',  explConfig.std.size);
    setR('dx-speed',  explConfig.std.speed);     setR('dx-glow',  explConfig.std.glow);
    setR('dx-bthresh',explBloom.stdThreshold);   setR('dx-bstr',  explBloom.stdStrength);
    setR('ex-count',  explConfig.elite.count, 0);setR('ex-size',  explConfig.elite.size);
    setR('ex-speed',  explConfig.elite.speed);   setR('ex-glow',  explConfig.elite.glow);
    setR('ex-bthresh',explBloom.eliteThreshold); setR('ex-bstr',  explBloom.eliteStrength);
    return;
  }
  if (t === 'audio') {
    g('aud-mute').checked = getMuted();
    setR('aud-sfx',   getSfxVolume(),   2);
    setR('aud-music', getMusicVolume(), 2);
    return;
  }
  const mat = matRefs[t], gp = geoParamsFor(t);
  setR('g-radius', gp.radius); setR('g-length', gp.length);
  setR('g-capSegs', gp.capSegs, 0); setR('g-radial', gp.radial, 0);
  setC('m-color',  '#' + mat.color.getHexString());
  setR('m-metal',  mat.metalness); setR('m-rough',  mat.roughness);
  setR('m-cc',     mat.clearcoat ?? 0); setR('m-ccr', mat.clearcoatRoughness ?? 0);
  setR('m-env',    mat.envMapIntensity ?? 0);
  setC('e-color',  mat.emissive ? '#' + mat.emissive.getHexString() : '#000000');
  setR('e-int',    mat.emissiveIntensity ?? 0);
}

// ── Rebuild geometry after slider change ──────────────────────────────────────
function rebuildGeo() {
  const gp = geoParamsFor(state.activeTab);
  if (state.activeTab === 'player') {
    setPlayerGeo(new THREE.CapsuleGeometry(gp.radius, gp.length, gp.capSegs, gp.radial));
    playerMesh.geometry = playerGeo;
    playerMesh.position.y = floorY(gp);
  } else if (state.activeTab === 'enemy') {
    setEnemyGeo(new THREE.CapsuleGeometry(gp.radius, gp.length, gp.capSegs, gp.radial));
    state.enemies.forEach(e => { e.mesh.geometry = enemyGeo; e.mesh.position.y = floorY(gp); });
  } else {
    setBulletGeo(new THREE.CapsuleGeometry(gp.radius, gp.length, gp.capSegs, gp.radial));
    state.bullets.forEach(b => { b.mesh.geometry = bulletGeo; b.mesh.position.y = floorY(gp); });
  }
}

function applyMat() {
  const mat = matRefs[state.activeTab];
  mat.color.set(g('m-color').value);
  mat.metalness = parseFloat(g('m-metal').value);
  mat.roughness = parseFloat(g('m-rough').value);
  if (mat.clearcoat          !== undefined) mat.clearcoat          = parseFloat(g('m-cc').value);
  if (mat.clearcoatRoughness !== undefined) mat.clearcoatRoughness = parseFloat(g('m-ccr').value);
  if (mat.envMapIntensity    !== undefined) mat.envMapIntensity    = parseFloat(g('m-env').value);
  mat.needsUpdate = true;
  if (state.activeTab === 'player') playerBaseColor.copy(playerMat.color);
  if (state.activeTab === 'enemy')  syncEnemyMats(state.enemies);
}

function applyEmissive() {
  const mat = matRefs[state.activeTab];
  if (!mat.emissive) return;
  mat.emissive.set(g('e-color').value);
  mat.emissiveIntensity = parseFloat(g('e-int').value);
  mat.needsUpdate = true;
  if (state.activeTab === 'enemy') syncEnemyMats(state.enemies);
}

// ── Open / close ──────────────────────────────────────────────────────────────
export function togglePanel() {
  const cp = document.getElementById('cp');
  if (!cp) return;
  state.cpOpen = !state.cpOpen;
  cp.style.display = state.cpOpen ? 'block' : 'none';

  // NOTE: Opening the Control Panel should NOT pause/unpause gameplay anymore.
  // Pause is controlled only by the Pause button / pause overlay.

  if (state.cpOpen) {
    loadPanelFromState();
  }

}
g('cp-close').addEventListener('click', togglePanel);

// ── Pause button ──────────────────────────────────────────────────────────────
export function updatePauseBtn() {
  const btn = g('pause-btn'); if (!btn) return;
  if (state.paused) { btn.textContent = '▶ Resume'; btn.classList.add('paused'); }
  else              { btn.textContent = '⏸ Pause';  btn.classList.remove('paused'); }
  pauseEl.classList.toggle('show', state.paused);
}
export function togglePause() {
  state.paused = !state.paused;
  if (!state.paused) { clock.getDelta(); resumeMusic(); syncPauseMenuFromEngine(); }
  else { pauseMusic(); syncPauseMenuFromEngine(); }
  updatePauseBtn();
  state.keys.w = state.keys.a = state.keys.s = state.keys.d = false;
}
g('pause-btn').addEventListener('click', togglePause);

// ── Pause menu controls ───────────────────────────────────────────────────────
function pct(v) { return Math.round(v * 100) + '%'; }

function clamp01(v) { return Math.max(0, Math.min(1, v)); }

function fillRange(el, v) {
  const p = (clamp01(v) * 100).toFixed(1);
  el.style.background = `linear-gradient(to right, #00e5ff ${p}%, rgba(255,255,255,0.1) ${p}%)`;
}

function showPausePage(name) {
  g('pause-page-main')     ?.classList.toggle('active', name === 'main');
  g('pause-page-settings') ?.classList.toggle('active', name === 'settings');
  g('pause-page-audio')    ?.classList.toggle('active', name === 'audio');
  g('pause-page-sfxmixer') ?.classList.toggle('active', name === 'sfxmixer');

  const title = g('pause-menu-title');
  if (title) {
    if (name === 'main')     title.textContent = 'PAUSED';
    if (name === 'settings') title.textContent = 'SETTINGS';
    if (name === 'audio')    title.textContent = 'AUDIO';
    if (name === 'sfxmixer') title.textContent = 'SFX MIXER';
  }
}

function setNum(id, v) { const el = g(id); if (el) el.value = (+v).toFixed(2); }

function syncPauseMenuFromEngine() {
  showPausePage('main');

  const mv = getMusicVolume();
  const sv = getSfxVolume();
  const masterV = (mv + sv) * 0.5;

  // Master / Music / SFX
  const master = g('pm-master');
  if (master) {
    master.value = masterV;
    fillRange(master, masterV);
    g('pm-master-val').textContent = pct(masterV);
    setNum('pm-master-num', masterV);
  }

  const music = g('pm-music');
  if (music) {
    music.value = mv;
    fillRange(music, mv);
    g('pm-music-val').textContent = pct(mv);
    setNum('pm-music-num', mv);
  }

  const sfx = g('pm-sfx');
  if (sfx) {
    sfx.value = sv;
    fillRange(sfx, sv);
    g('pm-sfx-val').textContent = pct(sv);
    setNum('pm-sfx-num', sv);
  }

  // Individual SFX (mixer page)
  document.querySelectorAll('.sfx-range').forEach(el => {
    const v = getSoundVolume(el.dataset.sfx);
    el.value = v; fillRange(el, v);
    const valEl = g('pm-sfx-' + el.dataset.sfx + '-val');
    if (valEl) valEl.textContent = pct(v);
    const numEl = g('pm-sfx-' + el.dataset.sfx + '-num');
    if (numEl) numEl.value = (+v).toFixed(2);
  });
}

function updateDerivedMaster() {
  const mv = getMusicVolume();
  const sv = getSfxVolume();
  const v  = (mv + sv) * 0.5;
  const master = g('pm-master');
  if (!master) return;
  master.value = v;
  fillRange(master, v);
  g('pm-master-val').textContent = pct(v);
  setNum('pm-master-num', v);
}

// Master (sets Music + SFX masters together)
g('pm-master')?.addEventListener('input', () => {
  const v = clamp01(parseFloat(g('pm-master').value || '0'));
  setMusicVolume(v);
  setSfxVolume(v);

  // keep the other sliders in lock-step
  const music = g('pm-music'); if (music) { music.value = v; fillRange(music, v); g('pm-music-val').textContent = pct(v); setNum('pm-music-num', v); }
  const sfx   = g('pm-sfx');   if (sfx)   { sfx.value   = v; fillRange(sfx, v);   g('pm-sfx-val').textContent   = pct(v); setNum('pm-sfx-num', v); }

  fillRange(g('pm-master'), v);
  g('pm-master-val').textContent = pct(v);
  setNum('pm-master-num', v);
});
g('pm-master-num')?.addEventListener('change', () => {
  const v = clamp01(parseFloat(g('pm-master-num').value || '0'));
  g('pm-master').value = v;
  g('pm-master').dispatchEvent(new Event('input', { bubbles: true }));
});

// Music
g('pm-music')?.addEventListener('input', () => {
  const v = clamp01(parseFloat(g('pm-music').value || '0'));
  setMusicVolume(v);
  fillRange(g('pm-music'), v);
  g('pm-music-val').textContent = pct(v);
  setNum('pm-music-num', v);
  updateDerivedMaster();
});
g('pm-music-num')?.addEventListener('change', () => {
  const v = clamp01(parseFloat(g('pm-music-num').value || '0'));
  g('pm-music').value = v;
  g('pm-music').dispatchEvent(new Event('input', { bubbles: true }));
});

// SFX master
g('pm-sfx')?.addEventListener('input', () => {
  const v = clamp01(parseFloat(g('pm-sfx').value || '0'));
  setSfxVolume(v);
  fillRange(g('pm-sfx'), v);
  g('pm-sfx-val').textContent = pct(v);
  setNum('pm-sfx-num', v);
  updateDerivedMaster();
});
g('pm-sfx-num')?.addEventListener('change', () => {
  const v = clamp01(parseFloat(g('pm-sfx-num').value || '0'));
  g('pm-sfx').value = v;
  g('pm-sfx').dispatchEvent(new Event('input', { bubbles: true }));
});

// Individual SFX
document.querySelectorAll('.sfx-range').forEach(el => {
  el.addEventListener('input', () => {
    const v = clamp01(parseFloat(el.value || '0'));
    setSoundVolume(el.dataset.sfx, v);
    fillRange(el, v);
    const valEl = g('pm-sfx-' + el.dataset.sfx + '-val');
    if (valEl) valEl.textContent = pct(v);
    const numEl = g('pm-sfx-' + el.dataset.sfx + '-num');
    if (numEl) numEl.value = (+v).toFixed(2);
  });
});
document.querySelectorAll('.pause-num[id^="pm-sfx-"][id$="-num"]').forEach(num => {
  num.addEventListener('change', () => {
    const id = num.id.replace('-num','');
    const range = g(id);
    if (!range) return;
    const v = clamp01(parseFloat(num.value || '0'));
    range.value = v;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  });
});

// Wire hover + click sounds on all pause menu buttons
document.querySelectorAll('.pause-action-btn, .pause-export-btn').forEach(btn => {
  btn.addEventListener('mouseenter', () => playSound('menu',        0.4));
  btn.addEventListener('click',      () => playSound('menu_select', 0.5));
});
// Resume
g('pause-resume-btn')?.addEventListener('click', () => {
  if (state.paused) togglePause();
});


// Settings page
g('pause-settings-btn')?.addEventListener('click', () => showPausePage('settings'));

// Audio page
g('pause-audio-btn')?.addEventListener('click', () => showPausePage('audio'));

// SFX Mixer page
g('pause-sfxmixer-btn')?.addEventListener('click', () => showPausePage('sfxmixer'));

// Back to main page (from settings)
g('pause-back-btn')?.addEventListener('click', () => showPausePage('main'));

// Back to settings page (from audio)
g('pause-audio-back-btn')?.addEventListener('click', () => showPausePage('settings'));

// Back to audio page (from mixer)
g('pause-sfxmixer-back-btn')?.addEventListener('click', () => showPausePage('audio'));

// Quit to main menu
g('pause-quit-btn')?.addEventListener('click', () => {
  if (typeof window.showMainMenu === 'function') window.showMainMenu();
});

// Export audio settings JSON
g('pm-export-btn')?.addEventListener('click', () => {
  const snap = {
    master: (getMusicVolume() + getSfxVolume()) * 0.5,
    music: getMusicVolume(),
    sfxMaster: getSfxVolume(),
    sfxIndividual: getAllSoundVolumes(),
    exportedAt: new Date().toISOString(),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' }));
  a.download = 'capsule-havoc-audio.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showNotif('Audio Settings Exported!');
});

g('pm-export-btn-2')?.addEventListener('click', () => g('pm-export-btn')?.click());

// ── Toast notification ────────────────────────────────────────────────────────
let _notifTimer = null;
export function showNotif(msg) {
  notifEl.textContent = msg;
  notifEl.classList.add('show');
  clearTimeout(_notifTimer);
  _notifTimer = setTimeout(() => notifEl.classList.remove('show'), 2200);
}

// ── Invincibility toggle ──────────────────────────────────────────────────────
const invCb  = g('invincible');
const invRow = g('inv-row');
invCb?.addEventListener('change', () => {
  state.invincible = invCb.checked;
  invRow?.classList.toggle('on', state.invincible);
});

// ── Level skip ────────────────────────────────────────────────────────────────
function jumpToLevel(targetLevel) {
  restartGame({ skipInitialSpawn: true });
  if (targetLevel > 0) {
    state.playerXP    = XP_THRESHOLDS[Math.min(targetLevel, XP_THRESHOLDS.length - 1)];
    state.playerLevel = Math.min(targetLevel, XP_THRESHOLDS.length - 1);
    updateXP(0);
    syncOrbitBullets();
  }
  state.paused = true; updatePauseBtn();
  document.querySelectorAll('.lvl-cb').forEach(lb =>
    lb.classList.toggle('active', parseInt(lb.dataset.lv) === targetLevel)
  );
}
document.querySelectorAll('.lvl-cb').forEach(lb =>
  lb.addEventListener('click', () => { jumpToLevel(parseInt(lb.dataset.lv)); showNotif('Jumped to Level ' + lb.dataset.lv + '!'); })
);

// ── Section collapse ──────────────────────────────────────────────────────────
document.querySelectorAll('.sec-hdr').forEach(h =>
  h.addEventListener('click', e => { if (!e.target.closest('.sec-rst')) h.parentElement.classList.toggle('collapsed'); })
);

// ── Capsule tabs ──────────────────────────────────────────────────────────────
document.querySelectorAll('.cap-tab').forEach(t =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.cap-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    state.activeTab = t.dataset.t;
    loadPanel();
  })
);

// ── Geometry sliders ──────────────────────────────────────────────────────────
[['g-radius','radius',2],['g-length','length',2],['g-capSegs','capSegs',0],['g-radial','radial',0]]
  .forEach(([id, key, dec]) => {
    g(id)?.addEventListener('input', () => {
      const v = parseFloat(g(id).value);
      const ve = g(id+'-v'); if (ve) ve.value = v.toFixed(dec);
      geoParamsFor(state.activeTab)[key] = dec === 0 ? Math.round(v) : v;
      rebuildGeo();
    });
  });

// ── Material sliders ──────────────────────────────────────────────────────────
['m-metal','m-rough','m-cc','m-ccr','m-env'].forEach(id =>
  g(id)?.addEventListener('input', () => { g(id+'-v').value = parseFloat(g(id).value).toFixed(2); applyMat(); })
);
g('m-color')?.addEventListener('input', applyMat);
g('e-color')?.addEventListener('input', applyEmissive);
g('e-int')?.addEventListener('input',   () => { g('e-int-v').value = parseFloat(g('e-int').value).toFixed(2); applyEmissive(); });

// ── Scene sliders ─────────────────────────────────────────────────────────────
g('s-fnear')?.addEventListener('input', () => { const v=parseFloat(g('s-fnear').value); g('s-fnear-v').value=Math.round(v); scene.fog.near=v; });
g('s-ffar')?.addEventListener('input',  () => { const v=parseFloat(g('s-ffar').value);  g('s-ffar-v').value=Math.round(v);  scene.fog.far=v; });
g('s-grid')?.addEventListener('change',  () => { grid.visible=g('s-grid').checked; });
g('s-floor')?.addEventListener('change', () => { ground.visible=g('s-floor').checked; });
g('s-fps')?.addEventListener('change', () => {
  const ov = document.getElementById('fpsOverlay'); if (ov) ov.style.display = g('s-fps').checked ? '' : 'none';
});

// ── Lighting sliders ──────────────────────────────────────────────────────────
g('l-amb')?.addEventListener('input',  () => { const v=parseFloat(g('l-amb').value);  g('l-amb-v').value=v.toFixed(2);  ambientLight.intensity=v; });
g('l-sun')?.addEventListener('input',  () => { const v=parseFloat(g('l-sun').value);  g('l-sun-v').value=v.toFixed(2);  sunLight.intensity=v; });
g('l-fill')?.addEventListener('input', () => { const v=parseFloat(g('l-fill').value); g('l-fill-v').value=v.toFixed(2); fillLight.intensity=v; });
g('l-rim')?.addEventListener('input',  () => { const v=parseFloat(g('l-rim').value);  g('l-rim-v').value=v.toFixed(2);  rimLight.intensity=v; });
g('l-ospd')?.addEventListener('input', () => {
  const v=parseFloat(g('l-ospd').value); g('l-ospd-v').value=v.toFixed(2);
  orbitLights[0].speed=v; orbitLights[1].speed=v; orbitLights[2].speed=-v*1.45; orbitLights[3].speed=v*2.55;
});
g('l-oint')?.addEventListener('input', () => {
  const v=parseFloat(g('l-oint').value); g('l-oint-v').value=Math.round(v);
  orbitLights[0].light.intensity=v; orbitLights[1].light.intensity=v;
  orbitLights[2].light.intensity=v*0.625; orbitLights[3].light.intensity=v*1.5;
});

// ── Bloom sliders ─────────────────────────────────────────────────────────────
g('b-thresh')?.addEventListener('input', () => { const v=parseFloat(g('b-thresh').value); g('b-thresh-v').value=v.toFixed(2); threshMat.uniforms.threshold.value=v; globalBloom.threshold=v; });
g('b-str')?.addEventListener('input',    () => { const v=parseFloat(g('b-str').value);    g('b-str-v').value=v.toFixed(2);    compositeMat.uniforms.strength.value=v; globalBloom.strength=v; });
g('b-exp')?.addEventListener('input',    () => { const v=parseFloat(g('b-exp').value);    g('b-exp-v').value=v.toFixed(2);    renderer.toneMappingExposure=v; });

// Bullet bloom
function syncBulletBloomUI() {
  g('bb-en').checked = bulletBloom.enabled;
  setR('bb-thresh', bulletBloom.threshold); g('bb-thresh-v').value = bulletBloom.threshold.toFixed(2);
  setR('bb-str',    bulletBloom.strength);  g('bb-str-v').value    = bulletBloom.strength.toFixed(2);
}
syncBulletBloomUI();
g('bb-en')?.addEventListener('change', () => { bulletBloom.enabled = g('bb-en').checked; });
g('bb-thresh')?.addEventListener('input', () => { const v=parseFloat(g('bb-thresh').value); bulletBloom.threshold=v; g('bb-thresh-v').value=v.toFixed(2); });
g('bb-str')?.addEventListener('input',    () => { const v=parseFloat(g('bb-str').value);    bulletBloom.strength=v;  g('bb-str-v').value=v.toFixed(2); });

// ── Destruction sliders ───────────────────────────────────────────────────────
function bindR(id, step, setter) {
  g(id)?.addEventListener('input', () => {
    const v = parseFloat(g(id).value);
    const ve = g(id+'-v'); if (ve) ve.value = v.toFixed(step === 1 ? 0 : 2);
    setter(v);
  });
}
bindR('dx-count',   1,    v => { explConfig.std.count      = Math.round(v); });
bindR('dx-size',    0.01, v => { explConfig.std.size        = v; });
bindR('dx-speed',   0.05, v => { explConfig.std.speed       = v; });
bindR('dx-glow',    0.1,  v => { explConfig.std.glow        = v; });
bindR('dx-bthresh', 0.01, v => { explBloom.stdThreshold     = v; });
bindR('dx-bstr',    0.01, v => { explBloom.stdStrength      = v; });
bindR('ex-count',   1,    v => { explConfig.elite.count     = Math.round(v); });
bindR('ex-size',    0.01, v => { explConfig.elite.size       = v; });
bindR('ex-speed',   0.05, v => { explConfig.elite.speed      = v; });
bindR('ex-glow',    0.1,  v => { explConfig.elite.glow       = v; });
bindR('ex-bthresh', 0.01, v => { explBloom.eliteThreshold    = v; });
bindR('ex-bstr',    0.01, v => { explBloom.eliteStrength     = v; });

// ── Enemy max count ───────────────────────────────────────────────────────────
g('e-maxcount')?.addEventListener('input', () => {
  const v = parseInt(g('e-maxcount').value);
  state.maxEnemies = v; g('e-maxcount-v').value = v;
  while (state.enemies.length > state.maxEnemies) {
    const e = state.enemies.pop(); scene.remove(e.grp);
  }
});

// ── Number input → range bidirectional sync ───────────────────────────────────
document.querySelectorAll('input.nv[id$="-v"]').forEach(numEl => {
  const rangeEl = document.getElementById(numEl.id.slice(0, -2));
  if (!rangeEl || rangeEl.type !== 'range') return;
  const sync = () => {
    let v = parseFloat(numEl.value); if (isNaN(v)) return;
    v = Math.max(parseFloat(rangeEl.min), Math.min(parseFloat(rangeEl.max), v));
    rangeEl.value = v; rangeEl.dispatchEvent(new Event('input'));
  };
  numEl.addEventListener('input', sync);
  numEl.addEventListener('change', () => { sync(); numEl.value = parseFloat(rangeEl.value); });
});

// ── Per-section reset ─────────────────────────────────────────────────────────
document.querySelectorAll('.sec-rst').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const s = btn.dataset.s;
    const t = state.activeTab;
    if (t === 'scene') {
      if (s === 'scene')  { setR('s-fnear',DEFS.scene.fnear,0); scene.fog.near=DEFS.scene.fnear; setR('s-ffar',DEFS.scene.ffar,0); scene.fog.far=DEFS.scene.ffar; g('s-grid').checked=true; grid.visible=true; g('s-floor').checked=true; ground.visible=true; }
      if (s === 'light')  { const dl=DEFS.light; setR('l-amb',dl.amb); ambientLight.intensity=dl.amb; setR('l-sun',dl.sun); sunLight.intensity=dl.sun; setR('l-fill',dl.fill); fillLight.intensity=dl.fill; setR('l-rim',dl.rim); rimLight.intensity=dl.rim; setR('l-ospd',dl.ospd); orbitLights[0].speed=orbitLights[1].speed=dl.ospd; orbitLights[2].speed=-dl.ospd*1.45; orbitLights[3].speed=dl.ospd*2.55; setR('l-oint',dl.oint,0); orbitLights[0].light.intensity=orbitLights[1].light.intensity=dl.oint; }
      if (s === 'bloom')  { setR('b-thresh',DEFS.bloom.thresh); threshMat.uniforms.threshold.value=DEFS.bloom.thresh; globalBloom.threshold=DEFS.bloom.thresh; setR('b-str',DEFS.bloom.str); compositeMat.uniforms.strength.value=DEFS.bloom.str; globalBloom.strength=DEFS.bloom.str; setR('b-exp',DEFS.bloom.exp); renderer.toneMappingExposure=DEFS.bloom.exp; }
      if (s === 'bbloom') { Object.assign(bulletBloom, { enabled:DEFS.bbullet.enabled, threshold:DEFS.bbullet.thresh, strength:DEFS.bbullet.str }); syncBulletBloomUI(); }
      if (s === 'destr-std')   { Object.assign(explConfig.std,  DEFS.destrStd);   explBloom.stdThreshold=DEFS.destrStd.bthresh;   explBloom.stdStrength=DEFS.destrStd.bstr;   loadPanel(); }
      if (s === 'destr-elite') { Object.assign(explConfig.elite,DEFS.destrElite); explBloom.eliteThreshold=DEFS.destrElite.bthresh; explBloom.eliteStrength=DEFS.destrElite.bstr; loadPanel(); }
      if (s === 'audio')       { setMuted(false); setSfxVolume(1.0); setMusicVolume(0.4); loadPanel(); }
      return;
    }
    const mat = matRefs[t], d = DEFS[t];
    if (s === 'geo') { const defKey='geo'+t.charAt(0).toUpperCase()+t.slice(1); Object.assign(geoParamsFor(t),DEFS[defKey]); rebuildGeo(); loadPanel(); }
    if (s === 'mat') { mat.color.set(d.color); mat.metalness=d.metal; mat.roughness=d.rough; if(mat.clearcoat!==undefined)mat.clearcoat=d.cc; if(mat.clearcoatRoughness!==undefined)mat.clearcoatRoughness=d.ccr; if(mat.envMapIntensity!==undefined)mat.envMapIntensity=d.env; mat.needsUpdate=true; if(t==='enemy')syncEnemyMats(state.enemies); loadPanel(); }
    if (s === 'em')  { if(mat.emissive){mat.emissive.set(d.ec);mat.emissiveIntensity=d.ei;mat.needsUpdate=true;} if(t==='enemy')syncEnemyMats(state.enemies); loadPanel(); }
  });
});

// ── Reset All ─────────────────────────────────────────────────────────────────
g('reset-all-btn')?.addEventListener('click', () => {
  ['player','enemy','bullet'].forEach(type => {
    const mat=matRefs[type], d=DEFS[type];
    mat.color.set(d.color); mat.metalness=d.metal; mat.roughness=d.rough;
    if(mat.clearcoat!==undefined)mat.clearcoat=d.cc;
    if(mat.clearcoatRoughness!==undefined)mat.clearcoatRoughness=d.ccr;
    if(mat.envMapIntensity!==undefined)mat.envMapIntensity=d.env;
    if(mat.emissive){mat.emissive.set(d.ec);mat.emissiveIntensity=d.ei;}
    mat.needsUpdate=true;
  });
  syncEnemyMats(state.enemies);
  ['player','enemy','bullet'].forEach(type => {
    const key='geo'+type.charAt(0).toUpperCase()+type.slice(1);
    const gp=geoParamsFor(type); Object.assign(gp,DEFS[key]);
    const newGeo=new THREE.CapsuleGeometry(gp.radius,gp.length,gp.capSegs,gp.radial);
    if(type==='player'){setPlayerGeo(newGeo);playerMesh.geometry=newGeo;playerMesh.position.y=floorY(gp);}
    else if(type==='enemy'){setEnemyGeo(newGeo);state.enemies.forEach(e=>{e.mesh.geometry=newGeo;e.mesh.position.y=floorY(gp);});}
    else{setBulletGeo(newGeo);}
  });
  const dl=DEFS.light;
  ambientLight.intensity=dl.amb; sunLight.intensity=dl.sun; fillLight.intensity=dl.fill; rimLight.intensity=dl.rim;
  orbitLights[0].speed=orbitLights[1].speed=dl.ospd; orbitLights[2].speed=-dl.ospd*1.45; orbitLights[3].speed=dl.ospd*2.55;
  orbitLights[0].light.intensity=orbitLights[1].light.intensity=dl.oint; orbitLights[2].light.intensity=dl.oint*0.625; orbitLights[3].light.intensity=dl.oint*1.5;
  scene.fog.near=DEFS.scene.fnear; scene.fog.far=DEFS.scene.ffar; grid.visible=true; ground.visible=true;
  threshMat.uniforms.threshold.value=DEFS.bloom.thresh; compositeMat.uniforms.strength.value=DEFS.bloom.str; renderer.toneMappingExposure=DEFS.bloom.exp;
  Object.assign(explConfig.std,DEFS.destrStd); Object.assign(explConfig.elite,DEFS.destrElite);
  explBloom.stdThreshold=DEFS.destrStd.bthresh; explBloom.stdStrength=DEFS.destrStd.bstr;
  explBloom.eliteThreshold=DEFS.destrElite.bthresh; explBloom.eliteStrength=DEFS.destrElite.bstr;
  loadPanel();
});

// ── Audio controls ────────────────────────────────────────────────────────────
g('aud-mute')?.addEventListener('change', () => { setMuted(g('aud-mute').checked); });
g('aud-sfx')?.addEventListener('input',   () => { const v=parseFloat(g('aud-sfx').value);   g('aud-sfx-v').value=v.toFixed(2);   setSfxVolume(v); });
g('aud-sfx-v')?.addEventListener('change',() => { const v=parseFloat(g('aud-sfx-v').value); g('aud-sfx').value=v;                setSfxVolume(v); });
g('aud-music')?.addEventListener('input', () => { const v=parseFloat(g('aud-music').value); g('aud-music-v').value=v.toFixed(2); setMusicVolume(v); });
g('aud-music-v')?.addEventListener('change',()=>{ const v=parseFloat(g('aud-music-v').value); g('aud-music').value=v;           setMusicVolume(v); });

// ── Export JSON ───────────────────────────────────────────────────────────────
function snapMat(mat) {
  return { color:'#'+mat.color.getHexString(), metalness:mat.metalness, roughness:mat.roughness,
           clearcoat:mat.clearcoat??0, clearcoatRoughness:mat.clearcoatRoughness??0,
           envMapIntensity:mat.envMapIntensity??0,
           emissive:mat.emissive?'#'+mat.emissive.getHexString():'#000000',
           emissiveIntensity:mat.emissiveIntensity??0 };
}
g('export-btn')?.addEventListener('click', () => {
  const snap = {
    capsules: {
      player: { geo:{...playerGeoParams}, mat:snapMat(playerMat) },
      enemy:  { geo:{...enemyGeoParams},  mat:snapMat(enemyMat)  },
      bullet: { geo:{...bulletGeoParams}, mat:snapMat(bulletMat) },
    },
    scene:   { fogNear:scene.fog.near, fogFar:scene.fog.far },
    lighting:{ ambient:ambientLight.intensity, sun:sunLight.intensity, fill:fillLight.intensity, rim:rimLight.intensity },
    bloom:   { threshold:threshMat.uniforms.threshold.value, strength:compositeMat.uniforms.strength.value, exposure:renderer.toneMappingExposure },
    bulletBloom: { ...bulletBloom },
    destruction: {
      standard: { count:explConfig.std.count,   size:explConfig.std.size,   speed:explConfig.std.speed,   glow:explConfig.std.glow,   bloomThreshold:explBloom.stdThreshold,   bloomStrength:explBloom.stdStrength   },
      elite:    { count:explConfig.elite.count, size:explConfig.elite.size, speed:explConfig.elite.speed, glow:explConfig.elite.glow, bloomThreshold:explBloom.eliteThreshold, bloomStrength:explBloom.eliteStrength },
    },
    ui: { showFps: g('s-fps')?.checked },
    audio: { muted: getMuted(), sfxVolume: getSfxVolume(), musicVolume: getMusicVolume() },
    exportedAt: new Date().toISOString(),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(snap,null,2)],{type:'application/json'}));
  a.download = 'capsule-havoc-settings.json'; a.click(); URL.revokeObjectURL(a.href);
  showNotif('Settings Exported!');
});

// ── Import JSON ───────────────────────────────────────────────────────────────
g('import-btn')?.addEventListener('click', () => g('import-file').click());
g('import-file')?.addEventListener('change', e => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try { applyImport(JSON.parse(ev.target.result)); showNotif('Settings Imported!'); }
    catch(err) { alert('Invalid JSON: ' + err.message); }
    e.target.value = '';
  };
  reader.readAsText(file);
});

function applyImport(data) {
  const applyM = (mat, d) => {
    if (!d) return;
    if (d.color) mat.color.set(d.color);
    if (d.metalness !== undefined) mat.metalness = d.metalness;
    if (d.roughness !== undefined) mat.roughness = d.roughness;
    if (d.clearcoat !== undefined && mat.clearcoat !== undefined) mat.clearcoat = d.clearcoat;
    if (d.clearcoatRoughness !== undefined && mat.clearcoatRoughness !== undefined) mat.clearcoatRoughness = d.clearcoatRoughness;
    if (d.envMapIntensity !== undefined && mat.envMapIntensity !== undefined) mat.envMapIntensity = d.envMapIntensity;
    if (d.emissive && mat.emissive) mat.emissive.set(d.emissive);
    if (d.emissiveIntensity !== undefined) mat.emissiveIntensity = d.emissiveIntensity;
    mat.needsUpdate = true;
  };
  applyM(playerMat, data.capsules?.player?.mat);
  applyM(enemyMat,  data.capsules?.enemy?.mat);
  applyM(bulletMat, data.capsules?.bullet?.mat);
  if (data.scene?.fogNear !== undefined) scene.fog.near = data.scene.fogNear;
  if (data.scene?.fogFar  !== undefined) scene.fog.far  = data.scene.fogFar;
  if (data.lighting?.ambient !== undefined) ambientLight.intensity = data.lighting.ambient;
  if (data.lighting?.sun     !== undefined) sunLight.intensity     = data.lighting.sun;
  if (data.lighting?.fill    !== undefined) fillLight.intensity    = data.lighting.fill;
  if (data.lighting?.rim     !== undefined) rimLight.intensity     = data.lighting.rim;
  if (data.bloom?.threshold  !== undefined) { threshMat.uniforms.threshold.value=data.bloom.threshold; globalBloom.threshold=data.bloom.threshold; }
  if (data.bloom?.strength   !== undefined) { compositeMat.uniforms.strength.value=data.bloom.strength; globalBloom.strength=data.bloom.strength; }
  if (data.bloom?.exposure   !== undefined) renderer.toneMappingExposure = data.bloom.exposure;
  if (data.bulletBloom) Object.assign(bulletBloom, data.bulletBloom);
  if (data.destruction?.standard) {
    const s = data.destruction.standard;
    if (s.count !== undefined) explConfig.std.count = s.count;
    if (s.size  !== undefined) explConfig.std.size  = s.size;
    if (s.speed !== undefined) explConfig.std.speed = s.speed;
    if (s.glow  !== undefined) explConfig.std.glow  = s.glow;
    if (s.bloomThreshold !== undefined) explBloom.stdThreshold = s.bloomThreshold;
    if (s.bloomStrength  !== undefined) explBloom.stdStrength  = s.bloomStrength;
  }
  if (data.destruction?.elite) {
    const el = data.destruction.elite;
    if (el.count !== undefined) explConfig.elite.count = el.count;
    if (el.size  !== undefined) explConfig.elite.size  = el.size;
    if (el.speed !== undefined) explConfig.elite.speed = el.speed;
    if (el.glow  !== undefined) explConfig.elite.glow  = el.glow;
    if (el.bloomThreshold !== undefined) explBloom.eliteThreshold = el.bloomThreshold;
    if (el.bloomStrength  !== undefined) explBloom.eliteStrength  = el.bloomStrength;
  }
  syncEnemyMats(state.enemies);
  if (data.audio) {
    if (data.audio.muted       !== undefined) setMuted(data.audio.muted);
    if (data.audio.sfxVolume   !== undefined) setSfxVolume(data.audio.sfxVolume);
    if (data.audio.musicVolume !== undefined) setMusicVolume(data.audio.musicVolume);
  }
  loadPanel();
  setR('s-fnear',scene.fog.near,0); setR('s-ffar',scene.fog.far,0);
  setR('l-amb',ambientLight.intensity); setR('l-sun',sunLight.intensity);
  setR('l-fill',fillLight.intensity); setR('l-rim',rimLight.intensity);
  setR('b-thresh',threshMat.uniforms.threshold.value);
  setR('b-str',compositeMat.uniforms.strength.value);
  setR('b-exp',renderer.toneMappingExposure);
  syncBulletBloomUI();
}
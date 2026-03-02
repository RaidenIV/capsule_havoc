// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import {PLAYER_MAX_HP, getEnemyCapForLevel, getActiveEnemyTypesForLevel, isBossLevel, ENEMY_TYPE, ENEMY_DEFS, getBossScaleForLevel} from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks, updateHealthBar } from './player.js';
import { updateEnemies, removeCSS2DFromGroup } from './enemies.js';
import { updateSpawner, initSpawner } from './spawner.js';
import { shootBulletWave, updateBullets, updateEnemyBullets, updateOrbitBullets, performSlash, updateSlashEffects } from './weapons.js';
import { updatePickups } from './pickups.js';
import { updateParticles } from './particles.js';
import { updateDamageNums } from './damageNumbers.js';
import { getFireInterval } from './xp.js';
import { triggerGameOver, formatTime } from './gameFlow.js';
import { openUpgradeShop, closeUpgradeShopIfOpen } from './ui/upgrades.js';
import { playerGroup } from './player.js';

const timerEl  = document.getElementById('timer-value');
const fpsTogEl = document.getElementById('s-fps');
const fpsOvEl  = document.getElementById('fpsOverlay');
const fpsValEl = document.getElementById('fpsVal');
const livesHudEl = document.getElementById('livesHud');
const livesValEl = document.getElementById('livesVal');
let _lastLives = null;

export const clock = new THREE.Clock();
let fpsEMA = 60;


let _bannerTimer = 0;
function _getBannerEls(){
  const a = document.getElementById('waveBanner');
  const at = document.getElementById('waveBannerText');
  // Back-compat if you ever used wave-banner id
  const b = document.getElementById('wave-banner');
  return { a, at, b };
}
function showWaveBanner(text){
  const { a, at, b } = _getBannerEls();
  if (a) {
    if (at) at.textContent = text;
    else a.textContent = text;
    a.classList.add('show');
    _bannerTimer = 1.35;
  } else if (b) {
    b.textContent = text;
    b.classList.add('show');
    _bannerTimer = 1.35;
  }
}
function hideWaveBannerIfDone(delta){
  if (_bannerTimer > 0) {
    _bannerTimer -= delta;
    if (_bannerTimer <= 0) {
      const { a, b } = _getBannerEls();
      if (a) a.classList.remove('show');
      if (b) b.classList.remove('show');
    }
  }
}



export function tick() {
  requestAnimationFrame(tick);

  if (state.paused || state.gameOver || state.upgradeOpen) {
    renderBloom();
    labelRenderer.render(scene, camera);
    return;
  }

  const delta = Math.min(clock.getDelta(), 0.05);

  hideWaveBannerIfDone(delta);

  // Lives HUD
  const livesNow = (state.extraLives || 0);
  if (_lastLives !== livesNow) {
    _lastLives = livesNow;
    if (livesValEl) livesValEl.textContent = String(livesNow);
    if (livesHudEl) livesHudEl.style.opacity = livesNow > 0 ? '1' : '0';
  }

// FPS display
  fpsEMA = fpsEMA * 0.9 + (1 / Math.max(delta, 1e-6)) * 0.1;
  if (fpsTogEl?.checked && fpsValEl) fpsValEl.textContent = fpsEMA.toFixed(0);

  state.elapsed += delta;
  if (timerEl) timerEl.textContent = formatTime(state.elapsed);

  // Slow-motion worldDelta is updated inside updatePlayer
  updatePlayer(delta, state.worldScale);
  const worldDelta = delta * state.worldScale;

  // ── Level-driven spawn system (Option B) ───────────────────────────────────
  // Cap is driven by player level per design doc.
  state.maxEnemies = getEnemyCapForLevel(state.playerLevel);

  // Open upgrade shop every 5 levels (set by xp.js) except boss levels.
  if (state.pendingShop && !state.upgradeOpen) {
    state.pendingShop = false;
    openUpgradeShop(state.playerLevel);
  }

  // Spawning (design doc)
  updateSpawner(worldDelta);

  // ── World ──────────────────────────────────────────────────────────────────
  updateChunks(playerGroup.position);
  updateSunPosition(playerGroup.position);
  updateOrbitLights(delta, playerGroup.position);

  // Camera follows player
  camera.position.set(
    playerGroup.position.x + 28,
    28,
    playerGroup.position.z + 28
  );
  camera.lookAt(playerGroup.position);

  // ── Wave spawns ────────────────────────────────────────────────────────────
  // Defensive init (prevents NaN from breaking spawns)
  if (!Number.isFinite(state.spawnTickTimer)) state.spawnTickTimer = 0;
  if (!Number.isFinite(state.maxEnemies) || state.maxEnemies <= 0) state.maxEnemies = 50;

  state.spawnTickTimer -= delta;

  // (Wave-based spawner removed; using spawner.js)

  updatePickups(worldDelta, state.playerLevel, state.elapsed);
  updateParticles(worldDelta);
  updateDamageNums(worldDelta);
  updateDashStreaks(delta);
  updateSlashEffects(worldDelta);

  consumeExplBloomDirty();
  renderBloom();
  labelRenderer.render(scene, camera);
}

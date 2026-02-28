// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import { PLAYER_MAX_HP, WAVE_CONFIG, STANDARD_ENEMY_SIZE_MULT } from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks } from './player.js';
import { updateEnemies, spawnEnemyAtEdge } from './enemies.js';
import { shootBulletWave, updateBullets, updateEnemyBullets, updateOrbitBullets } from './weapons.js';
import { updatePickups } from './pickups.js';
import { updateParticles } from './particles.js';
import { updateDamageNums } from './damageNumbers.js';
import { getFireInterval } from './xp.js';
import { triggerGameOver, triggerVictory, formatTime } from './gameFlow.js';
import { openUpgradeShop, closeUpgradeShopIfOpen } from './ui/upgrades.js';
import { playerGroup } from './player.js';

const timerEl  = document.getElementById('timer-value');
const fpsTogEl = document.getElementById('s-fps');
const fpsOvEl  = document.getElementById('fpsOverlay');
const fpsValEl = document.getElementById('fpsVal');
const waveBannerEl = document.getElementById('waveBanner');
const waveBannerTextEl = document.getElementById('waveBannerText');
let waveBannerTimer = null;
function showWaveBanner(text, ms = 1400) {
  if (!waveBannerEl || !waveBannerTextEl) return;
  waveBannerTextEl.textContent = text;
  waveBannerEl.classList.add('show');
  if (waveBannerTimer) clearTimeout(waveBannerTimer);
  waveBannerTimer = setTimeout(() => {
    waveBannerEl.classList.remove('show');
  }, ms);
}


export const clock = new THREE.Clock();
let fpsEMA = 60;
function _getWaveDef() {
  return WAVE_CONFIG[Math.min(Math.max(state.waveIndex, 1), WAVE_CONFIG.length) - 1];
}

function _initWaveState() {
  const def = _getWaveDef();
  state.wavePhase = 'standard';
  state.waveRemainingToSpawn = def.standardCount;
  state.bossRemainingToSpawn = 0;
  state.waveActiveCap = Math.min(80, 40 + state.waveIndex * 4);
  showWaveBanner(`WAVE ${state.waveIndex}`);
}

function _beginBossPhase() {
  const def = _getWaveDef();
  state.wavePhase = 'boss';
  state.bossRemainingToSpawn = def.boss.count;
  showWaveBanner(`BOSS`);
}

function _advanceWaveIfCleared(triggerVictory) {
  if (state.enemies.length !== 0) return;

  if (state.wavePhase === 'standard') {
    if (state.waveRemainingToSpawn <= 0) _beginBossPhase();
    return;
  }

  if (state.wavePhase === 'boss') {
    if (state.bossRemainingToSpawn > 0) return;

    // Boss pack cleared → open Upgrade Shop and pause progression.
    state.wavePhase = 'upgrade';
    state.upgradeOpen = true;

    openUpgradeShop(state.waveIndex, () => {
      closeUpgradeShopIfOpen();
      state.upgradeOpen = false;

      // Prevent a huge delta spike after being paused in the shop
      clock.getDelta();

      if (state.waveIndex >= WAVE_CONFIG.length) {
        triggerVictory();
        return;
      }

      state.waveIndex++;
      _initWaveState();
    });
  }
}

function _spawnWaveBatch() {
  const def = _getWaveDef();

  const activeCap = state.waveActiveCap ?? 60;
  const room = Math.max(0, activeCap - state.enemies.length);
  if (room <= 0) return;

  if (state.wavePhase === 'standard') {
    const n = Math.min(room, 12, state.waveRemainingToSpawn);
    for (let i = 0; i < n; i++) spawnEnemyAtEdge(null);
    state.waveRemainingToSpawn -= n;
    return;
  }

  if (state.wavePhase === 'boss') {
    const n = Math.min(room, state.bossRemainingToSpawn);
    if (n <= 0) return;

    const bossSizeMult = def.boss.size / STANDARD_ENEMY_SIZE_MULT;

    for (let i = 0; i < n; i++) {
      spawnEnemyAtEdge({
        isBoss: true,
        color: def.boss.color,
        sizeMult: bossSizeMult,
        fixedHp: def.boss.health,
        expMult: def.boss.expMult,
        coinMult: def.boss.expMult,
        fireRate: null,
      });
    }
    state.bossRemainingToSpawn -= n;
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

  // FPS display
  fpsEMA = fpsEMA * 0.9 + (1 / Math.max(delta, 1e-6)) * 0.1;
  if (fpsTogEl?.checked && fpsValEl) fpsValEl.textContent = fpsEMA.toFixed(0);

  state.elapsed += delta;
  if (timerEl) timerEl.textContent = formatTime(state.elapsed);

  // Slow-motion worldDelta is updated inside updatePlayer
  updatePlayer(delta, state.worldScale);
  const worldDelta = delta * state.worldScale;

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

  // Wave-driven spawns
  if (!state.waveIndex) state.waveIndex = 1;
  if (state.waveRemainingToSpawn == null || state.wavePhase == null) _initWaveState();
  if (state.waveRemainingToSpawn === 0 && state.bossRemainingToSpawn === 0 && state.enemies.length === 0 && state.elapsed < 0.2) {
    _initWaveState();
  }

  state.spawnTickTimer -= delta;
  if (state.spawnTickTimer <= 0) {
    _spawnWaveBatch();
    state.spawnTickTimer = 0.35;
  }

  // Auto-shoot (runs on real delta so fire rate is unaffected by slowmo)
  state.shootTimer -= delta;
  if ((state.weaponTier || 1) >= 2) state.bulletWaveAngle += 1.2 * delta;
  if (state.shootTimer <= 0) {
    shootBulletWave();
    state.shootTimer = getFireInterval();
  }

  // ── Update world entities with worldDelta ─────────────────────────────────
  updateBullets(worldDelta);
  updateEnemyBullets(worldDelta);
  if (state.orbitRings.length > 0) updateOrbitBullets(worldDelta);

  const enemyResult = updateEnemies(delta, worldDelta, state.elapsed);
  if (enemyResult === 'DEAD') { triggerGameOver(); return; }

  _advanceWaveIfCleared(triggerVictory);

  updatePickups(worldDelta, state.playerLevel, state.elapsed);
  updateParticles(worldDelta);
  updateDamageNums(worldDelta);
  updateDashStreaks(delta);

  consumeExplBloomDirty();
  renderBloom();
  labelRenderer.render(scene, camera);
}

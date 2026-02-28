// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import { PLAYER_MAX_HP, WAVE_CONFIG } from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks } from './player.js';
import { updateEnemies, spawnEnemyAtEdge } from './enemies.js';
import { shootBulletWave, updateBullets, updateEnemyBullets, updateOrbitBullets } from './weapons.js';
import { updatePickups } from './pickups.js';
import { updateParticles } from './particles.js';
import { updateDamageNums } from './damageNumbers.js';
import { getFireInterval } from './xp.js';
import { triggerGameOver, formatTime, triggerVictory } from './gameFlow.js';
import { openUpgradeShop, closeUpgradeShopIfOpen } from './ui/upgrades.js';
import { playerGroup } from './player.js';

const timerEl  = document.getElementById('timer-value');
const fpsTogEl = document.getElementById('s-fps');
const fpsOvEl  = document.getElementById('fpsOverlay');
const fpsValEl = document.getElementById('fpsVal');

export const clock = new THREE.Clock();
let fpsEMA = 60;

let _bannerTimer = 0;
const _bannerEl = document.getElementById('wave-banner');

function showWaveBanner(text) {
  if (!_bannerEl) return;
  _bannerEl.textContent = text;
  _bannerEl.classList.add('show');
  _bannerTimer = 1.35;
}

function startWave(waveNum) {
  const cfg = WAVE_CONFIG[Math.max(0, Math.min(waveNum - 1, WAVE_CONFIG.length - 1))];
  state.wave = cfg.wave;
  state.wavePhase = 'standard';
  state.waveSpawnRemaining = cfg.standardCount;
  state.bossSpawnRemaining = 0;
  state.maxEnemies = Math.max(state.maxEnemies, 350); // allow large waves
  showWaveBanner('WAVE ' + cfg.wave);
}

export function tick() {
  requestAnimationFrame(tick);

  if (state.paused || state.gameOver || state.upgradeOpen) {
    renderBloom();
    labelRenderer.render(scene, camera);
    return;
  }

  // Start wave after countdown completes
  if (state.wavePendingStart) {
    state.wavePendingStart = false;
    startWave(state.wave);
  }

  
    renderBloom();
    labelRenderer.render(scene, camera);
    return;
  }

  const delta = Math.min(clock.getDelta(), 0.05);

  // Wave banner timing
  if (_bannerEl && _bannerTimer > 0) {
    _bannerTimer -= delta;
    if (_bannerTimer <= 0) _bannerEl.classList.remove('show');
  }

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

  // ── Wave spawns ────────────────────────────────────────────────────────────
  state.spawnTickTimer -= delta;
  if (state.spawnTickTimer <= 0) {
    const waveCfg = WAVE_CONFIG[Math.max(0, Math.min(state.wave - 1, WAVE_CONFIG.length - 1))];
    const space = Math.max(0, state.maxEnemies - state.enemies.length);

    if (state.wavePhase === 'standard' && state.waveSpawnRemaining > 0 && space > 0) {
      const batch = Math.min(10, state.waveSpawnRemaining, space);
      for (let i = 0; i < batch; i++) spawnEnemyAtEdge(null);
      state.waveSpawnRemaining -= batch;
    } else if (state.wavePhase === 'boss' && state.bossSpawnRemaining > 0 && space > 0) {
      const boss = waveCfg.boss;
      const bossCfg = { isBoss: true, color: boss.color, sizeMult: boss.sizeMult, health: boss.health, expMult: boss.expMult, coinMult: 1, fireRate: 1.4 };
      const batch = Math.min(2, state.bossSpawnRemaining, space);
      for (let i = 0; i < batch; i++) spawnEnemyAtEdge(bossCfg);
      state.bossSpawnRemaining -= batch;
    }

    state.spawnTickTimer = 0.35;
  }

  // ── Wave transitions ────────────────────────────────────────────────────────
  if (state.wavePhase === 'standard' && state.waveSpawnRemaining <= 0 && state.enemies.length === 0) {
    const waveCfg = WAVE_CONFIG[Math.max(0, Math.min(state.wave - 1, WAVE_CONFIG.length - 1))];
    state.wavePhase = 'boss';
    state.bossSpawnRemaining = waveCfg.boss.count;
    showWaveBanner('BOSS');
  }

  if (state.wavePhase === 'boss' && state.bossSpawnRemaining <= 0 && state.enemies.length === 0) {
    state.wavePhase = 'upgrade';
    state.upgradeOpen = true;
    openUpgradeShop(state.wave, () => {
      // Called when player closes the upgrade window
      closeUpgradeShopIfOpen();
      state.upgradeOpen = false;
      if (state.wave >= 10) {
        triggerVictory();
        return;
      }
      state.wave += 1;
      startWave(state.wave);
    });
  }

  // Auto-shoot (runs on real delta so fire rate is unaffected by slowmo)
  state.shootTimer -= delta;
  if (state.weaponTier >= 2) state.bulletWaveAngle += 1.2 * delta;
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

  updatePickups(worldDelta, state.playerLevel, state.elapsed);
  updateParticles(worldDelta);
  updateDamageNums(worldDelta);
  updateDashStreaks(delta);

  consumeExplBloomDirty();
  renderBloom();
  labelRenderer.render(scene, camera);
}

// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import { PLAYER_MAX_HP } from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks } from './player.js';
import { updateEnemies, spawnEnemyAtEdge } from './enemies.js';
import { shootBulletWave, updateBullets, updateEnemyBullets, updateOrbitBullets } from './weapons.js';
import { updatePickups } from './pickups.js';
import { updateParticles } from './particles.js';
import { updateDamageNums } from './damageNumbers.js';
import { getFireInterval } from './xp.js';
import { triggerGameOver, formatTime } from './gameFlow.js';
import { playerGroup } from './player.js';

const timerEl  = document.getElementById('timer-value');
const fpsTogEl = document.getElementById('s-fps');
const fpsOvEl  = document.getElementById('fpsOverlay');
const fpsValEl = document.getElementById('fpsVal');

export const clock = new THREE.Clock();
let fpsEMA = 60;

export function tick() {
  requestAnimationFrame(tick);

  if (state.paused || state.gameOver) {
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

  // Periodic enemy trickle
  if (!Number.isFinite(state.spawnTickTimer)) state.spawnTickTimer = 0;
  if (!Number.isFinite(state.maxEnemies) || state.maxEnemies <= 0) state.maxEnemies = 50;
  state.spawnTickTimer -= delta;
  if (state.spawnTickTimer <= 0) {
    const space = Math.max(0, state.maxEnemies - state.enemies.length);
    const toSpawn = Math.min(space, 10);
    for (let s = 0; s < toSpawn; s++) spawnEnemyAtEdge();
    state.spawnTickTimer = 0.5;
  }

  // Auto-shoot (runs on real delta so fire rate is unaffected by slowmo)
  state.shootTimer -= delta;
  if (state.playerLevel >= 2) state.bulletWaveAngle += 1.2 * delta;
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
// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import {PLAYER_MAX_HP, getEnemyCapForLevel, getActiveEnemyTypesForLevel, isBossLevel, ENEMY_TYPE, ENEMY_DEFS, getBossScaleForLevel} from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks, updateHealthBar } from './player.js';
import { updateEnemies, spawnEnemyAtEdge, removeCSS2DFromGroup } from './enemies.js';
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
function startWave(waveNum){
  const cfg = [][Math.max(0, Math.min(waveNum - 1, [].length - 1))];
  state.wave = cfg.wave;
  state.wavePhase = 'standard';
  state.waveSpawnRemaining = cfg.standardCount;
  state.bossSpawnRemaining = 0;
  state.maxEnemies = Math.max(state.maxEnemies || 0, 350);
  showWaveBanner('WAVE ' + cfg.wave);
}


export function tick() {
  requestAnimationFrame(tick);

  if (state.paused || state.gameOver || state.upgradeOpen) {
    renderBloom();
    labelRenderer.render(scene, camera);
    return;
  }

  const delta = Math.min(clock.getDelta(), 0.05);

  // Kick off a new wave whenever flagged (initial wave 1 + every wave after upgrade shop)
  if (state.wavePendingStart) {
    state.wavePendingStart = false;
    startWave(state.wave);
  }

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

  // Boss presence on boss levels (every 10). Boss respawns if killed.
  if (isBossLevel(state.playerLevel)) {
    if (!state.bossAlive) {
      state.bossRespawnTimer -= worldDelta;
      if (state.bossRespawnTimer <= 0) {
        // spawn boss using ENEMY_TYPE.BOSS with scaling
        const scale = getBossScaleForLevel(state.playerLevel);
        const def = ENEMY_DEFS[ENEMY_TYPE.BOSS];
        spawnEnemyAtEdge({ isBoss:true, color:def.color, sizeMult:def.sizeMult, health: Math.round((state.playerMaxHP ?? PLAYER_MAX_HP) * def.hpPct * scale.hpMult), fireRate: def.fireRate });
        state.bossAlive = true;
        state.bossRespawnTimer = 6.0;
      }
    }
  } else {
    state.bossAlive = false;
    state.bossRespawnTimer = 0;
  }

  // Spawn timer: continuous spawning toward cap.
  state.spawnTimer -= worldDelta;
  const spawnInterval = Math.max(0.22, 1.05 - Math.min(0.65, state.playerLevel * 0.012));
  if (!state.paused && !state.gameOver && !state.upgradeOpen && state.spawnTimer <= 0) {
    state.spawnTimer = spawnInterval * (0.85 + Math.random() * 0.3);
    // swarmers spawn in groups early game
    const types = getActiveEnemyTypesForLevel(state.playerLevel);
    const t = types[(Math.random()*types.length)|0];
    if (t === ENEMY_TYPE.RUSHER && state.playerLevel <= 12 && Math.random() < 0.55) {
      const n = 8 + ((Math.random()*5)|0); // 8–12
      for (let i=0;i<n;i++) spawnEnemyAtEdge(ENEMY_TYPE.RUSHER);
    } else {
      spawnEnemyAtEdge(t);
    }
  }

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
  if (state.spawnTickTimer <= 0) {
    const waveCfg = [][Math.max(0, Math.min(state.wave - 1, [].length - 1))];
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
    const waveCfg = [][Math.max(0, Math.min(state.wave - 1, [].length - 1))];
    state.wavePhase = 'boss';
    state.bossSpawnRemaining = waveCfg.boss.count;
    showWaveBanner('BOSS');
  }

  if (state.wavePhase === 'boss' && state.bossSpawnRemaining <= 0 && state.enemies.length === 0) {
    state.wavePhase = 'upgrade';
    state.upgradeOpen = true;
    // Pause simulation while shop is open
    openUpgradeShop(state.wave, () => {
      closeUpgradeShopIfOpen();
      state.upgradeOpen = false;
      state.paused = false;

      if (state.wave >= 10) {
        triggerVictory();
        return;
      }
      state.wave += 1;
      // Start next wave on next frame to avoid re-entrancy
      state.wavePendingStart = true;
    });
  }
  // Auto-shoot (runs on real delta so fire rate is unaffected by slowmo)
  // Auto-shoot (runs on real delta so fire rate is unaffected by slowmo)
  // Weapon tier 0 = no starting laser; player must buy Tier 1 in the shop.
  if ((state.weaponTier || 0) > 0) {
    state.shootTimer -= delta;
    if (state.weaponTier >= 2) state.bulletWaveAngle += 1.2 * delta;
    if (state.shootTimer <= 0) {
      shootBulletWave();
      state.shootTimer = getFireInterval();
    }
  }

  // ── Slash attack ──────────────────────────────────────────────────────────
  if (!state.slashTimer) state.slashTimer = 0;
  state.slashTimer -= delta;
  if (state.slashTimer <= 0) {
    performSlash();
    state.slashTimer = 1.0;
  }

  // ── Update world entities with worldDelta ─────────────────────────────────
  updateBullets(worldDelta);
  updateEnemyBullets(worldDelta);
  if (state.orbitRings.length > 0) updateOrbitBullets(worldDelta);

  const enemyResult = updateEnemies(delta, worldDelta, state.elapsed);
  if (enemyResult === 'DEAD') {
    if ((state.extraLives || 0) > 0) {
      // Consume a life and "revive": clear immediate threats + brief invulnerability.
      state.extraLives -= 1;
      state.playerHP = PLAYER_MAX_HP;
      updateHealthBar();

      // Clear enemies and enemy bullets so we don't instantly re-die.
      state.enemies.forEach(e => { try { removeCSS2DFromGroup(e.grp); scene.remove(e.grp); } catch {} });
      state.enemies.length = 0;
      state.enemyBullets.forEach(b => { try { scene.remove(b.mesh); } catch {} });
      state.enemyBullets.length = 0;

      const sess = state.gameSession;
      state.invincible = true;
      setTimeout(() => { if (state.gameSession === sess) state.invincible = false; }, 1200);
    } else {
      triggerGameOver();
      return;
    }
  }

  updatePickups(worldDelta, state.playerLevel, state.elapsed);
  updateParticles(worldDelta);
  updateDamageNums(worldDelta);
  updateDashStreaks(delta);
  updateSlashEffects(worldDelta);

  consumeExplBloomDirty();
  renderBloom();
  labelRenderer.render(scene, camera);
}

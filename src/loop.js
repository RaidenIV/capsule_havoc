// ─── loop.js ──────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { renderer, scene, camera, labelRenderer } from './renderer.js';
import { renderBloom, consumeExplBloomDirty } from './bloom.js';
import { state } from './state.js';
import {PLAYER_MAX_HP, getEnemyCapForLevel, getActiveEnemyTypesForLevel, isBossLevel, ENEMY_TYPE, ENEMY_DEFS, getBossScaleForLevel, SLASH_INTERVAL} from './constants.js';
import { updateSunPosition, updateOrbitLights } from './lighting.js';
import { updateChunks } from './terrain.js';
import { updatePlayer, updateDashStreaks, updateHealthBar } from './player.js';
import { updateEnemies, removeCSS2DFromGroup, killEnemy } from './enemies.js';
import { updateSpawner, initSpawner } from './spawner.js';
import { shootBulletWave, updateBullets, updateEnemyBullets, updateOrbitBullets, performSlash, updateSlashEffects } from './weapons.js';
import { updatePickups } from './pickups.js';
import { updateActiveEffects } from './activeEffects.js';
import { updateArmorTimers } from './armor.js';
import { initArenaPickups, updateArenaPickups } from './arenaPickups.js';
import { updateHudEffects } from './hudEffects.js';
import { updateHudLevel } from './hudLevel.js';
import { updateParticles } from './particles.js';
import { updateDamageNums } from './damageNumbers.js';
import { getFireInterval } from './xp.js';
import { triggerGameOver, formatTime } from './gameFlow.js';
import { playSound } from './audio.js';
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

  // One-time init for systems introduced by the design doc.
  if (!state._designDocInitDone) {
    state._designDocInitDone = true;
    try { initArenaPickups(); } catch {}
  }

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
  // enemyTimeScale: slows only enemy movement and bullets (Time Freeze pickup)
  const clockActive = (state.effects?.clock || 0) > 0;
  state.enemyTimeScale = clockActive ? 0.05 : 1.0; // nearly frozen during clock effect

  // Timed effects (arena pickups)
  updateArmorTimers(worldDelta);
  updateActiveEffects(worldDelta);

  // ── Ability timers & passive effects (design doc) ─────────────────────────
  // Dash i-frames (Tier 3)
  state.dashInvincible = (state.dashTimer > 0) && ((state.upg?.dash || 0) >= 3);

  // Shield recharge
  if ((state.shieldHitCD || 0) > 0) state.shieldHitCD = Math.max(0, state.shieldHitCD - worldDelta);
  const shieldTier = Math.max(0, state.upg?.shield || 0);
  const shieldMax = shieldTier >= 3 ? 2 : (shieldTier >= 1 ? 1 : 0);
  if (shieldMax > 0) {
    if ((state.shieldCharges || 0) <= 0 && (state.shieldRecharge || 0) > 0) {
      state.shieldRecharge = Math.max(0, state.shieldRecharge - worldDelta);
      if (state.shieldRecharge <= 0) state.shieldCharges = shieldMax;
    } else if ((state.shieldCharges || 0) <= 0 && (state.shieldRecharge || 0) <= 0) {
      // If shield unlocked but never initialized
      state.shieldCharges = shieldMax;
    }
  } else {
    state.shieldCharges = 0;
    state.shieldRecharge = 0;
  }

  // Passive regen
  const regenTier = Math.max(0, state.upg?.regen || 0);
  if (regenTier > 0 && state.playerHP < state.playerMaxHP) {
    state.playerHP = Math.min(state.playerMaxHP, state.playerHP + regenTier * worldDelta);
  }

  // Cooldowns
  if ((state.burstCooldown || 0) > 0) state.burstCooldown = Math.max(0, state.burstCooldown - worldDelta);
  if ((state.slowCooldown || 0) > 0) state.slowCooldown = Math.max(0, state.slowCooldown - worldDelta);
  if ((state.slowTimer || 0) > 0) state.slowTimer = Math.max(0, state.slowTimer - worldDelta);

  // Time Slow activation (Q)
  if (state.slowRequested) {
    state.slowRequested = false;
    const tier = Math.max(0, state.upg?.timeSlow || 0);
    if (tier > 0 && state.slowCooldown <= 0 && state.slowTimer <= 0) {
      const duration = tier >= 3 ? 5.0 : 3.0;
      const cdBase = 15.0;
      const cd = (tier >= 2) ? cdBase * 0.70 : cdBase;
      state.slowTimer = duration;
      state.slowCooldown = cd;
      state.slowScale = 0.5;
      playSound('slowmo', 0.6, 1.0);
    }
  }

  // Area Burst activation (E)
  if (state.burstRequested) {
    state.burstRequested = false;
    const tier = Math.max(0, state.upg?.burst || 0);
    if (tier > 0 && state.burstCooldown <= 0) {
      const baseRadius = 5.5;
      const radius = tier >= 4 ? baseRadius * 2.0 : baseRadius;
      const dmg = (tier >= 4) ? 180 : (70 + tier * 30);
      // Apply damage to enemies in radius.
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j]; if (e.dead) continue;
        const dx = e.grp.position.x - playerGroup.position.x;
        const dz = e.grp.position.z - playerGroup.position.z;
        if (dx*dx + dz*dz <= radius*radius) {
          e.hp -= dmg;
          if (e.hp <= 0) {
            killEnemy(j);
          }
        }
      }
      state.burstCooldown = 8.0;
      playSound('burst', 0.7, 1.0);
    }
  }

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

  // Timed arena pickups
  updateArenaPickups(worldDelta);

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

  // ── Enemies ───────────────────────────────────────────────────────────────
  updateEnemies(delta, worldDelta * (state.enemyTimeScale ?? 1.0), state.elapsed);

  // ── Black Hole ─────────────────────────────────────────────────────────────
  // Spawned when the pickup is collected (see activeEffects.js applyEffect 'blackHole').
  // A vortex mesh is created at a random location ~15 units from the player.
  // Enemies pulled in are killed (coins still drop) but no explosion spawns.
  if (!state._bhMesh && (state.effects?.blackHole || 0) > 0) {
    // First frame of black hole — spawn the vortex
    const ang = Math.random() * Math.PI * 2;
    const dist = 12 + Math.random() * 6;
    const bx = playerGroup.position.x + Math.cos(ang) * dist;
    const bz = playerGroup.position.z + Math.sin(ang) * dist;
    const bhGeo = new THREE.SphereGeometry(1.2, 16, 16);
    const bhMat = new THREE.MeshStandardMaterial({
      color: 0x000000, emissive: 0x6600ff, emissiveIntensity: 3.0,
      transparent: true, opacity: 0.92, metalness: 0.0, roughness: 0.5,
    });
    const bhMesh = new THREE.Mesh(bhGeo, bhMat);
    bhMesh.position.set(bx, 1.2, bz);
    bhMesh.layers.enable(1);
    scene.add(bhMesh);
    state._bhMesh = bhMesh;
    state._bhMat = bhMat;
    state._bhGeo = bhGeo;
  }
  if (state._bhMesh) {
    if ((state.effects?.blackHole || 0) <= 0) {
      // Effect expired — clean up
      scene.remove(state._bhMesh);
      state._bhMat.dispose();
      state._bhGeo.dispose();
      state._bhMesh = null; state._bhMat = null; state._bhGeo = null;
    } else {
      // Spin and pulse
      state._bhMesh.rotation.y += worldDelta * 2.5;
      state._bhMat.emissiveIntensity = 2.5 + Math.sin(state.elapsed * 8) * 0.8;
      const PULL = 22.0;
      const KILL_R = 1.8;
      const bhx = state._bhMesh.position.x;
      const bhz = state._bhMesh.position.z;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (e.dead) continue;
        const bdx = bhx - e.grp.position.x;
        const bdz = bhz - e.grp.position.z;
        const bd = Math.sqrt(bdx*bdx + bdz*bdz);
        if (bd < KILL_R) {
          // Silently kill enemy — drop coins but no explosion flash
          removeCSS2DFromGroup(e.grp);
          scene.remove(e.grp);
          e.dead = true;
          state.kills++;
          const _ke = document.getElementById('kills-value'); if (_ke) _ke.textContent = state.kills;
          // Drop loot — same coin value as a normal kill
          import('./leveling.js').then(lev => {
            const tier = lev.getCoinTierForEnemy?.(e.enemyType) ?? { value: 1, color: null };
            import('./pickups.js').then(m => {
              if (m.dropLoot) m.dropLoot(e.grp.position, tier.value, e.coinMult || 1, tier.color ?? null);
            }).catch(()=>{});
          }).catch(()=>{});
          state.enemies.splice(j, 1);
        } else if (bd < 30) {
          e.grp.position.x += (bdx/bd) * Math.min(PULL * worldDelta, bd - KILL_R);
          e.grp.position.z += (bdz/bd) * Math.min(PULL * worldDelta, bd - KILL_R);
        }
      }
    }
  }

  // ── Weapons / bullets ─────────────────────────────────────────────────────
  // Auto-shoot: only fires when weapon tier is active
  if ((state.weaponTier || 0) >= 1) {
    state.shootTimer = (state.shootTimer || 0) - worldDelta;
    if (state.shootTimer <= 0) {
      shootBulletWave();
      state.shootTimer = getFireInterval();
    }
  }
  updateBullets(worldDelta);
  updateEnemyBullets(worldDelta * (state.enemyTimeScale ?? 1.0));
  updateOrbitBullets(worldDelta);
  // Slash: timed by SLASH_INTERVAL, scaled by worldDelta so Time Slow affects it
  state._slashTimer = (state._slashTimer || 0) - worldDelta;
  if (state._slashTimer <= 0) {
    performSlash();
    state._slashTimer = SLASH_INTERVAL;
  }

  updatePickups(worldDelta, state.playerLevel, state.elapsed);
  updateParticles(worldDelta);
  updateDamageNums(worldDelta);
  updateHudEffects();
  updateHudLevel();
  updateDashStreaks(delta);
  updateSlashEffects(worldDelta);

  consumeExplBloomDirty();
  renderBloom();
  labelRenderer.render(scene, camera);
}

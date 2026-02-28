// ─── enemies.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  ENEMY_SPEED, ENEMY_CONTACT_DPS, ENEMY_BULLET_SPEED, ENEMY_BULLET_LIFETIME,
  STAGGER_DURATION, SPAWN_FLASH_DURATION, ELITE_FIRE_RATE, ELITE_TYPES, PLAYER_MAX_HP,
  STANDARD_ENEMY_SIZE_MULT, ENEMY_HP,
} from './constants.js';
import {
  enemyGeo, enemyMat, enemyGeoParams, bulletGeoParams,
  enemyBulletGeo, getEnemyBulletMat, floorY,
} from './materials.js';
import { playerGroup, updateHealthBar } from './player.js';
import { steerAroundProps, pushOutOfProps, hasLineOfSight } from './terrain.js';
import { spawnEnemyDamageNum, spawnPlayerDamageNum } from './damageNumbers.js';
import { spawnExplosion } from './particles.js';
import { dropLoot } from './pickups.js';
import { updateXP, getXPPerKill, getCoinValue } from './xp.js';
import { playSound } from './audio.js';

// Reused quaternion helpers for enemy laser orientation
const _eBulletUp  = new THREE.Vector3(0, 1, 0);
const _eBulletDir = new THREE.Vector3();
const _eBulletQ   = new THREE.Quaternion();

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnEnemy(x, z, eliteType = null) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);

  const cfg = eliteType;
  const color     = cfg?.color ?? 0x888888;
  const scaleMult = cfg?.sizeMult ?? STANDARD_ENEMY_SIZE_MULT;
  const hpMult    = cfg?.hpMult   ?? 1;
  const expMult   = cfg?.expMult  ?? 1;
  const coinMult  = cfg?.coinMult ?? 1;

  const mat = enemyMat.clone();
  mat.color.set(color);
  const geo = new THREE.CapsuleGeometry(
    enemyGeoParams.radius * scaleMult, enemyGeoParams.length * scaleMult,
    enemyGeoParams.capSegs, enemyGeoParams.radial
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = (enemyGeoParams.radius + enemyGeoParams.length / 2) * scaleMult;
  mesh.castShadow = true;
  grp.add(mesh);
  scene.add(grp);

  const hp       = cfg?.fixedHp != null ? cfg.fixedHp : Math.round(ENEMY_HP * hpMult);
  const fireRate = eliteType ? (ELITE_FIRE_RATE[eliteType.minLevel] ?? 2.0) : null;

  let eliteBarFill = null;
  if (cfg) {
    const bWrap = document.createElement('div');
    bWrap.className = 'elite-bar-wrap';
    bWrap.style.width = Math.round(40 + scaleMult * 30) + 'px';
    const bFill = document.createElement('div');
    bFill.className = 'elite-bar-fill';
    bFill.style.width = '100%';
    bFill.style.background = 'linear-gradient(to right,#880000,#ff2222)';
    bWrap.appendChild(bFill);
    const bObj = new CSS2DObject(bWrap);
    bObj.position.set(0, (enemyGeoParams.radius + enemyGeoParams.length/2) * scaleMult * 2 + 0.5, 0);
    grp.add(bObj);
    eliteBarFill = bFill;
  }

  state.enemies.push({
    grp, mesh, mat, hp, maxHp: hp, dead: false,
    scaleMult, expMult, coinMult, eliteType: cfg, eliteBarFill,
    fireRate, shootTimer: fireRate ? Math.random() * fireRate : 0,
    staggerTimer: 0, baseColor: new THREE.Color(color),
    spawnFlashTimer: SPAWN_FLASH_DURATION, matDirty: true,
  });

  // Spawn fade-in
  mat.transparent = true; mat.opacity = 0; mesh.castShadow = false;
}

export function spawnEnemyAtEdge(eliteType = null) {
  if (state.enemies.length >= state.maxEnemies) return;
  const angle = Math.random() * Math.PI * 2;
  const r     = 28 + Math.random() * 5;
  spawnEnemy(
    playerGroup.position.x + Math.cos(angle) * r,
    playerGroup.position.z + Math.sin(angle) * r,
    eliteType
  );
}

export function spawnLevelElites(eliteType) {
  const session = state.gameSession;
  const WINDOW  = 8000;
  for (let i = 0; i < eliteType.count; i++) {
    setTimeout(() => {
      if (!state.gameOver && state.gameSession === session) spawnEnemyAtEdge(eliteType);
    }, Math.random() * WINDOW);
  }
}

export function updateEliteBar(e) {
  if (!e.eliteBarFill) return;
  e.eliteBarFill.style.width = Math.max(0, (e.hp / e.maxHp) * 100) + '%';
}

// ── Kill (imported by weapons.js too — no circular dep since it's a function call) ──
export function removeCSS2DFromGroup(grp) {
  grp.traverse(obj => {
    if (obj.isCSS2DObject && obj.element.parentNode)
      obj.element.parentNode.removeChild(obj.element);
  });
}

// onLevelUp is injected from main.js to break the enemies↔weapons circular dep
let _onLevelUp = null;
export function setLevelUpCallback(fn) { _onLevelUp = fn; }

let _triggerVictory = null;
export function setVictoryCallback(fn) { _triggerVictory = fn; }

const killsEl = document.getElementById('kills-value');

export function killEnemy(j) {
  const e = state.enemies[j];
  spawnExplosion(e.grp.position, e.eliteType);
  removeCSS2DFromGroup(e.grp);
  scene.remove(e.grp);
  e.dead = true;
  state.enemies.splice(j, 1);
  state.kills++;
  if (killsEl) killsEl.textContent = state.kills;

  dropLoot(e.grp.position, getCoinValue(), e.coinMult);

  const xpGained  = Math.round(getXPPerKill() * (e.expMult || 1));
  const prevLevel = state.playerLevel;
  updateXP(xpGained);

  if (state.playerLevel > prevLevel) {
    if (_onLevelUp) _onLevelUp(state.playerLevel);
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
export function updateEnemies(delta, worldDelta, elapsed) {
  let contactThisFrame = false;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (e.dead) continue;

    const dx   = playerGroup.position.x - e.grp.position.x;
    const dz   = playerGroup.position.z - e.grp.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);

    // Stagger flash
    if (e.staggerTimer > 0) {
      e.staggerTimer = Math.max(0, e.staggerTimer - worldDelta);
      const t = e.staggerTimer / STAGGER_DURATION;
      e.mat.color.setRGB(
        e.baseColor.r + (1 - e.baseColor.r) * t,
        e.baseColor.g + (1 - e.baseColor.g) * t,
        e.baseColor.b + (1 - e.baseColor.b) * t,
      );
      e.mat.emissive.setRGB(1, 1, 1);
      e.mat.emissiveIntensity = t > 0 ? t * 4 : enemyMat.emissiveIntensity;
      e.matDirty = true;
    } else if (e.spawnFlashTimer > 0) {
      e.spawnFlashTimer = Math.max(0, e.spawnFlashTimer - worldDelta);
      const progress = 1 - e.spawnFlashTimer / SPAWN_FLASH_DURATION;
      e.mat.opacity = progress;
      e.mat.color.copy(e.baseColor);
      e.mat.emissive.setRGB(0, 0, 0);
      e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
      e.matDirty = true;
      if (e.spawnFlashTimer <= 0) {
        e.mat.transparent = false; e.mat.opacity = 1; e.mesh.castShadow = true;
      }
      continue; // no movement during fade-in
    } else {
      if (e.matDirty) {
        e.mat.color.copy(e.baseColor);
        e.mat.emissive.setRGB(0, 0, 0);
        e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
        e.matDirty = false;
      }
    }

    // Elite shooting
    if (e.fireRate && !e.dead) {
      e.shootTimer -= worldDelta;
      if (e.shootTimer <= 0) {
        e.shootTimer = e.fireRate * (0.8 + Math.random() * 0.4);
        const RANGE = ENEMY_BULLET_SPEED * ENEMY_BULLET_LIFETIME * 0.72;
        if (dist > 0.5 && dist < RANGE &&
            hasLineOfSight(e.grp.position.x, e.grp.position.z,
                           playerGroup.position.x, playerGroup.position.z)) {
          const dvx = (dx/dist) * ENEMY_BULLET_SPEED;
          const dvz = (dz/dist) * ENEMY_BULLET_SPEED;
          const col  = e.eliteType ? e.eliteType.color : 0xff4400;
          const bMat = getEnemyBulletMat(col);
          const bMesh = new THREE.Mesh(enemyBulletGeo, bMat);
          _eBulletDir.set(dvx, 0, dvz).normalize();
          _eBulletQ.setFromUnitVectors(_eBulletUp, _eBulletDir);
          bMesh.quaternion.copy(_eBulletQ);
          bMesh.layers.enable(1);
          bMesh.position.copy(e.grp.position);
          bMesh.position.y = floorY(bulletGeoParams);
          scene.add(bMesh);
          state.enemyBullets.push({ mesh: bMesh, mat: bMat, vx: dvx, vz: dvz, life: ENEMY_BULLET_LIFETIME });
          playSound('elite_shoot', 0.5, 0.9 + Math.random() * 0.2);
        }
      }
    }

    // Movement
    if (dist > 0.01 && e.staggerTimer <= 0) {
      const eR = enemyGeoParams.radius * (e.scaleMult || 1);
      const { sx, sz } = steerAroundProps(
        e.grp.position.x, e.grp.position.z,
        playerGroup.position.x, playerGroup.position.z,
        eR, state.enemies, i
      );
      e.grp.position.x += sx * ENEMY_SPEED * worldDelta;
      e.grp.position.z += sz * ENEMY_SPEED * worldDelta;
    }
    pushOutOfProps(e.grp.position, enemyGeoParams.radius * (e.scaleMult || 1));

    // Bob + face player
    const eFloorY = (enemyGeoParams.radius + enemyGeoParams.length / 2) * (e.scaleMult || 1);
    e.mesh.position.y  = eFloorY + Math.sin(elapsed * 3 + i) * 0.05;
    e.grp.rotation.y   = Math.atan2(dx, dz);

    // Player contact damage
    const pr = 0.4 * 1.02;
    const er = enemyGeoParams.radius * (e.scaleMult || 1) * 1.02;
    const minD = pr + er;
    if (dist < minD && dist > 1e-6) {
      contactThisFrame = true;
      const nx = dx/dist, nz = dz/dist;
      const push = (minD - dist) * 0.55;
      e.grp.position.x -= nx * push; e.grp.position.z -= nz * push;
      playerGroup.position.x += nx * push; playerGroup.position.z += nz * push;
      // Play hit sound on contact (throttled via contactDmgTimer, invincible or not)
      if (state.contactDmgTimer <= 0) playSound('player_hit', 0.6, 0.95 + Math.random() * 0.1);
      if (!state.invincible) {
        const dmg = ENEMY_CONTACT_DPS * worldDelta;
        state.playerHP -= dmg;
        state.contactDmgAccum += dmg;
        state.contactDmgTimer -= worldDelta;
        if (state.contactDmgTimer <= 0) {
          spawnPlayerDamageNum(Math.round(state.contactDmgAccum));
          state.contactDmgAccum = 0;
          state.contactDmgTimer = 0.35;
        }
        updateHealthBar();
        if (state.playerHP <= 0) return 'DEAD';
      } else {
        // Still tick the timer when invincible so sound stays throttled
        state.contactDmgTimer -= worldDelta;
        if (state.contactDmgTimer <= 0) state.contactDmgTimer = 0.35;
      }
    }
  }

  // Reset contact sound timer when player is not touching any enemy,
  // so the sound plays immediately on the next contact
  if (!contactThisFrame) state.contactDmgTimer = 0;

  // ── Enemy/enemy separation ─────────────────────────────────────────────────
  for (let i = 0; i < state.enemies.length; i++) {
    const a = state.enemies[i]; if (a.dead) continue;
    const ra = enemyGeoParams.radius * (a.scaleMult || 1) * 1.05;
    for (let j = i + 1; j < state.enemies.length; j++) {
      const b = state.enemies[j]; if (b.dead) continue;
      const rb   = enemyGeoParams.radius * (b.scaleMult || 1) * 1.05;
      const minD = ra + rb;
      const dx = b.grp.position.x - a.grp.position.x;
      const dz = b.grp.position.z - a.grp.position.z;
      const d2 = dx*dx + dz*dz;
      if (d2 < minD*minD && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (minD - d) * 0.35;
        const nx = dx/d, nz = dz/d;
        a.grp.position.x -= nx*push; a.grp.position.z -= nz*push;
        b.grp.position.x += nx*push; b.grp.position.z += nz*push;
      }
    }
  }
}

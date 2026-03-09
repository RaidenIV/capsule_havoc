// ─── weapons.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  BULLET_SPEED, BULLET_LIFETIME, ENEMY_BULLET_DMG,
} from './constants.js';
import { bulletGeo, bulletMat, bulletGeoParams, floorY } from './materials.js';
import { playerGroup, updateHealthBar, hasShieldBubble, SHIELD_RADIUS, PLAYER_BODY_RADIUS } from './player.js';
import { pushOutOfProps, queryNearbyPropColliders } from './terrain.js';
import { spawnPlayerDamageNum, spawnEnemyDamageNum } from './damageNumbers.js';
import { killEnemy, updateEliteBar, queryEnemiesNear, releaseEnemyBulletVisual } from './enemies.js';
import { applyPlayerDamage } from './armor.js';
import {
  getFireInterval, getWaveBullets, getBulletDamage, getWeaponConfig,
} from './xp.js';
import { playSound } from './audio.js';

// ── Orbit bullet helpers ──────────────────────────────────────────────────────
function makeOrbitMat(color) {
  return new THREE.MeshPhysicalMaterial({
    color, emissive: color, emissiveIntensity: 2.0,
    metalness: 1.0, roughness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.0,
    depthTest: true, depthWrite: true,
  });
}

// Orbit visuals should match player lasers: a white core "rod" plus colored bloom glow.
const _orbitCoreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.35,
  metalness: 0.15,
  roughness: 0.35,
});
function _makeOrbitVisual(color) {
  const g = new THREE.Group();

  const core = new THREE.Mesh(bulletGeo, _orbitCoreMat);
  core.layers.set(0);
  g.add(core);

  const glowMat = makeOrbitMat(color);
  glowMat.emissiveIntensity = 1.25; // lower than before; bloom is handled by layer
  const glow = new THREE.Mesh(bulletGeo, glowMat);
  glow.layers.set(1);
  glow.scale.setScalar(1.35);
  g.add(glow);

  return g;
}

function getOrbitRingDefsFromTier(tier) {
  const t = Math.max(0, tier | 0);
  if (t <= 0) return [];
  const count = [0, 2, 3, 4, 5, 6][Math.min(t, 5)] || 0;
  const tierRadiusBonus = Math.max(0, t - 1) * 0.35;
  const radius = 1.9 + tierRadiusBonus + Math.max(0, state.upg?.orbitRange || 0) * 0.22;
  const speedBase = (1.7 * 2.0) * (1 + 0.15 * t) + Math.max(0, state.upg?.orbitSpeed || 0) * 0.20;
  return [{ count, radius, speed: speedBase, color: 0x00eeff }];
}

export function destroyOrbitBullets() {
  state.orbitRings.forEach(ring =>
    ring.meshes.forEach(group => {
      scene.remove(group);
      group.traverse(obj => {
        if (obj.isMesh && obj.material && obj.material !== _orbitCoreMat) {
          obj.material.dispose?.();
        }
      });
    })
  );
  state.orbitRings.length = 0;
  state.orbitHitActive.clear();
}

export function syncOrbitBullets() {
  destroyOrbitBullets();
    const orbitTier = Math.max(0, state.upg?.orbit || 0);
  for (const def of getOrbitRingDefsFromTier(orbitTier)) {
    const meshes = [];
    for (let i = 0; i < def.count; i++) {
      const obj = _makeOrbitVisual(def.color);
      scene.add(obj);
      meshes.push(obj);
    }
    state.orbitRings.push({ def, meshes, angle: 0 });
  }
}

// ── Shoot bullet wave ─────────────────────────────────────────────────────────
const _bulletUp  = new THREE.Vector3(0, 1, 0);
const _bulletDir = new THREE.Vector3();
const _bulletQ   = new THREE.Quaternion();

// Player laser look: white core (layer 0) + additive colored glow (layer 1)
// This restores the "white center" while keeping bullet bloom punchy.
const _playerLaserCoreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.35,
  metalness: 0.0,
  roughness: 0.25,
});

const _playerLaserGlowMat = new THREE.MeshStandardMaterial({
  color: 0xff1100,
  emissive: 0xff1100,
  emissiveIntensity: 6.0,
  metalness: 0.0,
  roughness: 0.2,
  transparent: true,
  opacity: 0.55,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

function _makePlayerLaserVisual() {
  const g = new THREE.Group();

  // Core: visible in main scene
  const core = new THREE.Mesh(bulletGeo, _playerLaserCoreMat);
  core.layers.set(0);
  g.add(core);

  // Glow: rendered in bullet bloom layer
  const glow = new THREE.Mesh(bulletGeo, _playerLaserGlowMat);
  glow.layers.set(1);
  glow.scale.setScalar(1.25);
  g.add(glow);

  return g;
}

const _playerBulletPool = [];
function _acquirePlayerLaserVisual() {
  const g = _playerBulletPool.pop() || _makePlayerLaserVisual();
  g.visible = true;
  g.traverse(obj => { obj.visible = true; });
  return g;
}
function _releasePlayerLaserVisual(g) {
  if (!g) return;
  scene.remove(g);
  g.visible = false;
  g.traverse(obj => { obj.visible = false; });
  _playerBulletPool.push(g);
}

export function shootBulletWave() {
  const dirs = getWaveBullets();
  if (dirs <= 0) return;
  const dmg  = getBulletDamage();
  const psTier = Math.max(0, state.upg?.projSpeed || 0);
  const speed  = BULLET_SPEED * (1 + 0.20 * psTier);
  const pierce = Math.max(0, state.upg?.piercing || 0);
  const msTier = Math.max(0, (state.upg?.multishot ?? 0));
  const rangeTier = Math.max(0, state.upg?.laserRange || 0);
  const bulletLife = BULLET_LIFETIME * (1 + 0.22 * rangeTier);
  const laserTier = Math.max(0, state.upg?.laserFire || 0);
  const rotating = (state.characterPrimaryWeapon === 'laser' || state.selectedCharacter === 'blue') && laserTier >= 5;
  const volleyCount = (state.multiShotVolleyCount || 0) + 1;
  state.multiShotVolleyCount = volleyCount;
  const multishotActive = msTier > 0 && (volleyCount % 5 === 0);
  const procIndex = Math.max(0, Math.floor(volleyCount / 5));
  const spreadOffset = dirs >= 10 ? 0.055 : (dirs >= 8 ? 0.070 : 0.085);

  playSound('shoot', 0.45, 0.92 + Math.random() * 0.16);

  const spawnShot = (ang) => {
    const vx = Math.cos(ang) * speed;
    const vz = Math.sin(ang) * speed;
    const obj = _acquirePlayerLaserVisual();
    _bulletDir.set(vx, 0, vz).normalize();
    _bulletQ.setFromUnitVectors(_bulletUp, _bulletDir);
    obj.quaternion.copy(_bulletQ);
    obj.position.copy(playerGroup.position);
    obj.position.y = floorY(bulletGeoParams);
    scene.add(obj);
    state.bullets.push({ obj, vx, vz, life: bulletLife, dmg, pierceLeft: pierce });
  };

  for (let i = 0; i < dirs; i++) {
    const baseAng = state.bulletWaveAngle + (i / Math.max(1, dirs)) * Math.PI * 2;
    spawnShot(baseAng);

    if (!multishotActive) continue;

    if (msTier >= 2) {
      spawnShot(baseAng - spreadOffset);
      spawnShot(baseAng + spreadOffset);
    } else {
      const side = (procIndex % 2 === 0) ? -1 : 1;
      spawnShot(baseAng + side * spreadOffset);
    }
  }
  if (rotating) state.bulletWaveAngle = (state.bulletWaveAngle + (Math.PI / Math.max(1, dirs))) % (Math.PI * 2);
}

// ── Update player bullets ─────────────────────────────────────────────────────
const _nearbyPropHits = [];
const _nearbyEnemies = [];

function applyEnemyDamage(e, amount) {
  // Shield absorbs damage first (shielded enemies are effectively immune until broken).
  if (e.shieldHp && e.shieldHp > 0) {
    e.shieldHp -= amount;
    if (e.shieldHp < 0) {
      // carry overflow into HP
      e.hp += e.shieldHp;
      e.shieldHp = 0;
    }
  } else {
    e.hp -= amount;
  }
}

export function updateBullets(delta) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.life -= delta;
    b.obj.position.x += b.vx * delta;
    b.obj.position.z += b.vz * delta;

    // NOTE: bulletGeo is shared; do NOT dispose shared geometry here.
    if (b.life <= 0) {
      _releasePlayerLaserVisual(b.obj);
      state.bullets.splice(i, 1);
      continue;
    }

    // Prop collision
    let dead = false;
    for (const c of queryNearbyPropColliders(b.obj.position.x, b.obj.position.z, 1.25, _nearbyPropHits)) {
      const dx = b.obj.position.x - c.wx, dz = b.obj.position.z - c.wz;
      if (dx*dx + dz*dz < (c.radius + 0.045) * (c.radius + 0.045)) {
        _releasePlayerLaserVisual(b.obj); state.bullets.splice(i, 1); dead = true; break;
      }
    }
    if (dead) continue;

    // Enemy collision
    let hit = false;
    const nearbyEnemies = queryEnemiesNear(b.obj.position.x, b.obj.position.z, 1.6, _nearbyEnemies);
    for (let n = nearbyEnemies.length - 1; n >= 0; n--) {
      const e = nearbyEnemies[n]; if (!e || e.dead) continue;
      const j = state.enemies.indexOf(e); if (j < 0) continue;
      const dx = b.obj.position.x - e.grp.position.x;
      const dz = b.obj.position.z - e.grp.position.z;
      if (dx*dx + dz*dz < 0.75*0.75) {
        applyEnemyDamage(e, b.dmg);
        spawnEnemyDamageNum(b.dmg, e);
        e.staggerTimer = 0.12;
        updateEliteBar(e);
        if ((b.pierceLeft || 0) > 0) {
          b.pierceLeft--;
        } else {
          _releasePlayerLaserVisual(b.obj); state.bullets.splice(i, 1);
        }
        hit = true;
        if (e.hp <= 0) {
          playSound(e.eliteType ? 'explodeElite' : 'explode', 0.7, 0.9 + Math.random() * 0.2);
          killEnemy(j);
        } else {
          playSound(e.eliteType ? 'elite_hit' : 'standard_hit', 0.4, 0.95 + Math.random() * 0.1);
        }
        break;
      }
    }
    if (hit) continue;
  }
}

// ── Update enemy bullets ──────────────────────────────────────────────────────
function _removeEBullet(b) {
  if (b.core) releaseEnemyBulletVisual(b.core);
  if (b.mesh && b.mesh !== b.core) releaseEnemyBulletVisual(b.mesh);
  if (b.obj && b.obj !== b.mesh && b.obj !== b.core) releaseEnemyBulletVisual(b.obj);
}

export function updateEnemyBullets(worldDelta) {
  for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
    const b = state.enemyBullets[i];
    b.life -= worldDelta;
    const mx = b.vx * worldDelta;
    const mz = b.vz * worldDelta;
    // Move bullet visuals (support old {mesh} as well as newer {core+mesh})
    if (b.core) { b.core.position.x += mx; b.core.position.z += mz; }
    const vis = b.mesh || b.obj || b.core;
    if (vis) { vis.position.x += mx; vis.position.z += mz; }
    else { _removeEBullet(b); state.enemyBullets.splice(i, 1); continue; }
    if (b.life <= 0) { _removeEBullet(b); state.enemyBullets.splice(i, 1); continue; }

    const visPos = (b.mesh || b.obj || b.core).position;
    const pdx = visPos.x - playerGroup.position.x;
    const pdz = visPos.z - playerGroup.position.z;
    const hitRadius = hasShieldBubble() ? SHIELD_RADIUS : PLAYER_BODY_RADIUS;
    if (pdx*pdx + pdz*pdz < hitRadius * hitRadius) {
      const dmg = (Number.isFinite(b.dmg) ? b.dmg : ENEMY_BULLET_DMG);
      // Shield absorbs hits first (abilities tab)
      if (!(state.invincible || state.dashInvincible) && (state.effects?.invincibility || 0) <= 0 && (state.reviveIFrames || 0) <= 0) {
        if ((state.shieldCharges || 0) > 0) {
          state.shieldCharges -= 1;
          // Start recharge timer
          if (state.shieldCharges <= 0) {
            const tier = Math.max(0, state.upg?.shield || 0);
            const base = 12.0;
            const rt = tier >= 4 ? base * 0.45 : ((tier >= 2) ? base * 0.65 : base);
            state.shieldRecharge = rt;
          }
          playSound('shield_break', 0.7, 1.0);
        } else {
          const res = applyPlayerDamage(dmg, 'enemyBullet');
          if (res.applied > 0) spawnPlayerDamageNum(Math.round(res.applied));
          if (res.died) return 'DEAD';
        }
      }
      _removeEBullet(b); state.enemyBullets.splice(i, 1);
      continue;
    }

    let blocked = false;
    for (const c of queryNearbyPropColliders(visPos.x, visPos.z, 1.5, _nearbyPropHits)) {
      const cdx = visPos.x - c.wx, cdz = visPos.z - c.wz; // bullet visual = glow mesh, tracks bullet position
      if (cdx*cdx + cdz*cdz < (c.radius + 0.14) * (c.radius + 0.14)) { blocked = true; break; }
    }
    if (blocked) { _removeEBullet(b); state.enemyBullets.splice(i, 1); }
  }
}

// ── Update orbit bullets ──────────────────────────────────────────────────────
export function updateOrbitBullets(delta) {
  const y    = floorY(bulletGeoParams);
  const orbitDmgTier = Math.max(0, state.upg?.orbitDamage || 0);
  const dmg  = Math.max(1, Math.round(getBulletDamage() * (1 + 0.10 * orbitDmgTier)));
  const hr2  = 0.75 * 0.75;

  for (let ri = 0; ri < state.orbitRings.length; ri++) {
    const ring = state.orbitRings[ri];
    ring.angle += ring.def.speed * delta;
    const { count, radius } = ring.def;
    for (let i = 0; i < ring.meshes.length; i++) {
      const angle = ring.angle + (i / count) * Math.PI * 2;
      ring.meshes[i].visible = true;
      ring.meshes[i].traverse(obj => { obj.visible = true; });
      ring.meshes[i].position.set(
        playerGroup.position.x + Math.cos(angle) * radius, y,
        playerGroup.position.z + Math.sin(angle) * radius
      );
      ring.meshes[i].rotation.y += 5 * delta;
    }
    for (let k = 0; k < ring.meshes.length; k++) {
      const candidates = queryEnemiesNear(ring.meshes[k].position.x, ring.meshes[k].position.z, 1.5, _nearbyEnemies);
      for (let c = candidates.length - 1; c >= 0; c--) {
        const e = candidates[c]; if (!e || e.dead) continue;
        const j = state.enemies.indexOf(e); if (j < 0) continue;
        const dx = ring.meshes[k].position.x - e.grp.position.x;
        const dz = ring.meshes[k].position.z - e.grp.position.z;
        const inContact = dx*dx + dz*dz < hr2;
        const key = ri * 65536 + k * 512 + j;
        const was = state.orbitHitActive.has(key);
        if (inContact && !was) {
          state.orbitHitActive.add(key);
          applyEnemyDamage(e, dmg);
          spawnEnemyDamageNum(dmg, e);
          e.staggerTimer = 0.12;
          updateEliteBar(e);
          if (e.hp <= 0) {
            playSound(e.eliteType ? 'explodeElite' : 'explode', 0.7, 0.9 + Math.random() * 0.2);
            killEnemy(j); break;
          } else {
            playSound(e.eliteType ? 'elite_hit' : 'standard_hit', 0.4, 0.95 + Math.random() * 0.1);
          }
        } else if (!inContact && was) {
          state.orbitHitActive.delete(key);
        }
      }
    }
  }
}


function _getNearestEnemy(maxRange = Infinity) {
  let best = null;
  let bestD2 = maxRange * maxRange;
  for (const e of state.enemies) {
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - playerGroup.position.x;
    const dz = e.grp.position.z - playerGroup.position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = e; }
  }
  return best;
}

const _targetedLaserCoreMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 0.35,
  metalness: 0.15,
  roughness: 0.35,
});
const _targetedLaserGlowMat = new THREE.MeshPhysicalMaterial({
  color: 0x8ecbff,
  emissive: 0x3ea0ff,
  emissiveIntensity: 2.15,
  metalness: 0.05,
  roughness: 0.22,
  clearcoat: 1.0,
  clearcoatRoughness: 0.08,
  transmission: 0.0,
  transparent: true,
  opacity: 1.0,
  depthWrite: false,
});
const _targetedBulletPool = [];
function _makeTargetedShotVisual() {
  const g = new THREE.Group();

  const core = new THREE.Mesh(bulletGeo, _targetedLaserCoreMat);
  core.layers.set(0);
  g.add(core);

  const glow = new THREE.Mesh(bulletGeo, _targetedLaserGlowMat);
  glow.layers.set(1);
  glow.scale.set(1.55, 1.55, 1.35);
  g.add(glow);

  return g;
}
function _acquireTargetedShotVisual() {
  const g = _targetedBulletPool.pop() || _makeTargetedShotVisual();
  g.visible = true;
  g.traverse(obj => { obj.visible = true; });
  return g;
}
function _releaseTargetedShotVisual(g) {
  if (!g) return;
  scene.remove(g);
  g.visible = false;
  g.traverse(obj => { obj.visible = false; });
  _targetedBulletPool.push(g);
}

function _makeLightningSegment(a, b, radius, material, layer = 0) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len <= 0.0001) return null;

  const geo = new THREE.CylinderGeometry(radius, radius * 1.18, len, 5, 1, false);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_bulletUp, dir.normalize());
  if (layer === 1) mesh.layers.enable(1);
  return { mesh, geo };
}

function _buildLightningPath(start, end, segments, jitter, taper = 1.0) {
  const pts = [start.clone()];
  const dir = new THREE.Vector3().subVectors(end, start);
  const len = Math.max(0.001, dir.length());
  dir.normalize();

  let side = new THREE.Vector3(dir.z, 0, -dir.x);
  if (side.lengthSq() < 0.0001) side.set(1, 0, 0);
  side.normalize();
  const side2 = new THREE.Vector3().crossVectors(dir, side).normalize();

  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    const p = start.clone().lerp(end, t);
    const amp = jitter * (1.0 - t * 0.72) * taper;
    const offA = (Math.random() * 2 - 1) * amp;
    const offB = (Math.random() * 2 - 1) * amp * 0.55;
    p.addScaledVector(side, offA);
    p.addScaledVector(side2, offB);
    pts.push(p);
  }
  pts.push(end.clone());
  return pts;
}

function _spawnLightningFx(pos) {
  if (!state.lightningFx) state.lightningFx = [];

  const root = new THREE.Group();
  root.position.set(pos.x, 0, pos.z);

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xf7fcff,
    transparent: true,
    opacity: 0.98,
    depthWrite: false,
  });
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x8fd8ff,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });

  const geos = [];
  const mats = [coreMat, glowMat];

  const start = new THREE.Vector3(0, 11.2, 0);
  const end = new THREE.Vector3((Math.random() * 2 - 1) * 0.06, 0.45, (Math.random() * 2 - 1) * 0.06);
  const mainPts = _buildLightningPath(start, end, 9, 0.48, 1.0);

  for (let i = 0; i < mainPts.length - 1; i++) {
    const a = mainPts[i];
    const b = mainPts[i + 1];
    const glowSeg = _makeLightningSegment(a, b, 0.0325, glowMat, 1);
    const coreSeg = _makeLightningSegment(a, b, 0.011, coreMat, 0);
    if (glowSeg) { root.add(glowSeg.mesh); geos.push(glowSeg.geo); }
    if (coreSeg) { root.add(coreSeg.mesh); geos.push(coreSeg.geo); }

    if (i > 1 && i < mainPts.length - 2 && Math.random() < 0.72) {
      const branchStart = a.clone().lerp(b, 0.45);
      const branchEnd = branchStart.clone().add(new THREE.Vector3(
        (Math.random() * 2 - 1) * 0.95,
        -(0.5 + Math.random() * 1.1),
        (Math.random() * 2 - 1) * 0.95,
      ));
      const branchPts = _buildLightningPath(branchStart, branchEnd, 4, 0.18, 0.65);
      for (let j = 0; j < branchPts.length - 1; j++) {
        const g = _makeLightningSegment(branchPts[j], branchPts[j + 1], 0.018, glowMat, 1);
        const c = _makeLightningSegment(branchPts[j], branchPts[j + 1], 0.0065, coreMat, 0);
        if (g) { root.add(g.mesh); geos.push(g.geo); }
        if (c) { root.add(c.mesh); geos.push(c.geo); }
      }
    }
  }

  const impactGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.26, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0x92dcff, transparent: true, opacity: 0.55, depthWrite: false })
  );
  impactGlow.position.copy(end);
  impactGlow.layers.enable(1);
  root.add(impactGlow);
  geos.push(impactGlow.geometry);
  mats.push(impactGlow.material);

  scene.add(root);
  state.lightningFx.push({ root, geos, mats, life: 0.17, maxLife: 0.17 });
}

function _updateTargetedShots(worldDelta) {
  if (!Array.isArray(state.targetedShots)) state.targetedShots = [];
  for (let i = state.targetedShots.length - 1; i >= 0; i--) {
    const b = state.targetedShots[i];
    b.life -= worldDelta;
    b.obj.position.x += b.vx * worldDelta;
    b.obj.position.z += b.vz * worldDelta;
    if (b.life <= 0) { _releaseTargetedShotVisual(b.obj); state.targetedShots.splice(i, 1); continue; }
    let hit = false;
    const candidates = queryEnemiesNear(b.obj.position.x, b.obj.position.z, 1.6, _nearbyEnemies);
    for (let n = candidates.length - 1; n >= 0; n--) {
      const e = candidates[n]; if (!e || e.dead) continue;
      const j = state.enemies.indexOf(e); if (j < 0) continue;
      const dx = b.obj.position.x - e.grp.position.x;
      const dz = b.obj.position.z - e.grp.position.z;
      if (dx*dx + dz*dz < 0.78 * 0.78) {
        applyEnemyDamage(e, b.dmg);
        spawnEnemyDamageNum(b.dmg, e);
        updateEliteBar(e);
        if (e.hp <= 0) killEnemy(j);
        _releaseTargetedShotVisual(b.obj);
        state.targetedShots.splice(i, 1);
        hit = true;
        break;
      }
    }
    if (hit) continue;
  }
}

function _updateLightningFx(worldDelta) {
  if (!Array.isArray(state.lightningFx)) state.lightningFx = [];
  for (let i = state.lightningFx.length - 1; i >= 0; i--) {
    const fx = state.lightningFx[i];
    fx.life -= worldDelta;
    if (fx.life <= 0) {
      scene.remove(fx.root);
      for (const geo of (fx.geos || [])) geo.dispose?.();
      for (const mat of (fx.mats || [])) mat.dispose?.();
      state.lightningFx.splice(i, 1);
      continue;
    }
    const a = Math.max(0, fx.life / fx.maxLife);
    for (const mat of (fx.mats || [])) {
      if (!mat) continue;
      const base = mat.color?.getHex?.() === 0xf7fcff ? 0.98 : (mat.color?.getHex?.() === 0x8fd8ff ? 0.62 : 0.55);
      mat.opacity = Math.max(0, base * a);
    }
  }
}

export function updateSecondaryWeapons(worldDelta) {
  _updateTargetedShots(worldDelta);
  _updateLightningFx(worldDelta);

  const tfTier = Math.max(0, state.upg?.targetedFire || 0, state.upg?.targetedCooldown || 0, state.upg?.targetedDamage || 0, state.upg?.targetedRange || 0);
  if (tfTier > 0) {
    state.targetedShotTimer = Math.max(0, (state.targetedShotTimer || 0) - worldDelta);
    if (state.targetedShotTimer <= 0) {
      const baseCdMult = [1.0, 1.0, 0.90, 0.80, 0.70, 0.60][Math.min(tfTier, 5)] || 1.0;
      const targetedSystemsTier = Math.max(0, state.upg?.targetedFire || 0, state.upg?.targetedCooldown || 0, state.upg?.targetedDamage || 0, state.upg?.targetedRange || 0);
      const extraCdMult = Math.pow(0.85, targetedSystemsTier);
      const baseRangeMult = [1.0, 1.0, 1.0, 1.10, 1.10, 1.20][Math.min(tfTier, 5)] || 1.0;
      const extraRangeMult = 1 + (0.15 * targetedSystemsTier);
      const maxRange = 10.0 * baseRangeMult * extraRangeMult;
      const target = _getNearestEnemy(maxRange);
      const cd = Math.max(0.18, 1.4 * baseCdMult * extraCdMult);
      state.targetedShotTimer = cd;
      if (target) {
        const dmg = Math.max(1, Math.round(getBulletDamage() * (1 + 0.15 * targetedSystemsTier)));
        const obj = _acquireTargetedShotVisual();
        const dx = target.grp.position.x - playerGroup.position.x;
        const dz = target.grp.position.z - playerGroup.position.z;
        const dir = new THREE.Vector3(dx, 0, dz).normalize();
        const speed = BULLET_SPEED * 2.2 * (1 + (0.15 * targetedSystemsTier));
        _bulletQ.setFromUnitVectors(_bulletUp, dir);
        obj.quaternion.copy(_bulletQ);
        obj.position.copy(playerGroup.position);
        obj.position.y = floorY(bulletGeoParams);
        scene.add(obj);
        state.targetedShots.push({ obj, vx: dir.x * speed, vz: dir.z * speed, life: maxRange / speed + 0.15, dmg });
      }
    }
  }

  const ltTier = Math.max(0, state.upg?.lightning || 0, state.upg?.lightningDamage || 0, state.upg?.lightningCooldown || 0);
  if (ltTier > 0) {
    state.lightningTimer = Math.max(0, (state.lightningTimer || 0) - worldDelta);
    if (state.lightningTimer <= 0) {
      const lightningBonusTier = Math.max(0, ltTier - 1);
      const cd = Math.max(0.25, 2.4 * Math.pow(0.90, lightningBonusTier));
      state.lightningTimer = cd;
      const strikes = Math.min(5, ltTier);
      const lightningStun = 0.5 + (lightningBonusTier * 0.25);
      const dmg = Math.max(1, Math.round(getBulletDamage() * (1 + 0.15 * lightningBonusTier) * 1.15));
      const pool = state.enemies.filter(e => e && !e.dead).slice();
      if (pool.length > 0) playSound('lightning', 0.78, 1.0);
      pool.sort((a, b) => {
        const adx = a.grp.position.x - playerGroup.position.x; const adz = a.grp.position.z - playerGroup.position.z;
        const bdx = b.grp.position.x - playerGroup.position.x; const bdz = b.grp.position.z - playerGroup.position.z;
        return (adx*adx + adz*adz) - (bdx*bdx + bdz*bdz);
      });
      for (const e of pool.slice(0, strikes)) {
        applyEnemyDamage(e, dmg);
        e.lightningStunTimer = Math.max(e.lightningStunTimer || 0, lightningStun);
        spawnEnemyDamageNum(dmg, e);
        _spawnLightningFx(e.grp.position);
        updateEliteBar(e);
        if (e.hp <= 0) {
          const idx = state.enemies.indexOf(e);
          if (idx >= 0) killEnemy(idx);
        }
      }
    }
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  360° SPIN-SLASH
// ═══════════════════════════════════════════════════════════════════════════════

const S_RANGE   = 5.0;
const S_INNER   = 1.0;
const S_RX      = 1.00;
const S_RZ      = 1.00;
const S_SWEEP   = Math.PI * 2.0;
const S_SWING_T = 0.16;
const S_FADE_T  = 0.14;
const S_Y       = 1.0;

const _sv = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;

const _arcFrag = /* glsl */`
  uniform float uProgress;
  uniform float uWipe;
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    if (vUv.x > uProgress + 0.012) discard;

    float wipe = smoothstep(uWipe - 0.18, uWipe + 0.025, vUv.x);
    if (wipe < 0.001) discard;

    float base  = smoothstep(0.0, 0.035, vUv.x);
    float white = smoothstep(0.52, 1.0, vUv.y);
    float body  = vUv.y * 0.58 + 0.14;
    float outer = exp(-(1.0 - vUv.y)*(1.0 - vUv.y)*44.0);
    float flash = smoothstep(uProgress - 0.10, uProgress, vUv.x) * pow(vUv.y, 0.55) * 0.42;
    float sh    = 0.97 + sin(vUv.x * 26.0 + uTime * 11.0) * 0.02
                       + sin(vUv.x *  9.0 - uTime *  7.0) * 0.015;

    vec3 col = mix(
      mix(uColor * 0.88, vec3(0.82, 0.94, 1.0), white * 0.5),
      vec3(1.0),
      clamp(white * 0.78 + outer * 0.48 + flash, 0.0, 1.0)
    );

    float radialFade = vUv.y;
    float alpha = (body + white*0.50 + outer*0.44 + flash) * sh * base * wipe * radialFade * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

const _SBLUE = new THREE.Vector3(0.25, 0.65, 1.0);
const _SADD  = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
const _mkArc = () => new THREE.ShaderMaterial({
  vertexShader: _sv, fragmentShader: _arcFrag,
  uniforms: { uProgress:{value:0}, uWipe:{value:0}, uFade:{value:1}, uTime:{value:0}, uColor:{value:_SBLUE.clone()} },
  ..._SADD,
});

function _buildEllipseArc(innerR, outerR, rx, rz, startA, sweepA, segs = 120) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = startA + t * sweepA;
    const cx = Math.cos(a), cz = Math.sin(a);
    pos.push(cx * innerR * rx, 0, cz * innerR * rz); uvs.push(t, 0);
    pos.push(cx * outerR * rx, 0, cz * outerR * rz); uvs.push(t, 1);
  }
  for (let i = 0; i < segs; i++) {
    const b = i * 2;
    idx.push(b, b+1, b+2,  b+1, b+3, b+2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(idx);
  return g;
}

function _spinDamage(px, pz, range, dmg) {
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - px, dz = e.grp.position.z - pz;
    if (dx*dx + dz*dz > range*range) continue;
    applyEnemyDamage(e, dmg);
    spawnEnemyDamageNum(dmg, e);
    e.staggerTimer = 0.12;
    updateEliteBar(e);
    if (e.hp <= 0) {
      playSound(e.eliteType ? 'explodeElite' : 'explode', 0.7, 0.9 + Math.random() * 0.2);
      killEnemy(j);
    } else {
      playSound(e.eliteType ? 'elite_hit' : 'standard_hit', 0.35, 0.95 + Math.random() * 0.1);
    }
  }
}

export function performSlash() {
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 8) return;

  state._sf    = ((state._sf | 0) + 1) & 1;
  const startA = Math.PI;
  const sweepA = state._sf ? S_SWEEP : -S_SWEEP;

  const range = S_RANGE, inner = S_INNER;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const y  = playerGroup.position.y + S_Y;

  const arcGeo  = _buildEllipseArc(inner, range, S_RX, S_RZ, startA, sweepA);
  const arcMat  = _mkArc();
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.position.set(px, y - 0.02, pz);
  arcMesh.frustumCulled = false;
  arcMesh.layers.enable(1); arcMesh.layers.enable(2);
scene.add(arcMesh);

    // Slash damage uses the same damage pipeline as player projectiles
  // (base level damage + dmg upgrades + weapon tier multiplier + Double Damage effect).
  // Slash remains a bit stronger than a single projectile by design.
  const slashBase = Math.max(1, getBulletDamage());
  const dmg = Math.max(1, Math.round(slashBase * 1.8));
  _spinDamage(px, pz, range, dmg);
  playSound('laser_sword', 0.72, 0.93 + Math.random() * 0.14);

  state.slashEffects.push({ arcMesh, arcGeo, arcMat, t: 0, startA, sweepA });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    if (s.t >= S_SWING_T + S_FADE_T) {
      scene.remove(s.arcMesh); s.arcGeo.dispose(); s.arcMat.dispose();
      state.slashEffects.splice(i, 1);
      continue;
    }

    const swing = 1.0 - Math.pow(1.0 - Math.min(1.0, s.t / S_SWING_T), 2.0);

    const inFade    = s.t > S_SWING_T;
    const fadePhase = inFade ? (s.t - S_SWING_T) / S_FADE_T : 0.0;
    const fade      = inFade ? Math.pow(1.0 - fadePhase, 0.68) : 1.0;
    const wipe      = inFade ? fadePhase : 0.0;

    const px = playerGroup.position.x;
    const pz = playerGroup.position.z;
    const y  = playerGroup.position.y + S_Y;

    s.arcMesh.position.set(px, y - 0.02, pz);
    s.arcMat.uniforms.uProgress.value = swing;
    s.arcMat.uniforms.uWipe.value     = wipe;
    s.arcMat.uniforms.uFade.value     = fade;
    s.arcMat.uniforms.uTime.value     = (state.elapsed || 0) + s.t;
  }
}

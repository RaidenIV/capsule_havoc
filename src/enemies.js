// ─── enemies.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scene, CAM_D } from './renderer.js';
import { state } from './state.js';
import {
  ENEMY_SPEED, ENEMY_CONTACT_DPS, ENEMY_BULLET_SPEED, ENEMY_BULLET_LIFETIME,
  ENEMY_BULLET_DMG,
  STAGGER_DURATION, SPAWN_FLASH_DURATION, ELITE_FIRE_RATE, ELITE_TYPES, PLAYER_MAX_HP,
  ENEMY_DEFS, ENEMY_TYPE,
} from './constants.js';
import {
  enemyGeo, enemyMat, enemyGeoParams, bulletGeoParams,
  enemyBulletGeo, getEnemyBulletMat, floorY,
} from './materials.js';
import { playerGroup, updateHealthBar, hasShieldBubble, SHIELD_RADIUS, PLAYER_BODY_RADIUS } from './player.js';
import { steerAroundProps, pushOutOfProps, hasLineOfSight } from './terrain.js';
import { spawnEnemyDamageNum, spawnPlayerDamageNum } from './damageNumbers.js';
import { spawnExplosion } from './particles.js';
import { dropLoot } from './pickups.js';
import { updateXP } from './xp.js';
import { getXPRewardForEnemy, getCoinTierForEnemy } from './leveling.js';
import { playSound } from './audio.js';
import { STANDARD_ENEMY_SIZE_MULT } from './constants.js';
import { applyPlayerDamage } from './armor.js';

// Reused quaternion helpers for enemy laser orientation
const _eBulletUp  = new THREE.Vector3(0, 1, 0);
const _eBulletDir = new THREE.Vector3();
const _eBulletQ   = new THREE.Quaternion();

// Back-compat helper:
// Some spawn paths (especially older "eliteType" spawns) expect a getEnemyHP() function.
// In the design-doc system, baseline enemies map to RUSHER (50% of player max HP).
function getEnemyHP() {
  const playerMax = (state.playerMaxHP ?? PLAYER_MAX_HP);
  const basePct = (ENEMY_DEFS?.[ENEMY_TYPE.RUSHER]?.hpPct ?? 0.50);
  return Math.round(playerMax * basePct);
}


const _enemyBulletPool = [];
const ENEMY_HASH_CELL = 4;

function _hashKey(ix, iz) { return `${ix},${iz}`; }
function _hashCoord(v) { return Math.floor(v / ENEMY_HASH_CELL); }

function makeGroundCue(color = 0xffffff, radius = 0.9) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.045, 10, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.0, depthWrite: false })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 0.08;
  mesh.visible = false;
  return mesh;
}

function ensureOrbiterLane() {
  if (state._orbiterLane) return state._orbiterLane;
  const radius = ENEMY_DEFS[ENEMY_TYPE.ORBITER]?.orbitR ?? 6.5;
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(radius, 0.045, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.0, depthWrite: false })
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = 0.06;
  mesh.visible = false;
  scene.add(mesh);
  state._orbiterLane = mesh;
  return mesh;
}

function getShotTellConfig(enemyType, isBoss) {
  if (isBoss || enemyType === ENEMY_TYPE.BOSS) return { prep: 0.34, color: 0xff4444, scale: 1.6 };
  if (enemyType === ENEMY_TYPE.SNIPER) return { prep: 0.58, color: 0xd975ff, scale: 1.45 };
  if (enemyType === ENEMY_TYPE.TANKER) return { prep: 0.42, color: 0xffaa33, scale: 1.75 };
  if (enemyType === ENEMY_TYPE.ORBITER) return { prep: 0.22, color: 0x66ff99, scale: 1.25 };
  if (enemyType === ENEMY_TYPE.SPLITTER) return { prep: 0.28, color: 0x80fb37, scale: 1.5 };
  return { prep: 0.20, color: 0xff8844, scale: 1.3 };
}

function rebuildEnemySpatialHash() {
  const map = new Map();
  for (const e of state.enemies) {
    if (!e || e.dead) continue;
    const ix = _hashCoord(e.grp.position.x);
    const iz = _hashCoord(e.grp.position.z);
    const key = _hashKey(ix, iz);
    let bucket = map.get(key);
    if (!bucket) {
      bucket = [];
      map.set(key, bucket);
    }
    bucket.push(e);
  }
  state.enemySpatialHash = map;
}

const _enemyQuerySeen = new Set();
export function queryEnemiesNear(x, z, radius = 0, out = []) {
  out.length = 0;
  const map = state.enemySpatialHash;
  if (!map) return out;
  _enemyQuerySeen.clear();
  const minX = _hashCoord(x - radius);
  const maxX = _hashCoord(x + radius);
  const minZ = _hashCoord(z - radius);
  const maxZ = _hashCoord(z + radius);
  for (let ix = minX; ix <= maxX; ix++) {
    for (let iz = minZ; iz <= maxZ; iz++) {
      const bucket = map.get(_hashKey(ix, iz));
      if (!bucket) continue;
      for (const e of bucket) {
        if (_enemyQuerySeen.has(e)) continue;
        _enemyQuerySeen.add(e);
        out.push(e);
      }
    }
  }
  return out;
}

export function acquireEnemyBulletVisual(color = 0xff4400) {
  const mesh = _enemyBulletPool.pop() || new THREE.Mesh(enemyBulletGeo, getEnemyBulletMat(color));
  mesh.material = getEnemyBulletMat(color);
  mesh.visible = true;
  mesh.layers.enable(1);
  return mesh;
}

export function releaseEnemyBulletVisual(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.visible = false;
  _enemyBulletPool.push(mesh);
}

function _fireEnemyShot(e, dx, dz, dist) {
  if (!(dist > 0.5)) return;
  const RANGE = ENEMY_BULLET_SPEED * ENEMY_BULLET_LIFETIME * 0.72;
  if (dist >= RANGE) return;
  if (!hasLineOfSight(e.grp.position.x, e.grp.position.z, playerGroup.position.x, playerGroup.position.z)) return;

  const spd = ENEMY_BULLET_SPEED * (e.bulletSpeedMult || 1);
  const dvx = (dx / dist) * spd;
  const dvz = (dz / dist) * spd;
  const bMesh = acquireEnemyBulletVisual(e.enemyType === ENEMY_TYPE.SNIPER ? 0xd975ff : (e.isBoss ? 0xff3333 : 0xff4400));

  _eBulletDir.set(dvx, 0, dvz).normalize();
  _eBulletQ.setFromUnitVectors(_eBulletUp, _eBulletDir);
  bMesh.quaternion.copy(_eBulletQ);
  bMesh.position.copy(e.grp.position);
  bMesh.position.y = floorY(bulletGeoParams);
  scene.add(bMesh);

  const chaosTier = getActiveChaosTier();
  const dmg = ENEMY_BULLET_DMG * (1 + 0.20 * chaosTier) * (e.phase >= 3 ? 1.12 : 1.0);
  state.enemyBullets.push({ mesh: bMesh, vx: dvx, vz: dvz, life: ENEMY_BULLET_LIFETIME, dmg });
  playSound('elite_shoot', 0.5, 0.9 + Math.random() * 0.2);
}

function _maybeAdvanceBossPhase(e) {
  if (!e?.isBoss || !e.maxHp) return;
  const ratio = e.hp / e.maxHp;
  if ((e.phase || 1) < 2 && ratio <= 0.66) {
    e.phase = 2;
    e.fireRate = Math.max(0.35, (e.baseFireRate || e.fireRate || 1.5) * 0.85);
    e.bulletSpeedMult = (e.baseBulletSpeedMult || e.bulletSpeedMult || 1) * 1.12;
    for (let k = 0; k < 3; k++) {
      const a = Math.random() * Math.PI * 2;
      spawnEnemyAtPosition(e.grp.position.x + Math.cos(a) * (2.2 + Math.random() * 1.4), e.grp.position.z + Math.sin(a) * (2.2 + Math.random() * 1.4), ENEMY_TYPE.RUSHER);
    }
  }
  if ((e.phase || 1) < 3 && ratio <= 0.33) {
    e.phase = 3;
    e.fireRate = Math.max(0.28, (e.baseFireRate || e.fireRate || 1.25) * 0.68);
    e.bulletSpeedMult = (e.baseBulletSpeedMult || e.bulletSpeedMult || 1) * 1.25;
    for (let k = 0; k < 2; k++) {
      const a = Math.random() * Math.PI * 2;
      const type = (state.playerLevel || 1) >= 21 ? ENEMY_TYPE.SNIPER : ENEMY_TYPE.TANKER;
      spawnEnemyAtPosition(e.grp.position.x + Math.cos(a) * (2.6 + Math.random() * 1.8), e.grp.position.z + Math.sin(a) * (2.6 + Math.random() * 1.8), type);
    }
  }
}


function getActiveChaosTier() {
  return (state.chaosTimer || 0) > 0 ? Math.max(0, state.curseTier || 0) : 0;
}

function getChaosStatMult() {
  return 1 + 0.20 * getActiveChaosTier();
}

function syncEnemyChaosTier(e) {
  const nextTier = getActiveChaosTier();
  const prevTier = Math.max(0, e.chaosAppliedTier || 0);
  if (prevTier === nextTier) return;
  const prevMult = 1 + 0.20 * prevTier;
  const nextMult = 1 + 0.20 * nextTier;
  const ratio = nextMult / prevMult;
  e.hp = Math.max(1, Math.round((e.hp || 1) * ratio));
  e.maxHp = Math.max(1, Math.round((e.maxHp || 1) * ratio));
  if (Number.isFinite(e.shieldHp) && e.shieldHp > 0) {
    e.shieldHp = Math.max(1, Math.round(e.shieldHp * ratio));
  }
  e.chaosAppliedTier = nextTier;
  try { updateEliteBar(e); } catch {}
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnEnemy(x, z, eliteTypeOrCfg = null) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);

  // eliteTypeOrCfg can be either:
  //  - an eliteType object from ELITE_TYPES, or
  //  - a string ENEMY_TYPE (RUSHER/TANKER/...) from the level-driven system, or
  //  - a config object for bosses/wave spawns (isBoss/color/sizeMult/health/expMult/coinMult/fireRate)

  // If we were passed an ENEMY_TYPE string, convert it to a config object using ENEMY_DEFS.
  // (Previously this was treated like an eliteType object, which produced undefined color/scale,
  // NaN geometry, and "invisible" enemies that could still shoot.)
  let enemyType = null;
  if (typeof eliteTypeOrCfg === 'string' && ENEMY_DEFS[eliteTypeOrCfg]) {
    enemyType = eliteTypeOrCfg;
    const def = ENEMY_DEFS[enemyType];
    eliteTypeOrCfg = {
      isBoss: enemyType === ENEMY_TYPE.BOSS,
      color: def.color,
      sizeMult: def.sizeMult,
      health: Math.round((state.playerMaxHP ?? PLAYER_MAX_HP) * (def.hpPct ?? 1)),
      expMult: 1,
      coinMult: 1,
      fireRate: def.shoot ? def.fireRate : undefined,
      bulletSpeedMult: def.bulletSpeedMult ?? 1,
    };
  }
  const isCfg = !!(eliteTypeOrCfg && (
    eliteTypeOrCfg.isBoss ||
    eliteTypeOrCfg.color !== undefined ||
    eliteTypeOrCfg.sizeMult !== undefined ||
    eliteTypeOrCfg.health !== undefined ||
    eliteTypeOrCfg.expMult !== undefined ||
    eliteTypeOrCfg.coinMult !== undefined ||
    eliteTypeOrCfg.fireRate !== undefined
  ));

  const eliteType = isCfg ? null : eliteTypeOrCfg;
  const cfg       = isCfg ? eliteTypeOrCfg : null;

  const color     = cfg ? (cfg.color ?? 0x888888) : (eliteType ? eliteType.color : 0x888888);
  const scaleMult = cfg ? (cfg.sizeMult ?? 1)     : (eliteType ? eliteType.sizeMult : STANDARD_ENEMY_SIZE_MULT);
  const hpMult    = cfg ? 1                       : (eliteType ? eliteType.hpMult   : 1);
  const expMult   = cfg ? (cfg.expMult ?? 1)      : (eliteType ? eliteType.expMult  : 1);
  const coinMult  = cfg ? (cfg.coinMult ?? 1)     : (eliteType ? eliteType.coinMult : 1);

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

  const curseTier = getActiveChaosTier();
  const curseMult = getChaosStatMult();
  const hp = (cfg && Number.isFinite(cfg.health))
    ? Math.round(cfg.health * curseMult)
    : Math.round(getEnemyHP() * hpMult * curseMult);

  const fireRate = (cfg && Number.isFinite(cfg.fireRate))
    ? cfg.fireRate
    : (eliteType ? (ELITE_FIRE_RATE[eliteType.minLevel] ?? 2.0) : null);

  const isBossBar = !!(cfg && cfg.isBoss) || (enemyType === ENEMY_TYPE.BOSS);

  let eliteBarFill = null;
  if (eliteType || isBossBar) {
    const bWrap = document.createElement('div');
    bWrap.className = 'elite-bar-wrap';
    bWrap.style.width = Math.round((isBossBar ? 84 : 40) + scaleMult * (isBossBar ? 44 : 30)) + 'px';
    const bFill = document.createElement('div');
    bFill.className = 'elite-bar-fill';
    bFill.style.width = '100%';
    // Boss bars are always red; elites keep their red gradient too.
    bFill.style.background = isBossBar
      ? 'linear-gradient(to right,#660000,#ff0000)'
      : 'linear-gradient(to right,#880000,#ff2222)';
    bWrap.appendChild(bFill);
    const bObj = new CSS2DObject(bWrap);
    bObj.position.set(0, (enemyGeoParams.radius + enemyGeoParams.length/2) * scaleMult * 2 + 0.5, 0);
    grp.add(bObj);
    eliteBarFill = bFill;
  }

  const shotCue = makeGroundCue(getShotTellConfig(enemyType, isBossBar).color, (enemyGeoParams.radius * scaleMult) * getShotTellConfig(enemyType, isBossBar).scale);
  grp.add(shotCue);
  const enemyData = {
    grp, mesh, mat, hp, maxHp: hp, dead: false,
    isBoss: isBossBar,
    scaleMult, expMult, coinMult, eliteType, eliteBarFill,
    fireRate, baseFireRate: fireRate,
    shootTimer: fireRate ? Math.random() * fireRate : 0,
    staggerTimer: 0, baseColor: new THREE.Color(color),
    spawnFlashTimer: SPAWN_FLASH_DURATION, matDirty: true,
    enemyType,
    bulletSpeedMult: (cfg && Number.isFinite(cfg.bulletSpeedMult)) ? cfg.bulletSpeedMult : 1,
    baseBulletSpeedMult: (cfg && Number.isFinite(cfg.bulletSpeedMult)) ? cfg.bulletSpeedMult : 1,
    chaosAppliedTier: curseTier,
    shotCue,
    fireTellTimer: 0,
    phase: 1,
  };
  state.enemies.push(enemyData);

  // Spawn fade-in
  mat.transparent = true;
  mat.opacity = 0;
  mesh.castShadow = false;
}



export function spawnEnemyAtPosition(x, z, enemyTypeOrCfg = null) {
  // Only enforce cap if maxEnemies is a positive finite number.
  const isBoss = (enemyTypeOrCfg === ENEMY_TYPE.BOSS) || (typeof enemyTypeOrCfg === 'object' && enemyTypeOrCfg && enemyTypeOrCfg.isBoss);
  if (!isBoss) {
    const regularCount = state.enemies.filter(x => x && !x.dead && !x.isBoss).length;
    if (Number.isFinite(state.maxEnemies) && state.maxEnemies > 0 && regularCount >= state.maxEnemies) return;
  }
  spawnEnemy(x, z, enemyTypeOrCfg);
}

export function spawnEnemyAtEdge(eliteTypeOrCfg = null) {
  // Only enforce cap if maxEnemies is a positive finite number.
  const isBoss = (eliteTypeOrCfg === ENEMY_TYPE.BOSS) || (typeof eliteTypeOrCfg === 'object' && eliteTypeOrCfg && eliteTypeOrCfg.isBoss);
  if (!isBoss) {
    const regularCount = state.enemies.filter(x => x && !x.dead && !x.isBoss).length;
    if (Number.isFinite(state.maxEnemies) && state.maxEnemies > 0 && regularCount >= state.maxEnemies) return;
  }
  const angle = Math.random() * Math.PI * 2;
  const baseR = (Number.isFinite(CAM_D) ? CAM_D : 18) * 1.55;
  const r     = baseR + Math.random() * 4.0;
  spawnEnemyAtPosition(
    playerGroup.position.x + Math.cos(angle) * r,
    playerGroup.position.z + Math.sin(angle) * r,
    eliteTypeOrCfg
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
  const wasBoss = !!(e && (e.isBoss || e.enemyType === ENEMY_TYPE.BOSS));
  if (e?.teleportMarker) {
    try { scene.remove(e.teleportMarker); e.teleportMarker.geometry.dispose(); e.teleportMarker.material.dispose(); } catch {}
    e.teleportMarker = null;
  }
  spawnExplosion(e.grp.position, e.eliteType);
  removeCSS2DFromGroup(e.grp);
  scene.remove(e.grp);
  e.dead = true;
  state.enemies.splice(j, 1);

  // Boss bookkeeping (boss does not count toward cap; respawns after delay)
  if (wasBoss) {
    state.bossAlive = false;
    if (state.spawn && Number.isFinite(state.spawn.bossCooldown)) {
      state.spawn.bossCooldown = 10.0;
    } else {
      state.bossRespawnTimer = 10.0;
    }

    // Boss chest drop (design doc Section 10)
    // Tier by level: 1-10 standard, 11-20 rare, 21+ epic.
    const tier = (state.playerLevel <= 10) ? 'standard' : (state.playerLevel <= 20 ? 'rare' : 'epic');
    // Lazy import to avoid circular deps
    import('./pickups.js').then(m => m.spawnChest?.(e.grp.position, tier)).catch(()=>{});

    // Boss wave luck bonus: +5 at levels 10/20/30
    if (state.playerLevel === 10 || state.playerLevel === 20 || state.playerLevel === 30) {
      state.bossLuck = (state.bossLuck || 0) + 5;
    }
  }

  // Ultra Elite split (doc Section 2)
  if (e && e.enemyType === ENEMY_TYPE.SPLITTER) {
    const min = (ENEMY_DEFS[ENEMY_TYPE.SPLITTER]?.splitCountMin ?? 2);
    const max = (ENEMY_DEFS[ENEMY_TYPE.SPLITTER]?.splitCountMax ?? 3);
    const n = min + Math.floor(Math.random() * (max - min + 1));
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.9 + Math.random() * 1.4;
      spawnEnemyAtPosition(e.grp.position.x + Math.cos(a)*r, e.grp.position.z + Math.sin(a)*r, ENEMY_TYPE.RUSHER);
    }
  }

  state.kills++;
  if (killsEl) killsEl.textContent = state.kills;

  // Coins (tiered)
  const tier = getCoinTierForEnemy(e.enemyType);
  dropLoot(e.grp.position, tier.value, (e.coinMult || 1), tier.color);

  // XP (tiered + Growth bonus handled in getXPRewardForEnemy)
  const xpGained  = getXPRewardForEnemy(e.enemyType, state.playerLevel);
  const prevLevel = state.playerLevel;
  updateXP(xpGained);

  if (state.playerLevel > prevLevel) {
    if (_onLevelUp) _onLevelUp(state.playerLevel);
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

export function updateEnemies(delta, worldDelta, elapsed) {
  let contactThisFrame = false;
  let orbiterAlive = false;
  const lane = ensureOrbiterLane();
  const sepCandidates = [];

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (!e || e.dead) continue;
    syncEnemyChaosTier(e);
    _maybeAdvanceBossPhase(e);

    const dx   = playerGroup.position.x - e.grp.position.x;
    const dz   = playerGroup.position.z - e.grp.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    const et = e.enemyType;

    if (et === ENEMY_TYPE.ORBITER) orbiterAlive = true;

    if (e.spawnFlashTimer > 0) {
      e.spawnFlashTimer = Math.max(0, e.spawnFlashTimer - worldDelta);
      const progress = 1 - e.spawnFlashTimer / SPAWN_FLASH_DURATION;
      e.mat.opacity = progress;
      if (e.spawnFlashTimer <= 0) {
        e.mat.transparent = false;
        e.mat.opacity = 1;
        e.mat.needsUpdate = true;
        e.mesh.castShadow = true;
      }
    }
    const fullySpawned = e.spawnFlashTimer <= 0;

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
    } else if (e.matDirty) {
      e.mat.color.copy(e.baseColor);
      e.mat.emissive.setRGB(0, 0, 0);
      e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
      e.matDirty = false;
    }

    const blackHoleSuppressed = !!e.blackHoleSuppressed;

    // Teleporter readability: mark destination first, then blink.
    if (et === ENEMY_TYPE.TELEPORTER) {
      const thresh = (ENEMY_DEFS[ENEMY_TYPE.TELEPORTER]?.teleportWhenBelow ?? 0.5);
      e._tpCD = Math.max(0, e._tpCD || 0);
      if (e.teleportPending) {
        e.teleportPending.timer -= worldDelta;
        if (e.teleportMarker) {
          e.teleportMarker.visible = true;
          e.teleportMarker.material.opacity = Math.min(0.85, e.teleportPending.timer / Math.max(0.01, e.teleportPending.maxTimer));
          e.teleportMarker.rotation.z += worldDelta * 4.0;
        }
        e.mesh.visible = false;
        if (e.teleportPending.timer <= 0) {
          e.grp.position.set(e.teleportPending.x, 0, e.teleportPending.z);
          e.mesh.visible = true;
          e._tpCD = 4.0;
          if (e.teleportMarker) { scene.remove(e.teleportMarker); e.teleportMarker.geometry.dispose(); e.teleportMarker.material.dispose(); e.teleportMarker = null; }
          e.teleportPending = null;
        }
      } else {
        e._tpCD = Math.max(0, e._tpCD - worldDelta);
        if (e._tpCD <= 0 && e.maxHp > 0 && (e.hp / e.maxHp) <= thresh) {
          const ang = Math.random() * Math.PI * 2;
          const rr  = (Number.isFinite(CAM_D) ? CAM_D : 18) * 1.7 + 6;
          const tx = playerGroup.position.x + Math.cos(ang) * rr;
          const tz = playerGroup.position.z + Math.sin(ang) * rr;
          const marker = makeGroundCue(0xe0e0e0, enemyGeoParams.radius * (e.scaleMult || 1) * 2.1);
          marker.position.set(tx, 0.08, tz);
          marker.visible = true;
          marker.material.opacity = 0.75;
          scene.add(marker);
          e.teleportMarker = marker;
          e.teleportPending = { x: tx, z: tz, timer: 0.42, maxTimer: 0.42 };
        }
      }
    }

    // Shot telegraph / firing cadence.
    if (fullySpawned && e.fireRate && !e.dead && !blackHoleSuppressed) {
      const tell = getShotTellConfig(et, e.isBoss);
      if ((e.fireTellTimer || 0) > 0) {
        e.fireTellTimer = Math.max(0, e.fireTellTimer - worldDelta);
        if (e.shotCue) {
          e.shotCue.visible = true;
          const pulse = 0.45 + 0.55 * (1 - e.fireTellTimer / Math.max(0.01, tell.prep));
          e.shotCue.material.opacity = pulse * 0.85;
          e.shotCue.scale.setScalar(1.0 + (1 - e.fireTellTimer / Math.max(0.01, tell.prep)) * 0.22);
        }
        e.mat.emissive.setHex(tell.color);
        e.mat.emissiveIntensity = 1.1 + (1 - e.fireTellTimer / Math.max(0.01, tell.prep)) * (et === ENEMY_TYPE.TANKER ? 2.2 : 1.6);
        if (e.fireTellTimer <= 0) {
          _fireEnemyShot(e, dx, dz, dist);
          e.shootTimer = (e.fireRate || 1.5) * (0.8 + Math.random() * 0.4);
          if (e.shotCue) { e.shotCue.visible = false; e.shotCue.material.opacity = 0; e.shotCue.scale.setScalar(1); }
          if (e.staggerTimer <= 0) {
            e.mat.emissive.setRGB(0, 0, 0);
            e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
          }
        }
      } else {
        if (e.shotCue) { e.shotCue.visible = false; e.shotCue.material.opacity = 0; e.shotCue.scale.setScalar(1); }
        if (e.staggerTimer <= 0) {
          e.mat.emissive.setRGB(0, 0, 0);
          e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
        }
        e.shootTimer -= worldDelta;
        const RANGE = ENEMY_BULLET_SPEED * ENEMY_BULLET_LIFETIME * 0.72;
        if (e.shootTimer <= tell.prep && dist > 0.5 && dist < RANGE && hasLineOfSight(e.grp.position.x, e.grp.position.z, playerGroup.position.x, playerGroup.position.z)) {
          e.fireTellTimer = tell.prep;
        }
      }
    } else if (e.shotCue) {
      e.shotCue.visible = false;
      e.shotCue.material.opacity = 0;
      if (e.staggerTimer <= 0) {
        e.mat.emissive.setRGB(0, 0, 0);
        e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
      }
    }

    // Movement (per-type behavior)
    if (!e.teleportPending && dist > 0.01 && e.staggerTimer <= 0) {
      const eR = enemyGeoParams.radius * (e.scaleMult || 1);
      let { sx, sz } = steerAroundProps(
        e.grp.position.x, e.grp.position.z,
        playerGroup.position.x, playerGroup.position.z,
        eR, state.enemies, i
      );

      let spdMult = 1.0;
      if (et === ENEMY_TYPE.TANKER) spdMult = 0.90;
      if (et === ENEMY_TYPE.SPLITTER) spdMult = 0.80;
      if (et === ENEMY_TYPE.BOSS || e.isBoss) spdMult = 0.90;

      if (et === ENEMY_TYPE.ORBITER) {
        const orbitR = (ENEMY_DEFS[ENEMY_TYPE.ORBITER]?.orbitR ?? 6.5);
        const rx = dx / dist;
        const rz = dz / dist;
        const tx = -rz;
        const tz = rx;
        const radialErr = (dist - orbitR);
        const radialBias = Math.max(-1, Math.min(1, radialErr / 2.5));
        sx = tx * 0.9 + rx * radialBias * 0.6;
        sz = tz * 0.9 + rz * radialBias * 0.6;
        const len = Math.hypot(sx, sz) || 1;
        sx /= len; sz /= len;
        spdMult = 1.05;
      } else if (et === ENEMY_TYPE.SNIPER) {
        const desired = 14.0;
        if (dist < desired) {
          sx = -dx / dist;
          sz = -dz / dist;
          spdMult = 1.05;
        } else {
          spdMult = 0.85;
        }
      }

      e.grp.position.x += sx * ENEMY_SPEED * spdMult * worldDelta;
      e.grp.position.z += sz * ENEMY_SPEED * spdMult * worldDelta;
    }
    pushOutOfProps(e.grp.position, enemyGeoParams.radius * (e.scaleMult || 1));

    const eFloorY = (enemyGeoParams.radius + enemyGeoParams.length / 2) * (e.scaleMult || 1);
    e.mesh.position.y  = eFloorY + Math.sin(elapsed * 3 + i) * 0.05;
    e.grp.rotation.y   = Math.atan2(dx, dz);

    const pr = PLAYER_BODY_RADIUS * 1.02;
    const shieldRadius = hasShieldBubble() ? SHIELD_RADIUS : pr;
    const er = enemyGeoParams.radius * (e.scaleMult || 1) * 1.02;
    const minD = shieldRadius + er;
    if (!e.teleportPending && dist < minD && dist > 1e-6) {
      contactThisFrame = true;
      const nx = dx/dist, nz = dz/dist;
      const push = (minD - dist) * 0.55;
      e.grp.position.x -= nx * push; e.grp.position.z -= nz * push;
      playerGroup.position.x += nx * push; playerGroup.position.z += nz * push;
      state.contactDmgTimer = Math.max(0, (state.contactDmgTimer || 0) - worldDelta);
      if (state.contactDmgTimer <= 0) {
        const CONTACT_HIT_INTERVAL = 1.0;
        state.contactDmgTimer = CONTACT_HIT_INTERVAL;
        if (!blackHoleSuppressed && !(state.invincible || state.dashInvincible || (state.effects?.invincibility || 0) > 0)) {
          if ((state.shieldCharges || 0) > 0) {
            if ((state.shieldHitCD || 0) <= 0) {
              state.shieldCharges -= 1;
              state.shieldHitCD = 0.6;
              if (state.shieldCharges <= 0) {
                const tier = Math.max(0, state.upg?.shield || 0);
                const base = 12.0;
                const rt = tier >= 4 ? base * 0.45 : ((tier >= 2) ? base * 0.65 : base);
                state.shieldRecharge = rt;
              }
              playSound('shield_break', 0.65, 1.0);
            }
          } else {
            const chaosTier = getActiveChaosTier();
            const dmg = ENEMY_CONTACT_DPS * CONTACT_HIT_INTERVAL * (1 + 0.20 * chaosTier);
            const res = applyPlayerDamage(dmg, 'contact');
            if (res.applied > 0) {
              spawnPlayerDamageNum(Math.round(res.applied));
              playSound('player_hit', 0.6, 0.95 + Math.random() * 0.1);
            }
            if (res.died) return 'DEAD';
          }
        }
      }
    }
  }

  if (!contactThisFrame) state.contactDmgTimer = 0;

  lane.visible = orbiterAlive;
  if (orbiterAlive) {
    lane.position.set(playerGroup.position.x, 0.06, playerGroup.position.z);
    lane.material.opacity = 0.18 + Math.sin(elapsed * 2.8) * 0.05;
    lane.rotation.z += worldDelta * 0.2;
  }

  rebuildEnemySpatialHash();
  for (let i = 0; i < state.enemies.length; i++) {
    const a = state.enemies[i]; if (!a || a.dead) continue;
    const ra = enemyGeoParams.radius * (a.scaleMult || 1) * 1.05;
    const candidates = queryEnemiesNear(a.grp.position.x, a.grp.position.z, ra + 3.0, sepCandidates);
    for (const b of candidates) {
      if (!b || b.dead || b === a) continue;
      const j = state.enemies.indexOf(b);
      if (j <= i) continue;
      const rb   = enemyGeoParams.radius * (b.scaleMult || 1) * 1.05;
      const minD = ra + rb + 1.0;
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
  rebuildEnemySpatialHash();
}

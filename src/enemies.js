// ─── enemies.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scene, CAM_D } from './renderer.js';
import { state } from './state.js';
import {
  ENEMY_SPEED, ENEMY_CONTACT_DPS, ENEMY_BULLET_SPEED, ENEMY_BULLET_LIFETIME,
  STAGGER_DURATION, SPAWN_FLASH_DURATION, ELITE_FIRE_RATE, ELITE_TYPES, PLAYER_MAX_HP,
  ENEMY_TYPE, ENEMY_DEFS, getBossScaleForLevel, isBossLevel, getActiveEnemyTypesForLevel, getEnemyCapForLevel, getPlayerMaxHPForLevel,
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
import { updateXP, getXPPerKill, getCoinValue, getEnemyHP } from './xp.js';
import { playSound } from './audio.js';
import { STANDARD_ENEMY_SIZE_MULT } from './constants.js';

// Reused quaternion helpers for enemy laser orientation
const _eBulletUp  = new THREE.Vector3(0, 1, 0);
const _eBulletDir = new THREE.Vector3();
const _eBulletQ   = new THREE.Quaternion();


function _resolveEnemyCfg(typeOrCfg){
  if (!typeOrCfg) return { type: ENEMY_TYPE.RUSHER, def: ENEMY_DEFS[ENEMY_TYPE.RUSHER], cfg: null };
  if (typeof typeOrCfg === 'string' && ENEMY_DEFS[typeOrCfg]) return { type: typeOrCfg, def: ENEMY_DEFS[typeOrCfg], cfg: null };
  // support existing eliteType objects / legacy cfg objects
  return { type: null, def: null, cfg: typeOrCfg };
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
export function spawnEnemy(x, z, eliteTypeOrCfg = null) {
  const grp = new THREE.Group();
  grp.position.set(x, 0, z);

  const resolved = _resolveEnemyCfg(eliteTypeOrCfg);
  const enemyType = resolved.type;
  const def = resolved.def;

  // eliteTypeOrCfg can be either:
  //  - an eliteType object from ELITE_TYPES, or
  //  - a config object for bosses/wave spawns (isBoss/color/sizeMult/health/expMult/coinMult/fireRate)
  const isCfg = !!(resolved.cfg && (
    eliteTypeOrCfg.isBoss ||
    eliteTypeOrCfg.color !== undefined ||
    eliteTypeOrCfg.sizeMult !== undefined ||
    eliteTypeOrCfg.health !== undefined ||
    eliteTypeOrCfg.expMult !== undefined ||
    eliteTypeOrCfg.coinMult !== undefined ||
    eliteTypeOrCfg.fireRate !== undefined
  ));

  const eliteType = (enemyType || isCfg) ? null : eliteTypeOrCfg;
  const cfg       = isCfg ? resolved.cfg : null;

  const color     = def ? def.color : (cfg ? (cfg.color ?? 0x888888) : (eliteType ? eliteType.color : 0x888888));
  const scaleMult = def ? def.sizeMult : (cfg ? (cfg.sizeMult ?? 1) : (eliteType ? eliteType.sizeMult : STANDARD_ENEMY_SIZE_MULT));
  const hpMult    = def ? 1 : (cfg ? 1 : (eliteType ? eliteType.hpMult : 1));
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

  const hp = (cfg && Number.isFinite(cfg.health))
    ? Math.round(cfg.health)
    : (def
        ? Math.max(1, Math.round((state.playerMaxHP ?? getPlayerMaxHPForLevel(state.playerLevel)) * def.hpPct))
        : Math.round(getEnemyHP() * hpMult));

  const fireRate = (cfg && Number.isFinite(cfg.fireRate))
    ? cfg.fireRate
    : (def && def.shoot ? (def.fireRate ?? 2.2) : (eliteType ? (ELITE_FIRE_RATE[eliteType.minLevel] ?? 2.0) : null));

  let eliteBarFill = null;
  if (eliteType) {
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

  const shieldHp = def && Number.isFinite(def.shieldPct)
    ? Math.max(0, Math.round((state.playerMaxHP ?? getPlayerMaxHPForLevel(state.playerLevel)) * def.shieldPct))
    : 0;

  state.enemies.push({
    grp, mesh, mat, hp, maxHp: hp, dead: false,
    enemyType, def,
    scaleMult, expMult, coinMult, eliteType, eliteBarFill,
    fireRate, shootTimer: fireRate ? Math.random() * fireRate : 0,
    contactPct: def ? def.contactPct : null,
    bulletPct: def ? def.bulletPct : null,
    bulletSpeedMult: def ? (def.bulletSpeedMult ?? 1) : 1,
    orbitR: def ? def.orbitR : null,
    teleportWhenBelow: def ? def.teleportWhenBelow : null,
    teleportTimer: 0,
    shieldHp,
    shieldMax: shieldHp,
    splitCountMin: def ? def.splitCountMin : null,
    splitCountMax: def ? def.splitCountMax : null,
    staggerTimer: 0, baseColor: new THREE.Color(color),
    spawnFlashTimer: SPAWN_FLASH_DURATION, matDirty: true,
  });

  // Spawn fade-in
  mat.transparent = true;
  mat.opacity = 0;
  mesh.castShadow = false;
}


export function spawnEnemyAtEdge(eliteTypeOrCfg = null) {
  // Only enforce cap if maxEnemies is a positive finite number.
  if (Number.isFinite(state.maxEnemies) && state.maxEnemies > 0 && state.enemies.length >= state.maxEnemies) return;

  let choice = eliteTypeOrCfg;
  if (!choice) {
    const types = getActiveEnemyTypesForLevel(state.playerLevel);
    choice = types[(Math.random() * types.length) | 0];
  }

  const angle = Math.random() * Math.PI * 2;
  const baseR = (Number.isFinite(CAM_D) ? CAM_D : 18) * 1.55;
  const r     = baseR + Math.random() * 4.0;
  spawnEnemy(
    playerGroup.position.x + Math.cos(angle) * r,
    playerGroup.position.z + Math.sin(angle) * r,
    choice
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

  if (e.shieldMax && e.shieldHp > 0) {
    const pct = Math.max(0, (e.shieldHp / e.shieldMax) * 100);
    e.eliteBarFill.style.width = pct + '%';
    e.eliteBarFill.style.background = 'linear-gradient(to right,#00aaff,#00e5ff)';
    e.eliteBarFill.style.boxShadow = '0 0 10px rgba(0,229,255,0.35)';
  } else {
    const pct = Math.max(0, (e.hp / e.maxHp) * 100);
    e.eliteBarFill.style.width = pct + '%';
    e.eliteBarFill.style.background = 'linear-gradient(to right,#880000,#ff2222)';
    e.eliteBarFill.style.boxShadow = 'none';
  }
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

  // Splitter: spawn 2–3 rushers on death (design doc)
  if (e.enemyType === ENEMY_TYPE.SPLITTER) {
    const nMin = e.splitCountMin ?? 2;
    const nMax = e.splitCountMax ?? 3;
    const n = nMin + ((Math.random() * (nMax - nMin + 1)) | 0);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = 1.2 + Math.random() * 1.0;
      spawnEnemy(e.grp.position.x + Math.cos(a) * rr, e.grp.position.z + Math.sin(a) * rr, ENEMY_TYPE.RUSHER);
    }
  }

  // Boss: allow main.js to trigger victory banners if you still use them
  if (e.enemyType === ENEMY_TYPE.BOSS) {
    state.bossAlive = false;
    state.bossRespawnTimer = 6.0;
    if (_triggerVictory) _triggerVictory();
  }

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
          const spd = ENEMY_BULLET_SPEED * (e.bulletSpeedMult || 1);
          const dvx = (dx/dist) * spd;
          const dvz = (dz/dist) * spd;
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
          const dmgPct = (Number.isFinite(e.bulletPct) ? e.bulletPct : null);
          const dmg = dmgPct ? dmgPct * (state.playerMaxHP ?? PLAYER_MAX_HP) : null;
          state.enemyBullets.push({ mesh: bMesh, mat: bMat, vx: dvx, vz: dvz, life: ENEMY_BULLET_LIFETIME, dmg });
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
      let spd = ENEMY_SPEED;
      if (e.enemyType === ENEMY_TYPE.TANKER || e.enemyType === ENEMY_TYPE.SPLITTER) spd *= 0.70;
      if (e.enemyType === ENEMY_TYPE.SNIPER) spd *= 0.85;

      // Orbiter: tangential motion around player at radius
      if (e.enemyType === ENEMY_TYPE.ORBITER && Number.isFinite(e.orbitR)) {
        const rx = e.grp.position.x - playerGroup.position.x;
        const rz = e.grp.position.z - playerGroup.position.z;
        const rlen = Math.sqrt(rx*rx + rz*rz) || 1e-6;
        const tx = -rz / rlen;
        const tz =  rx / rlen;
        // radial correction toward desired orbit radius
        const corr = (rlen - e.orbitR) * 0.35;
        const cx = (rx / rlen) * corr;
        const cz = (rz / rlen) * corr;
        e.grp.position.x += (tx - cx) * spd * worldDelta;
        e.grp.position.z += (tz - cz) * spd * worldDelta;
      } else if (e.enemyType === ENEMY_TYPE.SNIPER) {
        // Sniper: maintain distance, strafe
        const desired = (Number.isFinite(CAM_D) ? CAM_D : 18) * 1.35;
        const rdx = dx / dist, rdz = dz / dist;
        const tooClose = dist < desired * 0.95;
        const tooFar   = dist > desired * 1.15;
        const strafeX  = -rdz;
        const strafeZ  =  rdx;
        const away = tooClose ? -1 : 0;
        const toward = tooFar ? 1 : 0;
        e.grp.position.x += (rdx * toward + rdx * away + strafeX * 0.75) * spd * worldDelta;
        e.grp.position.z += (rdz * toward + rdz * away + strafeZ * 0.75) * spd * worldDelta;
      } else {
        e.grp.position.x += sx * spd * worldDelta;
        e.grp.position.z += sz * spd * worldDelta;
      }
    }
    pushOutOfProps(e.grp.position, enemyGeoParams.radius * (e.scaleMult || 1));

    // Teleporter: begins teleporting when below threshold HP
    if (e.enemyType === ENEMY_TYPE.TELEPORTER && Number.isFinite(e.teleportWhenBelow)) {
      if (e.hp <= e.maxHp * e.teleportWhenBelow) {
        e.teleportTimer -= worldDelta;
        if (e.teleportTimer <= 0) {
          e.teleportTimer = 1.35 + Math.random() * 0.75;
          const ang = Math.random() * Math.PI * 2;
          const baseR = (Number.isFinite(CAM_D) ? CAM_D : 18) * 1.15;
          const rr = baseR + (Math.random() * 4.0);
          e.grp.position.x = playerGroup.position.x + Math.cos(ang) * rr;
          e.grp.position.z = playerGroup.position.z + Math.sin(ang) * rr;
        }
      }
    }

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
        const pct = Number.isFinite(e.contactPct) ? e.contactPct : null;
        const perHit = pct ? pct * (state.playerMaxHP ?? PLAYER_MAX_HP) : (ENEMY_CONTACT_DPS * 0.5);
        const dps = perHit / 0.5;
        const dmg = dps * worldDelta;
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
      const minD = ra + rb + 1.0;   // maintain 1.0-unit gap between enemies
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

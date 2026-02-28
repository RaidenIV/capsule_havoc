// ─── weapons.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  BULLET_SPEED, BULLET_LIFETIME, ENEMY_BULLET_DMG, WEAPON_CONFIG,
  SLASH_RADIUS, SLASH_ARC, SLASH_DAMAGE, SLASH_DURATION,
} from './constants.js';
import { bulletGeo, bulletMat, bulletGeoParams, floorY } from './materials.js';
import { playerGroup, updateHealthBar } from './player.js';
import { pushOutOfProps } from './terrain.js';
import { spawnPlayerDamageNum, spawnEnemyDamageNum } from './damageNumbers.js';
import { killEnemy, updateEliteBar } from './enemies.js';
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

function getOrbitRingDefsByTier(tier) {
  const C = WEAPON_CONFIG;
  const idx = Math.min(Math.max((tier || 1) - 1, 0), C.length - 1);
  const ring = (ci, flip = false) => ({
    count: C[ci][3],
    radius: C[ci][4],
    speed: C[ci][5] * (flip ? -1 : 1),
    color: C[ci][6],
  });

  // No orbit bullets until config index >= 2 (tier 3+)
  if (idx < 2) return [];

  switch (idx) {
    case 2:  return [ring(2)];
    case 3:  return [ring(3)];
    case 4:  return [ring(4)];
    case 5:  return [ring(5)];
    case 6:  return [ring(6), ring(2, true)];
    case 7:  return [ring(7), ring(3, true)];
    case 8:  return [ring(8), ring(4, true)];
    case 9:  return [ring(9), ring(5, true)];
    default: return [ring(10), ring(6, true)];
  }
}

export function destroyOrbitBullets() {
  state.orbitRings.forEach(ring =>
    ring.meshes.forEach(m => { scene.remove(m); m.material.dispose(); })
  );
  state.orbitRings.length = 0;
  state.orbitHitActive.clear();
}

export function syncOrbitBullets() {
  destroyOrbitBullets();
  for (const def of getOrbitRingDefsByTier(state.weaponTier || 1)) {
    const meshes = [];
    for (let i = 0; i < def.count; i++) {
      const mesh = new THREE.Mesh(bulletGeo, makeOrbitMat(def.color));
      mesh.layers.enable(1);
      scene.add(mesh);
      meshes.push(mesh);
    }
    state.orbitRings.push({ def, meshes, angle: 0 });
  }
}

// ── Shoot bullet wave ─────────────────────────────────────────────────────────
const _bulletUp  = new THREE.Vector3(0, 1, 0);
const _bulletDir = new THREE.Vector3();
const _bulletQ   = new THREE.Quaternion();

export function shootBulletWave() {
  const dirs = getWaveBullets();
  const dmg  = getBulletDamage();
  playSound('shoot', 0.45, 0.92 + Math.random() * 0.16); // slight pitch variation
  for (let i = 0; i < dirs; i++) {
    const angle = state.bulletWaveAngle + (i / dirs) * Math.PI * 2;
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vz = Math.sin(angle) * BULLET_SPEED;
    const mesh = new THREE.Mesh(bulletGeo, bulletMat);
    mesh.layers.enable(1);
    _bulletDir.set(vx, 0, vz).normalize();
    _bulletQ.setFromUnitVectors(_bulletUp, _bulletDir);
    mesh.quaternion.copy(_bulletQ);
    mesh.position.copy(playerGroup.position);
    mesh.position.y = floorY(bulletGeoParams);
    scene.add(mesh);
    state.bullets.push({ mesh, vx, vz, life: BULLET_LIFETIME, dmg });
  }
}

// ── Update player bullets ─────────────────────────────────────────────────────
import { propColliders } from './terrain.js';

export function updateBullets(worldDelta) {
  for (let i = state.bullets.length - 1; i >= 0; i--) {
    const b = state.bullets[i];
    b.life -= worldDelta;
    b.mesh.position.x += b.vx * worldDelta;
    b.mesh.position.z += b.vz * worldDelta;
    if (b.life <= 0) { scene.remove(b.mesh); b.mesh.geometry.dispose(); state.bullets.splice(i, 1); continue; }

    // Prop collision
    let dead = false;
    for (const c of propColliders) {
      const dx = b.mesh.position.x - c.wx, dz = b.mesh.position.z - c.wz;
      if (dx*dx + dz*dz < (c.radius + 0.045) * (c.radius + 0.045)) {
        scene.remove(b.mesh); state.bullets.splice(i, 1); dead = true; break;
      }
    }
    if (dead) continue;

    // Enemy collision
    let hit = false;
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j]; if (e.dead) continue;
      const dx = b.mesh.position.x - e.grp.position.x;
      const dz = b.mesh.position.z - e.grp.position.z;
      if (dx*dx + dz*dz < 0.75*0.75) {
        e.hp -= b.dmg;
        spawnEnemyDamageNum(b.dmg, e);
        e.staggerTimer = 0.12;
        updateEliteBar(e);
        scene.remove(b.mesh); state.bullets.splice(i, 1); hit = true;
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
export function updateEnemyBullets(worldDelta) {
  for (let i = state.enemyBullets.length - 1; i >= 0; i--) {
    const b = state.enemyBullets[i];
    b.life -= worldDelta;
    b.mesh.position.x += b.vx * worldDelta;
    b.mesh.position.z += b.vz * worldDelta;
    if (b.life <= 0) { scene.remove(b.mesh); state.enemyBullets.splice(i, 1); continue; }

    const pdx = b.mesh.position.x - playerGroup.position.x;
    const pdz = b.mesh.position.z - playerGroup.position.z;
    if (pdx*pdx + pdz*pdz < 0.36) {
      playSound('player_hit', 0.7, 0.95 + Math.random() * 0.1);
      if (!state.invincible) {
        state.playerHP -= ENEMY_BULLET_DMG;
        spawnPlayerDamageNum(ENEMY_BULLET_DMG);
        updateHealthBar();
        if (state.playerHP <= 0) return 'DEAD';
      }
      scene.remove(b.mesh); state.enemyBullets.splice(i, 1);
      continue;
    }

    let blocked = false;
    for (const c of propColliders) {
      const cdx = b.mesh.position.x - c.wx, cdz = b.mesh.position.z - c.wz;
      if (cdx*cdx + cdz*cdz < (c.radius + 0.14) * (c.radius + 0.14)) { blocked = true; break; }
    }
    if (blocked) { scene.remove(b.mesh); state.enemyBullets.splice(i, 1); }
  }
}

// ── Update orbit bullets ──────────────────────────────────────────────────────
export function updateOrbitBullets(worldDelta) {
  const y    = floorY(bulletGeoParams);
  const dmg  = getBulletDamage();
  const hr2  = 0.75 * 0.75;

  for (let ri = 0; ri < state.orbitRings.length; ri++) {
    const ring = state.orbitRings[ri];
    ring.angle += ring.def.speed * worldDelta;
    const { count, radius } = ring.def;
    for (let i = 0; i < ring.meshes.length; i++) {
      const angle = ring.angle + (i / count) * Math.PI * 2;
      ring.meshes[i].position.set(
        playerGroup.position.x + Math.cos(angle) * radius, y,
        playerGroup.position.z + Math.sin(angle) * radius
      );
      ring.meshes[i].rotation.y += 5 * worldDelta;
    }
    for (let j = state.enemies.length - 1; j >= 0; j--) {
      const e = state.enemies[j]; if (e.dead) continue;
      for (let k = 0; k < ring.meshes.length; k++) {
        const dx = ring.meshes[k].position.x - e.grp.position.x;
        const dz = ring.meshes[k].position.z - e.grp.position.z;
        const inContact = dx*dx + dz*dz < hr2;
        const key = ri * 65536 + k * 512 + j;
        const was = state.orbitHitActive.has(key);
        if (inContact && !was) {
          state.orbitHitActive.add(key);
          e.hp -= dmg;
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
// ── Slash attack ──────────────────────────────────────────────────────────────
// ── Slash layer factory ────────────────────────────────────────────────────────
// Each layer is a RingGeometry arc rebuilt every frame as the sweep progresses.
// innerR/outerR: blade thickness  color: emissive colour  baseOpacity: max alpha
function _makeSlashLayer(innerR, outerR, color, baseOpacity) {
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // Start with a zero-arc placeholder geometry
  const geo  = new THREE.RingGeometry(innerR, outerR, 48, 1, 0, 0.001);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.layers.enable(2); // bloom layer
  return { mesh, mat, innerR, outerR, baseOpacity };
}

export function performSlash() {
  const facingAngle = Math.atan2(state.lastMoveX, state.lastMoveZ);
  const halfArc     = SLASH_ARC / 2;
  const startAngle  = facingAngle - halfArc;
  const dmg         = Math.round(SLASH_DAMAGE * (getBulletDamage() / 10));

  // Three layers — outer blue halo, mid cyan, bright white core
  const outer = _makeSlashLayer(0.3,               SLASH_RADIUS + 0.35, 0x0033ff, 0.45);
  const mid   = _makeSlashLayer(0.35,              SLASH_RADIUS,        0x00ccff, 0.70);
  const core  = _makeSlashLayer(SLASH_RADIUS - 0.18, SLASH_RADIUS + 0.05, 0xffffff, 0.95);

  // Leading-edge tip: a small bright cap at the front of the sweep
  const tipMat  = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const tipGeo  = new THREE.RingGeometry(SLASH_RADIUS - 0.1, SLASH_RADIUS + 0.1, 24, 1, 0, 0.18);
  const tipMesh = new THREE.Mesh(tipGeo, tipMat);
  tipMesh.rotation.x = -Math.PI / 2;
  tipMesh.layers.enable(2);

  const pos = playerGroup.position.clone();
  pos.y = 0.12;

  [outer.mesh, mid.mesh, core.mesh, tipMesh].forEach(m => {
    m.position.copy(pos);
    scene.add(m);
  });

  state.slashEffects.push({
    layers: [outer, mid, core],
    tipMesh, tipMat,
    startAngle,
    totalArc: SLASH_ARC,
    life:     SLASH_DURATION,
    maxLife:  SLASH_DURATION,
    hitDone:  false,
    dmg,
    facingAngle,
    halfArc,
  });

  // Damage lands at the midpoint of the sweep (feels snappier than on hit-spawn)
  // We schedule it via a flag checked in update instead of doing it here so the
  // swing has visually crossed the enemy before damage numbers appear.
}

export function updateSlashEffects(worldDelta) {
  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.life -= worldDelta;

    if (s.life <= 0) {
      // Clean up all meshes
      s.layers.forEach(l => {
        scene.remove(l.mesh);
        l.mesh.geometry.dispose();
        l.mat.dispose();
      });
      scene.remove(s.tipMesh);
      s.tipMesh.geometry.dispose();
      s.tipMat.dispose();
      state.slashEffects.splice(i, 1);
      continue;
    }

    const progress = 1 - (s.life / s.maxLife); // 0 → 1 over duration

    // Sweep opens over the first 55% of duration, then holds and fades
    const SWEEP_FRAC = 0.55;
    const sweepT  = Math.min(1, progress / SWEEP_FRAC);
    // Ease-out: fast start, slows at end of swing
    const easedT  = 1 - Math.pow(1 - sweepT, 2.2);
    const curArc  = s.totalArc * easedT;

    // Fade: opacity starts dropping after sweep completes
    const fadeT   = Math.max(0, (progress - SWEEP_FRAC) / (1 - SWEEP_FRAC));
    const opacityMult = 1 - Math.pow(fadeT, 1.4);

    // Rebuild arc geometries with current swept angle
    s.layers.forEach(l => {
      l.mesh.geometry.dispose();
      l.mesh.geometry = new THREE.RingGeometry(
        l.innerR, l.outerR, 48, 1, s.startAngle, Math.max(0.001, curArc)
      );
      l.mat.opacity = l.baseOpacity * opacityMult;
    });

    // Tip cap sits at the leading edge of the sweep
    const tipAngle = s.startAngle + curArc - 0.09;
    s.tipMesh.geometry.dispose();
    s.tipMesh.geometry = new THREE.RingGeometry(
      SLASH_RADIUS - 0.1, SLASH_RADIUS + 0.1, 24, 1, tipAngle, 0.18
    );
    // Tip is brightest early in swing, fades fast
    s.tipMat.opacity = Math.max(0, (1 - fadeT * 2.5) * opacityMult);

    // Deal damage at 40% through the swing (blade has crossed most enemies by then)
    if (!s.hitDone && progress >= 0.4) {
      s.hitDone = true;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (e.dead) continue;
        const dx   = e.grp.position.x - playerGroup.position.x;
        const dz   = e.grp.position.z - playerGroup.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > SLASH_RADIUS) continue;

        let angleDiff = Math.atan2(dx, dz) - s.facingAngle;
        while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (Math.abs(angleDiff) > s.halfArc) continue;

        e.hp -= s.dmg;
        spawnEnemyDamageNum(s.dmg, e);
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
  }
}

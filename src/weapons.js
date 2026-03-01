// ─── weapons.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  BULLET_SPEED, BULLET_LIFETIME, ENEMY_BULLET_DMG, WEAPON_CONFIG,
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

function getOrbitRingDefs(level) {
  const C  = WEAPON_CONFIG;
  const ring = (lv, flip = false) => ({
    count: C[lv][3], radius: C[lv][4], speed: C[lv][5] * (flip ? -1 : 1), color: C[lv][6],
  });
  switch (level) {
    case 0: case 1: return [];
    case 2: return [ring(2)];
    case 3: return [ring(3)];
    case 4: return [ring(4)];
    case 5: return [ring(5)];
    case 6:  return [ring(6),  ring(3, true)];
    case 7:  return [ring(7),  ring(4, true)];
    case 8:  return [ring(8),  ring(5, true)];
    case 9:  return [ring(9),  ring(6, true)];
    case 10: return [ring(10), ring(6, true)];
    default: return [ring(Math.min(level, 10))];
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
  for (const def of getOrbitRingDefs(state.playerLevel)) {
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


// ── Vampire Survivors–style slash (Whip lane cleave) ──────────────────────────
// Visual: bright core + warm glow streak (straight lane), very short lifetime.
// Behavior: alternates left/right each cast; damage applied once on spawn.
const VS_SLASH_RANGE     = 8.5;   // world units
const VS_SLASH_THICKNESS = 0.14;  // mesh thickness (visual)
const VS_SLASH_LANE_W    = 1.25;  // hit lane half-width*2 (gameplay)
const VS_SLASH_LIFE      = 0.18;  // seconds

const _vsVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _vsFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uTint;
  varying vec2 vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main() {
    float x  = clamp(vUv.x, 0.0, 1.0);          // along slash
    float cy = abs(vUv.y - 0.5) * 2.0;          // across slash

    // VS whip read: bright interior with soft warm halo
    float core = exp(-cy * cy * 260.0);         // white core
    float glow = exp(-cy * cy * 28.0);          // warm halo
    float taper = 1.0 - smoothstep(0.88, 1.0, x) * 0.92;
    float base  = smoothstep(0.0, 0.06, x);

    float n = hash21(vec2(x * 26.0, uTime * 0.75));
    float flicker = 0.92 + 0.16 * n;

    vec3 col = core * vec3(1.0) + glow * uTint * 1.35;
    float alpha = (core * 2.8 + glow * 1.05) * taper * base * uFade * flicker;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeVSMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vsVert,
    fragmentShader: _vsFrag,
    uniforms: {
      uFade: { value: 1.0 },
      uTime: { value: 0.0 },
      // Warm pale gold like VS whip on dark background
      uTint: { value: new THREE.Vector3(1.0, 0.92, 0.70) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _ensureSlashState() {
  if (!state.slashEffects) state.slashEffects = [];
  if (!Number.isFinite(state._vsSlashFlip)) state._vsSlashFlip = 0;
}

function _applyVSLaneDamage(origin, ux, uz, range, laneW, dmg) {
  const ox = origin.x, oz = origin.z;
  const halfW = laneW * 0.5;
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;

    const ex = e.grp.position.x;
    const ez = e.grp.position.z;

    const dx = ex - ox;
    const dz = ez - oz;

    // Along-lane distance
    const t = dx * ux + dz * uz;
    if (t < 0 || t > range) continue;

    // Perpendicular distance to lane center
    const px = dx - t * ux;
    const pz = dz - t * uz;
    const perp = Math.sqrt(px*px + pz*pz);
    if (perp > halfW) continue;

    // Hit
    e.hp -= dmg;
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
  _ensureSlashState();

  // Direction aligned to camera "screen horizontal" (roughly right-left in iso):
  // right vector approx ( +1, 0, -1 ). Alternate right/left each cast.
  state._vsSlashFlip ^= 1;
  const flip = state._vsSlashFlip ? 1 : -1;

  const ux = (1 / Math.sqrt(2)) * flip;
  const uz = (-1 / Math.sqrt(2)) * flip;

  const range = VS_SLASH_RANGE;
  const thickness = VS_SLASH_THICKNESS;

  // Visual mesh: long thin plane
  const geo = new THREE.PlaneGeometry(range, thickness);
  const mat = _makeVSMat();
  const mesh = new THREE.Mesh(geo, mat);

  // Default PlaneGeometry is XY; rotate to ground (XZ)
  mesh.rotation.x = -Math.PI / 2;

  // Place centered in front of player along lane direction
  const cx = playerGroup.position.x + ux * (range * 0.5);
  const cz = playerGroup.position.z + uz * (range * 0.5);
  const y  = floorY(bulletGeoParams) + 0.06;
  mesh.position.set(cx, y, cz);

  // Rotate around Y so the plane's local +X aligns with lane direction
  mesh.rotation.y = Math.atan2(uz, ux);

  // Keep on base layer and bloom layer (if used)
  mesh.layers.enable(1);
  mesh.layers.enable(2);

  scene.add(mesh);

  // Damage (instantaneous feel)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.15));
  _applyVSLaneDamage(playerGroup.position, ux, uz, range, VS_SLASH_LANE_W, dmg);

  // Cap to avoid runaway if something goes wrong
  if (state.slashEffects.length > 20) {
    const old = state.slashEffects.shift();
    if (old) { scene.remove(old.mesh); old.geo.dispose(); old.mat.dispose(); }
  }

  state.slashEffects.push({ mesh, geo, mat, t: 0, life: VS_SLASH_LIFE });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    // Very quick fade like VS whip
    const fade = Math.max(0.0, 1.0 - (s.t / s.life));
    s.mat.uniforms.uFade.value = fade;
    s.mat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    // Keep anchored to player (so slowmo/pauses don't desync visually)
    // Compute current lane direction from flip stored in state at spawn time is not tracked;
    // but for this VFX, keeping world-space is fine. Do not re-anchor.

    if (s.t >= s.life) {
      scene.remove(s.mesh);
      s.geo.dispose();
      s.mat.dispose();
      state.slashEffects.splice(i, 1);
    }
  }
}


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


// ── Vampire Survivors–style "Whip Slash" (lane cleave) ────────────────────────
// Visual: fast horizontal lash (straight lane) with bright core + soft glow.
// Behavior: short-lived, instantaneous-feeling cleave. Alternates left/right.
//
// NOTE: loop.js is expected to call performSlash() to trigger and
// updateSlashEffects(worldDelta) every tick.

const _vsSlashVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _vsSlashFrag = /* glsl */`
  uniform float uFade;   // 1..0
  uniform float uTime;
  uniform vec3  uTint;   // warm tint
  varying vec2  vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    // Along slash: 0 = start near player, 1 = tip
    float x  = clamp(vUv.x, 0.0, 1.0);
    float cy = abs(vUv.y - 0.5) * 2.0; // 0 center, 1 edge

    // White-hot core + warm glow
    float core = exp(-cy * cy * 220.0);
    float glow = exp(-cy * cy * 24.0);

    // Tip taper + slight flicker
    float taper = 1.0 - smoothstep(0.88, 1.0, x) * 0.9;
    float base  = smoothstep(0.0, 0.06, x);

    float n = hash21(vec2(x * 28.0, uTime * 0.6));
    float flicker = 0.92 + 0.16 * n;

    vec3 col = core * vec3(1.0) + glow * uTint * 1.4;
    float alpha = (core * 2.2 + glow * 0.85) * taper * base * uFade * flicker;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeVSSlashMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vsSlashVert,
    fragmentShader: _vsSlashFrag,
    uniforms: {
      uFade: { value: 1.0 },
      uTime: { value: 0.0 },
      // Warm off-white / pale gold (reads like VS whip streak on dark bg)
      uTint: { value: new THREE.Vector3(1.0, 0.92, 0.70) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

// Private: apply cleave once (simple sector test)
function _applyVSSlashDamage(center, dirAngle, range, arc, dmg) {
  const half = arc * 0.5;
  const cx = center.x, cz = center.z;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const dx = e.mesh.position.x - cx;
    const dz = e.mesh.position.z - cz;
    const d2 = dx*dx + dz*dz;
    if (d2 > range*range) continue;

    const a = Math.atan2(dz, dx);
    let da = a - dirAngle;
    while (da > Math.PI) da -= Math.PI * 2.0;
    while (da < -Math.PI) da += Math.PI * 2.0;
    if (Math.abs(da) > half) continue;

    // Hit
    e.hp -= dmg;
    spawnEnemyDamageNum(e.mesh.position, dmg, false);
    if (e.hp <= 0) killEnemy(i, e, 'slash');
  }
}

export function performSlash() {
  // Create container if older state doesn't have it
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 12) return; // sanity cap

  // Alternate direction left/right like VS whip
  state._vsSlashFlip = (state._vsSlashFlip || 0) ^ 1;
  const flip = state._vsSlashFlip ? 1 : -1;

  // In this game bullets orbit around player; use a "forward" slash along camera diagonal-ish
  // We pick a lane relative to player: 45° / -135° alternating feels good in iso view.
  const baseAngle = Math.PI * 0.25; // 45°
  const dirAngle = baseAngle + (flip < 0 ? Math.PI : 0.0);

  const len = SLASH_RADIUS;              // reuse existing constant as reach
  const thickness = 0.10;                // thin lane
  const geo = new THREE.PlaneGeometry(len, thickness);

  const mat = _makeVSSlashMat();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.enable(2); // bloom layer if present

  // Anchor at player; offset forward so it reads as "in front" lash
  const ox = Math.cos(dirAngle) * (len * 0.5);
  const oz = Math.sin(dirAngle) * (len * 0.5);
  mesh.position.set(playerGroup.position.x + ox, floorY({ size: thickness }) + 0.06, playerGroup.position.z + oz);
  mesh.rotation.y = -dirAngle; // plane's +X points right; rotate so it faces lane

  scene.add(mesh);

  // Apply damage once at start (instantaneous feel)
  _applyVSSlashDamage(playerGroup.position, dirAngle, len, SLASH_HIT_ARC || (Math.PI/3), SLASH_DAMAGE);

  state.slashEffects.push({
    mesh, geo, mat,
    t: 0,
    life: Math.max(0.14, Math.min(SLASH_DURATION || 0.20, 0.30)),
  });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;
  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    // Quick fade; VS slash is very brief
    const fade = 1.0 - (s.t / s.life);
    s.mat.uniforms.uFade.value = Math.max(0.0, fade);
    s.mat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    if (s.t >= s.life) {
      scene.remove(s.mesh);
      s.geo.dispose();
      s.mat.dispose();
      state.slashEffects.splice(i, 1);
    }
  }
}

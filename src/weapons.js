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
// Visual: fast horizontal lash (straight lane) with bright core + warm glow.
// Behavior: brief, instantaneous-feeling cleave in a lane. Alternates direction.

const VS_SLASH_LIFE      = 0.18;          // seconds
const VS_SLASH_RANGE     = 7.5;           // world units (reach)
const VS_SLASH_THICKNESS = 0.14;          // world units (visual thickness)
const VS_SLASH_ARC       = Math.PI / 3;   // 60° lane width (hit arc)

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
    float x  = clamp(vUv.x, 0.0, 1.0);
    float cy = abs(vUv.y - 0.5) * 2.0;

    float core = exp(-cy * cy * 260.0);    // white-hot core
    float glow = exp(-cy * cy * 28.0);     // soft halo

    float taper = 1.0 - smoothstep(0.86, 1.0, x) * 0.9;
    float base  = smoothstep(0.0, 0.05, x);

    float n = hash21(vec2(x * 26.0, uTime * 0.7));
    float flicker = 0.93 + 0.14 * n;

    vec3 col = core * vec3(1.0) + glow * uTint * 1.35;
    float alpha = (core * 2.4 + glow * 0.95) * taper * base * uFade * flicker;

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

function _wrapPi(a){
  while (a > Math.PI) a -= Math.PI * 2.0;
  while (a < -Math.PI) a += Math.PI * 2.0;
  return a;
}

// Apply cleave once (sector test)
function _applyVSSlashDamage(center, dirAngle, range, arc, dmg) {
  const half = arc * 0.5;
  const cx = center.x, cz = center.z;
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    const ex = e.mesh.position.x;
    const ez = e.mesh.position.z;
    const dx = ex - cx;
    const dz = ez - cz;
    const d2 = dx*dx + dz*dz;
    if (d2 > range*range) continue;

    const a = Math.atan2(dz, dx);
    const da = _wrapPi(a - dirAngle);
    if (Math.abs(da) > half) continue;

    // Hit
    e.hp -= dmg;
    spawnEnemyDamageNum(e.mesh.position, dmg, false);
    if (e.hp <= 0) killEnemy(i, e, 'slash');
  }
}

// Exported: triggered by input (loop.js expects this export)
export function performSlash() {
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 12) return;

  // Alternate direction like VS whip (left/right)
  state._vsSlashFlip = (state._vsSlashFlip || 0) ^ 1;
  const flip = state._vsSlashFlip ? 1 : -1;

  // For isometric-ish camera, a diagonal lane reads best.
  // We alternate 45° and 225° (opposite).
  const baseAngle = Math.PI * 0.25;
  const dirAngle = baseAngle + (flip < 0 ? Math.PI : 0.0);

  const len = VS_SLASH_RANGE;
  const thickness = VS_SLASH_THICKNESS;

  const geo = new THREE.PlaneGeometry(len, thickness);
  const mat = _makeVSSlashMat();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.layers.enable(2);

  // Place the plane so its center sits half-range away from player in dirAngle
  const ox = Math.cos(dirAngle) * (len * 0.5);
  const oz = Math.sin(dirAngle) * (len * 0.5);
  const y  = floorY({ size: thickness }) + 0.06;

  mesh.position.set(playerGroup.position.x + ox, y, playerGroup.position.z + oz);
  // Plane local +X goes right; rotate so +X aligns with lane direction
  mesh.rotation.y = -dirAngle;

  scene.add(mesh);

  // Damage once (instantaneous snap feel)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.25));
  _applyVSSlashDamage(playerGroup.position, dirAngle, len, VS_SLASH_ARC, dmg);

  state.slashEffects.push({ mesh, geo, mat, t: 0, life: VS_SLASH_LIFE });
}

// Exported: called each tick (loop.js expects this export)
export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

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


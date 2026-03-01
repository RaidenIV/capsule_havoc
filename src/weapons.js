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


// ── Cinematic lightsaber swing slash (procedural, no sprites) ──────────────────
// Requirements:
// - White-hot core + electric-blue halo blade
// - Overexposed triangular motion-smear wedge
// - Additive blending, transparent, depthWrite off, bloom-friendly
// Tweaks per user:
// - Slash moves 2x faster (shorter swing duration)
// - Afterimage wedge is half as wide

const SABER_SLASH_RANGE = 9.0;
const SABER_SLASH_ARC   = Math.PI * 0.42;  // hit arc (about 75°)
const SABER_SWING_T     = 0.06;            // 2x faster than 0.12s
const SABER_FADE_T      = 0.10;
const SABER_AFTER_CT    = 4;

// Blade shader
const _saberVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _saberBladeFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2 vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    float x  = clamp(vUv.x, 0.0, 1.0);
    float cy = abs(vUv.y - 0.5) * 2.0;

    float core = exp(-cy * cy * 720.0);
    float glow = exp(-cy * cy * 58.0);

    float n = hash21(vec2(x * 34.0, uTime * 0.65));
    float ripple = 0.92 + 0.14 * n;

    float taper = 1.0 - smoothstep(0.88, 1.0, x) * 0.78;
    float base  = smoothstep(0.0, 0.04, x);
    float tipBoost = mix(0.90, 1.25, smoothstep(0.25, 1.0, x));

    vec3  col   = core * vec3(1.0) + glow * uColor * (3.0 * ripple) * tipBoost;
    float alpha = (core * 3.2 + glow * 1.55) * taper * base * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// Wedge smear shader (cone). Half width tweak implemented via halfW *= 0.5
const _saberWedgeFrag = /* glsl */`
  uniform float uProgress;
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2 vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    float x  = clamp(vUv.x, 0.0, 1.0);
    float cy = abs(vUv.y - 0.5) * 2.0;

    // Triangular taper wedge: wide near hilt, narrow at tip
    float halfW = mix(0.95, 0.12, pow(x, 0.65));
    halfW *= 0.5; // <-- half as wide per request
    float wedge = 1.0 - smoothstep(halfW - 0.03, halfW + 0.03, cy);

    // Segment behind leading edge
    float lead = clamp(uProgress + 0.02, 0.0, 1.0);
    float tail = clamp(uProgress - 0.22, 0.0, 1.0);
    float seg  = smoothstep(tail, tail + 0.02, x) * (1.0 - smoothstep(lead, lead + 0.02, x));

    float m = wedge * seg;
    if (m < 0.002) discard;

    float core = exp(-cy * cy * 44.0);
    float glow = exp(-cy * cy * 10.0);

    float n = hash21(vec2(x * 18.0, uTime * 0.35));
    float ripple = 0.92 + 0.16 * n;
    float edgeBoost = mix(0.90, 1.18, smoothstep(0.0, 1.0, (x - tail) / max(lead - tail, 1e-4)));

    vec3 col = core * vec3(1.0) * 1.05 + glow * uColor * (2.3 * ripple) * edgeBoost;
    float alpha = (core * 0.85 + glow * 0.70) * m * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeSaberBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _saberVert,
    fragmentShader: _saberBladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uTime:  { value: 0.0 },
      uColor: { value: new THREE.Vector3(0.25, 0.65, 1.0) }, // electric blue
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _makeSaberWedgeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _saberVert,
    fragmentShader: _saberWedgeFrag,
    uniforms: {
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uTime:     { value: 0.0 },
      uColor:    { value: new THREE.Vector3(0.25, 0.65, 1.0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _applySlashDamage(origin, dirAngle, range, arc, dmg) {
  const ox = origin.x, oz = origin.z;
  const half = arc * 0.5;
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;

    const ex = e.grp.position.x;
    const ez = e.grp.position.z;

    const dx = ex - ox;
    const dz = ez - oz;
    const d2 = dx*dx + dz*dz;
    if (d2 > range*range) continue;

    const a = Math.atan2(dz, dx);
    let da = a - dirAngle;
    while (da > Math.PI) da -= Math.PI * 2.0;
    while (da < -Math.PI) da += Math.PI * 2.0;
    if (Math.abs(da) > half) continue;

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
  // state.slashEffects expected by loop.js
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 12) return;

  // Alternate direction for visual variety (screen-horizontal-ish in iso view)
  state._saberFlip = (state._saberFlip || 0) ^ 1;
  const flip = state._saberFlip ? 1 : -1;

  // direction along (+1,-1) in XZ (roughly screen horizontal)
  const dirAngle = Math.atan2(-1, 1) + (flip < 0 ? Math.PI : 0.0);

  const range = SABER_SLASH_RANGE;
  const y = floorY(bulletGeoParams) + 0.08;

  // Blade mesh: long thin plane on ground
  const bladeGeo = new THREE.PlaneGeometry(range, 0.14);
  const bladeMat = _makeSaberBladeMat();
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.rotation.x = -Math.PI / 2;
  blade.rotation.y = dirAngle;
  blade.layers.enable(1);
  blade.layers.enable(2);

  const cx = playerGroup.position.x + Math.cos(dirAngle) * (range * 0.5);
  const cz = playerGroup.position.z + Math.sin(dirAngle) * (range * 0.5);
  blade.position.set(cx, y, cz);
  blade.frustumCulled = false;
  scene.add(blade);

  // Wedge smear: larger plane, same orientation
  const wedgeGeo = new THREE.PlaneGeometry(range, range * 0.90);
  const wedgeMat = _makeSaberWedgeMat();
  const wedge = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedge.rotation.x = -Math.PI / 2;
  wedge.rotation.y = dirAngle;
  wedge.layers.enable(1);
  wedge.layers.enable(2);
  wedge.position.set(cx, y + 0.01, cz);
  wedge.frustumCulled = false;
  scene.add(wedge);

  // Afterimage blades (lagged)
  const after = [];
  for (let i = 0; i < SABER_AFTER_CT; i++) {
    const am = _makeSaberBladeMat();
    const m = new THREE.Mesh(bladeGeo, am);
    m.rotation.x = -Math.PI / 2;
    m.rotation.y = dirAngle;
    m.layers.enable(1);
    m.layers.enable(2);
    m.position.set(cx, y, cz);
    m.frustumCulled = false;
    scene.add(m);
    after.push({ mesh: m, mat: am });
  }

  // Damage once at mid swing (very fast)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.2));
  _applySlashDamage(playerGroup.position, dirAngle, range, SABER_SLASH_ARC, dmg);

  state.slashEffects.push({
    blade, bladeGeo, bladeMat,
    wedge, wedgeGeo, wedgeMat,
    after,
    t: 0,
    swingT: SABER_SWING_T,
    fadeT: SABER_FADE_T,
    dirAngle,
    origin: { x: playerGroup.position.x, z: playerGroup.position.z },
  });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    const swing = Math.min(1.0, s.t / s.swingT);
    const fade = s.t <= s.swingT ? 1.0 : Math.max(0.0, 1.0 - (s.t - s.swingT) / s.fadeT);

    // Keep anchored to player position (looks better in motion/slowmo)
    const range = SABER_SLASH_RANGE;
    const y = floorY(bulletGeoParams) + 0.08;
    const cx = playerGroup.position.x + Math.cos(s.dirAngle) * (range * 0.5);
    const cz = playerGroup.position.z + Math.sin(s.dirAngle) * (range * 0.5);

    s.blade.position.set(cx, y, cz);
    s.wedge.position.set(cx, y + 0.01, cz);

    s.bladeMat.uniforms.uFade.value = fade;
    s.bladeMat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    s.wedgeMat.uniforms.uProgress.value = swing;
    s.wedgeMat.uniforms.uFade.value = fade * 0.90;
    s.wedgeMat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    // Afterimages: increasing lag, decreasing alpha
    for (let k = 0; k < s.after.length; k++) {
      const t = (k + 1) / (s.after.length + 1);
      const lag = (0.20 + 0.10 * t) * (1.0 - swing);
      const a = s.dirAngle - lag;
      s.after[k].mesh.rotation.y = a;
      s.after[k].mesh.position.set(cx, y, cz);
      s.after[k].mat.uniforms.uFade.value = fade * (0.34 - 0.06 * k);
      s.after[k].mat.uniforms.uTime.value = (state.elapsed || 0) + s.t + 0.04 * k;
    }

    if (fade <= 0.001) {
      scene.remove(s.blade); s.bladeGeo.dispose(); s.bladeMat.dispose();
      scene.remove(s.wedge); s.wedgeGeo.dispose(); s.wedgeMat.dispose();
      for (const a of s.after) { scene.remove(a.mesh); a.mat.dispose(); }
      state.slashEffects.splice(i, 1);
    }
  }
}


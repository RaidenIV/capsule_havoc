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



// ── Lightsaber Slash (procedural, no textures) ───────────────────────────────
//
// Some versions of loop.js import performSlash. Provide it here to avoid module
// import errors, and to enable a Star Wars–style swing VFX.

const SLASH_DURATION   = 0.22;   // total lifetime (s)
const SLASH_SWING_TIME = 0.12;   // extend / rotate (s)
const SLASH_FADE_TIME  = 0.10;   // fade (s)
const SLASH_RADIUS     = 3.2;    // reach (world units)
const SLASH_THICKNESS  = 0.12;   // main blade quad thickness

const _sweepVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _sweepFrag = /* glsl */`
  uniform float uProgress; // 0..1 during swing
  uniform float uFade;     // 1..0 during fade
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    float x  = clamp(vUv.x, 0.0, 1.0);
    float cy = abs(vUv.y - 0.5) * 2.0;

    // Triangular cone mask: wide near hilt, narrow near tip
    float halfW = mix(0.98, 0.10, pow(x, 0.62));
    float wedge = 1.0 - smoothstep(halfW - 0.02, halfW + 0.02, cy);

    // Segment behind leading edge (motion persistence)
    float lead = clamp(uProgress + 0.03, 0.0, 1.0);
    float tail = clamp(uProgress - 0.28, 0.0, 1.0);
    float seg  = smoothstep(tail, tail + 0.02, x) * (1.0 - smoothstep(lead, lead + 0.02, x));

    float m = wedge * seg;
    if (m < 0.002) discard;

    float core = exp(-cy * cy * 28.0);
    float glow = exp(-cy * cy * 6.0);

    float n = hash21(vec2(x * 16.0, uTime * 0.35));
    float ripple = 0.92 + 0.16 * n;

    vec3 col = core * vec3(1.0) * 1.05 + glow * uColor * (2.8 * ripple);
    float alpha = (core * 0.95 + glow * 0.75) * m * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

const _bladeVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _bladeFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    float cy = abs(vUv.y - 0.5) * 2.0;

    // Saber look: hard white core + saturated blue halo
    float core = exp(-cy * cy * 700.0);
    float glow = exp(-cy * cy * 45.0);

    float n = hash21(vec2(vUv.x * 26.0, uTime * 0.65));
    float ripple = 0.92 + 0.14 * n;

    // Round/taper tip a little
    float taper = 1.0 - smoothstep(0.88, 1.0, vUv.x) * 0.65;

    vec3 col = core * vec3(1.0) + glow * uColor * (3.6 * ripple);
    float alpha = (core * 3.2 + glow * 1.9) * taper * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeSweepMat(){
  return new THREE.ShaderMaterial({
    vertexShader: _sweepVert,
    fragmentShader: _sweepFrag,
    uniforms: {
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uTime:     { value: 0.0 },
      uColor:    { value: new THREE.Vector3(0.25, 0.65, 1.0) }, // blue
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _makeBladeMat(){
  return new THREE.ShaderMaterial({
    vertexShader: _bladeVert,
    fragmentShader: _bladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uTime:  { value: 0.0 },
      uColor: { value: new THREE.Vector3(0.25, 0.65, 1.0) }, // blue
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _bearingToRotY(a){
  // Your codebase uses bearing angles in radians around Y
  return -a + Math.PI * 0.5;
}

// Public: used by loop.js in some versions
export function performSlash(startAngle = 0, endAngle = Math.PI * 0.8){
  if (!scene || !playerGroup) return;

  state.slashEffects ||= [];

  const slashY = floorY ?? 0;

  const sweepGeo  = new THREE.PlaneGeometry(SLASH_RADIUS, SLASH_RADIUS * 0.95);
  const sweepMat  = _makeSweepMat();
  const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
  sweepMesh.position.set(playerGroup.position.x, slashY + 0.055, playerGroup.position.z);
  sweepMesh.rotation.y = _bearingToRotY(startAngle);
  scene.add(sweepMesh);

  const bladeGeo  = new THREE.PlaneGeometry(SLASH_RADIUS, SLASH_THICKNESS);
  const bladeMat  = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.set(playerGroup.position.x, slashY + 0.06, playerGroup.position.z);
  bladeMesh.rotation.y = _bearingToRotY(startAngle);
  scene.add(bladeMesh);

  state.slashEffects.push({
    elapsed: 0,
    startAngle,
    endAngle,
    sweepMesh, sweepGeo, sweepMat,
    bladeMesh, bladeGeo, bladeMat,
  });
}

// Public: call this once per tick to animate/fade and clean up
export function updateSlashEffects(delta){
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--){
    const s = state.slashEffects[i];
    s.elapsed += delta;

    const swing = Math.min(1, s.elapsed / SLASH_SWING_TIME);
    const fadeT = Math.max(0, (s.elapsed - SLASH_SWING_TIME) / Math.max(0.0001, SLASH_FADE_TIME));
    const fade = 1.0 - Math.min(1, fadeT);

    const cur = s.startAngle + (s.endAngle - s.startAngle) * swing;

    // Anchor to player
    const slashY = floorY ?? 0;
    s.sweepMesh.position.set(playerGroup.position.x, slashY + 0.055, playerGroup.position.z);
    s.bladeMesh.position.set(playerGroup.position.x, slashY + 0.06, playerGroup.position.z);

    s.sweepMesh.rotation.y = _bearingToRotY(cur);
    s.bladeMesh.rotation.y = _bearingToRotY(cur);

    s.sweepMat.uniforms.uProgress.value = swing;
    s.sweepMat.uniforms.uFade.value     = (swing < 1.0 ? 1.0 : fade) * 0.9;
    s.sweepMat.uniforms.uTime.value     = (state.elapsed || 0) + s.elapsed;

    s.bladeMat.uniforms.uFade.value = (swing < 1.0 ? 1.0 : fade) * 1.0;
    s.bladeMat.uniforms.uTime.value = (state.elapsed || 0) + s.elapsed;

    if (s.elapsed >= SLASH_DURATION){
      scene.remove(s.sweepMesh); s.sweepGeo.dispose(); s.sweepMat.dispose();
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      state.slashEffects.splice(i, 1);
    }
  }
}

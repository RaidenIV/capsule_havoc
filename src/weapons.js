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

// ═══════════════════════════════════════════════════════════════════════════════
//  360° OVOID SPIN-SLASH
//
//  The blade sweeps a full ~350° circle around the player in an OVOID path
//  (wider on X, narrower on Z) so it hits enemies on all sides.
//
//  Layers:
//    1. arc   – ring-sector BufferGeometry, elliptical (RX ≠ RZ), world-baked
//    2. bloom – wide gaussian plane, rotates + stretches with ellipse each frame
//    3. blade – solid white rod, same rotation/scale as bloom
//    4. after – 3 lagged bloom echoes trailing behind the blade
//
//  THREE.JS ROTATION NOTE:
//    PlaneGeometry(len, w) after rotation.x=-PI/2:  local X = blade long axis
//    rotation.y = -angle  →  local +X points toward world (cos angle, 0, sin angle)
//    We also set mesh.scale.x each frame to match the ellipse stretch at that angle.
// ═══════════════════════════════════════════════════════════════════════════════

// Tune these
const S_RANGE   = 5.0;            // outer radius (-25%)
const S_INNER   = 1.0;             // gap between player body and blade start
const S_RX      = 2.00;             // ellipse X scale (world X axis)
const S_RZ      = 1.00;             // circular (equal axes = blade stays radially aligned)
const S_SWEEP   = Math.PI * 1.94;   // ~349° sweep — nearly full circle
const S_SWING_T = 0.22;             // time to complete the full spin
const S_FADE_T  = 0.18;             // fade-out duration
const S_Y       = 1.0;              // player y offset (half capsule height)
const S_AFTERS  = 3;                // number of afterimage echoes

// ── Shared vertex shader ──────────────────────────────────────────────────────
const _sv = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;

// ── 1. Arc trail shader ───────────────────────────────────────────────────────
//  UV.x = 0(swing start / tail) → 1(leading edge / current blade pos)
//  UV.y = 0(inner radius)       → 1(outer radius / cutting edge)
//  Filled solid glow — the whole swept area is bright, not edge-only.
const _arcFrag = /* glsl */`
  uniform float uProgress; // 0→1: leading-edge reveal
  uniform float uWipe;     // 0→1 during fade: tail-to-tip dissolve front
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    // Reveal: only show the portion the blade has already swept
    if (vUv.x > uProgress + 0.012) discard;

    // Directional wipe on fade: uWipe=0 → nothing erased; uWipe=1 → all gone
    float wipe = smoothstep(uWipe - 0.18, uWipe + 0.025, vUv.x);
    if (wipe < 0.001) discard;

    float base = smoothstep(0.0, 0.035, vUv.x);

    // Solid filled wedge interior
    float white = smoothstep(0.52, 1.0, vUv.y);           // white-hot outer zone
    float body  = vUv.y * 0.58 + 0.14;                    // uniform body fill
    float outer = exp(-(1.0 - vUv.y)*(1.0 - vUv.y)*44.0); // bright cutting edge

    // Flash just behind the current leading edge
    float flash = smoothstep(uProgress - 0.10, uProgress, vUv.x) * pow(vUv.y, 0.55) * 0.42;

    float sh = 0.97 + sin(vUv.x * 26.0 + uTime * 11.0) * 0.02
                    + sin(vUv.x *  9.0 - uTime *  7.0) * 0.015;

    vec3 col = mix(
      mix(uColor * 0.88, vec3(0.82, 0.94, 1.0), white * 0.5),
      vec3(1.0),
      clamp(white * 0.78 + outer * 0.48 + flash, 0.0, 1.0)
    );

    float alpha = (body + white*0.50 + outer*0.44 + flash) * sh * base * wipe * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 2. Bloom corona shader ────────────────────────────────────────────────────
const _bloomFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;
  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;
    float bloom = exp(-cy * cy * 4.6);
    float tip   = 1.0 - smoothstep(0.90, 1.0, vUv.x) * 0.75;
    float bas   = smoothstep(0.0, 0.04, vUv.x);
    float alpha = bloom * 0.62 * tip * bas * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * 2.1, alpha);
  }
`;

// ── 3. Blade rod shader ───────────────────────────────────────────────────────
const _bladeFrag = /* glsl */`
  uniform float uFade;
  varying vec2  vUv;
  void main(){
    float cy  = abs(vUv.y - 0.5) * 2.0;
    float rod = 1.0 - smoothstep(0.56, 1.0, cy);  // solid flat-top white fill
    float tip = 1.0 - smoothstep(0.89, 1.0, vUv.x) * 0.84;
    float bas = smoothstep(0.0, 0.03, vUv.x);
    float a   = rod * tip * bas * uFade;
    if (a < 0.002) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, a);
  }
`;

// ── 4. Afterimage shader ──────────────────────────────────────────────────────
const _afterFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;
  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;
    float bloom = exp(-cy * cy * 3.5);
    float tip   = 1.0 - smoothstep(0.84, 1.0, vUv.x) * 0.62;
    float bas   = smoothstep(0.0, 0.05, vUv.x);
    float alpha = bloom * 0.36 * tip * bas * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * 1.5, alpha);
  }
`;

// ── Material factories ────────────────────────────────────────────────────────
const _SBLUE = new THREE.Vector3(0.25, 0.65, 1.0);
const _SADD  = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
const _mkArc   = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _arcFrag,
  uniforms: { uProgress:{value:0}, uWipe:{value:0}, uFade:{value:1}, uTime:{value:0}, uColor:{value:_SBLUE.clone()} }, ..._SADD });
const _mkBloom = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _bloomFrag,
  uniforms: { uFade:{value:1}, uColor:{value:_SBLUE.clone()} }, ..._SADD });
const _mkBlade = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _bladeFrag,
  uniforms: { uFade:{value:1} }, ..._SADD });
const _mkAfter = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _afterFrag,
  uniforms: { uFade:{value:1}, uColor:{value:_SBLUE.clone()} }, ..._SADD });

// ── Elliptical ring-sector geometry ──────────────────────────────────────────
// All vertex positions baked in world XZ (no mesh rotation needed for arc).
// innerR/outerR are the base radii, scaled by rx/rz per axis.
// UV.x=0(tail)→1(tip), UV.y=0(inner)→1(outer)
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

// Place a blade/bloom plane correctly on the ellipse at angle `a`.
// The inner/outer ellipse points at angle a:
//   inner = (cos(a)*innerR*rx,  sin(a)*innerR*rz)
//   outer = (cos(a)*outerR*rx,  sin(a)*outerR*rz)
// The blade must point from inner to outer → worldDir = atan2(Δz, Δx).
// We scale mesh.scale.x so the geometry length matches the actual ellipse chord.
function _placeEllipseBlade(mesh, px, py, pz, a, innerR, outerR, rx, rz) {
  const ix = Math.cos(a) * innerR * rx,  iz = Math.sin(a) * innerR * rz;
  const ox = Math.cos(a) * outerR * rx,  oz = Math.sin(a) * outerR * rz;
  const dx = ox - ix, dz = oz - iz;
  const actualLen  = Math.sqrt(dx*dx + dz*dz);
  const worldDir   = Math.atan2(dz, dx); // true pointing angle in world XZ

  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = -worldDir;               // ← correct sign for Three.js
  mesh.scale.x    = actualLen / mesh.userData.baseLen;
  mesh.position.set(px + (ix+ox)*0.5, py, pz + (iz+oz)*0.5);
}

// ── Damage helper ─────────────────────────────────────────────────────────────
function _spinDamage(px, pz, range, dmg) {
  // Full 360° → hits every enemy within range
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - px, dz = e.grp.position.z - pz;
    if (dx*dx + dz*dz > range*range) continue;
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

// ── performSlash ──────────────────────────────────────────────────────────────
export function performSlash() {
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 8) return;

  // Start angle: player facing direction. Sweep CW or CCW alternating.
  // Fixed start at world -X (left side of screen) so the ellipse major axis
  // always stays aligned to world X — gives perfect left/right symmetry.
  state._sf    = ((state._sf | 0) + 1) & 1;
  const startA = Math.PI;                                  // always start from left (-X)
  const sweepA = state._sf ? S_SWEEP : -S_SWEEP;          // alternate CW/CCW

  const range = S_RANGE, inner = S_INNER;
  const baseLen = range - inner;                           // reference blade length (at rx=1)
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const y  = playerGroup.position.y + S_Y;

  // ── Arc trail ────────────────────────────────────────────────────────────
  const arcGeo  = _buildEllipseArc(inner, range, S_RX, S_RZ, startA, sweepA);
  const arcMat  = _mkArc();
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.position.set(px, y - 0.02, pz);
  arcMesh.frustumCulled = false;
  arcMesh.layers.enable(1); arcMesh.layers.enable(2);
  scene.add(arcMesh);

  // ── Bloom corona ──────────────────────────────────────────────────────────
  const bloomGeo  = new THREE.PlaneGeometry(baseLen, 1.35);
  bloomGeo.userData = { baseLen };
  const bloomMat  = _mkBloom();
  const bloomMesh = new THREE.Mesh(bloomGeo, bloomMat);
  bloomMesh.userData.baseLen = baseLen;
  _placeEllipseBlade(bloomMesh, px, y, pz, startA, inner, range, S_RX, S_RZ);
  bloomMesh.frustumCulled = false;
  bloomMesh.layers.enable(1); bloomMesh.layers.enable(2);
  scene.add(bloomMesh);

  // ── White rod ─────────────────────────────────────────────────────────────
  const bladeGeo  = new THREE.PlaneGeometry(baseLen, 0.21);
  const bladeMat  = _mkBlade();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.userData.baseLen = baseLen;
  _placeEllipseBlade(bladeMesh, px, y + 0.01, pz, startA, inner, range, S_RX, S_RZ);
  bladeMesh.frustumCulled = false;
  bladeMesh.layers.enable(1); bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  // ── Afterimage echoes ─────────────────────────────────────────────────────
  const after = [];
  for (let i = 0; i < S_AFTERS; i++) {
    const geo = new THREE.PlaneGeometry(baseLen, 1.35);
    const mat = _mkAfter();
    const m   = new THREE.Mesh(geo, mat);
    m.userData.baseLen = baseLen;
    _placeEllipseBlade(m, px, y, pz, startA, inner, range, S_RX, S_RZ);
    m.frustumCulled = false;
    m.layers.enable(1); m.layers.enable(2);
    scene.add(m);
    after.push({ mesh: m, geo, mat });
  }

  // Damage at mid-swing (hits all enemies in range — 360° spin)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.2));
  _spinDamage(px, pz, range, dmg);
  playSound('laser_sword', 0.72, 0.93 + Math.random() * 0.14);

  state.slashEffects.push({
    arcMesh, arcGeo, arcMat,
    bloomMesh, bloomGeo, bloomMat,
    bladeMesh, bladeGeo, bladeMat,
    after,
    t: 0,
    startA, sweepA,
  });
}

// ── updateSlashEffects ────────────────────────────────────────────────────────
export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    // ── Cleanup ───────────────────────────────────────────────────────────────
    if (s.t >= S_SWING_T + S_FADE_T) {
      scene.remove(s.arcMesh);   s.arcGeo.dispose();   s.arcMat.dispose();
      scene.remove(s.bloomMesh); s.bloomGeo.dispose(); s.bloomMat.dispose();
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      for (const a of s.after) { scene.remove(a.mesh); a.geo.dispose(); a.mat.dispose(); }
      state.slashEffects.splice(i, 1);
      continue;
    }

    // ── Swing progress 0→1 over S_SWING_T, ease-out ──────────────────────────
    const swing = 1.0 - Math.pow(1.0 - Math.min(1.0, s.t / S_SWING_T), 2.0);

    // ── Fade 1→0 over S_FADE_T after peak ────────────────────────────────────
    const inFade    = s.t > S_SWING_T;
    const fadePhase = inFade ? (s.t - S_SWING_T) / S_FADE_T : 0.0;
    const fade      = inFade ? Math.pow(1.0 - fadePhase, 0.68) : 1.0;
    const wipe      = inFade ? fadePhase : 0.0;  // tail→tip dissolve during fade

    // ── Player tracking ───────────────────────────────────────────────────────
    const px  = playerGroup.position.x;
    const pz  = playerGroup.position.z;
    const y   = playerGroup.position.y + S_Y;

    // Arc just translates with player
    s.arcMesh.position.set(px, y - 0.02, pz);
    s.arcMat.uniforms.uProgress.value = swing;
    s.arcMat.uniforms.uWipe.value     = wipe;
    s.arcMat.uniforms.uFade.value     = fade;
    s.arcMat.uniforms.uTime.value     = (state.elapsed || 0) + s.t;

    // ── Current blade angle on the ellipse ────────────────────────────────────
    const currentA = s.startA + swing * s.sweepA;

    _placeEllipseBlade(s.bladeMesh, px, y + 0.01, pz, currentA, S_INNER, S_RANGE, S_RX, S_RZ);
    _placeEllipseBlade(s.bloomMesh, px, y,         pz, currentA, S_INNER, S_RANGE, S_RX, S_RZ);
    s.bladeMat.uniforms.uFade.value = fade;
    s.bloomMat.uniforms.uFade.value = fade * 0.95;

    // ── Afterimages lag behind the leading blade ──────────────────────────────
    for (let k = 0; k < s.after.length; k++) {
      const lag    = (k + 1) / (S_AFTERS + 1) * 0.28 * (1.0 - swing * 0.65);
      const aAngle = s.startA + Math.max(0, swing - lag) * s.sweepA;
      _placeEllipseBlade(s.after[k].mesh, px, y, pz, aAngle, S_INNER, S_RANGE, S_RX, S_RZ);
      s.after[k].mat.uniforms.uFade.value = fade * (0.38 - k * 0.10);
    }
  }
}

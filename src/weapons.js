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
//  LIGHTSABER SLASH VFX
//
//  THREE.JS ROTATION CONVENTION (critical):
//    rotation.y = θ  →  local +X  →  world (cos θ, 0, -sin θ)
//    To point toward world direction (cos d, 0, sin d): rotation.y = -d
//
//  COORDINATE SYSTEM:
//    dir = Math.atan2(lastMoveZ, lastMoveX)
//    world pos at angle d, radius r = (cos(d)*r, y, sin(d)*r)  ← no negation needed
//
//  LAYERS:
//    1. arc   – ring-sector BufferGeometry baked in world-space angles.
//               Placed at playerPos (no mesh rotation). UV.x = 0(tail)→1(tip)
//    2. bloom – wide gaussian plane co-rotating with blade (rotation.y = -currentAngle)
//    3. blade – solid white rod, co-rotating with bloom
//    4. after – N lagged bloom echoes at staggered angles behind the blade
// ═══════════════════════════════════════════════════════════════════════════════

const SABER_RANGE   = 9.0;
const SABER_INNER   = 0.55;           // arc/blade starts here (gap past player body)
const SABER_SWEEP   = Math.PI * 0.75; // visual arc width ~135°
const SABER_HIT_ARC = Math.PI * 0.44; // damage arc
const SABER_SWING_T = 0.08;
const SABER_FADE_T  = 0.22;
const SABER_Y       = 1.0;            // playerGroup.y offset (half capsule)
const SABER_AFTERS  = 3;

// ── Vertex shader (shared) ────────────────────────────────────────────────────
const _sv = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;

// ── 1. Arc trail shader ───────────────────────────────────────────────────────
// UV.x = 0(tail/swing-start) → 1(leading edge/tip)
// UV.y = 0(inner, near player) → 1(outer, cutting edge)
// The whole wedge interior is filled with light — solid, not edge-only.
const _arcFrag = /* glsl */`
  uniform float uProgress; // 0→1: leading edge sweeps tail→tip
  uniform float uWipe;     // 0→1 during fade: erase front sweeps tail→tip
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    // Reveal: only show up to the current leading edge
    if (vUv.x > uProgress + 0.015) discard;

    // Directional tail-to-tip dissolve on fade
    // uWipe=0: nothing erased. uWipe=1: everything erased.
    // smoothstep makes a soft wipe front moving from x=0 to x=1
    float wipe = smoothstep(uWipe - 0.20, uWipe + 0.03, vUv.x);
    if (wipe < 0.001) discard;

    float base = smoothstep(0.0, 0.04, vUv.x);

    // FILLED solid glow across the whole wedge interior
    float white  = smoothstep(0.50, 1.0, vUv.y);           // white-hot outer zone
    float body   = vUv.y * 0.60 + 0.15;                    // uniform body fill
    float outer  = exp(-(1.0 - vUv.y) * (1.0 - vUv.y) * 45.0); // bright cutting edge

    // Extra flash just behind the leading edge (shows where blade currently is)
    float lFlash = smoothstep(uProgress - 0.12, uProgress, vUv.x) * pow(vUv.y, 0.5) * 0.45;

    float sh = 0.96 + sin(vUv.x * 16.0 + uTime * 11.0) * 0.025
                    + sin(vUv.x *  7.0 - uTime *  7.5) * 0.018;

    vec3 col = mix(
      mix(uColor * 0.9, vec3(0.82, 0.94, 1.0), white * 0.5),
      vec3(1.0, 1.0, 1.0),
      clamp(white * 0.8 + outer * 0.5 + lFlash, 0.0, 1.0)
    );

    float alpha = (body + white * 0.55 + outer * 0.45 + lFlash) * sh * base * wipe * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 2. Bloom corona shader ────────────────────────────────────────────────────
// Wide gaussian around the blade. Plane is narrow (hw=0.65), so UV.y covers bloom width.
// UV.x: 0(player end) → 1(tip)   UV.y: 0→1 across width (0.5=centreline)
const _bloomFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;   // 0=centreline, 1=edge
    float bloom = exp(-cy * cy * 4.8);

    float taper = 1.0 - smoothstep(0.90, 1.0, vUv.x) * 0.75;
    float base  = smoothstep(0.0, 0.04, vUv.x);
    float alpha = bloom * 0.65 * taper * base * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * 2.1 + vec3(0.25, 0.4, 0.65) * bloom * 0.2, alpha);
  }
`;

// ── 3. Blade rod shader ───────────────────────────────────────────────────────
// Solid white flat-top fill. Geometry is thin (hw=0.105).
const _bladeFrag = /* glsl */`
  uniform float uFade;
  varying vec2  vUv;

  void main(){
    float cy  = abs(vUv.y - 0.5) * 2.0;
    float rod = 1.0 - smoothstep(0.58, 1.0, cy);   // flat-top solid white
    float tip = 1.0 - smoothstep(0.88, 1.0, vUv.x) * 0.85;
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
    float bloom = exp(-cy * cy * 3.8);
    float tip   = 1.0 - smoothstep(0.84, 1.0, vUv.x) * 0.65;
    float bas   = smoothstep(0.0, 0.05, vUv.x);
    float alpha = bloom * 0.38 * tip * bas * uFade;
    if (alpha < 0.002) discard;
    gl_FragColor = vec4(uColor * 1.55, alpha);
  }
`;

// ── Material factories ────────────────────────────────────────────────────────
const _BLUE = new THREE.Vector3(0.25, 0.65, 1.0);
const _ADD  = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

const _mkArc   = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _arcFrag,
  uniforms: { uProgress:{value:0}, uWipe:{value:0}, uFade:{value:1}, uTime:{value:0}, uColor:{value:_BLUE.clone()} }, ..._ADD });
const _mkBloom = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _bloomFrag,
  uniforms: { uFade:{value:1}, uColor:{value:_BLUE.clone()} }, ..._ADD });
const _mkBlade = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _bladeFrag,
  uniforms: { uFade:{value:1} }, ..._ADD });
const _mkAfter = () => new THREE.ShaderMaterial({ vertexShader: _sv, fragmentShader: _afterFrag,
  uniforms: { uFade:{value:1}, uColor:{value:_BLUE.clone()} }, ..._ADD });

// ── Geometry ──────────────────────────────────────────────────────────────────

// Ring-sector arc. All positions baked in world-space XZ.
// Arc mesh just gets translated to player pos (no rotation).
// UV.x = 0(tail) → 1(leading edge),  UV.y = 0(inner) → 1(outer)
function _buildArc(innerR, outerR, startA, sweepA, segs = 80) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = startA + t * sweepA;           // angle in world XZ
    const cx = Math.cos(a), cz = Math.sin(a);
    pos.push(cx * innerR, 0, cz * innerR);  uvs.push(t, 0);
    pos.push(cx * outerR, 0, cz * outerR);  uvs.push(t, 1);
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

// Blade/bloom plane helper.
// PlaneGeometry(len, w): local X = long axis (hilt→tip), local Y = width.
// rotation.x=-PI/2  → lies flat in XZ plane.
// rotation.y=-angle → local +X points toward world (cos angle, 0, sin angle).  ← KEY FIX
// Center placed at playerPos + (cos angle, 0, sin angle) * (innerR + len/2).
function _mkPlane(len, w) { return new THREE.PlaneGeometry(len, w); }

function _placePlane(mesh, px, py, pz, angle, innerR, len) {
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.y = -angle;                         // ← correct sign!
  const d = innerR + len * 0.5;
  mesh.position.set(px + Math.cos(angle) * d, py, pz + Math.sin(angle) * d);
}

// ── Damage ────────────────────────────────────────────────────────────────────
function _slashDamage(px, pz, dir, range, halfArc, dmg) {
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - px, dz = e.grp.position.z - pz;
    if (dx*dx + dz*dz > range*range) continue;
    let da = Math.atan2(dz, dx) - dir;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > halfArc) continue;
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
  if (state.slashEffects.length > 10) return;

  const mx = state.lastMoveX || 0, mz = state.lastMoveZ || 1;
  const dir = Math.atan2(mz, mx);   // world-space facing angle

  // Alternate swing direction for visual variety
  state._sf = ((state._sf | 0) + 1) & 1;
  const half   = SABER_SWEEP * 0.5;
  const startA = dir + (state._sf ? -half : +half);  // start on one side
  const sweepA = state._sf ? SABER_SWEEP : -SABER_SWEEP; // sweep to other side

  const range  = SABER_RANGE;
  const inner  = SABER_INNER;
  const bladeL = range - inner;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const y  = playerGroup.position.y + SABER_Y;

  // ── Arc trail (world-space baked, just translate to player pos) ──────────
  const arcGeo  = _buildArc(inner, range, startA, sweepA);
  const arcMat  = _mkArc();
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.position.set(px, y - 0.02, pz);
  arcMesh.frustumCulled = false;
  arcMesh.layers.enable(1); arcMesh.layers.enable(2);
  scene.add(arcMesh);

  // ── Bloom corona (rotates with blade each frame) ──────────────────────────
  const bloomGeo  = _mkPlane(bladeL, 1.35);
  const bloomMat  = _mkBloom();
  const bloomMesh = new THREE.Mesh(bloomGeo, bloomMat);
  _placePlane(bloomMesh, px, y, pz, startA, inner, bladeL);
  bloomMesh.frustumCulled = false;
  bloomMesh.layers.enable(1); bloomMesh.layers.enable(2);
  scene.add(bloomMesh);

  // ── White rod (thinner, on top of bloom) ──────────────────────────────────
  const bladeGeo  = _mkPlane(bladeL, 0.21);
  const bladeMat  = _mkBlade();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  _placePlane(bladeMesh, px, y + 0.01, pz, startA, inner, bladeL);
  bladeMesh.frustumCulled = false;
  bladeMesh.layers.enable(1); bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  // ── Afterimage echoes ─────────────────────────────────────────────────────
  const after = [];
  for (let i = 0; i < SABER_AFTERS; i++) {
    const geo = _mkPlane(bladeL, 1.35);
    const mat = _mkAfter();
    const m   = new THREE.Mesh(geo, mat);
    _placePlane(m, px, y, pz, startA, inner, bladeL);
    m.frustumCulled = false;
    m.layers.enable(1); m.layers.enable(2);
    scene.add(m);
    after.push({ mesh: m, geo, mat });
  }

  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.2));
  _slashDamage(px, pz, dir, range, SABER_HIT_ARC * 0.5, dmg);
  playSound('laser_sword', 0.72, 0.93 + Math.random() * 0.14);

  state.slashEffects.push({
    arcMesh, arcGeo, arcMat,
    bloomMesh, bloomGeo, bloomMat,
    bladeMesh, bladeGeo, bladeMat,
    after,
    t: 0,
    startA, sweepA,
    dir,
  });
}

// ── updateSlashEffects ────────────────────────────────────────────────────────
export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    const totalLife = SABER_SWING_T + SABER_FADE_T;

    // ── Cleanup ───────────────────────────────────────────────────────────────
    if (s.t >= totalLife) {
      scene.remove(s.arcMesh);   s.arcGeo.dispose();   s.arcMat.dispose();
      scene.remove(s.bloomMesh); s.bloomGeo.dispose(); s.bloomMat.dispose();
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      for (const a of s.after) { scene.remove(a.mesh); a.geo.dispose(); a.mat.dispose(); }
      state.slashEffects.splice(i, 1);
      continue;
    }

    // ── Swing 0→1 over SABER_SWING_T, ease-out ───────────────────────────────
    const rawSwing = Math.min(1.0, s.t / SABER_SWING_T);
    const swing    = 1.0 - Math.pow(1.0 - rawSwing, 2.0);

    // ── Fade 1→0 over SABER_FADE_T after peak ────────────────────────────────
    const inFade    = s.t > SABER_SWING_T;
    const fadePhase = inFade ? (s.t - SABER_SWING_T) / SABER_FADE_T : 0.0;
    const fade      = inFade ? Math.pow(1.0 - fadePhase, 0.70) : 1.0;
    const wipe      = inFade ? fadePhase : 0.0; // tail-to-tip dissolve

    // ── Player tracking ───────────────────────────────────────────────────────
    const px    = playerGroup.position.x;
    const pz    = playerGroup.position.z;
    const y     = playerGroup.position.y + SABER_Y;
    const inner = SABER_INNER;
    const range = SABER_RANGE;
    const bLen  = range - inner;

    // Arc translates with player (geometry angles are world-relative)
    s.arcMesh.position.set(px, y - 0.02, pz);
    s.arcMat.uniforms.uProgress.value = swing;
    s.arcMat.uniforms.uWipe.value     = wipe;
    s.arcMat.uniforms.uFade.value     = fade;
    s.arcMat.uniforms.uTime.value     = (state.elapsed || 0) + s.t;

    // ── Current blade angle: sweeps from startA to startA+sweepA ─────────────
    const currentA = s.startA + swing * s.sweepA;

    // Blade and bloom rotate to currentA each frame
    _placePlane(s.bladeMesh, px, y + 0.01, pz, currentA, inner, bLen);
    _placePlane(s.bloomMesh, px, y,         pz, currentA, inner, bLen);
    s.bladeMat.uniforms.uFade.value = fade;
    s.bloomMat.uniforms.uFade.value = fade * 0.95;

    // ── Afterimages: staggered angles lagging behind the leading blade ────────
    for (let k = 0; k < s.after.length; k++) {
      // Each afterimage is at a fixed fraction of the swing behind the blade.
      // As swing→1, the lag shrinks (they converge onto the resting blade).
      const lagFrac = (k + 1) / (SABER_AFTERS + 1);
      const lagAng  = lagFrac * 0.30 * (1.0 - swing * 0.7);
      // Lag is subtracted in the direction of sweep
      const aAngle  = s.startA + Math.max(0, swing - lagAng) * s.sweepA;
      _placePlane(s.after[k].mesh, px, y, pz, aAngle, inner, bLen);
      s.after[k].mat.uniforms.uFade.value = fade * (0.40 - k * 0.11);
    }
  }
}

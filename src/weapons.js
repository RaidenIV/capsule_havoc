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
//  LIGHTSABER SLASH VFX  (improved)
//
//  Layers (rendered back → front):
//    1. wedge  – filled tapered glow trail, tail-to-tip directional dissolve
//    2. bloom  – wide soft gaussian corona along blade axis
//    3. blade  – solid white rod, flat-top fill + rounded tip
//    4. after  – 3 lagged soft-bloom echoes (no sharp blade, just blue glow)
//
//  Direction follows player movement (state.lastMoveX / lastMoveZ).
//  All meshes track player position each frame (feel good in motion).
//  Height: playerGroup.position.y + 1.0 (half of capsule height).
// ═══════════════════════════════════════════════════════════════════════════════

const SABER_SLASH_RANGE = 9.0;
const SABER_SLASH_ARC   = Math.PI * 0.42;  // hit arc ~75°
const SABER_SWING_T     = 0.06;            // blade extends over this time
const SABER_FADE_T      = 0.18;            // fade after peak (longer = more satisfying)
const SABER_Y_OFFSET    = 1.0;             // half capsule height (radius 0.4 + len/2 0.6)
const SABER_AFTER_CT    = 3;              // afterimage count

// ── Shared vertex shader ──────────────────────────────────────────────────────
const _sVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── 1. Wedge trail shader ─────────────────────────────────────────────────────
//  Filled tapered wedge: wide at hilt (UV.x=0), narrow at tip (UV.x=1).
//  During swing: leading-edge reveal sweeps from hilt to tip.
//  During fade:  tail-to-tip wipe dissolves the trail progressively.
//
//  UV.x = 0 (hilt, near player) → 1 (tip, far from player)
//  UV.y = 0 → 1 across the plane width (0.5 = blade centreline)
const _wedgeFrag = /* glsl */`
  uniform float uProgress;  // 0→1  leading-edge reveal during swing
  uniform float uWipeFront; // 0→1  tail-to-tip dissolve front during fade (0=nothing erased)
  uniform float uFade;      // 1→0  overall brightness multiplier
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float x  = vUv.x;
    float cy = abs(vUv.y - 0.5) * 2.0;   // 0=centreline, 1=geometry edge

    // Triangular wedge taper: wide near hilt (x=0), narrows to a point at tip (x=1)
    float halfW = mix(0.78, 0.06, pow(x, 0.52));
    float wedge = 1.0 - smoothstep(halfW - 0.05, halfW + 0.05, cy);
    if (wedge < 0.001) discard;

    // Leading-edge reveal: only show up to uProgress
    if (x > uProgress + 0.025) discard;

    // Tail-to-tip directional wipe during fade phase
    // uWipeFront goes 0→1: wipe erases from x=0 (tail) toward x=1 (tip)
    float wipe = smoothstep(uWipeFront - 0.18, uWipeFront + 0.03, x);
    if (wipe < 0.001) discard;

    // Brightness: peaks near the leading edge, dims toward the tail
    float lead = pow(clamp(x / max(uProgress, 0.01), 0.0, 1.0), 1.6);

    // Inner white core glow + outer blue body
    float core = exp(-cy * cy * 40.0);
    float body = exp(-cy * cy *  9.5);

    // Subtle animated shimmer — sin waves, no hash noise
    float sh = 0.94
      + sin(x * 22.0 + uTime * 13.0) * 0.04
      + sin(x * 10.0 - uTime *  8.0) * 0.03;

    vec3  col   = core * vec3(0.88, 0.94, 1.0) + body * uColor * 1.9 * sh;
    float alpha = (core * 0.75 + body * 0.65) * wedge * wipe * lead * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 2. Bloom corona shader ────────────────────────────────────────────────────
//  Wide soft gaussian — this IS the blue glow that wraps the white rod.
//  Geometry is much wider than the rod (hw≈0.7 vs rod hw≈0.11).
const _bloomFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;
    float bloom = exp(-cy * cy * 5.0);          // wide gaussian corona

    float taper = 1.0 - smoothstep(0.89, 1.0, vUv.x) * 0.72;
    float base  = smoothstep(0.0, 0.04, vUv.x);

    vec3  col   = uColor * 2.1 + vec3(0.3, 0.5, 0.8) * bloom * 0.25;
    float alpha = bloom * 0.60 * taper * base * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 3. Blade rod shader ───────────────────────────────────────────────────────
//  Solid white flat-top fill across the rod width.
//  UV.x: 0=hilt, 1=tip   UV.y: 0→1 across width (0.5=centreline)
const _bladeFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy = abs(vUv.y - 0.5) * 2.0;   // 0=centre, 1=geometry edge

    // Flat-top solid white rod: fills inner 62%, soft rolloff at edge
    float rod = 1.0 - smoothstep(0.60, 1.0, cy);

    // Very subtle inner blue modulation (lightsaber inner glow)
    float shimmer = 0.97
      + sin(vUv.x * 18.0 + uTime * 12.0) * 0.02
      + sin(vUv.x *  9.0 - uTime *  7.0) * 0.015;

    // Rounded tip taper + clean hilt start
    float taper = 1.0 - smoothstep(0.90, 1.0, vUv.x) * 0.84;
    float base  = smoothstep(0.0, 0.035, vUv.x);

    // White rod, with a whisper of blue at the very edge of the rod
    vec3  col   = vec3(1.0) * rod;
    float alpha = rod * taper * base * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 4. Afterimage ghost shader ────────────────────────────────────────────────
//  Soft blue bloom ghost — no sharp white rod, just a fading corona echo.
const _afterFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;
    float bloom = exp(-cy * cy * 4.2);   // very wide, very soft

    float taper = 1.0 - smoothstep(0.84, 1.0, vUv.x) * 0.60;
    float base  = smoothstep(0.0, 0.05, vUv.x);

    vec3  col   = uColor * 1.6;
    float alpha = bloom * 0.42 * taper * base * uFade;

    if (alpha < 0.002) discard;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Material factories ────────────────────────────────────────────────────────
const _SABER_BLUE = new THREE.Vector3(0.25, 0.65, 1.0);
const _additive = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };

function _makeWedgeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _sVert, fragmentShader: _wedgeFrag,
    uniforms: {
      uProgress:  { value: 0.0 },
      uWipeFront: { value: 0.0 },
      uFade:      { value: 1.0 },
      uTime:      { value: 0.0 },
      uColor:     { value: _SABER_BLUE.clone() },
    },
    ..._additive,
  });
}

function _makeBloomMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _sVert, fragmentShader: _bloomFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uColor: { value: _SABER_BLUE.clone() },
    },
    ..._additive,
  });
}

function _makeBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _sVert, fragmentShader: _bladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uTime:  { value: 0.0 },
      uColor: { value: _SABER_BLUE.clone() },
    },
    ..._additive,
  });
}

function _makeAfterMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _sVert, fragmentShader: _afterFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uColor: { value: _SABER_BLUE.clone() },
    },
    ..._additive,
  });
}

// ── Geometry builders ─────────────────────────────────────────────────────────
// A flat horizontal plane centered at the mesh position.
// After rotation.x=-PI/2, rotation.y=dirAngle:
//   UV.x=0 → hilt (near player),  UV.x=1 → tip (far)
//   UV.y=0.5 → blade centreline
function _makeFlatPlane(length, width) {
  return new THREE.PlaneGeometry(length, width);
}

function _positionBlade(mesh, playerPos, dirAngle, range, y) {
  const cx = playerPos.x + Math.cos(dirAngle) * range * 0.5;
  const cz = playerPos.z + Math.sin(dirAngle) * range * 0.5;
  mesh.position.set(cx, y, cz);
}

// ── Damage helper ─────────────────────────────────────────────────────────────
function _applySlashDamage(origin, dirAngle, range, arcHalf, dmg) {
  for (let j = state.enemies.length - 1; j >= 0; j--) {
    const e = state.enemies[j];
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - origin.x;
    const dz = e.grp.position.z - origin.z;
    if (dx*dx + dz*dz > range*range) continue;
    let da = Math.atan2(dz, dx) - dirAngle;
    while (da >  Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    if (Math.abs(da) > arcHalf) continue;
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
  if (state.slashEffects.length > 12) return;

  // Direction follows player movement
  const mx = state.lastMoveX || 0;
  const mz = state.lastMoveZ || 1;
  const dirAngle = Math.atan2(mz, mx);

  const range  = SABER_SLASH_RANGE;
  const y      = playerGroup.position.y + SABER_Y_OFFSET;
  const ppos   = playerGroup.position;

  const _mesh = (geo, mat, dy = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.y = dirAngle;
    _positionBlade(m, ppos, dirAngle, range, y + dy);
    m.frustumCulled = false;
    m.layers.enable(1);
    m.layers.enable(2);
    scene.add(m);
    return m;
  };

  // Layer 1 – wedge trail (back, lowest Y)
  const wedgeGeo = _makeFlatPlane(range, range * 0.82);
  const wedgeMat = _makeWedgeMat();
  const wedge    = _mesh(wedgeGeo, wedgeMat, -0.02);

  // Layer 2 – wide blue bloom corona
  const bloomGeo = _makeFlatPlane(range, 1.40);
  const bloomMat = _makeBloomMat();
  const bloom    = _mesh(bloomGeo, bloomMat, 0.00);

  // Layer 3 – solid white rod (top)
  const bladeGeo = _makeFlatPlane(range, 0.22);
  const bladeMat = _makeBladeMat();
  const blade    = _mesh(bladeGeo, bladeMat, 0.01);

  // Layer 4 – afterimage ghosts (lagged angles, same geometry as bloom)
  const after = [];
  for (let i = 0; i < SABER_AFTER_CT; i++) {
    const am  = _makeAfterMat();
    const m   = new THREE.Mesh(bloomGeo, am); // shared geo, own material
    m.rotation.x = -Math.PI / 2;
    m.rotation.y = dirAngle;                  // lag applied in update
    _positionBlade(m, ppos, dirAngle, range, y);
    m.frustumCulled = false;
    m.layers.enable(1);
    m.layers.enable(2);
    scene.add(m);
    after.push({ mesh: m, mat: am });
  }

  // Apply damage immediately (swing is very fast)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.2));
  _applySlashDamage(ppos, dirAngle, range, SABER_SLASH_ARC * 0.5, dmg);

  playSound('laser_sword', 0.72, 0.93 + Math.random() * 0.14);

  state.slashEffects.push({
    wedge, wedgeGeo, wedgeMat,
    bloom, bloomGeo, bloomMat,
    blade, bladeGeo, bladeMat,
    after,
    t: 0,
    dirAngle,
  });
}

// ── updateSlashEffects ────────────────────────────────────────────────────────
export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    const totalLife = SABER_SWING_T + SABER_FADE_T;
    if (s.t >= totalLife) {
      scene.remove(s.wedge); s.wedgeGeo.dispose(); s.wedgeMat.dispose();
      scene.remove(s.bloom); s.bloomGeo.dispose(); s.bloomMat.dispose();
      scene.remove(s.blade); s.bladeGeo.dispose(); s.bladeMat.dispose();
      for (const a of s.after) { scene.remove(a.mesh); a.mat.dispose(); }
      state.slashEffects.splice(i, 1);
      continue;
    }

    // Progress 0→1 over SABER_SWING_T (ease-out so it snaps fast then slows)
    const rawSwing = Math.min(1.0, s.t / SABER_SWING_T);
    const swing    = 1.0 - Math.pow(1.0 - rawSwing, 1.8);

    // Overall fade 1→0 over SABER_FADE_T after peak
    const inFade    = s.t > SABER_SWING_T;
    const fadePhase = inFade ? (s.t - SABER_SWING_T) / SABER_FADE_T : 0.0;
    const fade      = inFade ? Math.pow(1.0 - fadePhase, 0.70) : 1.0;

    // Tail-to-tip wipe front: 0→1 during fade phase
    // At 0: nothing erased.  At 1: all gone.
    const wipeFront = inFade ? fadePhase : 0.0;

    // Track player position every frame
    const range = SABER_SLASH_RANGE;
    const y     = playerGroup.position.y + SABER_Y_OFFSET;
    const ppos  = playerGroup.position;

    const reposition = (m, dy) => {
      m.rotation.y = s.dirAngle;
      _positionBlade(m, ppos, s.dirAngle, range, y + dy);
    };

    reposition(s.wedge, -0.02);
    reposition(s.bloom,  0.00);
    reposition(s.blade,  0.01);

    const now = (state.elapsed || 0) + s.t;

    // Wedge uniforms
    s.wedgeMat.uniforms.uProgress.value  = swing;
    s.wedgeMat.uniforms.uWipeFront.value = wipeFront;
    s.wedgeMat.uniforms.uFade.value      = fade;
    s.wedgeMat.uniforms.uTime.value      = now;

    // Bloom fades like the blade (no wipe — it disappears uniformly)
    s.bloomMat.uniforms.uFade.value = fade * 0.95;

    // Blade: full brightness during swing, fades out after
    s.bladeMat.uniforms.uFade.value = fade;
    s.bladeMat.uniforms.uTime.value = now;

    // Afterimage ghosts: lagging angles, cascading alpha
    for (let k = 0; k < s.after.length; k++) {
      const lag     = (k + 1) * 0.08 * (1.0 - swing);   // lag collapses as swing completes
      const aAngle  = s.dirAngle - lag;
      const m       = s.after[k].mesh;
      m.rotation.x  = -Math.PI / 2;
      m.rotation.y  = aAngle;
      _positionBlade(m, ppos, aAngle, range, y);
      s.after[k].mat.uniforms.uFade.value = fade * (0.36 - k * 0.10);
    }
  }
}

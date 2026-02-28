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

// ── Lightsaber-style slash (procedural, no textures) ───────────────────────────
// Exports: performSlash(), updateSlashEffects(worldDelta)
//
// Visual goal: crisp white-hot blade core + strong blue halo + cone-shaped swing smear.
// Implementation: 3 meshes per slash: (1) ring-sector arc trail, (2) blade line, (3) wedge smear quad.
// Damage: applied once per slash at mid-swing to enemies within the sector.

const SLASH_RADIUS      = 2.9;   // world units (tune for reach)
const SLASH_INNER_R     = 0.55;  // keep near player readable
const SLASH_ARC         = Math.PI * 0.65; // ~117°
const SLASH_SWING_TIME  = 0.12;  // seconds (extend)
const SLASH_FADE_TIME   = 0.10;  // seconds (fade)
const SLASH_DURATION    = SLASH_SWING_TIME + SLASH_FADE_TIME;

const SLASH_DMG_BASE    = 10;    // baseline; scaled by weapon tier
const SLASH_SFX         = 'slash';

// Arc trail (ring sector) shaders
const _trailVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _trailFrag = /* glsl */`
  uniform float uProgress;  // 0→1: reveal arc from tail to leading edge
  uniform float uFade;      // 1→0: overall brightness after peak
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    // Hide geometry past the current leading edge
    float mask = 1.0 - smoothstep(uProgress - 0.03, uProgress + 0.01, vUv.x);
    if (mask < 0.001) discard;

    float base = smoothstep(0.0, 0.06, vUv.x);

    // Brighter at outer cutting edge, thicker fill for smear
    float edge = exp(-(1.0 - vUv.y) * (1.0 - vUv.y) * 55.0);
    float body = pow(vUv.y, 0.7) * 0.62;

    float n = hash21(vec2(vUv.x * 24.0, vUv.y * 6.0 + uTime * 0.35));
    float shimmer = 0.92 + 0.16 * n;

    vec3 col = mix(uColor * 0.72, vec3(1.0, 1.0, 1.0), edge * 1.05);
    float alpha = (body + edge * 1.05) * base * mask * uFade * shimmer * 1.08;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// Blade line shaders
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
    float cy   = abs(vUv.y - 0.5) * 2.0;   // 0 center, 1 edge
    // Wider halo than a "laser line" to read as a saber
    float core = exp(-cy * cy * 650.0);
    float glow = exp(-cy * cy * 55.0);

    float n = hash21(vec2(vUv.x * 38.0, uTime * 0.65));
    float ripple = 0.92 + 0.14 * n;

    float taper = 1.0 - smoothstep(0.88, 1.0, vUv.x) * 0.75;
    float base  = smoothstep(0.0, 0.04, vUv.x);

    float tipBoost = mix(0.85, 1.25, smoothstep(0.25, 1.0, vUv.x));

    vec3  col   = core * vec3(1.0) + glow * uColor * (3.2 * ripple) * tipBoost;
    float alpha = (core * 3.4 + glow * 1.65) * taper * base * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// Motion smear wedge shader (matches the "white cone" look in film swings)
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
    float x  = clamp(vUv.x, 0.0, 1.0);          // along blade
    float cy = abs(vUv.y - 0.5) * 2.0;          // across blade

    // Wedge mask: wide near hilt, narrows to tip
    float halfW = mix(0.95, 0.10, pow(x, 0.65));
    float wedge = 1.0 - smoothstep(halfW - 0.03, halfW + 0.03, cy);

    // Segment behind the leading edge
    float lead = clamp(uProgress + 0.02, 0.0, 1.0);
    float tail = clamp(uProgress - 0.22, 0.0, 1.0);
    float seg  = smoothstep(tail, tail + 0.02, x) * (1.0 - smoothstep(lead, lead + 0.02, x));

    if (wedge * seg < 0.002) discard;

    float core = exp(-cy * cy * 38.0);
    float glow = exp(-cy * cy * 8.0);

    float n = hash21(vec2(x * 18.0, uTime * 0.35));
    float ripple = 0.92 + 0.16 * n;

    float edgeBoost = mix(0.85, 1.15, smoothstep(0.0, 1.0, (x - tail) / max(lead - tail, 1e-4)));

    vec3 col = core * vec3(1.0) * 1.05 + glow * uColor * (2.4 * ripple) * edgeBoost;
    float alpha = (core * 0.85 + glow * 0.70) * wedge * seg * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeTrailMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _trailVert,
    fragmentShader: _trailFrag,
    uniforms: {
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uTime:     { value: 0.0 },
      uColor:    { value: new THREE.Vector3(0.15, 0.55, 1.0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _makeBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _bladeVert,
    fragmentShader: _bladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uTime:  { value: 0.0 },
      uColor: { value: new THREE.Vector3(0.25, 0.65, 1.0) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

function _makeSweepMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _sweepVert,
    fragmentShader: _sweepFrag,
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

// Build a ring-sector geometry in XZ plane (y=0). UV.x is angle progress 0..1, UV.y is radial 0..1.
function _buildArcGeo(innerR, outerR, arcRad, segs = 48) {
  const positions = [];
  const uvs = [];
  const indices = [];

  // Two radii per step => strip
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = (-arcRad * 0.5) + t * arcRad;

    const c = Math.cos(a), s = Math.sin(a);

    // inner
    positions.push(c * innerR, 0, s * innerR);
    uvs.push(t, 0.0);

    // outer
    positions.push(c * outerR, 0, s * outerR);
    uvs.push(t, 1.0);
  }

  for (let i = 0; i < segs; i++) {
    const i0 = i * 2;
    const i1 = i0 + 1;
    const i2 = i0 + 2;
    const i3 = i0 + 3;
    indices.push(i0, i1, i2);
    indices.push(i2, i1, i3);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function _bearingToRotY(bearingRad) {
  // Bearing in XZ (0 = +X, PI/2 = +Z). Three.js rotation.y uses same sense.
  return -bearingRad; // keep consistent with your existing wave orientation
}

function _angNorm(a) {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a >  Math.PI) a -= Math.PI * 2;
  return a;
}

function _angleDiff(a, b) { return _angNorm(a - b); }

function _ensureSlashState() {
  if (!Array.isArray(state.slashEffects)) state.slashEffects = [];
  if (!state.slashHitIds) state.slashHitIds = new Set();
}

export function performSlash() {
  _ensureSlashState();

  // If a lot are active, don't spam
  if (state.slashEffects.length > 8) return;

  // Choose a direction: use current movement heading if available, else use bulletWaveAngle
  const dir = (Number.isFinite(state.moveAngle) ? state.moveAngle : state.bulletWaveAngle) || 0;
  const startA = dir - SLASH_ARC * 0.5;
  const endA   = dir + SLASH_ARC * 0.5;

  const slashY = playerGroup.position.y + 0.02;

  // Arc trail
  const arcGeo   = _buildArcGeo(SLASH_INNER_R, SLASH_RADIUS, SLASH_ARC, 54);
  const trailMat = _makeTrailMat();
  const trailMesh = new THREE.Mesh(arcGeo, trailMat);
  trailMesh.position.set(playerGroup.position.x, slashY + 0.04, playerGroup.position.z);
  trailMesh.rotation.y = _bearingToRotY(dir);
  trailMesh.layers.enable(2);
  scene.add(trailMesh);

  // Motion smear wedge
  const sweepGeo  = new THREE.PlaneGeometry(SLASH_RADIUS, SLASH_RADIUS * 0.90);
  const sweepMat  = _makeSweepMat();
  const sweepMesh = new THREE.Mesh(sweepGeo, sweepMat);
  sweepMesh.position.set(playerGroup.position.x, slashY + 0.055, playerGroup.position.z);
  sweepMesh.rotation.y = _bearingToRotY(dir);
  sweepMesh.layers.enable(2);
  scene.add(sweepMesh);

  // Blade line
  const bladeGeo  = new THREE.PlaneGeometry(SLASH_RADIUS, 0.12);
  const bladeMat  = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.set(playerGroup.position.x, slashY + 0.06, playerGroup.position.z);
  bladeMesh.rotation.y = _bearingToRotY(startA);
  bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  // sfx
  try { playSound(SLASH_SFX, 0.6, 0.92 + Math.random() * 0.16); } catch {}

  state.slashEffects.push({
    t: 0,
    dir,
    startA,
    endA,
    didHit: false,
    trailMesh, arcGeo, trailMat,
    sweepMesh, sweepGeo, sweepMat,
    bladeMesh, bladeGeo, bladeMat,
  });
}

function _applySlashDamage(centerAngle, dmg) {
  // Damage enemies in sector within SLASH_RADIUS
  const cx = playerGroup.position.x;
  const cz = playerGroup.position.z;

  // Sector is centered on dir, half-angle SLASH_ARC/2
  const half = SLASH_ARC * 0.5;

  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];
    if (!e || e.dead) continue;

    const dx = e.grp.position.x - cx;
    const dz = e.grp.position.z - cz;
    const d2 = dx*dx + dz*dz;
    if (d2 > SLASH_RADIUS * SLASH_RADIUS) continue;

    const ang = Math.atan2(dz, dx); // bearing
    const da = Math.abs(_angleDiff(ang, centerAngle));
    if (da > half) continue;

    // Apply damage
    e.hp -= dmg;
    spawnEnemyDamageNum(e.grp.position.x, e.grp.position.y + 0.9, e.grp.position.z, dmg, false);

    if (e.hp <= 0) {
      killEnemy(e, i);
    } else {
      if (e.isElite) updateEliteBar(e);
    }
  }
}

export function updateSlashEffects(worldDelta) {
  _ensureSlashState();
  const dt = worldDelta; // already world-scaled in loop

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += dt;

    const rawSwing = Math.min(1, s.t / SLASH_SWING_TIME);
    const fadeT = Math.max(0, s.t - SLASH_SWING_TIME);
    const fade = 1 - Math.min(1, fadeT / SLASH_FADE_TIME);

    // drive uniforms
    s.trailMat.uniforms.uProgress.value = rawSwing;
    s.trailMat.uniforms.uFade.value = fade;
    s.trailMat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    s.sweepMat.uniforms.uProgress.value = rawSwing;
    s.sweepMat.uniforms.uFade.value = (rawSwing < 1 ? fade : fade * 0.7);
    s.sweepMat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    // rotate blade from start->end across swing
    const currentAngle = s.startA + (s.endA - s.startA) * rawSwing;
    s.bladeMesh.rotation.y = _bearingToRotY(currentAngle);
    s.bladeMat.uniforms.uFade.value = (rawSwing < 1 ? fade : fade * 0.6);
    s.bladeMat.uniforms.uTime.value = (state.elapsed || 0) + s.t;

    // keep anchored to player
    const slashY = playerGroup.position.y + 0.02;
    s.trailMesh.position.set(playerGroup.position.x, slashY + 0.04, playerGroup.position.z);
    s.sweepMesh.position.set(playerGroup.position.x, slashY + 0.055, playerGroup.position.z);
    s.bladeMesh.position.set(playerGroup.position.x, slashY + 0.06, playerGroup.position.z);

    // Damage once at mid swing (looks/feels like the hit happens during the sweep)
    if (!s.didHit && rawSwing >= 0.55) {
      s.didHit = true;
      const tier = (state.weaponTier ?? 1);
      const dmg = Math.round(SLASH_DMG_BASE * Math.pow(1.35, Math.max(0, tier - 1)));
      _applySlashDamage(s.dir, dmg);
    }

    if (s.t >= SLASH_DURATION) {
      scene.remove(s.trailMesh); s.arcGeo.dispose(); s.trailMat.dispose();
      scene.remove(s.sweepMesh); s.sweepGeo.dispose(); s.sweepMat.dispose();
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      state.slashEffects.splice(i, 1);
    }
  }
}


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

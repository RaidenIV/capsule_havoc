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


// ─────────────────────────────────────────────────────────────────────────────
// Lightsaber-style slash VFX (procedural, no sprite sheets)
// Layers: blade line (white core + blue halo), smear wedge (cone of light),
// and multiple afterimage blades (motion persistence).
// Exported: performSlash(), updateSlashEffects(worldDelta)
// ─────────────────────────────────────────────────────────────────────────────

const SLASH_SWING_TIME = 0.12;
const SLASH_FADE_TIME  = 0.10;
const SLASH_DURATION   = SLASH_SWING_TIME + SLASH_FADE_TIME;

// Visual sizing (world units) tuned for top-down/isometric camera.
const SLASH_RADIUS     = 10.0;
const SLASH_INNER_R    = 1.1;
const SLASH_THICKNESS  = 0.22;   // blade visual thickness (plane height in XZ after rotateX)
const SLASH_WEDGE_SIZE = 10.0;   // smear plane size

const _slashUp = new THREE.Vector3(0, 1, 0);

function _normAng(a) {
  a = (a + Math.PI * 2) % (Math.PI * 2);
  return a;
}
function _angInRange(a, start, end) {
  // Inclusive range with wrap support
  a = _normAng(a); start = _normAng(start); end = _normAng(end);
  if (start <= end) return a >= start && a <= end;
  return a >= start || a <= end;
}
function _rotYFromAngle(angle) {
  // Our gameplay angles use cos->x, sin->z, so rotate around Y by -angle for a plane lying in XZ
  return -angle;
}

// ── Blade shader (white-hot core + electric-blue halo) ────────────────────────
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
  varying vec2 vUv;

  float hash21(vec2 p){
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  void main(){
    // vUv.x along blade (0 hilt -> 1 tip)
    // vUv.y across blade (0..1, center at 0.5)
    float cy = abs(vUv.y - 0.5) * 2.0;

    // lightsaber read: tight white core + wider blue halo
    float core = exp(-cy * cy * 520.0);
    float glow = exp(-cy * cy * 32.0);

    // subtle shimmer along the length
    float n = hash21(vec2(vUv.x * 26.0, uTime * 0.60));
    float ripple = 0.92 + 0.16 * n;

    // tip emphasis and gentle taper
    float tipBoost = mix(0.95, 1.25, smoothstep(0.25, 1.0, vUv.x));
    float taper = 1.0 - smoothstep(0.90, 1.0, vUv.x) * 0.60;
    float base  = smoothstep(0.0, 0.03, vUv.x);

    vec3 col = core * vec3(1.0) * 1.15
             + glow * uColor * (3.6 * ripple) * tipBoost;

    float alpha = (core * 3.0 + glow * 1.35) * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Afterimage blade shader (softer/wider) ───────────────────────────────────
const _afterFrag = /* glsl */`
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
    float cy = abs(vUv.y - 0.5) * 2.0;
    float core = exp(-cy * cy * 140.0);
    float glow = exp(-cy * cy * 10.0);

    float n = hash21(vec2(vUv.x * 18.0, uTime * 0.40));
    float ripple = 0.90 + 0.20 * n;

    float taper = 1.0 - smoothstep(0.86, 1.0, vUv.x) * 0.55;
    float base  = smoothstep(0.0, 0.03, vUv.x);

    vec3 col = core * vec3(1.0) * 0.45 + glow * uColor * (2.1 * ripple);
    float alpha = (core * 1.2 + glow * 1.1) * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Smear wedge shader (overexposed cone with blue fringe) ────────────────────
const _wedgeVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const _wedgeFrag = /* glsl */`
  uniform float uProgress; // 0..1 during swing
  uniform float uFade;     // 1..0 during fade
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

    // Wedge mask: wide near hilt, taper towards tip
    float halfW = mix(0.98, 0.08, pow(x, 0.65));
    float wedge = 1.0 - smoothstep(halfW - 0.03, halfW + 0.03, cy);

    // Show only behind the leading edge (tail..lead segment)
    float lead = clamp(uProgress + 0.02, 0.0, 1.0);
    float tail = clamp(uProgress - 0.26, 0.0, 1.0);
    float seg  = smoothstep(tail, tail + 0.02, x) * (1.0 - smoothstep(lead, lead + 0.02, x));

    float m = wedge * seg;
    if (m < 0.002) discard;

    // White interior with blue fringe (slightly more glow at edges)
    float core = exp(-cy * cy * 22.0);
    float glow = exp(-cy * cy * 6.5);

    float n = hash21(vec2(x * 16.0, uTime * 0.35));
    float ripple = 0.92 + 0.16 * n;

    float edgeBoost = mix(0.85, 1.25, smoothstep(0.0, 1.0, (x - tail) / max(lead - tail, 1e-4)));

    vec3 col = core * vec3(1.0) * 1.10 + glow * uColor * (2.8 * ripple) * edgeBoost;
    float alpha = (core * 0.95 + glow * 0.65) * m * uFade;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _bladeVert,
    fragmentShader: _bladeFrag,
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

function _makeAfterMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _bladeVert,
    fragmentShader: _afterFrag,
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

function _makeWedgeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _wedgeVert,
    fragmentShader: _wedgeFrag,
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

function _ensureSlashState() {
  if (!state.slashEffects) state.slashEffects = [];
  if (typeof state.slashTimer !== 'number' || !isFinite(state.slashTimer)) state.slashTimer = 0.0;
}

export function performSlash() {
  _ensureSlashState();

  // Use the same global angle driver as bullets so the slash "sweeps" around the player over time.
  const baseA = (typeof state.bulletWaveAngle === 'number' ? state.bulletWaveAngle : 0) % (Math.PI * 2);
  const arc = Math.PI * 0.55; // ~99°
  const startA = baseA - arc * 0.5;
  const endA   = baseA + arc * 0.5;

  const y = floorY(bulletGeoParams) + 0.05;

  // Blade plane (lies in XZ)
  const bladeGeo = new THREE.PlaneGeometry(SLASH_RADIUS, SLASH_THICKNESS);
  bladeGeo.rotateX(-Math.PI / 2);
  const bladeMat = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.set(playerGroup.position.x, y + 0.02, playerGroup.position.z);
  bladeMesh.rotation.y = _rotYFromAngle(startA);
  bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  // Smear wedge (cone of light) - larger quad
  const wedgeGeo = new THREE.PlaneGeometry(SLASH_WEDGE_SIZE, SLASH_WEDGE_SIZE * 0.90);
  wedgeGeo.rotateX(-Math.PI / 2);
  const wedgeMat = _makeWedgeMat();
  const wedgeMesh = new THREE.Mesh(wedgeGeo, wedgeMat);
  wedgeMesh.position.set(playerGroup.position.x, y + 0.015, playerGroup.position.z);
  wedgeMesh.rotation.y = _rotYFromAngle(startA);
  wedgeMesh.layers.enable(2);
  scene.add(wedgeMesh);

  // Afterimages (motion persistence)
  const AFTER_COUNT = 5;
  const afterGeo = bladeGeo; // share geometry
  const afterMeshes = [];
  const afterMats = [];
  for (let i = 0; i < AFTER_COUNT; i++) {
    const m = _makeAfterMat();
    const mesh = new THREE.Mesh(afterGeo, m);
    mesh.position.set(playerGroup.position.x, y + 0.018, playerGroup.position.z);
    mesh.rotation.y = _rotYFromAngle(startA);
    mesh.layers.enable(2);
    scene.add(mesh);
    afterMeshes.push(mesh);
    afterMats.push(m);
  }

  // Gameplay: slash damage (single application mid-swing)
  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.15));

  // SFX
  playSound('slash', 0.55, 0.95 + Math.random() * 0.08);

  state.slashEffects.push({
    elapsed: 0,
    startA, endA,
    didDamage: false,
    dmg,
    bladeMesh, bladeGeo, bladeMat,
    wedgeMesh, wedgeGeo, wedgeMat,
    afterMeshes, afterMats,
  });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const y  = floorY(bulletGeoParams) + 0.05;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.elapsed += worldDelta;

    const t = s.elapsed / SLASH_DURATION;
    const rawSwing = Math.min(1.0, s.elapsed / SLASH_SWING_TIME);
    const swing = rawSwing; // 0..1
    const fadeT = Math.max(0.0, (s.elapsed - SLASH_SWING_TIME) / SLASH_FADE_TIME);
    const fade = (s.elapsed <= SLASH_SWING_TIME) ? 1.0 : (1.0 - Math.min(1.0, fadeT));

    // current blade angle along sweep
    const currentA = s.startA + (s.endA - s.startA) * swing;

    // anchor meshes
    s.bladeMesh.position.set(px, y + 0.02, pz);
    s.bladeMesh.rotation.y = _rotYFromAngle(currentA);

    s.wedgeMesh.position.set(px, y + 0.015, pz);
    s.wedgeMesh.rotation.y = _rotYFromAngle(currentA);

    // uniforms
    if (s.bladeMat?.uniforms) {
      s.bladeMat.uniforms.uFade.value = fade;
      s.bladeMat.uniforms.uTime.value = (state.elapsed || 0) + s.elapsed;
    }
    if (s.wedgeMat?.uniforms) {
      s.wedgeMat.uniforms.uProgress.value = swing;
      s.wedgeMat.uniforms.uFade.value = (s.elapsed <= SLASH_SWING_TIME) ? 1.0 : fade * 0.85;
      s.wedgeMat.uniforms.uTime.value = (state.elapsed || 0) + s.elapsed;
    }

    // Afterimages: lagged slices
    const count = s.afterMeshes.length;
    for (let k = 0; k < count; k++) {
      const mesh = s.afterMeshes[k];
      const mat  = s.afterMats[k];
      const frac = (k + 1) / (count + 1);
      const lag  = (0.22 + 0.12 * frac) * (1.0 - rawSwing); // more lag early
      const a = currentA - lag;

      mesh.position.set(px, y + 0.018, pz);
      mesh.rotation.y = _rotYFromAngle(a);

      const alphaScale = (0.38 - 0.05 * k);
      if (mat?.uniforms) {
        mat.uniforms.uFade.value = fade * Math.max(0.05, alphaScale);
        mat.uniforms.uTime.value = (state.elapsed || 0) + s.elapsed + 0.05 + 0.02 * k;
      }
    }

    // Damage application at mid-swing (single pulse)
    if (!s.didDamage && rawSwing >= 0.55) {
      s.didDamage = true;

      const start = s.startA;
      const end   = s.endA;
      const r2 = SLASH_RADIUS * SLASH_RADIUS;

      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (!e || e.dead) continue;

        const ex = e.grp.position.x;
        const ez = e.grp.position.z;
        const dx = ex - px;
        const dz = ez - pz;
        const d2 = dx*dx + dz*dz;
        if (d2 > r2) continue;

        const ang = Math.atan2(dz, dx);
        if (!_angInRange(ang, start, end)) continue;

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

    // End of effect
    if (s.elapsed >= SLASH_DURATION) {
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      scene.remove(s.wedgeMesh); s.wedgeGeo.dispose(); s.wedgeMat.dispose();
      for (let k = 0; k < s.afterMeshes.length; k++) {
        scene.remove(s.afterMeshes[k]);
        s.afterMats[k].dispose();
      }
      state.slashEffects.splice(i, 1);
    }
  }
}


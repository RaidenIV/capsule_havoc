// ─── weapons.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  BULLET_SPEED, BULLET_LIFETIME, ENEMY_BULLET_DMG, WEAPON_CONFIG,
  SLASH_RADIUS, SLASH_INNER_R, SLASH_VISUAL_ARC, SLASH_HIT_ARC,
  SLASH_DAMAGE, SLASH_DURATION, SLASH_SWING_TIME, SLASH_FADE_TIME,
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

function getOrbitRingDefsByTier(tier) {
  const C = WEAPON_CONFIG;
  const idx = Math.min(Math.max((tier || 1) - 1, 0), C.length - 1);
  const ring = (ci, flip = false) => ({
    count: C[ci][3],
    radius: C[ci][4],
    speed: C[ci][5] * (flip ? -1 : 1),
    color: C[ci][6],
  });

  // No orbit bullets until config index >= 2 (tier 3+)
  if (idx < 2) return [];

  switch (idx) {
    case 2:  return [ring(2)];
    case 3:  return [ring(3)];
    case 4:  return [ring(4)];
    case 5:  return [ring(5)];
    case 6:  return [ring(6), ring(2, true)];
    case 7:  return [ring(7), ring(3, true)];
    case 8:  return [ring(8), ring(4, true)];
    case 9:  return [ring(9), ring(5, true)];
    default: return [ring(10), ring(6, true)];
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
  for (const def of getOrbitRingDefsByTier(state.weaponTier || 1)) {
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

// ═════════════════════════════════════════════════════════════════════════════
//  LIGHTSABER SLASH VFX
//  Layers (back → front):
//    1. arc trail  – ring-sector, uniform brightness, animated shimmer on edge
//    2. afterimage blade – lags AFTER_LAG radians behind main, wider glow
//    3. main blade – laser-thin rotating line, white core / blue halo
//    4. tip flare  – tiny additive billboard spawned at peak, radial shader
// ═════════════════════════════════════════════════════════════════════════════

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Ring-sector arc trail
// UV.x = 0 (tail/start) → 1 (leading edge)   UV.y = 0 (inner) → 1 (outer)
function _buildArcGeo(innerR, outerR, startAngle, totalArc, segs = 80) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = startAngle + t * totalArc;
    const sx = Math.sin(a), cz = Math.cos(a);
    pos.push(sx * innerR, 0, cz * innerR); uvs.push(t, 0);
    pos.push(sx * outerR, 0, cz * outerR); uvs.push(t, 1);
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

// Thin blade rectangle along +X,  UV.x = 0(inner) → 1(outer tip)
function _buildBladeGeo(innerR, outerR, hw = 0.045) {
  const pos = new Float32Array([
    innerR, 0, -hw,  outerR, 0, -hw,
    outerR, 0,  hw,  innerR, 0,  hw,
  ]);
  const uvs = new Float32Array([0,0, 1,0, 1,1, 0,1]);
  const g   = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0,1,2, 0,2,3]);
  return g;
}

// ── Shaders ───────────────────────────────────────────────────────────────────

const _vert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;

// ── 1. Arc trail shader ───────────────────────────────────────────────────────
//  Uniform brightness across full revealed arc.
//  Shimmer: animated sin-noise along UV.x modulates the outer-edge brightness.
const _trailFrag = /* glsl */`
  uniform float uProgress; // 0→1: reveal arc tail → leading edge
  uniform float uFade;     // 1→0: global fade after peak
  uniform float uTime;     // seconds elapsed
  uniform vec3  uColor;    // electric blue
  varying vec2  vUv;

  float shimmer(float x, float t) {
    return 0.82
      + sin(x * 18.0 + t * 11.0) * 0.08
      + sin(x *  9.0 - t *  7.0) * 0.06
      + sin(x * 31.0 + t * 19.0) * 0.04;
  }

  void main(){
    // Reveal mask – leading edge with soft fringe
    float mask = 1.0 - smoothstep(uProgress - 0.025, uProgress + 0.01, vUv.x);
    if (mask < 0.001) discard;

    // Base clip at origin so it doesn't hard-cut
    float base = smoothstep(0.0, 0.05, vUv.x);

    // Outer cutting-edge glow (UV.y = 1 = outer radius)
    float edge = exp(-(1.0 - vUv.y) * (1.0 - vUv.y) * 75.0);
    // Arc-body fill, uniform brightness
    float body = pow(vUv.y, 0.9) * 0.40;

    // Shimmer on the outer edge only
    float sh = shimmer(vUv.x, uTime);

    vec3 col = mix(uColor * 0.6, vec3(1.0), edge * 0.88);
    float alpha = (body + edge * sh) * base * mask * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 2. Main blade shader ──────────────────────────────────────────────────────
//  Laser-thin white core + electric-blue halo.
//  uTime drives a gentle plasma ripple along the blade length.
const _bladeFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  float plasma(float x, float t){
    return 0.88
      + sin(x * 14.0 + t * 10.0) * 0.07
      + sin(x * 24.0 - t * 16.0) * 0.05;
  }

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;      // 0=centre, 1=edge
    float core  = exp(-cy * cy * 800.0);        // razor white core (laser-width)
    float glow  = exp(-cy * cy * 120.0);        // tight electric-blue halo
    float taper = 1.0 - smoothstep(0.88, 1.0, vUv.x) * 0.75;
    float base  = smoothstep(0.0, 0.04, vUv.x);
    float sh    = plasma(vUv.x, uTime);

    vec3  col   = core * vec3(1.0) + glow * uColor * 2.2 * sh;
    float alpha = (core * 4.0 + glow * 1.2 * sh) * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 3. Afterimage blade shader ────────────────────────────────────────────────
//  Wider, softer glow, dimmer, fades more slowly.
const _afterFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy   = abs(vUv.y - 0.5) * 2.0;
    float glow = exp(-cy * cy * 30.0);           // wide soft bloom
    float taper = 1.0 - smoothstep(0.82, 1.0, vUv.x) * 0.6;
    float base  = smoothstep(0.0, 0.06, vUv.x);

    vec3  col   = uColor * 1.4 + vec3(0.15, 0.3, 0.5) * glow;
    float alpha = glow * 0.45 * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 4. Tip flare shader ───────────────────────────────────────────────────────
//  Billboard, UV centred at 0.5,0.5. Radial falloff: white core → blue glow.
const _flareFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    vec2  d    = vUv - 0.5;
    float dist = length(d) * 2.0;            // 0=centre, 1=edge
    float core = exp(-dist * dist * 18.0);   // tight white centre
    float glow = exp(-dist * dist *  4.5);   // electric-blue halo
    float ring = exp(-(dist - 0.55) * (dist - 0.55) * 60.0) * 0.4; // subtle outer ring

    vec3  col   = core * vec3(1.0) + glow * uColor * 1.6 + ring * uColor;
    float alpha = (core * 3.0 + glow * 0.9 + ring) * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── Material factories ────────────────────────────────────────────────────────
const _BLUE = new THREE.Vector3(0.25, 0.65, 1.0);

function _makeTrailMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vert, fragmentShader: _trailFrag,
    uniforms: {
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uTime:     { value: 0.0 },
      uColor:    { value: _BLUE.clone() },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function _makeBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vert, fragmentShader: _bladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uTime:  { value: 0.0 },
      uColor: { value: _BLUE.clone() },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function _makeAfterMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vert, fragmentShader: _afterFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uColor: { value: new THREE.Vector3(0.15, 0.50, 0.95) },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function _makeFlareMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _vert, fragmentShader: _flareFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uColor: { value: _BLUE.clone() },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// bearing angle (atan2 moveX,moveZ) → Three.js rotation.y for +X geometry
function _bearingToRotY(a) { return a - Math.PI / 2; }

// Half of capsule height (radius 0.4 + half-length 0.6)
const SLASH_Y_OFFSET = 1.0;
// Afterimage lags this many radians behind the leading edge
const AFTER_LAG = 0.18;

// ── performSlash ──────────────────────────────────────────────────────────────
export function performSlash() {
  const facing = Math.atan2(state.lastMoveX, state.lastMoveZ);
  const half   = SLASH_VISUAL_ARC * 0.5;
  const startA = facing - half;
  const endA   = facing + half;
  const slashY = playerGroup.position.y + SLASH_Y_OFFSET;
  const px = playerGroup.position.x, pz = playerGroup.position.z;

  // ── Arc trail ──────────────────────────────────────────────────────────────
  const arcGeo   = _buildArcGeo(SLASH_INNER_R, SLASH_RADIUS, startA, SLASH_VISUAL_ARC);
  const trailMat = _makeTrailMat();
  const trailMesh = new THREE.Mesh(arcGeo, trailMat);
  trailMesh.position.set(px, slashY - 0.02, pz);
  trailMesh.layers.enable(2);
  scene.add(trailMesh);

  // ── Afterimage blade (wider, offset by AFTER_LAG) ─────────────────────────
  const afterGeo  = _buildBladeGeo(SLASH_INNER_R, SLASH_RADIUS, 0.14); // hw=0.14 = wide glow
  const afterMat  = _makeAfterMat();
  const afterMesh = new THREE.Mesh(afterGeo, afterMat);
  afterMesh.position.set(px, slashY, pz);
  afterMesh.rotation.y = _bearingToRotY(startA);
  afterMesh.layers.enable(2);
  scene.add(afterMesh);

  // ── Main blade ────────────────────────────────────────────────────────────
  const bladeGeo  = _buildBladeGeo(SLASH_INNER_R, SLASH_RADIUS, 0.045);
  const bladeMat  = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.set(px, slashY + 0.06, pz);
  bladeMesh.rotation.y = _bearingToRotY(startA);
  bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  const dmg = Math.round(SLASH_DAMAGE * (getBulletDamage() / 10));
  playSound('laser_sword', 0.7, 0.92 + Math.random() * 0.16);

  state.slashEffects.push({
    trailMesh, arcGeo, trailMat,
    bladeMesh, bladeGeo, bladeMat,
    afterMesh, afterGeo, afterMat,
    // tip flare created at peak
    flareMesh: null, flareGeo: null, flareMat: null, flareLife: 0,
    startA, endA,
    life:    SLASH_DURATION,
    maxLife: SLASH_DURATION,
    elapsed: 0,
    hitDone: false,
    dmg,
    facing,
    halfHit: SLASH_HIT_ARC * 0.5,
  });
}

// ── updateSlashEffects ────────────────────────────────────────────────────────
export function updateSlashEffects(worldDelta) {
  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.life    -= worldDelta;
    s.elapsed += worldDelta;

    // ── Cleanup ──────────────────────────────────────────────────────────────
    if (s.life <= 0) {
      scene.remove(s.trailMesh);  s.arcGeo.dispose();   s.trailMat.dispose();
      scene.remove(s.bladeMesh);  s.bladeGeo.dispose(); s.bladeMat.dispose();
      scene.remove(s.afterMesh);  s.afterGeo.dispose(); s.afterMat.dispose();
      if (s.flareMesh) { scene.remove(s.flareMesh); s.flareGeo.dispose(); s.flareMat.dispose(); }
      state.slashEffects.splice(i, 1);
      continue;
    }

    // ── Track player ─────────────────────────────────────────────────────────
    const slashY = playerGroup.position.y + SLASH_Y_OFFSET;
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    s.trailMesh.position.set(px, slashY - 0.02, pz);
    s.bladeMesh.position.set(px, slashY + 0.06, pz);
    s.afterMesh.position.set(px, slashY,         pz);

    // ── Swing progress: ease-out over SLASH_SWING_TIME ───────────────────────
    const rawSwing = Math.min(1, s.elapsed / SLASH_SWING_TIME);
    const swing    = 1 - Math.pow(1 - rawSwing, 2.2);

    // ── Fade: holds 1 while swinging, then drops over SLASH_FADE_TIME ────────
    const fade = s.life <= SLASH_FADE_TIME
      ? Math.pow(s.life / SLASH_FADE_TIME, 0.65)
      : 1.0;

    // ── Update trail ─────────────────────────────────────────────────────────
    s.trailMat.uniforms.uProgress.value = swing;
    s.trailMat.uniforms.uFade.value     = fade;
    s.trailMat.uniforms.uTime.value     = s.elapsed;

    // ── Rotate main blade to leading edge ─────────────────────────────────────
    const leadAngle  = s.startA + swing * SLASH_VISUAL_ARC;
    s.bladeMesh.rotation.y = _bearingToRotY(leadAngle);
    s.bladeMat.uniforms.uFade.value = swing < 1.0 ? fade : fade * 0.55;
    s.bladeMat.uniforms.uTime.value = s.elapsed;

    // ── Afterimage blade: lags AFTER_LAG behind lead, fades slower ───────────
    const afterAngle = Math.max(s.startA, leadAngle - AFTER_LAG);
    s.afterMesh.rotation.y = _bearingToRotY(afterAngle);
    // Afterimage fades at 40% brightness of main, persists into fade phase
    s.afterMat.uniforms.uFade.value = fade * 0.7;

    // ── Tip flare: spawn once at peak, then update ────────────────────────────
    if (!s.flareMesh && swing >= 0.99) {
      const tipX = px + Math.sin(s.endA) * SLASH_RADIUS;
      const tipZ = pz + Math.cos(s.endA) * SLASH_RADIUS;
      const SIZE = 0.8;
      s.flareGeo  = new THREE.PlaneGeometry(SIZE, SIZE);
      s.flareMat  = _makeFlareMat();
      s.flareMesh = new THREE.Mesh(s.flareGeo, s.flareMat);
      s.flareMesh.position.set(tipX, slashY + 0.06, tipZ);
      s.flareMesh.rotation.x = -Math.PI / 2; // face up (top-down camera)
      s.flareMesh.layers.enable(2);
      s.flareLife = 0.08;
      scene.add(s.flareMesh);
    }

    if (s.flareMesh) {
      s.flareLife -= worldDelta;
      if (s.flareLife <= 0) {
        scene.remove(s.flareMesh); s.flareGeo.dispose(); s.flareMat.dispose();
        s.flareMesh = null;
      } else {
        // Keep anchored to blade tip as player moves
        const tipX = px + Math.sin(s.endA) * SLASH_RADIUS;
        const tipZ = pz + Math.cos(s.endA) * SLASH_RADIUS;
        s.flareMesh.position.set(tipX, slashY + 0.06, tipZ);
        s.flareMat.uniforms.uFade.value = Math.pow(s.flareLife / 0.08, 0.5);
      }
    }

    // ── Damage at 50% through swing ───────────────────────────────────────────
    if (!s.hitDone && swing >= 0.5) {
      s.hitDone = true;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (e.dead) continue;
        const dx = e.grp.position.x - px;
        const dz = e.grp.position.z - pz;
        if (dx*dx + dz*dz > SLASH_RADIUS * SLASH_RADIUS) continue;
        let diff = Math.atan2(dx, dz) - s.facing;
        while (diff >  Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        if (Math.abs(diff) > s.halfHit) continue;
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
  }
}

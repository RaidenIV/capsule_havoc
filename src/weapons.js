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
  uniform float uFade;     // 1→0: global brightness (used for blade/bloom, not trail wipe)
  uniform float uFadeWipe; // 0→1 during fade phase: dissolve front sweeps tail→tip
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  float shimmer(float x, float t){
    return 1.0 + sin(x * 20.0 + t * 12.0) * 0.03
               + sin(x * 11.0 - t *  8.0) * 0.02;
  }

  void main(){
    // Reveal: hide past leading edge
    float mask = 1.0 - smoothstep(uProgress - 0.02, uProgress + 0.008, vUv.x);
    if (mask < 0.001) discard;

    // Directional fade: dissolve front sweeps from UV.x=0 (tail) → UV.x=1 (tip)
    // uFadeWipe=0 → nothing faded; uFadeWipe=1 → everything faded
    float fadeWipe = smoothstep(uFadeWipe - 0.18, uFadeWipe + 0.04, vUv.x);
    if (fadeWipe < 0.001) discard;

    float base = smoothstep(0.0, 0.04, vUv.x);

    float whiteZone = smoothstep(0.58, 1.0, vUv.y);
    float bodyFill  = vUv.y * 0.55 + 0.18;
    float leadFlash = smoothstep(uProgress - 0.14, uProgress, vUv.x) * pow(vUv.y, 0.5) * 0.5;
    float outerLine = exp(-(1.0 - vUv.y) * (1.0 - vUv.y) * 55.0) * 0.6;
    float sh = shimmer(vUv.x, uTime);

    vec3 bodyCol = mix(uColor * 0.9, vec3(0.75, 0.90, 1.0), whiteZone * 0.5);
    vec3 col     = mix(bodyCol, vec3(1.0, 1.0, 1.0),
                       whiteZone * 0.85 + outerLine + leadFlash);

    float alpha = (bodyFill + whiteZone * 0.7 + outerLine + leadFlash) * sh * base * mask * fadeWipe;

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 2. Main blade shader ──────────────────────────────────────────────────────
//  Laser-thin white core + electric-blue halo.
//  uTime drives a gentle plasma ripple along the blade length.
// Solid white rod — flat-top fill across the hw width, rounded tip.
// hw=0.12 in world units so the rod is clearly visible from top-down camera.
// UV.y: 0=one long edge, 0.5=centerline, 1=other long edge
const _bladeFrag = /* glsl */`
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;   // 0=centre, 1=geometry edge

    // Flat-top white fill: solid across ~80% of width, smooth rolloff to edge
    float rod   = 1.0 - smoothstep(0.72, 1.0, cy);

    // Subtle inner blue tint at the very center (lightsaber inner glow)
    float inner = exp(-cy * cy * 6.0) * 0.18;

    // Rounded tip taper
    float taper = 1.0 - smoothstep(0.88, 1.0, vUv.x) * 0.85;
    // Clean hilt start — no hard clip
    float base  = smoothstep(0.0, 0.035, vUv.x);

    vec3  col   = rod * (vec3(1.0) + uColor * inner);
    float alpha = rod * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

// ── 3. Blue bloom layer ──────────────────────────────────────────────────────
//  Wide gaussian that envelops the white rod — hw=0.50 geometry, pure blue bloom.
//  This is the "corona" of the lightsaber, wider than the rod itself.
//  UV.y=0.5 aligns with the rod centerline; falloff spreads to hw edges.
const _afterFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    float cy    = abs(vUv.y - 0.5) * 2.0;   // 0=centerline, 1=bloom edge (hw=0.50)

    // Wide gaussian bloom — peaks at rod center, fades to edges
    // With hw=0.50 and exp(-cy²×4), at cy=0: 1.0, at cy=0.5 (= 0.25 world): 0.54,
    // at cy=1.0 (= 0.50 world): 0.018  — smooth corona
    float bloom = exp(-cy * cy * 4.0);

    float taper = 1.0 - smoothstep(0.86, 1.0, vUv.x) * 0.65;
    float base  = smoothstep(0.0, 0.04, vUv.x);

    vec3  col   = uColor * 1.8 + vec3(0.4, 0.6, 0.9) * bloom * 0.3;
    float alpha = bloom * 0.70 * taper * base * uFade;
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
      uFadeWipe: { value: 1.0 }, // starts at 1 = fully visible; driven to 0→1 during fade
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
  const afterGeo  = _buildBladeGeo(SLASH_INNER_R, SLASH_RADIUS, 0.50); // hw=0.50 = wide blue bloom corona
  const afterMat  = _makeAfterMat();
  const afterMesh = new THREE.Mesh(afterGeo, afterMat);
  afterMesh.position.set(px, slashY, pz);
  afterMesh.rotation.y = _bearingToRotY(startA);
  afterMesh.layers.enable(2);
  scene.add(afterMesh);

  // ── Main blade (white rod, rendered on top of bloom) ────────────────────────────────────────────────────────────
  const bladeGeo  = _buildBladeGeo(SLASH_INNER_R, SLASH_RADIUS, 0.12);  // hw=0.12 = visible rod width
  const bladeMat  = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.set(px, slashY + 0.01, pz);
  bladeMesh.rotation.y = _bearingToRotY(startA);
  bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  const dmg = Math.round(SLASH_DAMAGE * (getBulletDamage() / 10));
  playSound('laser_sword', 0.7, 0.92 + Math.random() * 0.16);

  state.slashEffects.push({
    trailMesh, arcGeo, trailMat,
    bladeMesh, bladeGeo, bladeMat,
    afterMesh, afterGeo, afterMat,

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

      state.slashEffects.splice(i, 1);
      continue;
    }

    // ── Track player ─────────────────────────────────────────────────────────
    const slashY = playerGroup.position.y + SLASH_Y_OFFSET;
    const px = playerGroup.position.x, pz = playerGroup.position.z;
    s.trailMesh.position.set(px, slashY - 0.02, pz);
    s.bladeMesh.position.set(px, slashY + 0.01, pz);   // rod slightly above bloom
    s.afterMesh.position.set(px, slashY,          pz);   // bloom base layer

    // ── Swing progress: ease-out over SLASH_SWING_TIME ───────────────────────
    const rawSwing = Math.min(1, s.elapsed / SLASH_SWING_TIME);
    const swing    = 1 - Math.pow(1 - rawSwing, 2.2);

    // ── Fade: holds 1 while swinging, then drops over SLASH_FADE_TIME ────────
    const fade = s.life <= SLASH_FADE_TIME
      ? Math.pow(s.life / SLASH_FADE_TIME, 0.65)
      : 1.0;

    // ── Update trail ─────────────────────────────────────────────────────────
    s.trailMat.uniforms.uProgress.value  = swing;
    s.trailMat.uniforms.uFade.value      = fade;
    s.trailMat.uniforms.uTime.value      = s.elapsed;
    // uFadeWipe: 1.0 = fully visible; sweeps 0→1 (tail→tip) during SLASH_FADE_TIME
    const fadePhaseT = s.life <= SLASH_FADE_TIME
      ? 1.0 - (s.life / SLASH_FADE_TIME)   // 0 at fade start, 1 at end
      : 0.0;
    s.trailMat.uniforms.uFadeWipe.value  = 1.0 - fadePhaseT; // 1→0 as arc dissolves

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

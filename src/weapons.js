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

// ─────────────────────────────────────────────────────────────────────────────
//  SWORD SWING  –  Arc trail + rotating blade line
//
//  Visual design:
//    • Ring-sector (wedge) geometry = the glowing arc TRAIL left by the swing
//    • Thin flat rectangle = the BLADE LINE itself, rotates across the arc
//    • Outer edge (cutting edge) is the brightest part of the trail
//    • Blade snaps from start-angle to end-angle over SLASH_SWING_TIME
//    • Tip sparkle bursts at blade tip when swing peaks
//
//  NOTE: game uses atan2(moveX, moveZ) convention (bearing), so
//    facing +Z → angle 0 → geometry must use sin(a) for X, cos(a) for Z
// ─────────────────────────────────────────────────────────────────────────────

// Ring-sector trail geometry
// UV.x = 0 (swing-start / tail) → 1 (swing-end / leading edge)
// UV.y = 0 (inner radius / hilt) → 1 (outer radius / cutting edge)
function _buildArcGeo(innerR, outerR, startAngle, totalArc, segs = 64) {
  const pos = [], uvs = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const a = startAngle + t * totalArc;
    const sx = Math.sin(a), cz = Math.cos(a);
    pos.push(sx * innerR, 0, cz * innerR);  uvs.push(t, 0);
    pos.push(sx * outerR, 0, cz * outerR);  uvs.push(t, 1);
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

// Blade-line geometry: extends along +X from innerR to outerR, thin in Z
// Mesh is rotated via rotation.y each frame to follow the leading edge
function _buildBladeGeo(innerR, outerR) {
  const hw = 0.08; // half-thickness
  const pos = new Float32Array([
    innerR, 0, -hw,   outerR, 0, -hw,
    outerR, 0,  hw,   innerR, 0,  hw,
  ]);
  const uvs = new Float32Array([0,0, 1,0, 1,1, 0,1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex([0,1,2, 0,2,3]);
  return g;
}

// Trail shader
// UV.x: arc position (0=tail, 1=leading edge shown by uProgress mask)
// UV.y: radial (0=inner/hilt, 1=outer/cutting edge)
const _trailVert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;
const _trailFrag = /* glsl */`
  uniform float uProgress;  // 0→1: reveal arc from tail to leading edge
  uniform float uFade;      // 1→0: overall brightness after peak
  uniform vec3  uColor;
  varying vec2  vUv;
  void main(){
    // Hide geometry past the current leading edge
    float mask = 1.0 - smoothstep(uProgress - 0.04, uProgress + 0.01, vUv.x);
    if (mask < 0.001) discard;

    // Cutting-edge glow: outer radius (UV.y → 1) is brightest
    float edgeFalloff = pow(vUv.y, 1.4);   // dim near hilt, bright at tip

    // Trail fades toward the tail (UV.x=0)
    float trailFade = pow(vUv.x / max(uProgress, 0.02), 2.5);

    // Thin bright line right at the outer edge
    float edge = exp(-(1.0 - vUv.y) * (1.0 - vUv.y) * 90.0);

    vec3 col = mix(uColor * 0.4, vec3(1.0, 1.0, 1.0), edge * 0.85);
    float alpha = (edgeFalloff * 0.6 + edge * 0.9) * trailFade * mask * uFade;
    alpha = clamp(alpha, 0.0, 1.0);
    gl_FragColor = vec4(col, alpha);
  }
`;

// Blade shader  UV.x: 0=hilt, 1=tip   UV.y: 0/1=edges, 0.5=center
const _bladeVert = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;
const _bladeFrag = /* glsl */`
  uniform float uFade;
  uniform vec3  uColor;
  varying vec2  vUv;
  void main(){
    float cy   = abs(vUv.y - 0.5) * 2.0;          // 0 = centre, 1 = edge
    float core = exp(-cy * cy * 180.0);            // white-hot core
    float glow = exp(-cy * cy *  18.0);            // blue glow
    float taper = 1.0 - smoothstep(0.85, 1.0, vUv.x) * 0.7;  // tip taper
    float base  = smoothstep(0.0, 0.06, vUv.x);               // base fade-in

    vec3  col   = core * vec3(1.0) + glow * uColor * 1.8;
    float alpha = (core * 2.5 + glow * 0.8) * taper * base * uFade;
    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
  }
`;

function _makeTrailMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _trailVert, fragmentShader: _trailFrag,
    uniforms: {
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uColor:    { value: new THREE.Vector3(0.15, 0.55, 1.0) },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function _makeBladeMat() {
  return new THREE.ShaderMaterial({
    vertexShader: _bladeVert, fragmentShader: _bladeFrag,
    uniforms: {
      uFade:  { value: 1.0 },
      uColor: { value: new THREE.Vector3(0.25, 0.65, 1.0) },
    },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

function _makeTipSparkle(pos) {
  const g = new THREE.Group();
  g.position.copy(pos);
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const len   = 0.12 + Math.random() * 0.18;
    const geo   = new THREE.PlaneGeometry(len, 0.05);
    geo.translate(len * 0.5, 0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xffffff : 0x44bbff,
      transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.z = angle;
    m.layers.enable(2);
    g.add(m);
  }
  g.layers.enable(2);
  return g;
}

// Convert our bearing angle (atan2(moveX,moveZ)) to mesh rotation.y
// so that the blade extends toward the bearing direction
function _bearingToRotY(a) { return a - Math.PI / 2; }

// ── performSlash ──────────────────────────────────────────────────────────────
export function performSlash() {
  const facing = Math.atan2(state.lastMoveX, state.lastMoveZ);
  const half   = SLASH_VISUAL_ARC * 0.5;
  const startA = facing - half;
  const endA   = facing + half;

  // Arc trail mesh (full arc, revealed progressively via shader)
  const arcGeo  = _buildArcGeo(SLASH_INNER_R, SLASH_RADIUS, startA, SLASH_VISUAL_ARC);
  const trailMat = _makeTrailMat();
  const trailMesh = new THREE.Mesh(arcGeo, trailMat);
  trailMesh.position.copy(playerGroup.position);
  trailMesh.position.y = 0.08;
  trailMesh.layers.enable(2);
  scene.add(trailMesh);

  // Blade line (rotates from startA → endA)
  const bladeGeo  = _buildBladeGeo(SLASH_INNER_R, SLASH_RADIUS);
  const bladeMat  = _makeBladeMat();
  const bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
  bladeMesh.position.copy(playerGroup.position);
  bladeMesh.position.y = 0.14;
  bladeMesh.rotation.y = _bearingToRotY(startA);
  bladeMesh.layers.enable(2);
  scene.add(bladeMesh);

  // Tip sparkle position (at blade tip on the leading edge)
  const dmg = Math.round(SLASH_DAMAGE * (getBulletDamage() / 10));

  state.slashEffects.push({
    trailMesh, arcGeo, trailMat,
    bladeMesh, bladeGeo, bladeMat,
    startA, endA,
    tipSparkle: null, sparkleLife: 0,
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

    if (s.life <= 0) {
      scene.remove(s.trailMesh); s.arcGeo.dispose();   s.trailMat.dispose();
      scene.remove(s.bladeMesh); s.bladeGeo.dispose(); s.bladeMat.dispose();
      if (s.tipSparkle) {
        scene.remove(s.tipSparkle);
        s.tipSparkle.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
      }
      state.slashEffects.splice(i, 1);
      continue;
    }

    // Swing progress: 0→1 over SLASH_SWING_TIME, ease-out
    const rawSwing  = Math.min(1, s.elapsed / SLASH_SWING_TIME);
    const swing     = 1 - Math.pow(1 - rawSwing, 2.0); // ease-out

    // Overall fade: holds at 1 while swinging, then 1→0 over SLASH_FADE_TIME
    const fade = s.life <= SLASH_FADE_TIME
      ? Math.pow(s.life / SLASH_FADE_TIME, 0.65)
      : 1.0;

    // Update trail shader
    s.trailMat.uniforms.uProgress.value = swing;
    s.trailMat.uniforms.uFade.value     = fade;

    // Rotate blade to current leading edge
    const currentAngle = s.startA + swing * SLASH_VISUAL_ARC;
    s.bladeMesh.rotation.y = _bearingToRotY(currentAngle);
    s.bladeMat.uniforms.uFade.value = swing < 1.0 ? fade : fade * 0.6; // blade dims after peak

    // Tip sparkle at peak
    if (!s.tipSparkle && swing >= 0.98) {
      const tx = playerGroup.position.x + Math.sin(s.endA) * SLASH_RADIUS;
      const tz = playerGroup.position.z + Math.cos(s.endA) * SLASH_RADIUS;
      s.tipSparkle  = _makeTipSparkle(new THREE.Vector3(tx, 0.18, tz));
      s.sparkleLife = 0.12;
      scene.add(s.tipSparkle);
    }

    if (s.tipSparkle) {
      s.sparkleLife -= worldDelta;
      const sf = Math.max(0, s.sparkleLife / 0.12);
      s.tipSparkle.children.forEach(c => {
        c.material.opacity = sf * 0.9;
        c.scale.setScalar(1 + (1 - sf) * 1.8);
      });
      if (s.sparkleLife <= 0) {
        scene.remove(s.tipSparkle);
        s.tipSparkle.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
        s.tipSparkle = null;
      }
    }

    // Damage at 50% through swing
    if (!s.hitDone && swing >= 0.5) {
      s.hitDone = true;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (e.dead) continue;
        const dx = e.grp.position.x - playerGroup.position.x;
        const dz = e.grp.position.z - playerGroup.position.z;
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

// ─── weapons.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import {
  BULLET_SPEED, BULLET_LIFETIME, ENEMY_BULLET_DMG, WEAPON_CONFIG,
  SLASH_RADIUS, SLASH_ARC, SLASH_DAMAGE, SLASH_DURATION,
  SLASH_EXTEND_TIME, SLASH_FADE_TIME, SLASH_WIDTH,
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
// ── Slash attack ──────────────────────────────────────────────────────────────
// ── Slash ShaderMaterial factory ──────────────────────────────────────────────
// One shared shader definition; each slash gets its own uniform instances.
const _slashVert = /* glsl */`
  varying vec2 vUv;
  void main(){
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
  }
`;
const _slashFrag = /* glsl */`
  uniform float uTime;
  uniform float uProgress;   // 0 → 1  (blade grows from base to tip)
  uniform float uFade;       // 1 → 0  (overall fade after peak)
  uniform vec3  uColor;      // electric blue
  varying vec2  vUv;

  // Cheap plasma shimmer: layered sin bands scrolling along the blade
  float plasma(float x, float t){
    float n  = sin(x * 14.0 + t * 9.0)  * 0.50;
        n += sin(x *  9.0 - t * 6.0)  * 0.30;
        n += sin(x * 22.0 + t * 14.0) * 0.20;
    return n * 0.5 + 0.5;                       // remap 0..1
  }

  void main(){
    // ── 1. Cross-section glow (distance from centre line in UV.y) ────────────
    float cy    = vUv.y - 0.5;                  // -0.5 … +0.5
    float core  = exp(-cy * cy * 260.0);        // white-hot core (very tight)
    float glow  = exp(-cy * cy *  22.0);        // electric blue glow (wide)
    float halo  = exp(-cy * cy *   6.0);        // outer soft halo

    // ── 2. Length mask — blade grows from base (uv.x=0) → tip (uv.x=1) ──────
    //    Soft leading edge so tip looks like it's cutting through air
    float lenMask = 1.0 - smoothstep(uProgress - 0.10, uProgress + 0.01, vUv.x);

    // ── 3. Tip taper — blade narrows at the very tip ──────────────────────────
    float taper = 1.0 - smoothstep(0.80, 1.00, vUv.x) * 0.65;

    // ── 4. Base fade — slight taper back at origin so it doesn't hard-clip ───
    float baseFade = smoothstep(0.0, 0.04, vUv.x);

    // ── 5. Plasma shimmer along the blade ────────────────────────────────────
    float shimmer = plasma(vUv.x, uTime) * 0.22 + 0.78;

    // ── 6. Assemble colour layers ─────────────────────────────────────────────
    vec3 coreCol  = vec3(1.00, 1.00, 1.00);            // white
    vec3 glowCol  = uColor;                             // electric blue
    vec3 haloCol  = uColor * vec3(0.5, 0.75, 1.4);     // cooler blue-purple halo

    vec3 col =  coreCol * core * 2.2
              + glowCol * glow * shimmer * 1.4
              + haloCol * halo * 0.5;

    // ── 7. Alpha — additive so alpha == brightness contribution ───────────────
    float alpha = (core * 2.0 + glow * 1.0 + halo * 0.35)
                  * lenMask * taper * baseFade * uFade;

    // Clamp — additive blending so brightness > 1 is fine, but alpha needs cap
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(col, alpha);
  }
`;

function _makeSlashMat() {
  return new THREE.ShaderMaterial({
    vertexShader:   _slashVert,
    fragmentShader: _slashFrag,
    uniforms: {
      uTime:     { value: 0.0 },
      uProgress: { value: 0.0 },
      uFade:     { value: 1.0 },
      uColor:    { value: new THREE.Vector3(0.25, 0.65, 1.0) },
    },
    transparent:  true,
    depthWrite:   false,
    blending:     THREE.AdditiveBlending,
    side:         THREE.DoubleSide,
  });
}

// ── Tip sparkle — tiny radial burst at blade tip on peak ──────────────────────
function _makeTipSparkle(tipPos) {
  const group = new THREE.Group();
  group.position.copy(tipPos);
  const SPOKES = 8;
  for (let i = 0; i < SPOKES; i++) {
    const angle = (i / SPOKES) * Math.PI * 2;
    const len   = 0.18 + Math.random() * 0.22;
    const geo   = new THREE.PlaneGeometry(len, 0.06);
    // Offset geometry so it extends outward from center
    geo.translate(len * 0.5, 0, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0xffffff : 0x66ddff,
      transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.rotation.z = angle;
    m.layers.enable(2);
    group.add(m);
  }
  group.layers.enable(2);
  return group;
}

// ── performSlash ──────────────────────────────────────────────────────────────
export function performSlash() {
  const facingAngle = Math.atan2(state.lastMoveX, state.lastMoveZ);
  const halfArc     = SLASH_ARC / 2;
  const dmg         = Math.round(SLASH_DAMAGE * (getBulletDamage() / 10));

  // Blade plane: PlaneGeometry(length, width), lying flat on XZ, facing up
  const geo = new THREE.PlaneGeometry(SLASH_RADIUS, SLASH_WIDTH, 1, 1);
  const mat = _makeSlashMat();
  const mesh = new THREE.Mesh(geo, mat);

  // Lay flat
  mesh.rotation.x = -Math.PI / 2;
  // Orient along attack direction
  mesh.rotation.z = -facingAngle;
  // Offset so blade extends *forward* from player (not centered on player)
  const fwdX = Math.sin(facingAngle);
  const fwdZ = Math.cos(facingAngle);
  mesh.position.set(
    playerGroup.position.x + fwdX * (SLASH_RADIUS * 0.5),
    0.12,
    playerGroup.position.z + fwdZ * (SLASH_RADIUS * 0.5),
  );
  mesh.layers.enable(2); // bloom
  scene.add(mesh);

  // Tip world position (for sparkle)
  const tipPos = new THREE.Vector3(
    playerGroup.position.x + fwdX * SLASH_RADIUS,
    0.18,
    playerGroup.position.z + fwdZ * SLASH_RADIUS,
  );

  state.slashEffects.push({
    mesh, mat, geo,
    tipPos,
    tipSparkle:  null,        // created at peak
    sparkleLife: 0,
    life:        SLASH_DURATION,
    maxLife:     SLASH_DURATION,
    hitDone:     false,
    dmg,
    facingAngle,
    halfArc,
    elapsed:     0,
  });
}

// ── updateSlashEffects ────────────────────────────────────────────────────────
export function updateSlashEffects(worldDelta) {
  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.life    -= worldDelta;
    s.elapsed += worldDelta;

    if (s.life <= 0) {
      scene.remove(s.mesh);
      s.geo.dispose();
      s.mat.dispose();
      if (s.tipSparkle) {
        scene.remove(s.tipSparkle);
        s.tipSparkle.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
      }
      state.slashEffects.splice(i, 1);
      continue;
    }

    const totalLife = s.maxLife;

    // uProgress: 0 → 1 over SLASH_EXTEND_TIME
    const progress = Math.min(1.0, s.elapsed / SLASH_EXTEND_TIME);

    // uFade: 1 while extending, then 1→0 over SLASH_FADE_TIME
    const fadeStart = totalLife - SLASH_FADE_TIME;
    const fade      = s.life <= SLASH_FADE_TIME
      ? s.life / SLASH_FADE_TIME
      : 1.0;

    s.mat.uniforms.uTime.value     = s.elapsed;
    s.mat.uniforms.uProgress.value = progress;
    s.mat.uniforms.uFade.value     = fade;

    // Spawn tip sparkle the moment blade fully extends
    if (!s.tipSparkle && progress >= 1.0) {
      s.tipSparkle  = _makeTipSparkle(s.tipPos);
      s.sparkleLife = 0.10;
      scene.add(s.tipSparkle);
    }

    // Fade sparkle
    if (s.tipSparkle) {
      s.sparkleLife -= worldDelta;
      const sf = Math.max(0, s.sparkleLife / 0.10);
      s.tipSparkle.children.forEach(c => {
        c.material.opacity = sf * 0.95;
        // Scale spokes outward as they fade
        const sc = 1 + (1 - sf) * 1.4;
        c.scale.setScalar(sc);
      });
      if (s.sparkleLife <= 0) {
        scene.remove(s.tipSparkle);
        s.tipSparkle.children.forEach(c => { c.geometry.dispose(); c.material.dispose(); });
        s.tipSparkle = null;
      }
    }

    // Damage fires when blade is 50% extended
    if (!s.hitDone && progress >= 0.5) {
      s.hitDone = true;
      for (let j = state.enemies.length - 1; j >= 0; j--) {
        const e = state.enemies[j];
        if (e.dead) continue;
        const dx   = e.grp.position.x - playerGroup.position.x;
        const dz   = e.grp.position.z - playerGroup.position.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > SLASH_RADIUS) continue;

        let angleDiff = Math.atan2(dx, dz) - s.facingAngle;
        while (angleDiff >  Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (Math.abs(angleDiff) > s.halfArc) continue;

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

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

// ═══════════════════════════════════════════════════════════════════════════════
//  360° SPIN-SLASH
// ═══════════════════════════════════════════════════════════════════════════════

const S_RANGE   = 5.0; // outer radius
const S_INNER   = 0.75; // gap between player body and blade
const S_RX      = 1.00; // ellipse X scale (world X axis)
const S_RZ      = 1.00; // circular (equal axes = blade stays radially aligned)
const S_SWEEP   = Math.PI * 1.94; // ~349° sweep — nearly full circle
const S_SWING_T = 0.16; // time to complete the full spin
const S_FADE_T  = 0.14; // fade-out duration
const S_Y       = 1.0; // player y offset (half capsule height)

const _sv = /* glsl */`
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }
`;

const _arcFrag = /* glsl */`
  uniform float uProgress;
  uniform float uWipe;
  uniform float uFade;
  uniform float uTime;
  uniform vec3  uColor;
  varying vec2  vUv;

  void main(){
    if (vUv.x > uProgress + 0.012) discard;

    float wipe = smoothstep(uWipe - 0.18, uWipe + 0.025, vUv.x);
    if (wipe < 0.001) discard;

    float base  = smoothstep(0.0, 0.035, vUv.x);
    float white = smoothstep(0.52, 1.0, vUv.y);
    float body  = vUv.y * 0.58 + 0.14;
    float outer = exp(-(1.0 - vUv.y)*(1.0 - vUv.y)*44.0);
    float flash = smoothstep(uProgress - 0.10, uProgress, vUv.x) * pow(vUv.y, 0.55) * 0.42;
    float sh    = 0.97 + sin(vUv.x * 26.0 + uTime * 11.0) * 0.02
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

const _SBLUE = new THREE.Vector3(0.25, 0.65, 1.0);
const _SADD  = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide };
const _mkArc = () => new THREE.ShaderMaterial({
  vertexShader: _sv, fragmentShader: _arcFrag,
  uniforms: { uProgress:{value:0}, uWipe:{value:0}, uFade:{value:1}, uTime:{value:0}, uColor:{value:_SBLUE.clone()} },
  ..._SADD,
});

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

function _spinDamage(px, pz, range, dmg) {
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

export function performSlash() {
  if (!state.slashEffects) state.slashEffects = [];
  if (state.slashEffects.length > 8) return;

  state._sf    = ((state._sf | 0) + 1) & 1;
  const startA = Math.PI;
  const sweepA = state._sf ? S_SWEEP : -S_SWEEP;

  const range = S_RANGE, inner = S_INNER;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const y  = playerGroup.position.y + S_Y;

  const arcGeo  = _buildEllipseArc(inner, range, S_RX, S_RZ, startA, sweepA);
  const arcMat  = _mkArc();
  const arcMesh = new THREE.Mesh(arcGeo, arcMat);
  arcMesh.position.set(px, y - 0.02, pz);
  arcMesh.frustumCulled = false;
  arcMesh.layers.enable(1); arcMesh.layers.enable(2);
  scene.add(arcMesh);

  const dmg = Math.max(1, Math.round(getBulletDamage() * 1.2));
  _spinDamage(px, pz, range, dmg);
  playSound('laser_sword', 0.72, 0.93 + Math.random() * 0.14);

  state.slashEffects.push({ arcMesh, arcGeo, arcMat, t: 0, startA, sweepA });
}

export function updateSlashEffects(worldDelta) {
  if (!state.slashEffects || state.slashEffects.length === 0) return;

  for (let i = state.slashEffects.length - 1; i >= 0; i--) {
    const s = state.slashEffects[i];
    s.t += worldDelta;

    if (s.t >= S_SWING_T + S_FADE_T) {
      scene.remove(s.arcMesh); s.arcGeo.dispose(); s.arcMat.dispose();
      state.slashEffects.splice(i, 1);
      continue;
    }

    const swing = 1.0 - Math.pow(1.0 - Math.min(1.0, s.t / S_SWING_T), 2.0);

    const inFade    = s.t > S_SWING_T;
    const fadePhase = inFade ? (s.t - S_SWING_T) / S_FADE_T : 0.0;
    const fade      = inFade ? Math.pow(1.0 - fadePhase, 0.68) : 1.0;
    const wipe      = inFade ? fadePhase : 0.0;

    const px = playerGroup.position.x;
    const pz = playerGroup.position.z;
    const y  = playerGroup.position.y + S_Y;

    s.arcMesh.position.set(px, y - 0.02, pz);
    s.arcMat.uniforms.uProgress.value = swing;
    s.arcMat.uniforms.uWipe.value     = wipe;
    s.arcMat.uniforms.uFade.value     = fade;
    s.arcMat.uniforms.uTime.value     = (state.elapsed || 0) + s.t;
  }
}

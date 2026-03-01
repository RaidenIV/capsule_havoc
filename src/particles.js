// ─── particles.js ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { setExplBloom, explBloom } from './bloom.js';

const _particleGeo       = new THREE.SphereGeometry(1, 5, 5);
const _particleMatCache  = new Map();
export const _particleMeshPool = [];

// Explosion visual config (mutated by control panel)
export const explConfig = {
  std:   { count: 10,  size: 0.25, speed: 1.0,  glow: 0.0  },
  elite: { count: 100, size: 0.5,  speed: 1.75, glow: 12.0 },
};

function getParticleMat(col) {
  let m = _particleMatCache.get(col);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 1,
      metalness: 0.5, roughness: 0.3, transparent: true,
    });
    _particleMatCache.set(col, m);
  }
  return m;
}

export function spawnExplosion(pos, eliteType = null) {
  const isElite = !!eliteType;
  const cfg     = isElite ? explConfig.elite : explConfig.std;
  const colors  = isElite && eliteType
    ? [eliteType.color, eliteType.color, eliteType.color, 0xffffff, 0xffee88]
    : [0xcc0000, 0xaa0000, 0xdd0000, 0x880000, 0xff1111, 0xbb0000];

  // Signal bloom which settings to use for this frame
  setExplBloom(
    isElite ? explBloom.eliteThreshold : explBloom.stdThreshold,
    isElite ? explBloom.eliteStrength  : explBloom.stdStrength,
  );

  for (let i = 0; i < Math.round(cfg.count); i++) {
    const baseRadius = (0.06 + Math.random() * 0.12) * cfg.size;
    const col  = colors[Math.floor(Math.random() * colors.length)];
    const mat  = getParticleMat(col);
    let mesh   = _particleMeshPool.pop();
    if (mesh) { mesh.material = mat; }
    else { mesh = new THREE.Mesh(_particleGeo, mat); mesh.layers.enable(2); }
    mesh.scale.setScalar(baseRadius);
    mesh.position.copy(pos); mesh.position.y = 1;
    mesh.visible = true;
    const theta = Math.random() * Math.PI * 2;
    const phi   = (Math.random() - 0.5) * Math.PI;
    const spd   = (4 + Math.random() * 8) * cfg.speed;
    scene.add(mesh);
    state.particles.push({
      mesh, baseRadius,
      vx: Math.cos(theta) * Math.cos(phi) * spd,
      vy: Math.sin(phi) * spd + 2 * cfg.speed,
      vz: Math.sin(theta) * Math.cos(phi) * spd,
      life: 1, maxLife: 0.5 + Math.random() * 0.6,
      glowCap: cfg.glow,
    });
  }
}

export function updateParticles(worldDelta) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= worldDelta;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      _particleMeshPool.push(p.mesh);
      state.particles.splice(i, 1);
      continue;
    }
    p.mesh.position.x += p.vx * worldDelta;
    p.mesh.position.y += p.vy * worldDelta;
    p.mesh.position.z += p.vz * worldDelta;
    p.vy -= 9 * worldDelta;
    const t = p.life / p.maxLife;
    p.mesh.scale.setScalar(t * 1.2 * p.baseRadius);
    p.mesh.material.emissiveIntensity = Math.min(t * 5, p.glowCap);
    p.mesh.material.opacity = t;
  }
}

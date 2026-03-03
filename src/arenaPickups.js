// ─── arenaPickups.js ────────────────────────────────────────────────────────
// Timed arena pickups (double damage, invincibility, coin value 2x, xp 2x, armor,
// clock, black hole). This is a minimal implementation to match the design doc.
// Pickups are spawned occasionally and collected on contact.

import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup } from './player.js';
import { applyEffect } from './activeEffects.js';
import { grantArmor } from './armor.js';
import { playSound } from './audio.js';
import { getLuckSpawnMultiplier } from './luck.js';

const PICKUP_TYPES = [
  'doubleDamage',
  'invincibility',
  'coinValue2x',
  'xp2x',
  'armor',
  'clock',
  'blackHole',
];

const geo = new THREE.IcosahedronGeometry(0.45, 0);
const mats = {
  doubleDamage: new THREE.MeshStandardMaterial({ color: 0xff3355, emissive: 0xff0022, emissiveIntensity: 1.1, metalness: 0.4, roughness: 0.25 }),
  invincibility: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x88ffff, emissiveIntensity: 1.1, metalness: 0.25, roughness: 0.2 }),
  coinValue2x: new THREE.MeshStandardMaterial({ color: 0xffe566, emissive: 0xffcc55, emissiveIntensity: 1.0, metalness: 0.6, roughness: 0.25 }),
  xp2x: new THREE.MeshStandardMaterial({ color: 0x55ccff, emissive: 0x55ccff, emissiveIntensity: 1.0, metalness: 0.35, roughness: 0.22 }),
  armor: new THREE.MeshStandardMaterial({ color: 0x66ff99, emissive: 0x00ff66, emissiveIntensity: 0.95, metalness: 0.4, roughness: 0.25 }),
  clock: new THREE.MeshStandardMaterial({ color: 0xbbccff, emissive: 0x88aaff, emissiveIntensity: 0.95, metalness: 0.35, roughness: 0.25 }),
  blackHole: new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x6600ff, emissiveIntensity: 1.2, metalness: 0.2, roughness: 0.35 }),
};

let _spawnTimer = 0;

export function initArenaPickups(){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];
  _spawnTimer = 8.0;
}

function randType(){
  return PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
}

function spawnAtRandom(type){
  const mat = (mats[type] || mats.doubleDamage).clone();
  const mesh = new THREE.Mesh(geo, mat);
  const ang = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * 14;
  mesh.position.set(playerGroup.position.x + Math.cos(ang) * r, 0.65, playerGroup.position.z + Math.sin(ang) * r);
  mesh.castShadow = true;
  mesh.layers.enable(1);
  scene.add(mesh);
  state.arenaPickups.push({ type, mesh, mat, life: 18.0, bob: Math.random() * Math.PI * 2 });
}

export function updateArenaPickups(worldDelta){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];

  // Spawn loop (luck reduces interval)
  const mult = getLuckSpawnMultiplier();
  _spawnTimer -= worldDelta;
  if (_spawnTimer <= 0) {
    const t = randType();
    spawnAtRandom(t);
    // Base 18s interval, luck can bring it down.
    _spawnTimer = (45.0 * mult) * (0.75 + Math.random() * 0.5);
  }

  // Update / collection
  for (let i = state.arenaPickups.length - 1; i >= 0; i--) {
    const p = state.arenaPickups[i];
    p.life -= worldDelta;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mat.dispose();
      state.arenaPickups.splice(i, 1);
      continue;
    }
    p.bob += worldDelta * 2.0;
    p.mesh.rotation.y += worldDelta * 1.1;
    p.mesh.position.y = 0.65 + Math.sin(p.bob) * 0.12;

    const dx = playerGroup.position.x - p.mesh.position.x;
    const dz = playerGroup.position.z - p.mesh.position.z;
    const dist2 = dx*dx + dz*dz;

    // Magnet attraction — same range as coins (level-based + magnet upgrade)
    const baseAttract = [5.0,5.5,6.0,6.5,7.0,7.5,8.0,8.5,9.0,9.5,10.0][Math.min(state.playerLevel || 1, 10)];
    const attractDist = baseAttract + Math.max(0, state.upg?.magnet || 0) * 1.25;
    const dist = Math.sqrt(dist2);
    if (dist < attractDist && dist > 0.001) {
      const spd = 9.0 * worldDelta;
      p.mesh.position.x += (dx / dist) * Math.min(spd, dist);
      p.mesh.position.z += (dz / dist) * Math.min(spd, dist);
    }

    if (dist2 < 0.85*0.85) {
      // collect
      scene.remove(p.mesh);
      p.mat.dispose();
      state.arenaPickups.splice(i, 1);

      if (p.type === 'armor') {
        grantArmor(3);
      } else {
        const dur = (p.type === 'clock') ? 8 : 10;
        applyEffect(p.type, dur);
      }
      // small pickup blip
      playSound('coin', 0.25, 1.2);
    }
  }
}

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
import { notifyPowerup } from './hudEffects.js';

const PICKUP_TYPES = [
  'doubleDamage',
  'invincibility',
  'coinValue2x',
  'xp2x',
  'armor',
  'clock',
  'blackHole',
];

// Arena powerups should read as metallic, reflective pickups with emissive bloom.
// The cube is mounted so one corner sits at the pivot; the whole pickup spins
// around that corner rather than around its center.
const PICKUP_SIZE = 0.72;
const cubeGeo = new THREE.BoxGeometry(PICKUP_SIZE, PICKUP_SIZE, PICKUP_SIZE);
const cornerToCenter = new THREE.Vector3(PICKUP_SIZE * 0.5, PICKUP_SIZE * 0.5, PICKUP_SIZE * 0.5);
const balanceQuat = new THREE.Quaternion().setFromUnitVectors(
  cornerToCenter.clone().normalize(),
  new THREE.Vector3(0, 1, 0)
);
const scratchLift = new THREE.Vector3();

const mats = {
  doubleDamage: new THREE.MeshPhysicalMaterial({ color: 0xff3355, emissive: 0xff2244, emissiveIntensity: 1.35, metalness: 1.0, roughness: 0.12, clearcoat: 1.0, clearcoatRoughness: 0.08, reflectivity: 1.0 }),
  invincibility: new THREE.MeshPhysicalMaterial({ color: 0xffffff, emissive: 0xdfffff, emissiveIntensity: 1.25, metalness: 1.0, roughness: 0.08, clearcoat: 1.0, clearcoatRoughness: 0.04, reflectivity: 1.0 }),
  coinValue2x: new THREE.MeshPhysicalMaterial({ color: 0xffe566, emissive: 0xffd24d, emissiveIntensity: 1.25, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  xp2x: new THREE.MeshPhysicalMaterial({ color: 0x55ccff, emissive: 0x55ccff, emissiveIntensity: 1.25, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  armor: new THREE.MeshPhysicalMaterial({ color: 0x66ff99, emissive: 0x22ff77, emissiveIntensity: 1.25, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  clock: new THREE.MeshPhysicalMaterial({ color: 0xbbccff, emissive: 0x9db6ff, emissiveIntensity: 1.20, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  // Black hole pickup should stay visually black while still carrying a dark aura.
  blackHole: new THREE.MeshPhysicalMaterial({ color: 0x060606, emissive: 0x111111, emissiveIntensity: 1.35, metalness: 1.0, roughness: 0.14, clearcoat: 1.0, clearcoatRoughness: 0.08, reflectivity: 1.0 }),
};

let _spawnTimer = 0;

export function initArenaPickups(){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];
  _spawnTimer = 8.0;
}

function randType(){
  return PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
}

function createCornerPivotPickup(type){
  const mat = (mats[type] || mats.doubleDamage).clone();

  const pivot = new THREE.Group();
  const balance = new THREE.Group();
  balance.quaternion.copy(balanceQuat);

  const cube = new THREE.Mesh(cubeGeo, mat);
  cube.position.copy(cornerToCenter);
  cube.castShadow = true;
  cube.receiveShadow = true;
  cube.layers.enable(1); // bloom layer
  balance.add(cube);

  // Keep the bloom layer hot on the visible geometry only.
  pivot.add(balance);
  pivot.userData.balance = balance;
  pivot.userData.cube = cube;

  return { pivot, mat };
}

function spawnAtRandom(type){
  const { pivot, mat } = createCornerPivotPickup(type);
  const ang = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * 14;
  pivot.position.set(playerGroup.position.x + Math.cos(ang) * r, 0.14, playerGroup.position.z + Math.sin(ang) * r);
  scene.add(pivot);
  state.arenaPickups.push({ type, mesh: pivot, mat, life: 18.0, spin: Math.random() * Math.PI * 2 });
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

    // Spin around the contact corner instead of around the cube center.
    p.spin += worldDelta * 1.8;
    p.mesh.rotation.y = p.spin;

    // Small vertical hover keeps the corner from z-fighting with the floor while
    // preserving the "balanced on one corner" read.
    scratchLift.set(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), p.spin);
    p.mesh.position.y = 0.14 + Math.sin(p.spin * 2.0 + i) * 0.03;

    const dx = playerGroup.position.x - p.mesh.position.x;
    const dz = playerGroup.position.z - p.mesh.position.z;
    const dist2 = dx*dx + dz*dz;

    // Magnet attraction — locked to the DEFAULT coin radius (no scaling/upgrade)
    const attractDist = 5.0;
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
        notifyPowerup('Armor', null);
      } else {
        const dur = (p.type === 'clock') ? 8 : 10;
        applyEffect(p.type, dur);

        switch (p.type) {
          case 'doubleDamage':   notifyPowerup('Double Damage', dur, 'doubleDamage'); break;
          case 'invincibility':  notifyPowerup('Invincibility', dur, 'invincibility'); break;
          case 'coinValue2x':    notifyPowerup('2× Coin Value', dur, 'coinValue2x'); break;
          case 'xp2x':           notifyPowerup('2× XP', dur, 'xp2x'); break;
          case 'clock':          notifyPowerup('Time Slow', dur, 'clock'); break;
          case 'blackHole':      notifyPowerup('Black Hole', dur, 'blackHole'); break;
          default:               notifyPowerup(p.type, dur, p.type); break;
        }
      }
      // small pickup blip
      playSound('coin', 0.25, 1.2);
    }
  }
}

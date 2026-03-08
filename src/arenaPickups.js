// ─── arenaPickups.js ────────────────────────────────────────────────────────
// Timed arena pickups (double damage, invincibility, coin value 2x, xp 2x,
// armor, clock, black hole, coin magnet).

import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup } from './player.js';
import { applyEffect } from './activeEffects.js';
import { grantArmor } from './armor.js';
import { playSound } from './audio.js';
import { getLuckSpawnMultiplier } from './luck.js';
import { notifyPowerup } from './hudEffects.js';

const PICKUP_WEIGHTS = [
  ['doubleDamage', 6.25],
  ['invincibility', 6.25],
  ['coinValue2x', 25.0],
  ['xp2x', 6.25],
  ['armor', 25.0],
  ['clock', 12.5],
  ['blackHole', 6.25],
  ['coinMagnet', 12.5],
];
const TOTAL_PICKUP_WEIGHT = PICKUP_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

const CUBE_SIZE = 0.72;
const ORB_RADIUS = 0.42;
const PICKUP_BASE_Y = 0.14;
const cubeGeo = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
const orbGeo = new THREE.SphereGeometry(ORB_RADIUS, 28, 22);
const auraGeo = new THREE.SphereGeometry(ORB_RADIUS * 1.38, 20, 16);
const sparkGeo = new THREE.SphereGeometry(0.048, 10, 10);
const cornerToCenter = new THREE.Vector3(CUBE_SIZE * 0.5, CUBE_SIZE * 0.5, CUBE_SIZE * 0.5);
const balanceQuat = new THREE.Quaternion().setFromUnitVectors(
  cornerToCenter.clone().normalize(),
  new THREE.Vector3(0, 1, 0)
);

const mats = {
  doubleDamage: new THREE.MeshPhysicalMaterial({ color: 0xff3355, emissive: 0xff2244, emissiveIntensity: 1.0, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  invincibility: new THREE.MeshPhysicalMaterial({ color: 0xf5fbff, emissive: 0x80a7ff, emissiveIntensity: 0.18, metalness: 0.0, roughness: 0.03, transmission: 0.92, transparent: true, opacity: 0.58, thickness: 0.55, ior: 1.15, clearcoat: 1.0, clearcoatRoughness: 0.02 }),
  coinValue2x: new THREE.MeshPhysicalMaterial({ color: 0xffe566, emissive: 0xffd24d, emissiveIntensity: 0.90, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  xp2x: new THREE.MeshPhysicalMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 0.78, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  armor: new THREE.MeshPhysicalMaterial({ color: 0x66ff99, emissive: 0x22ff77, emissiveIntensity: 0.66, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  clock: new THREE.MeshPhysicalMaterial({ color: 0xc8c7ff, emissive: 0xb8c7ff, emissiveIntensity: 0.70, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.06, reflectivity: 1.0 }),
  blackHole: new THREE.MeshPhysicalMaterial({ color: 0x060606, emissive: 0x111111, emissiveIntensity: 0.70, metalness: 0.65, roughness: 0.78, clearcoat: 0.12, clearcoatRoughness: 1.0, reflectivity: 0.08 }),
  coinMagnet: new THREE.MeshPhysicalMaterial({ color: 0x8be7ff, emissive: 0x33cfff, emissiveIntensity: 0.72, metalness: 1.0, roughness: 0.10, clearcoat: 1.0, clearcoatRoughness: 0.05, reflectivity: 1.0 }),
};

let _spawnTimer = 0;

export function initArenaPickups(){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];
  _spawnTimer = 8.0;
}

function randType(){
  let roll = Math.random() * TOTAL_PICKUP_WEIGHT;
  for (const [type, weight] of PICKUP_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return type;
  }
  return PICKUP_WEIGHTS[PICKUP_WEIGHTS.length - 1][0];
}

function addBloom(mesh){
  mesh.layers.enable(1);
  return mesh;
}

function makeAura(color, intensity = 0.35){
  const aura = new THREE.Mesh(
    auraGeo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: intensity, depthWrite: false })
  );
  aura.layers.enable(1);
  return aura;
}

function makeOrbPickup(type){
  const root = new THREE.Group();
  const mesh = addBloom(new THREE.Mesh(orbGeo, mats[type].clone()));
  mesh.position.y = ORB_RADIUS;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  root.add(mesh);
  root.userData.visual = mesh;
  root.userData.shape = 'orb';

  if (type === 'doubleDamage') {
    const aura = makeAura(0xff2244, 0.18);
    aura.position.y = ORB_RADIUS;
    root.add(aura);
    root.userData.aura = aura;
  } else if (type === 'coinValue2x') {
    const aura = makeAura(0xffd24d, 0.16);
    aura.position.y = ORB_RADIUS;
    root.add(aura);
    root.userData.aura = aura;
  }

  return { root, mat: mesh.material, extraMats: root.userData.aura ? [root.userData.aura.material] : [] };
}

function makeInvincibilityPickup(){
  const root = new THREE.Group();
  const balance = new THREE.Group();
  balance.quaternion.copy(balanceQuat);

  const cube = addBloom(new THREE.Mesh(cubeGeo, mats.invincibility.clone()));
  cube.position.copy(cornerToCenter);
  cube.castShadow = true;
  cube.receiveShadow = true;
  balance.add(cube);

  const sparks = [];
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 14; i++) {
    const spark = addBloom(new THREE.Mesh(sparkGeo, sparkMat.clone()));
    spark.position.set(
      cornerToCenter.x + (Math.random() - 0.5) * 0.34,
      cornerToCenter.y + (Math.random() - 0.5) * 0.34,
      cornerToCenter.z + (Math.random() - 0.5) * 0.34,
    );
    spark.userData.base = spark.position.clone();
    spark.userData.phase = Math.random() * Math.PI * 2;
    spark.userData.speed = 1.8 + Math.random() * 1.6;
    spark.userData.radius = 0.02 + Math.random() * 0.03;
    sparks.push(spark);
    balance.add(spark);
  }

  root.add(balance);
  root.userData.visual = balance;
  root.userData.shape = 'cube';
  root.userData.innerSparks = sparks;
  return {
    root,
    mat: cube.material,
    extraMats: sparks.map(s => s.material),
  };
}

function makeCubePickup(type){
  const root = new THREE.Group();
  const balance = new THREE.Group();
  balance.quaternion.copy(balanceQuat);

  const cube = addBloom(new THREE.Mesh(cubeGeo, mats[type].clone()));
  cube.position.copy(cornerToCenter);
  cube.castShadow = true;
  cube.receiveShadow = true;
  balance.add(cube);
  root.add(balance);
  root.userData.visual = balance;
  root.userData.shape = 'cube';

  const extraMats = [];
  if (type === 'blackHole') {
    const aura = makeAura(0x111111, 0.22);
    aura.scale.setScalar(1.25);
    aura.position.copy(cornerToCenter);
    balance.add(aura);
    root.userData.aura = aura;
    extraMats.push(aura.material);
  }

  return { root, mat: cube.material, extraMats };
}

function createPickupVisual(type){
  if (type === 'doubleDamage' || type === 'coinValue2x') return makeOrbPickup(type);
  if (type === 'invincibility') return makeInvincibilityPickup();
  return makeCubePickup(type);
}

function spawnAtRandom(type){
  const { root, mat, extraMats = [] } = createPickupVisual(type);
  const ang = Math.random() * Math.PI * 2;
  const r = 10 + Math.random() * 14;
  root.position.set(playerGroup.position.x + Math.cos(ang) * r, PICKUP_BASE_Y, playerGroup.position.z + Math.sin(ang) * r);
  scene.add(root);
  state.arenaPickups.push({
    type,
    mesh: root,
    mat,
    extraMats,
    life: 18.0,
    spin: Math.random() * Math.PI * 2,
  });
}

function triggerCoinMagnetBurst(){
  if (Array.isArray(state.coinPickups)) {
    for (const cp of state.coinPickups) {
      if (!cp) continue;
      cp.attracting = true;
      cp.magnetBurst = Math.max(cp.magnetBurst || 0, 1.2);
    }
  }
  if (Array.isArray(state.healthPickups)) {
    for (const hp of state.healthPickups) {
      if (!hp) continue;
      hp.attracting = true;
      hp.magnetBurst = Math.max(hp.magnetBurst || 0, 1.2);
    }
  }
}

export function updateArenaPickups(worldDelta){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];

  const mult = getLuckSpawnMultiplier();
  _spawnTimer -= worldDelta;
  if (_spawnTimer <= 0) {
    spawnAtRandom(randType());
    _spawnTimer = (45.0 * mult) * (0.75 + Math.random() * 0.5);
  }

  for (let i = state.arenaPickups.length - 1; i >= 0; i--) {
    const p = state.arenaPickups[i];
    p.life -= worldDelta;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      p.mat.dispose();
      for (const m of (p.extraMats || [])) m.dispose?.();
      state.arenaPickups.splice(i, 1);
      continue;
    }

    p.spin += worldDelta * (p.type === 'doubleDamage' || p.type === 'coinValue2x' ? 1.55 : 1.8);
    p.mesh.rotation.y = p.spin;
    p.mesh.position.y = PICKUP_BASE_Y + Math.sin(p.spin * 2.0 + i) * 0.03;

    if (p.mesh.userData.aura) {
      p.mesh.userData.aura.scale.setScalar(1.0 + Math.sin(p.spin * 2.8) * 0.08);
    }
    if (Array.isArray(p.mesh.userData.innerSparks)) {
      for (const spark of p.mesh.userData.innerSparks) {
        const base = spark.userData.base;
        const ph = spark.userData.phase + p.spin * spark.userData.speed;
        spark.position.set(
          base.x + Math.cos(ph * 1.6) * spark.userData.radius,
          base.y + Math.sin(ph * 1.25) * spark.userData.radius,
          base.z + Math.sin(ph * 1.9) * spark.userData.radius,
        );
        spark.scale.setScalar(0.85 + Math.sin(ph * 2.0) * 0.22);
      }
    }

    const dx = playerGroup.position.x - p.mesh.position.x;
    const dz = playerGroup.position.z - p.mesh.position.z;
    const dist2 = dx*dx + dz*dz;

    const attractDist = 5.0;
    const dist = Math.sqrt(dist2);
    if (dist < attractDist && dist > 0.001) {
      const spd = 18.0 * worldDelta;
      p.mesh.position.x += (dx / dist) * Math.min(spd, dist);
      p.mesh.position.z += (dz / dist) * Math.min(spd, dist);
    }

    if (dist2 < 0.85*0.85) {
      scene.remove(p.mesh);
      p.mat.dispose();
      for (const m of (p.extraMats || [])) m.dispose?.();
      state.arenaPickups.splice(i, 1);

      if (p.type === 'armor') {
        grantArmor(3);
        notifyPowerup('Armor', null);
      } else if (p.type === 'coinMagnet') {
        triggerCoinMagnetBurst();
        notifyPowerup('Coin Magnet', null);
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
      playSound('coin', 0.25, 1.2);
    }
  }
}

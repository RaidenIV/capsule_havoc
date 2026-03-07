// ─── coins.js ───────────────────────────────────────────────────────────────
// Design doc Section 8 — Coin system owner.
// Owns:
//  - coin creation
//  - magnet pull-in
//  - collision/collection
//  - merge behaviour (>400 coins)

import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup } from './player.js';
import { playSound } from './audio.js';
import { HEALTH_PICKUP_CHANCE } from './constants.js';
import { spawnHealthPickup } from './pickups.js';
import { getCoinValueMultiplier } from './activeEffects.js';

const coinGeo     = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12);
const coinMatBase = new THREE.MeshStandardMaterial({
  color: 0xffe566, emissive: 0xf0a800, emissiveIntensity: 0.6,
  metalness: 0.9, roughness: 0.2,
});

const coinCountEl = document.getElementById('coin-count');

const ATTRACT_DIST_COIN = [5.0,5.5,6.0,6.5,7.0,7.5,8.0,8.5,9.0,9.5,10.0];
const ATTRACT_SPD_COIN  = 4.5;
const COLLECT_COIN      = 0.7;

export function spawnCoins(pos, count, value = 1, colorHex = null) {
  if (!Array.isArray(state.coinPickups)) state.coinPickups = [];
  for (let i = 0; i < count; i++) {
    const mat   = coinMatBase.clone();
    if (colorHex != null) {
      mat.color.setHex(colorHex);
      mat.emissive.setHex(colorHex);
      mat.emissiveIntensity = 0.55;
    }
    const mesh  = new THREE.Mesh(coinGeo, mat);
    const angle = Math.random() * Math.PI * 2;
    const r     = 0.3 + Math.random() * 1.2;
    mesh.position.set(pos.x + Math.cos(angle)*r, 0.35, pos.z + Math.sin(angle)*r);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    state.coinPickups.push({ mesh, mat, value, colorHex: colorHex ?? null, attracting: false, life: 20.0, merged: false });
  }
}

export function dropLoot(pos, coinValue, coinMult, coinColorHex = null) {
  // Health is still a chance-based drop (doc Section 14 excludes coins/chests).
  if (Math.random() < HEALTH_PICKUP_CHANCE) {
    spawnHealthPickup(pos);
  }

  // Coins always drop, tiered by enemy type at the call site.
  const coinTier = Math.max(0, state.upg?.coinBonus || 0);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const bonus = (1 + 0.20 * coinTier) * (1 + 0.25 * curseTier) * getCoinValueMultiplier();
  const val = Math.max(1, Math.round((coinValue || 1) * (coinMult || 1) * bonus));
  spawnCoins(pos, 1, val, coinColorHex);
}

export function collectAllCoins(){
  if (!Array.isArray(state.coinPickups) || state.coinPickups.length === 0) return 0;
  let sum = 0;
  for (const cp of state.coinPickups) {
    sum += (cp.value || 0);
    try { scene.remove(cp.mesh); } catch {}
    try { cp.mat?.dispose?.(); } catch {}
  }
  state.coinPickups.length = 0;
  state.coins += sum;
  if (coinCountEl) coinCountEl.textContent = state.coins;
  return sum;
}

function mergeIfNeeded(attractDist){
  if (!Array.isArray(state.coinPickups)) state.coinPickups = [];
  if (state.coinPickups.length <= 400) return;

  let sum = 0;
  for (const cp of state.coinPickups) {
    sum += (cp.value || 0);
    scene.remove(cp.mesh);
    cp.mat.dispose();
  }
  state.coinPickups.length = 0;

  // Place merged coin at edge/corner away from player.
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const dx = (Math.random() < 0.5 ? -1 : 1);
  const dz = (Math.random() < 0.5 ? -1 : 1);
  const far = attractDist * 3.25;
  const pos = { x: px + dx * far, z: pz + dz * far };
  spawnCoins(pos, 1, sum, 0xffffff);
  if (state.coinPickups[0]) state.coinPickups[0].merged = true;
  playSound('coin_merge', 0.7, 0.95 + Math.random() * 0.1);
}

export function updateCoins(worldDelta){
  if (!Array.isArray(state.coinPickups)) state.coinPickups = [];
  const playerLevel = Math.max(1, Math.floor(state.playerLevel || 1));

  const baseAttract = ATTRACT_DIST_COIN[Math.min(playerLevel, 10)];
  const bonus = Math.max(0, (state.upg?.magnet || 0)) * 1.25;
  const attractDist = baseAttract + bonus;

  mergeIfNeeded(attractDist);

  for (let i = state.coinPickups.length - 1; i >= 0; i--) {
    const cp = state.coinPickups[i];
    cp.life -= worldDelta;
    if (cp.life <= 0) {
      scene.remove(cp.mesh);
      cp.mat.dispose();
      state.coinPickups.splice(i, 1);
      continue;
    }
    if (cp.life < 2.0) {
      cp.mat.opacity = cp.life / 2.0;
      cp.mat.transparent = true;
    }

    const dx = playerGroup.position.x - cp.mesh.position.x;
    const dz = playerGroup.position.z - cp.mesh.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < COLLECT_COIN) {
      scene.remove(cp.mesh);
      cp.mat.dispose();
      state.coinPickups.splice(i, 1);
      state.coins += cp.value;
      if (coinCountEl) coinCountEl.textContent = state.coins;
      playSound('coin', 0.5, 0.95 + Math.random() * 0.15);
      continue;
    }

    if (dist < attractDist) cp.attracting = true;
    if (cp.attracting && dist > 0.001) {
      const spd = ATTRACT_SPD_COIN * worldDelta;
      cp.mesh.position.x += (dx/dist) * Math.min(spd, dist);
      cp.mesh.position.z += (dz/dist) * Math.min(spd, dist);
    }
    cp.mesh.rotation.z += 3.0 * worldDelta;
  }
}

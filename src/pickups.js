// ─── pickups.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { PLAYER_MAX_HP, HEALTH_PICKUP_CHANCE, HEALTH_RESTORE } from './constants.js';
import { playerGroup, updateHealthBar } from './player.js';
import { spawnHealNum } from './damageNumbers.js';
import { playSound } from './audio.js';

// ── Coin ──────────────────────────────────────────────────────────────────────
const coinGeo     = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12);
const coinMatBase = new THREE.MeshStandardMaterial({
  color: 0xffe566, emissive: 0xf0a800, emissiveIntensity: 0.6,
  metalness: 0.9, roughness: 0.2,
});
const coinCountEl = document.getElementById('coin-count');

export function spawnCoins(pos, count, value = 1) {
  for (let i = 0; i < count; i++) {
    const mat   = coinMatBase.clone();
    const mesh  = new THREE.Mesh(coinGeo, mat);
    const angle = Math.random() * Math.PI * 2;
    const r     = 0.3 + Math.random() * 1.2;
    mesh.position.set(pos.x + Math.cos(angle)*r, 0.35, pos.z + Math.sin(angle)*r);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    state.coinPickups.push({ mesh, mat, value, attracting: false, life: 20.0 });
  }
}

// ── Health pickup ──────────────────────────────────────────────────────────────
const plusHorizGeo  = new THREE.BoxGeometry(0.72, 0.22, 0.18);
const plusVertGeo   = new THREE.BoxGeometry(0.22, 0.72, 0.18);
const healthMatBase = new THREE.MeshPhysicalMaterial({
  color: 0xff1a3a, emissive: 0xff0022, emissiveIntensity: 1.6,
  metalness: 0.1, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.1,
});

export function spawnHealthPickup(pos) {
  const mat   = healthMatBase.clone();
  const group = new THREE.Group();
  [plusHorizGeo, plusVertGeo].forEach(g => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.layers.enable(1);
    group.add(m);
  });
  const angle = Math.random() * Math.PI * 2;
  const r     = 0.3 + Math.random() * 0.8;
  group.position.set(pos.x + Math.cos(angle)*r, 0.55, pos.z + Math.sin(angle)*r);
  scene.add(group);
  state.healthPickups.push({ mesh: group, mat, life: 15.0, attracting: false });
}

// ── Drop helper used by killEnemy (in enemies.js) ──────────────────────────────
export function dropLoot(pos, coinValue, coinMult) {
  if (Math.random() < HEALTH_PICKUP_CHANCE) {
    spawnHealthPickup(pos);
  } else {
    const count = 1 + Math.floor(Math.random() * 3);
    spawnCoins(pos, count, Math.round(coinValue * (coinMult || 1)));
  }
}

// ── Update ────────────────────────────────────────────────────────────────────
const ATTRACT_DIST_COIN = [5.0,5.5,6.0,6.5,7.0,7.5,8.0,8.5,9.0,9.5,10.0];
const ATTRACT_SPD_COIN  = 9.0;
const ATTRACT_DIST_HP   = 4.0;
const ATTRACT_SPD_HP    = 10.0;
const COLLECT_COIN      = 0.7;
const COLLECT_HP        = 0.8;

export function updatePickups(worldDelta, playerLevel, elapsed) {
  const attractDist = ATTRACT_DIST_COIN[Math.min(playerLevel, 10)];

  // ── Coins ───────────────────────────────────────────────────────────────────
  for (let i = state.coinPickups.length - 1; i >= 0; i--) {
    const cp = state.coinPickups[i];
    cp.life -= worldDelta;
    if (cp.life <= 0) { scene.remove(cp.mesh); cp.mat.dispose(); state.coinPickups.splice(i, 1); continue; }
    if (cp.life < 2.0) { cp.mat.opacity = cp.life / 2.0; cp.mat.transparent = true; }

    const dx = playerGroup.position.x - cp.mesh.position.x;
    const dz = playerGroup.position.z - cp.mesh.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < COLLECT_COIN) {
      scene.remove(cp.mesh); cp.mat.dispose();
      state.coinPickups.splice(i, 1);
      state.coins += cp.value;
      if (coinCountEl) coinCountEl.textContent = state.coins;
      playSound('coin', 0.5, 0.95 + Math.random() * 0.15);
      continue;
    }
    if (dist < attractDist) cp.attracting = true;
    if (cp.attracting) {
      const spd = ATTRACT_SPD_COIN * worldDelta;
      cp.mesh.position.x += (dx/dist) * Math.min(spd, dist);
      cp.mesh.position.z += (dz/dist) * Math.min(spd, dist);
    }
    cp.mesh.rotation.z += 3.0 * worldDelta;
  }

  // ── Health packs ─────────────────────────────────────────────────────────────
  for (let i = state.healthPickups.length - 1; i >= 0; i--) {
    const hp = state.healthPickups[i];
    hp.life -= worldDelta;
    if (hp.life <= 0) { scene.remove(hp.mesh); hp.mat.dispose(); state.healthPickups.splice(i, 1); continue; }
    if (hp.life < 2.0) { hp.mat.opacity = hp.life / 2.0; hp.mat.transparent = true; }

    const dx = playerGroup.position.x - hp.mesh.position.x;
    const dz = playerGroup.position.z - hp.mesh.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < COLLECT_HP) {
      scene.remove(hp.mesh); hp.mat.dispose();
      state.healthPickups.splice(i, 1);
      const healed = Math.min(HEALTH_RESTORE, PLAYER_MAX_HP - state.playerHP);
      state.playerHP = Math.min(PLAYER_MAX_HP, state.playerHP + HEALTH_RESTORE);
      updateHealthBar();
      if (healed > 0) { spawnHealNum(healed); playSound('heal', 0.6, 1.0); }
      continue;
    }
    if (dist < ATTRACT_DIST_HP) hp.attracting = true;
    if (hp.attracting) {
      const spd = ATTRACT_SPD_HP * worldDelta;
      hp.mesh.position.x += (dx/dist) * Math.min(spd, dist);
      hp.mesh.position.z += (dz/dist) * Math.min(spd, dist);
    }
    hp.mesh.rotation.y   = elapsed * 1.8 + i;
    hp.mesh.position.y   = 0.55 + Math.sin(elapsed * 3.5 + i) * 0.12;
  }
}

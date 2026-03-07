// ─── pickups.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { PLAYER_MAX_HP, HEALTH_PICKUP_CHANCE, HEALTH_RESTORE } from './constants.js';
import { playerGroup, updateHealthBar } from './player.js';
import { spawnHealNum } from './damageNumbers.js';
import { playSound } from './audio.js';
import { openChestOverlay } from './ui/chestOverlay.js';
import { getCoinValueMultiplier } from './activeEffects.js';

// ── Coin ──────────────────────────────────────────────────────────────────────
const coinGeo     = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12);
const coinMatBase = new THREE.MeshStandardMaterial({
  // Keep the base neutral; tier coloration is applied per-coin.
  color: 0xffffff,
  emissive: 0x000000,
  emissiveIntensity: 0.0,
  metalness: 0.85,
  roughness: 0.25,
});
const coinCountEl = document.getElementById('coin-count');

export function spawnCoins(pos, count, value = 1, colorHex = null) {
  const GOLD_COIN = 0xffd700;
  for (let i = 0; i < count; i++) {
    const mat   = coinMatBase.clone();
    const finalColor = GOLD_COIN;
    mat.color.setHex(finalColor);
    // Keep the gold readable in dark scenes without making it look neon.
    mat.emissive.setHex(0x111111);
    mat.emissiveIntensity = 0.18;
    const mesh  = new THREE.Mesh(coinGeo, mat);
    const angle = Math.random() * Math.PI * 2;
    const r     = 0.3 + Math.random() * 1.2;
    mesh.position.set(pos.x + Math.cos(angle)*r, 0.35, pos.z + Math.sin(angle)*r);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    state.coinPickups.push({ mesh, mat, value, colorHex: GOLD_COIN, attracting: false, life: 20.0, merged: false });
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
const COIN_DROP_CHANCE = 0.50;  // 50% chance to drop coins on kill

export function dropLoot(pos, coinValue, coinMult, coinColorHex = null) {
  // Health is still a chance-based drop.
  if (Math.random() < HEALTH_PICKUP_CHANCE) {
    spawnHealthPickup(pos);
  }
  // Coins always drop (physical pickup), tiered by enemy type at the call site.
  const coinTier = Math.max(0, state.upg?.coinBonus || 0);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const bonus = (1 + 0.20 * coinTier) * (1 + 0.25 * curseTier) * getCoinValueMultiplier();
  const val = Math.max(1, Math.round((coinValue || 1) * (coinMult || 1) * bonus));
  spawnCoins(pos, 1, val, coinColorHex);
}

// ── Update ────────────────────────────────────────────────────────────────────
const ATTRACT_DIST_COIN = [5.0,5.5,6.0,6.5,7.0,7.5,8.0,8.5,9.0,9.5,10.0];
const ATTRACT_SPD_COIN  = 4.5;
const ATTRACT_DIST_HP   = ATTRACT_DIST_COIN; // same magnet range as coins
const ATTRACT_SPD_HP    = ATTRACT_SPD_COIN;
const COLLECT_COIN      = 0.7;
const COLLECT_HP        = 0.8;

export function updatePickups(worldDelta, playerLevel, elapsed) {
  const baseAttract = ATTRACT_DIST_COIN[Math.min(playerLevel, 10)];
  const bonus = Math.max(0, (state.upg?.magnet || 0)) * 1.25; // shop upgrade (design doc)
  const coinMagnetActive = (state.effects?.coinMagnet || 0) > 0;
  const attractDist = coinMagnetActive ? Infinity : (baseAttract + bonus);
  const attractSpeed = coinMagnetActive ? 17.0 : ATTRACT_SPD_COIN;
  // Coin merge safety (performance): consolidate if too many coins are on the ground.
  if (state.coinPickups.length > 400) {
    let sum = 0;
    for (const cp of state.coinPickups) { sum += (cp.value || 0); scene.remove(cp.mesh); cp.mat.dispose(); }
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
    if (coinMagnetActive || dist < attractDist) cp.attracting = true;
    if (cp.attracting && dist > 0.001) {
      const spd = attractSpeed * worldDelta;
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

    const dx = playerGroup.position.x - hp.mesh.position.x;
    const dz = playerGroup.position.z - hp.mesh.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < COLLECT_HP) {
      scene.remove(hp.mesh); hp.mat.dispose();
      state.healthPickups.splice(i, 1);
      const maxHP = (state.playerMaxHP || PLAYER_MAX_HP);
      const heal = Math.max(1, Math.round(maxHP * HEALTH_RESTORE));
      const healed = Math.min(heal, maxHP - state.playerHP);
      state.playerHP = Math.min(maxHP, state.playerHP + heal);
      updateHealthBar();
      playSound('heal', 0.6, 1.0);
      if (healed > 0) spawnHealNum(healed);
      continue;
    }
    if (dist < attractDist) hp.attracting = true;
    if (hp.attracting) {
      const spd = ATTRACT_SPD_HP * worldDelta;
      hp.mesh.position.x += (dx/dist) * Math.min(spd, dist);
      hp.mesh.position.z += (dz/dist) * Math.min(spd, dist);
    }
    hp.mesh.rotation.y   = elapsed * 1.8 + i;
    hp.mesh.position.y   = 0.55 + Math.sin(elapsed * 3.5 + i) * 0.12;
  }

  // ── Chests (boss drops; do not despawn) ───────────────────────────────────
  if (!state.chests) state.chests = [];
  for (let i = state.chests.length - 1; i >= 0; i--) {
    const c = state.chests[i];
    c.bob = (c.bob || 0) + worldDelta * 2.0;
    c.mesh.rotation.y += worldDelta * 0.9;
    c.mesh.position.y = 0.35 + Math.sin(c.bob) * 0.08;
    const dx = playerGroup.position.x - c.mesh.position.x;
    const dz = playerGroup.position.z - c.mesh.position.z;
    if (dx*dx + dz*dz < 0.8*0.8) {
      scene.remove(c.mesh);
      state.chests.splice(i, 1);
      playSound('chest', 0.75, 1.0);
      openChestOverlay(c.tier || 'standard');
    }
  }
}

// ── Chest spawning API ──────────────────────────────────────────────────────
const chestGeo = new THREE.BoxGeometry(0.85, 0.55, 0.85);
const CHEST_MAT = {
  standard: new THREE.MeshStandardMaterial({ color: 0x8a5a2b, emissive: 0xffcc55, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.55 }),
  rare:     new THREE.MeshStandardMaterial({ color: 0x1f4a8a, emissive: 0x55ccff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.35 }),
  epic:     new THREE.MeshStandardMaterial({ color: 0x4a1f8a, emissive: 0xcc55ff, emissiveIntensity: 1.1, metalness: 0.55, roughness: 0.25 }),
};

export function spawnChest(pos, tier='standard') {
  const mat = (CHEST_MAT[tier] || CHEST_MAT.standard).clone();
  const mesh = new THREE.Mesh(chestGeo, mat);
  mesh.position.set(pos.x, 0.35, pos.z);
  scene.add(mesh);
  if (!state.chests) state.chests = [];
  state.chests.push({ mesh, tier, bob: Math.random() * Math.PI * 2 });
}

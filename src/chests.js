// ─── chests.js ──────────────────────────────────────────────────────────────
// Design doc Section 10 — Treasure Chests owner.
// Owns:
//  - Chest spawning + persistence (dropLevel saving)
//  - Tier thresholds
//  - Weighted reward selection rules
//  - Open animation / skip logic (delegated to UI overlay module)

import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup } from './player.js';
import { playSound } from './audio.js';
import { getLuck } from './luck.js';
import { ALL_UPGRADES, applyUpgradeEffect } from './ui/upgrades.js';

const chestGeo = new THREE.BoxGeometry(0.85, 0.55, 0.85);
const CHEST_MAT = {
  standard: new THREE.MeshStandardMaterial({ color: 0x8a5a2b, emissive: 0xffcc55, emissiveIntensity: 0.7, metalness: 0.4, roughness: 0.55 }),
  rare:     new THREE.MeshStandardMaterial({ color: 0x1f4a8a, emissive: 0x55ccff, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.35 }),
  epic:     new THREE.MeshStandardMaterial({ color: 0x4a1f8a, emissive: 0xcc55ff, emissiveIntensity: 1.1, metalness: 0.55, roughness: 0.25 }),
};

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

export function getChestTierForLevel(level){
  // Design doc thresholds: Standard < 40, Rare 40–69, Epic 70+
  const L = Math.max(1, Math.floor(level||1));
  if (L < 40) return 'standard';
  if (L < 70) return 'rare';
  return 'epic';
}

function tierCap(tier){
  return ({ standard: 2, rare: 4, epic: 5 }[tier] || 2);
}

export function spawnChest(pos, tier = 'standard', dropLevel = null) {
  const mat = (CHEST_MAT[tier] || CHEST_MAT.standard).clone();
  const mesh = new THREE.Mesh(chestGeo, mat);
  mesh.position.set(pos.x, 0.35, pos.z);
  scene.add(mesh);

  if (!Array.isArray(state.chests)) state.chests = [];

  const dl = Math.max(1, Math.floor(dropLevel ?? state.playerLevel ?? 1));
  const cap = tierCap(tier);
  // Saving rule: chest remembers the maximum shop tier it can offer based on dropLevel.
  state.chests.push({
    mesh,
    mat,
    tier,
    dropLevel: dl,
    maxTierAllowed: cap,
    bob: Math.random() * Math.PI * 2,
  });
}

// Luck-based item count table (doc Section 10)
export function rollChestItemCount(){
  const luck = getLuck();
  // Probability tables for item counts 1, 3, 5
  // Luck:  0      10     20     30
  const p1 = luck <= 0  ? 0.70 : luck <= 10 ? 0.45 : luck <= 20 ? 0.20 : 0.00;
  const p5 = luck <= 0  ? 0.05 : luck <= 10 ? 0.15 : luck <= 20 ? 0.25 : 0.368;
  const r  = Math.random();
  if (r < p5) return 5;
  if (r < p5 + (1 - p1 - p5)) return 3;
  return 1;
}

function nextUnpurchasedTierKey(){
  // Find the "next" tier bucket the player is still working on.
  // We treat each upgrade key independently; the heuristic is:
  //  - Prefer upgrades where current tier is 0..(max-1)
  //  - Among them, prefer lower current tiers first.
  let best = null;
  for (const upg of ALL_UPGRADES) {
    const cur = state.upg?.[upg.key] || 0;
    const max = upg.costs.length;
    if (cur >= max) continue;
    if (!best) best = { key: upg.key, cur, max };
    else if (cur < best.cur) best = { key: upg.key, cur, max };
  }
  return best?.key || null;
}

export function pickChestItems(count, chest){
  const maxTier = clamp(chest?.maxTierAllowed ?? tierCap(chest?.tier), 1, 5);
  const preferredKey = nextUnpurchasedTierKey();

  const candidates = ALL_UPGRADES
    .map(upg => {
      const cur = state.upg?.[upg.key] || 0;
      const nextTier = cur + 1;
      const allowed = cur < upg.costs.length && nextTier <= maxTier;
      if (!allowed) return null;

      // Weighting: bias toward the next unpurchased tier (doc Section 10.3)
      let w = 1.0;
      if (preferredKey && upg.key === preferredKey) w *= 3.0;
      if (cur === 0) w *= 1.25;
      return { upg, cur, nextTier, w };
    })
    .filter(Boolean);

  if (!candidates.length) return { items: [], debug: { reason: 'all_maxed_or_capped' } };

  const pickOne = (pool) => {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total;
    for (const x of pool) {
      r -= x.w;
      if (r <= 0) return x;
    }
    return pool[pool.length - 1];
  };

  const chosen = [];
  const pool = [...candidates];
  while (chosen.length < count && pool.length) {
    const x = pickOne(pool);
    chosen.push(x);
    const idx = pool.indexOf(x);
    if (idx >= 0) pool.splice(idx, 1);
  }

  const debug = {
    preferredKey,
    maxTier,
    candidates: candidates.map(c => ({ key: c.upg.key, cur: c.cur, next: c.nextTier, w: Number(c.w.toFixed(2)) })),
    chosen: chosen.map(c => ({ key: c.upg.key, next: c.nextTier })),
  };

  return { items: chosen.map(c => c.upg), debug };
}

export function applyChestChoice(upg){
  if (!upg) return;
  const cur = state.upg?.[upg.key] || 0;
  const next = cur + 1;
  state.upg[upg.key] = next;
  try { applyUpgradeEffect(upg.key, next); } catch {}
}

export function updateChests(worldDelta, elapsed){
  if (!Array.isArray(state.chests)) state.chests = [];
  for (let i = state.chests.length - 1; i >= 0; i--) {
    const c = state.chests[i];
    c.bob = (c.bob || 0) + worldDelta * 2.0;
    c.mesh.rotation.y += worldDelta * 0.9;
    c.mesh.position.y = 0.35 + Math.sin(c.bob) * 0.08;

    const dx = playerGroup.position.x - c.mesh.position.x;
    const dz = playerGroup.position.z - c.mesh.position.z;
    if (dx*dx + dz*dz < 0.8*0.8) {
      // Collect/open
      scene.remove(c.mesh);
      try { c.mat?.dispose?.(); } catch {}
      state.chests.splice(i, 1);
      playSound('chest', 0.75, 1.0);

      // Opening flow is isolated in ui/chestOverlay.js (doc Issue 10.5)
      import('./ui/chestOverlay.js')
        .then(m => m.openChestOverlay?.(c))
        .catch(() => { state.paused = false; });
    }
  }
}

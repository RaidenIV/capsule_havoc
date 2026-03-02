// ─── spawner.js ────────────────────────────────────────────────────────────
// Enemy spawn system based on game_design_doc.md Section 12.
// - Per-type independent timers
// - Quota enforcement (subject to global screen cap of 50)
// - Off-screen spawning in an oval ring with direction bias
//
// This module intentionally keeps the implementation lightweight and readable.

import * as THREE from 'three';
import { state } from './state.js';
import { camera } from './renderer.js';
import { playerGroup } from './player.js';
import { ENEMY_TYPE, getActiveEnemyTypesForLevel } from './constants.js';
import { spawnEnemyAtPosition } from './enemies.js';

const HARD_CAP = 50;

const BASE = Object.freeze({
  [ENEMY_TYPE.RUSHER]:     { quotaMin: 8, quotaMax: 12, interval: 3.0, group: true },
  [ENEMY_TYPE.ORBITER]:    { quotaMin: 3, quotaMax: 5,  interval: 5.0, group: false },
  [ENEMY_TYPE.TANKER]:     { quotaMin: 2, quotaMax: 3,  interval: 8.0, group: false },
  [ENEMY_TYPE.SNIPER]:     { quotaMin: 2, quotaMax: 3,  interval: 8.0, group: false },
  [ENEMY_TYPE.TELEPORTER]: { quotaMin: 2, quotaMax: 2,  interval: 10.0, group: false },
  [ENEMY_TYPE.SHIELDED]:   { quotaMin: 2, quotaMax: 3,  interval: 9.0, group: false },
  [ENEMY_TYPE.SPLITTER]:   { quotaMin: 1, quotaMax: 1,  interval: 15.0, group: false },
});

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function scaleMultipliers(level) {
  const L = Math.max(1, Math.floor(level || 1));
  if (L <= 19) return { q: 1.0, i: 1.0 };
  if (L <= 39) return { q: 1.2, i: 0.85 };
  if (L <= 59) return { q: 1.5, i: 0.70 };
  if (L <= 69) return { q: 1.75, i: 0.60 };
  return { q: 2.0, i: 0.50 };
}

function getQuota(type, level) {
  const base = BASE[type];
  if (!base) return 0;
  const { q } = scaleMultipliers(level);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const curseQ = 1 + 0.20 * curseTier; // design doc: +20% spawn quota / tier
  const min = Math.max(1, Math.round(base.quotaMin * q));
  const max = Math.max(min, Math.round(base.quotaMax * q));
  return randInt(Math.round(min * curseQ), Math.round(max * curseQ));
}

function getInterval(type, level) {
  const base = BASE[type];
  if (!base) return 9999;
  const { i } = scaleMultipliers(level);
  const curseTier = Math.max(0, state.upg?.curse || 0);
  const curseI = 1 / (1 + 0.10 * curseTier); // +10% spawn rate / tier
  return Math.max(0.35, base.interval * i * curseI);
}



function countType(type) {
  let n = 0;
  for (const e of state.enemies) if (!e.dead && e.enemyType === type && !e.isBoss) n++;
  return n;
}

function availableSlots() {
  const n = state.enemies.filter(e => !e.dead && !e.isBoss).length;
  return Math.max(0, HARD_CAP - n);
}

function playerMoveDir() {
  // approximate move direction from player velocity cached by player.js
  const v = state.playerVel || { x: 0, z: 0 };
  const len = Math.hypot(v.x, v.z);
  if (len < 0.001) return null;
  return { x: v.x / len, z: v.z / len };
}

export function initSpawner() {
  state.spawn = {
    timers: {},       // per-type timer accumulator
    quotas: {},       // per-type current quota target
    bossCooldown: 0,  // seconds
  };
}

function ensureSpawnState(level) {
  if (!state.spawn) initSpawner();
  const types = getActiveEnemyTypesForLevel(level);
  for (const t of types) {
    if (state.spawn.timers[t] == null) state.spawn.timers[t] = 0;
    if (state.spawn.quotas[t] == null) state.spawn.quotas[t] = getQuota(t, level);
  }
}

export function getSpawnPosition(isBoss = false) {
  // Build an oval just outside the viewport bounds.
  // We estimate "visible" extents using camera distance and fov; exact math isn't required.
  const cam = camera;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;

  const dir = playerMoveDir();

  // Determine angle distribution with bias.
  let angle = Math.random() * Math.PI * 2;
  if (dir) {
    // forward vector in XZ
    const fwdAng = Math.atan2(dir.z, dir.x);
    const duringBoss = !!state.bossAlive;
    const forwardWeight = duringBoss ? 0.40 : 0.60;
    if (Math.random() < forwardWeight) {
      // 180° arc ahead
      angle = fwdAng + (Math.random() - 0.5) * Math.PI;
    } else {
      // remaining spawns around full ring
      angle = Math.random() * Math.PI * 2;
    }
  }

  // Oval radii scale with camera height/distance (iso camera).
  const camDist = Math.hypot(cam.position.x - px, cam.position.z - pz);
  const baseA = camDist * 0.95;  // major axis
  const baseB = camDist * 0.70;  // minor axis
  const pad   = isBoss ? 6.0 : 3.5;

  const a = baseA + pad;
  const b = baseB + pad;

  const x = px + Math.cos(angle) * a;
  const z = pz + Math.sin(angle) * b;

  return { x, z };
}

function spawnBatch(type, count) {
  const slots = availableSlots();
  const n = Math.min(count, slots);
  for (let i = 0; i < n; i++) {
    const p = getSpawnPosition(false);
    spawnEnemyAtPosition(p.x, p.z, type);
  }
}

function updateBoss(delta, level) {
  // Boss wave every 10 levels; Boss does not count toward cap and can always spawn.
  const isBossLevel = (level >= 10) && (level % 10 === 0);
  if (!isBossLevel) return;

  // If boss is alive, nothing to do.
  if (state.bossAlive) return;

  state.spawn.bossCooldown -= delta;
  if (state.spawn.bossCooldown > 0) return;

  // Spawn boss immediately
  const p = getSpawnPosition(true);
  spawnEnemyAtPosition(p.x, p.z, ENEMY_TYPE.BOSS);
  state.bossAlive = true;
  state.spawn.bossCooldown = 0;
}

export function updateSpawner(delta) {
  if (state.gameOver || state.paused) return;
  const level = Math.max(1, Math.floor(state.playerLevel || 1));

  ensureSpawnState(level);
  updateBoss(delta, level);

  const types = getActiveEnemyTypesForLevel(level);
  for (const t of types) {
    const interval = getInterval(t, level);
    state.spawn.timers[t] += delta;
    if (state.spawn.timers[t] < interval) continue;
    state.spawn.timers[t] = 0;

    // Refresh quota occasionally (adds variety)
    if (Math.random() < 0.15) state.spawn.quotas[t] = getQuota(t, level);

    const q = state.spawn.quotas[t] ?? getQuota(t, level);
    const have = countType(t);
    if (have >= q) continue;

    const need = q - have;

    if (t === ENEMY_TYPE.RUSHER) {
      // Rusher spawns in groups (doc). We treat "need" as group count and clamp.
      const groupSize = randInt(8, 12);
      spawnBatch(t, Math.min(need * groupSize, 18)); // avoid huge spikes from quota refresh
    } else {
      spawnBatch(t, need);
    }
  }
}

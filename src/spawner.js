// ─── spawner.js ────────────────────────────────────────────────────────────
// Enemy spawn system (game_design_doc.md Section 12)
//
// Implements:
// - Per-type independent timers (base intervals/quotas)
// - Level-range scaling multipliers + Curse modifiers (stacking)
// - Enemy cap progression by level range (boss excluded from cap)
// - Special spawn events: Swarmer Surge, Elite Reinforcement, Ultra Elite Interrupt
// - Deterministic, testable level-transition summary logs
//
// NOTE: We keep the authoritative tables in this module to avoid hard ESM
// import failures across patches. If you later want them centralized, move the
// tables into constants.js and keep the export names stable.

import * as THREE from 'three';
import { state } from './state.js';
import { camera } from './renderer.js';
import { playerGroup } from './player.js';
import { ENEMY_TYPE, getActiveEnemyTypesForLevel } from './constants.js';
import { spawnEnemyAtPosition } from './enemies.js';

// ── Tables (from design doc) ──────────────────────────────────────────────────
const SPAWN_BASE = Object.freeze({
  // Rushers/Swarmers are treated as "group spawn" (8–12) on each spawn tick.
  [ENEMY_TYPE.RUSHER]:     { quotaMin: 8, quotaMax: 12, intervalSec: 3,  groupSpawn: true },

  [ENEMY_TYPE.ORBITER]:    { quotaMin: 3, quotaMax: 5,  intervalSec: 5,  groupSpawn: false },
  [ENEMY_TYPE.TANKER]:     { quotaMin: 2, quotaMax: 3,  intervalSec: 8,  groupSpawn: false },
  [ENEMY_TYPE.SNIPER]:     { quotaMin: 2, quotaMax: 3,  intervalSec: 8,  groupSpawn: false },
  [ENEMY_TYPE.TELEPORTER]: { quotaMin: 2, quotaMax: 2,  intervalSec: 10, groupSpawn: false },
  [ENEMY_TYPE.SHIELDED]:   { quotaMin: 2, quotaMax: 3,  intervalSec: 9,  groupSpawn: false },
  // In your codebase, "SPLITTER" maps to the Ultra Elite behavior.
  [ENEMY_TYPE.SPLITTER]:   { quotaMin: 1, quotaMax: 1,  intervalSec: 15, groupSpawn: false },

  // Boss respawns every 10 seconds on boss levels (10,20,30,...). Boss excluded from cap.
  [ENEMY_TYPE.BOSS]:       { quotaMin: 1, quotaMax: 1,  intervalSec: 10, groupSpawn: false, boss: true },
});

const SPAWN_LEVEL_SCALING = Object.freeze([
  { min: 1,  max: 19,  quotaMul: 1.0,  intervalMul: 1.0  },
  { min: 20, max: 39,  quotaMul: 1.2,  intervalMul: 0.85 },
  { min: 40, max: 59,  quotaMul: 1.5,  intervalMul: 0.70 },
  { min: 60, max: 69,  quotaMul: 1.75, intervalMul: 0.60 },
  { min: 70, max: 999, quotaMul: 2.0,  intervalMul: 0.50 },
]);

const CURSE_SPAWN = Object.freeze({
  0: { quotaMul: 1.00, intervalMul: 1.00 },
  1: { quotaMul: 1.10, intervalMul: 0.95 },
  2: { quotaMul: 1.20, intervalMul: 0.90 },
  3: { quotaMul: 1.35, intervalMul: 0.80 },
});

const ENEMY_CAP_BY_LEVEL_RANGE = Object.freeze([
  { min: 1, max: 2,   cap: 20 },
  { min: 3, max: 999, cap: 50 },
]);

// ── Utilities ────────────────────────────────────────────────────────────────
function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function getLevelScaling(level) {
  const L = clamp(Math.floor(level || 1), 1, 999);
  for (const r of SPAWN_LEVEL_SCALING) {
    if (L >= r.min && L <= r.max) return { quotaMul: r.quotaMul, intervalMul: r.intervalMul };
  }
  return { quotaMul: 1.0, intervalMul: 1.0 };
}

function getCurseScaling() {
  // Chaos no longer changes spawn quotas or intervals. It only affects combat/rewards.
  return { tier: 0, quotaMul: 1.0, intervalMul: 1.0 };
}

function getEnemyCapForLevel(level) {
  const L = clamp(Math.floor(level || 1), 1, 999);
  for (const r of ENEMY_CAP_BY_LEVEL_RANGE) {
    if (L >= r.min && L <= r.max) return r.cap;
  }
  return 50;
}

function countRegularEnemies() {
  // Boss does not count toward cap per design doc.
  let n = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e || e.dead) continue;
    if (e.isBoss) continue;
    n++;
  }
  return n;
}

function countType(type) {
  let n = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e || e.dead) continue;
    if (type === ENEMY_TYPE.BOSS) {
      if (e.isBoss) n++;
      continue;
    }
    const liveType = e.enemyType ?? e.type;
    if (liveType === type && !e.isBoss) n++;
  }
  return n;
}

function availableSlots(level) {
  const cap = getEnemyCapForLevel(level);
  const regularCount = countRegularEnemies();
  return Math.max(0, cap - regularCount);
}

function getEffectiveQuota(type, level) {
  const base = SPAWN_BASE[type];
  if (!base) return 0;

  const { quotaMul } = getLevelScaling(level);
  const curse = getCurseScaling();

  const qMin = Math.max(0, Math.floor(base.quotaMin * quotaMul * curse.quotaMul));
  const qMax = Math.max(qMin, Math.floor(base.quotaMax * quotaMul * curse.quotaMul));

  return randInt(qMin, qMax);
}

function getEffectiveIntervalSec(type, level) {
  const base = SPAWN_BASE[type];
  if (!base) return 999;

  const { intervalMul } = getLevelScaling(level);
  const curse = getCurseScaling();

  // Clamp to avoid pathological 0 intervals.
  return Math.max(0.15, base.intervalSec * intervalMul * curse.intervalMul);
}

// ── Spawn ring (off-screen) ──────────────────────────────────────────────────
function getSpawnPosition(isBoss) {
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const cam = camera;

  // Try to bias spawns slightly toward camera-forward direction (more readable),
  // but keep randomness.
  const toCam = new THREE.Vector3(cam.position.x - px, 0, cam.position.z - pz).normalize();
  const baseAngle = Math.atan2(toCam.z, toCam.x);
  const angle = baseAngle + (Math.random() - 0.5) * Math.PI * 1.6;

  // Oval radii scale with camera distance (iso camera).
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

function spawnOne(type, level, isBoss = false) {
  if (!isBoss) {
    const slots = availableSlots(level);
    if (slots <= 0) return false;
  }
  const p = getSpawnPosition(isBoss);
  spawnEnemyAtPosition(p.x, p.z, type);
  return true;
}

function spawnBatch(type, count, level) {
  let spawned = 0;
  const isBoss = (type === ENEMY_TYPE.BOSS);
  for (let i = 0; i < count; i++) {
    if (!spawnOne(type, level, isBoss)) break;
    spawned++;
  }
  return spawned;
}

// ── Special spawn events (doc) ───────────────────────────────────────────────
function shouldSuppressSwarmerSurge() {
  return (state.luck || 0) >= 20;
}

function eventChanceMultiplierFromLuck() {
  // Luck reduces frequency; keep simple and monotonic.
  // Every 5 luck reduces chance by ~10% (min 35% of base).
  const L = Math.max(0, Math.floor(state.luck || 0));
  return Math.max(0.35, 1.0 - 0.10 * Math.floor(L / 5));
}

function maybeTriggerSpecialEvents(level) {
  // Only one event per level by default (keeps it readable).
  if (state.spawn.eventFiredThisLevel) return;

  const luckMul = eventChanceMultiplierFromLuck();

  // Swarmer Surge: any level, but suppressed at Luck >= 20.
  if (!shouldSuppressSwarmerSurge()) {
    const surgeChance = 0.055 * luckMul; // base ~5.5% per level
    if (Math.random() < surgeChance) {
      const extra = randInt(15, 20);
      const spawned = spawnBatch(ENEMY_TYPE.RUSHER, extra, level);
      state.spawn.eventFiredThisLevel = true;
      console.log('[SPAWN_EVENT] SwarmerSurge', { level, requested: extra, spawned });
      return;
    }
  }

  // Elite Reinforcement: 30+
  if (level >= 30) {
    const reinChance = 0.045 * luckMul;
    if (Math.random() < reinChance) {
      const extra = randInt(2, 3);
      // Choose from elite-ish pool that is active this level.
      const active = getActiveEnemyTypesForLevel(level);
      const elitePool = active.filter(t => (
        t === ENEMY_TYPE.ORBITER ||
        t === ENEMY_TYPE.TANKER ||
        t === ENEMY_TYPE.SNIPER ||
        t === ENEMY_TYPE.TELEPORTER ||
        t === ENEMY_TYPE.SHIELDED
      ));
      const pick = elitePool.length ? elitePool[randInt(0, elitePool.length - 1)] : ENEMY_TYPE.ORBITER;
      const spawned = spawnBatch(pick, extra, level);
      state.spawn.eventFiredThisLevel = true;
      console.log('[SPAWN_EVENT] EliteReinforcement', { level, type: pick, requested: extra, spawned });
      return;
    }
  }

  // Ultra Elite Interrupt: 51+ rare
  if (level >= 51) {
    const ultraChance = 0.018 * luckMul;
    if (Math.random() < ultraChance) {
      const spawned = spawnBatch(ENEMY_TYPE.SPLITTER, 1, level);
      if (spawned > 0) {
        state.spawn.eventFiredThisLevel = true;
        console.log('[SPAWN_EVENT] UltraEliteInterrupt', { level, spawned });
      }
      return;
    }
  }
}

// ── Level transition logging ─────────────────────────────────────────────────
function logSpawnSummary(level) {
  const cap = getEnemyCapForLevel(level);
  const lv = getLevelScaling(level);
  const curse = getCurseScaling();
  const active = getActiveEnemyTypesForLevel(level);

  const perType = {};
  for (const t of active) {
    const b = SPAWN_BASE[t];
    if (!b) continue;
    const effInterval = getEffectiveIntervalSec(t, level);
    // For summary, show scaled min/max before RNG:
    const qMin = Math.floor(b.quotaMin * lv.quotaMul * curse.quotaMul);
    const qMax = Math.floor(b.quotaMax * lv.quotaMul * curse.quotaMul);
    perType[t] = { quotaRange: [qMin, qMax], intervalSec: Number(effInterval.toFixed(3)) };
  }

  console.log('[SPAWN_SUMMARY]', {
    level,
    cap,
    levelScale: lv,
    curseScale: { tier: curse.tier, quotaMul: curse.quotaMul, intervalMul: curse.intervalMul },
    activeTypes: active,
    perType,
  });
}

// ── Public API ───────────────────────────────────────────────────────────────
export function initSpawner() {
  // Create a single namespace in state for spawner runtime fields.
  state.spawn = {
    timers: {},          // per-type timer accumulator
    quotas: {},          // per-type target quota (randomized within range)
    bossCooldown: 0,     // boss respawn cooldown
    lastLevel: -1,
    eventFiredThisLevel: false,
  };
}

function ensureSpawnState(level) {
  if (!state.spawn) initSpawner();

  if (state.spawn.lastLevel !== level) {
    state.spawn.lastLevel = level;
    state.spawn.eventFiredThisLevel = false;

    // refresh quotas for this level
    const types = getActiveEnemyTypesForLevel(level);
    for (const t of types) {
      if (!(t in state.spawn.timers)) state.spawn.timers[t] = 0;
      state.spawn.quotas[t] = getEffectiveQuota(t, level);
    }

    // Boss cooldown reset on boss levels.
    state.spawn.bossCooldown = 0;

    logSpawnSummary(level);
  }
}

function updateBoss(delta, level) {
  const isBossLevel = (level >= 10) && (level % 10 === 0);
  if (!isBossLevel) return;

  if (state.bossAlive) return;

  state.spawn.bossCooldown -= delta;
  if (state.spawn.bossCooldown > 0) return;

  // Boss can always spawn (does not count toward cap).
  const p = getSpawnPosition(true);
  spawnEnemyAtPosition(p.x, p.z, ENEMY_TYPE.BOSS);
  state.bossAlive = true;

  // respawn timer per doc (10s)
  state.spawn.bossCooldown = SPAWN_BASE[ENEMY_TYPE.BOSS].intervalSec;
}

export function updateSpawner(delta) {
  if (state.gameOver || state.paused) return;

  const level = clamp(Math.floor(state.playerLevel || 1), 1, 999);
  ensureSpawnState(level);

  // boss first
  updateBoss(delta, level);

  // maybe run one special event per level
  maybeTriggerSpecialEvents(level);

  const activeTypes = getActiveEnemyTypesForLevel(level);
  const nonRusherTypes = activeTypes.filter(t => t !== ENEMY_TYPE.RUSHER);
  const types = [...nonRusherTypes, ENEMY_TYPE.RUSHER];

  for (const t of types) {
    if (!activeTypes.includes(t)) continue;

    const base = SPAWN_BASE[t];
    if (!base || base.boss) continue;

    const interval = getEffectiveIntervalSec(t, level);
    state.spawn.timers[t] = (state.spawn.timers[t] || 0) + delta;
    if (state.spawn.timers[t] < interval) continue;
    state.spawn.timers[t] = 0;

    // Occasionally refresh quota (keeps variance), but deterministically per tick.
    if (Math.random() < 0.10) state.spawn.quotas[t] = getEffectiveQuota(t, level);

    const baseTarget = state.spawn.quotas[t] ?? getEffectiveQuota(t, level);
    const have = countType(t);
    let target = baseTarget;

    // Once the player reaches level 3, Rushers act as the filler type so the
    // live non-boss population stays pushed toward 50 while elite quotas remain
    // unchanged. Processing Rushers last preserves room for elite spawns first.
    if (t === ENEMY_TYPE.RUSHER && level >= 3) {
      const cap = getEnemyCapForLevel(level);
      target = Math.max(baseTarget, cap - (countRegularEnemies() - have));
    }

    if (have >= target) continue;

    const need = target - have;

    if (base.groupSpawn) {
      // Spawn a group (8–12), but keep it subject to cap. When Rushers are
      // filling to cap, allow a larger burst so the field reaches 50 quickly.
      const groupSize = randInt(8, 12);
      const requested = (t === ENEMY_TYPE.RUSHER && level >= 3)
        ? Math.max(groupSize, Math.min(need, 20))
        : Math.max(groupSize, Math.min(groupSize * need, 20));
      spawnBatch(t, requested, level);
    } else {
      spawnBatch(t, need, level);
    }
  }
}

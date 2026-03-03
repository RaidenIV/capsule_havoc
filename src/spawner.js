// ─── spawner.js ────────────────────────────────────────────────────────────
// Design doc Section 12 — Enemy Spawn System
// Owns:
//  - Per-type spawn timers / quotas
//  - Enemy cap progression enforcement
//  - Level-range scaling + curse modifiers
//  - Special spawn events (Surge / Reinforcement / Interrupt)

import { state } from './state.js';
import { camera } from './renderer.js';
import { playerGroup } from './player.js';
import {
  ENEMY_TYPE,
  getActiveEnemyTypesForLevel,
  getEnemyCapForLevel,
  SPAWN_BASE,
  SPAWN_LEVEL_SCALING,
  CURSE_SPAWN,
  isBossLevel,
} from './constants.js';
import { spawnEnemyAtPosition } from './enemies.js';
import { getLuck } from './luck.js';

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rand(){ return Math.random(); }
function randInt(a,b){ return a + Math.floor(Math.random() * (b - a + 1)); }

function getLevelScaling(level){
  const L = Math.max(1, Math.floor(level||1));
  for (const r of SPAWN_LEVEL_SCALING) {
    if (L >= r.min && L <= r.max) return r;
  }
  return SPAWN_LEVEL_SCALING[0];
}

function getCurseScaling(){
  const tier = clamp(state.upg?.curse ?? 0, 0, 3);
  return CURSE_SPAWN[tier] || CURSE_SPAWN[0];
}

function countAliveNonBoss(){
  let n = 0;
  for (const e of state.enemies) if (e && !e.dead && !e.isBoss && e.enemyType !== ENEMY_TYPE.BOSS) n++;
  return n;
}

function countType(type){
  let n = 0;
  for (const e of state.enemies) if (e && !e.dead && !e.isBoss && e.enemyType === type) n++;
  return n;
}

function availableSlots(level){
  const cap = getEnemyCapForLevel(level);
  return Math.max(0, cap - countAliveNonBoss());
}

function effectiveQuota(type, level){
  const base = SPAWN_BASE[type];
  if (!base) return 0;
  const { quotaMul } = getLevelScaling(level);
  const curse = getCurseScaling();

  const qMin = Math.max(1, Math.round(base.quotaMin * quotaMul * curse.quotaMul));
  const qMax = Math.max(qMin, Math.round(base.quotaMax * quotaMul * curse.quotaMul));
  return randInt(qMin, qMax);
}

function effectiveInterval(type, level){
  const base = SPAWN_BASE[type];
  if (!base) return 9999;
  const { intervalMul } = getLevelScaling(level);
  const curse = getCurseScaling();
  // Clamp so we never hit the old "0.5s for everything" behaviour.
  return Math.max(0.55, base.intervalSec * intervalMul * curse.intervalMul);
}

export function initSpawner(){
  state.spawn = {
    timers: {},
    quotas: {},
    lastLevel: 0,
    bossCooldown: 0,
    // Special events
    nextEventTimer: 8.0,
    pendingEvent: null,
  };
}

function ensureState(level){
  if (!state.spawn) initSpawner();
  const types = getActiveEnemyTypesForLevel(level);
  for (const t of types) {
    if (state.spawn.timers[t] == null) state.spawn.timers[t] = 0;
    if (state.spawn.quotas[t] == null) state.spawn.quotas[t] = effectiveQuota(t, level);
  }
}

function logLevelSummary(level){
  try {
    const cap = getEnemyCapForLevel(level);
    const luck = getLuck();
    const { quotaMul, intervalMul } = getLevelScaling(level);
    const curseTier = clamp(state.upg?.curse ?? 0, 0, 3);
    const curse = getCurseScaling();
    const types = getActiveEnemyTypesForLevel(level);
    const per = {};
    for (const t of types) {
      per[t] = {
        quotaTarget: state.spawn.quotas[t],
        intervalSec: Number(effectiveInterval(t, level).toFixed(2)),
      };
    }
    // Deterministic + testable summary on each level transition.
    console.log('[Spawner] Level', level, {
      cap,
      luck,
      quotaMul,
      intervalMul,
      curseTier,
      curseQuotaMul: curse.quotaMul,
      curseIntervalMul: curse.intervalMul,
      perType: per,
    });
  } catch {}
}

export function getSpawnPosition(isBoss = false){
  // Spawn in an oval ring just outside the viewport bounds.
  const cam = camera;
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;

  const angle = Math.random() * Math.PI * 2;

  const camDist = Math.hypot(cam.position.x - px, cam.position.z - pz);
  const baseA = camDist * 0.95;
  const baseB = camDist * 0.70;
  const pad   = isBoss ? 6.0 : 3.5;
  const x = px + Math.cos(angle) * (baseA + pad);
  const z = pz + Math.sin(angle) * (baseB + pad);
  return { x, z };
}

function spawnOne(type){
  const p = getSpawnPosition(false);
  spawnEnemyAtPosition(p.x, p.z, type);
}

function spawnBatch(type, count, level){
  const slots = availableSlots(level);
  const n = Math.min(count, slots);
  for (let i = 0; i < n; i++) spawnOne(type);
}

function updateBoss(delta, level){
  if (!isBossLevel(level)) return;
  if (state.bossAlive) return;

  state.spawn.bossCooldown = (state.spawn.bossCooldown ?? 0) - delta;
  if (state.spawn.bossCooldown > 0) return;

  const p = getSpawnPosition(true);
  spawnEnemyAtPosition(p.x, p.z, ENEMY_TYPE.BOSS);
  state.bossAlive = true;
}

// ── Special events (doc Section 12.4) ───────────────────────────────────────

function rollSpecialEvent(level){
  // Events should be occasional, not constant. Keep behaviour deterministic
  // via logged choices at level transitions.
  const L = Math.max(1, Math.floor(level||1));
  const luck = getLuck();

  // Luck 20+ suppresses swarmer surge (doc Section 11 → ties to 12.4)
  const suppressSurge = luck >= 20;

  // Base chances scale mildly with level.
  const t = clamp((L - 10) / 70, 0, 1);
  let surgeP = 0.10 + 0.10 * t; // 10% → 20%
  let reinfP = 0.06 + 0.06 * t; // 6%  → 12%
  let interruptP = 0.03 + 0.05 * t; // 3% → 8%

  // Luck makes events rarer overall.
  const luckMul = clamp(1.0 - (luck / 120), 0.35, 1.0);
  surgeP *= luckMul;
  reinfP *= luckMul;
  interruptP *= luckMul;

  if (suppressSurge) surgeP = 0;

  const r = rand();
  const sum = surgeP + reinfP + interruptP;
  if (sum <= 0) return null;
  const x = r * sum;
  if (x < surgeP) return 'swarmerSurge';
  if (x < surgeP + reinfP) return 'eliteReinforcement';
  return 'ultraInterrupt';
}

function scheduleNextEvent(){
  // Base ~25–40s between checks.
  const luck = getLuck();
  const luckMul = clamp(1.0 + (luck / 80), 1.0, 1.75);
  state.spawn.nextEventTimer = (25 + rand() * 15) * luckMul;
}

function runEvent(kind, level){
  if (!kind) return;
  const slots = availableSlots(level);
  if (slots <= 0) return;

  if (kind === 'swarmerSurge') {
    // Burst of rushers.
    spawnBatch(ENEMY_TYPE.RUSHER, Math.min(20, slots), level);
    console.log('[Spawner] Event: Swarmer Surge');
    return;
  }
  if (kind === 'eliteReinforcement') {
    // A few elites appropriate to current level.
    const pool = [ENEMY_TYPE.TANKER, ENEMY_TYPE.SNIPER, ENEMY_TYPE.SHIELDED, ENEMY_TYPE.TELEPORTER]
      .filter(t => getActiveEnemyTypesForLevel(level).includes(t));
    if (!pool.length) return;
    const n = Math.min(3, slots);
    for (let i = 0; i < n; i++) {
      spawnBatch(pool[Math.floor(Math.random()*pool.length)], 1, level);
    }
    console.log('[Spawner] Event: Elite Reinforcement');
    return;
  }
  if (kind === 'ultraInterrupt') {
    // Spawn an Ultra Elite if unlocked.
    if (getActiveEnemyTypesForLevel(level).includes(ENEMY_TYPE.SPLITTER)) {
      spawnBatch(ENEMY_TYPE.SPLITTER, 1, level);
      console.log('[Spawner] Event: Ultra Elite Interrupt');
    }
  }
}

export function updateSpawner(delta){
  if (state.gameOver || state.paused) return;
  const level = Math.max(1, Math.floor(state.playerLevel || 1));
  ensureState(level);

  if (state.spawn.lastLevel !== level) {
    state.spawn.lastLevel = level;
    // Refresh quotas on transition so changes are visible immediately.
    for (const t of getActiveEnemyTypesForLevel(level)) state.spawn.quotas[t] = effectiveQuota(t, level);
    logLevelSummary(level);
  }

  updateBoss(delta, level);

  // Special event scheduler
  state.spawn.nextEventTimer -= delta;
  if (state.spawn.nextEventTimer <= 0) {
    const ev = rollSpecialEvent(level);
    runEvent(ev, level);
    scheduleNextEvent();
  }

  const types = getActiveEnemyTypesForLevel(level);
  for (const t of types) {
    const interval = effectiveInterval(t, level);
    state.spawn.timers[t] = (state.spawn.timers[t] ?? 0) + delta;
    if (state.spawn.timers[t] < interval) continue;
    state.spawn.timers[t] = 0;

    // Slight quota refresh chance for variety; deterministic targets are logged on level-up.
    if (rand() < 0.12) state.spawn.quotas[t] = effectiveQuota(t, level);

    const q = state.spawn.quotas[t] ?? effectiveQuota(t, level);
    const have = countType(t);
    if (have >= q) continue;

    const need = q - have;
    if (SPAWN_BASE[t]?.groupSpawn) {
      // "Group" meaning: spawn a small burst to feel like a swarm.
      const group = randInt(6, 10);
      spawnBatch(t, Math.min(need * group, 18), level);
    } else {
      spawnBatch(t, need, level);
    }
  }
}

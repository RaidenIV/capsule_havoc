// ─── spawner.js ────────────────────────────────────────────────────────────
// Enemy spawn system with surround-pressure formations.
//
// Core goals of this version:
// - keep the level-based enemy roster and per-type timers
// - replace random refill behavior with directional surround pressure
// - maintain a live pressure floor so the player rarely gets breathing room
// - add periodic formation waves and emergency refill bursts

import { state } from './state.js';
import { camera } from './renderer.js';
import { playerGroup } from './player.js';
import { ENEMY_TYPE, getActiveEnemyTypesForLevel } from './constants.js';
import { spawnEnemyAtPosition } from './enemies.js';

const SPAWN_BASE = Object.freeze({
  [ENEMY_TYPE.RUSHER]:     { quotaMin: 10, quotaMax: 14, intervalSec: 2.2, groupSpawn: true },
  [ENEMY_TYPE.ORBITER]:    { quotaMin: 3,  quotaMax: 5,  intervalSec: 4.6, groupSpawn: false },
  [ENEMY_TYPE.TANKER]:     { quotaMin: 2,  quotaMax: 3,  intervalSec: 6.8, groupSpawn: false },
  [ENEMY_TYPE.SNIPER]:     { quotaMin: 2,  quotaMax: 3,  intervalSec: 6.3, groupSpawn: false },
  [ENEMY_TYPE.TELEPORTER]: { quotaMin: 2,  quotaMax: 2,  intervalSec: 8.2, groupSpawn: false },
  [ENEMY_TYPE.SHIELDED]:   { quotaMin: 2,  quotaMax: 3,  intervalSec: 7.2, groupSpawn: false },
  [ENEMY_TYPE.SPLITTER]:   { quotaMin: 1,  quotaMax: 1,  intervalSec: 12.0, groupSpawn: false },
  [ENEMY_TYPE.BOSS]:       { quotaMin: 1,  quotaMax: 1,  intervalSec: 10.0, groupSpawn: false, boss: true },
});

const SPAWN_LEVEL_SCALING = Object.freeze([
  { min: 1,  max: 19,  quotaMul: 1.0,  intervalMul: 1.0  },
  { min: 20, max: 39,  quotaMul: 1.15, intervalMul: 0.90 },
  { min: 40, max: 59,  quotaMul: 1.35, intervalMul: 0.78 },
  { min: 60, max: 69,  quotaMul: 1.55, intervalMul: 0.66 },
  { min: 70, max: 999, quotaMul: 1.75, intervalMul: 0.58 },
]);

const CURSE_SPAWN = Object.freeze({
  0: { quotaMul: 1.00, intervalMul: 1.00 },
  1: { quotaMul: 1.00, intervalMul: 1.00 },
  2: { quotaMul: 1.00, intervalMul: 1.00 },
  3: { quotaMul: 1.00, intervalMul: 1.00 },
});

const ENEMY_CAP_BY_LEVEL_RANGE = Object.freeze([
  { min: 1, max: 2,   cap: 20 },
  { min: 3, max: 999, cap: 60 },
]);

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function randFloat(a, b) { return a + Math.random() * (b - a); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function normAngle(a) {
  let out = a;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

function splitCount(total, parts) {
  if (parts <= 1) return [total];
  const out = new Array(parts).fill(Math.floor(total / parts));
  for (let i = 0; i < (total % parts); i++) out[i] += 1;
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getLevelScaling(level) {
  const L = clamp(Math.floor(level || 1), 1, 999);
  for (const r of SPAWN_LEVEL_SCALING) {
    if (L >= r.min && L <= r.max) return { quotaMul: r.quotaMul, intervalMul: r.intervalMul };
  }
  return { quotaMul: 1.0, intervalMul: 1.0 };
}

function getCurseScaling() {
  const tier = clamp(Math.floor(state.curseTier || 0), 0, 3);
  return { tier, ...(CURSE_SPAWN[tier] || CURSE_SPAWN[0]) };
}

function getEnemyCapForLevel(level) {
  const L = clamp(Math.floor(level || 1), 1, 999);
  for (const r of ENEMY_CAP_BY_LEVEL_RANGE) {
    if (L >= r.min && L <= r.max) return r.cap;
  }
  return 60;
}

function countRegularEnemies() {
  let n = 0;
  for (let i = 0; i < state.enemies.length; i++) {
    const e = state.enemies[i];
    if (!e || e.dead || e.isBoss) continue;
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
  return Math.max(0, cap - countRegularEnemies());
}

function getTypeSoftCap(type, level) {
  if (type === ENEMY_TYPE.ORBITER || type === ENEMY_TYPE.TANKER) {
    const quotaBase = state.spawn?.quotas?.[type] ?? getEffectiveQuota(type, level);
    return Math.max(1, Math.floor(quotaBase * 0.5));
  }
  return Number.POSITIVE_INFINITY;
}

function availableTypeSlots(type, level) {
  const softCap = getTypeSoftCap(type, level);
  if (!Number.isFinite(softCap)) return Number.POSITIVE_INFINITY;
  return Math.max(0, softCap - countType(type));
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
  return Math.max(0.12, base.intervalSec * intervalMul * curse.intervalMul);
}

function getTravelAngle() {
  const mx = Number(state.lastMoveX) || 0;
  const mz = Number(state.lastMoveZ) || 0;
  if ((mx * mx + mz * mz) > 0.04) return Math.atan2(mz, mx);

  const camDx = camera.position.x - playerGroup.position.x;
  const camDz = camera.position.z - playerGroup.position.z;
  if ((camDx * camDx + camDz * camDz) > 0.01) {
    return Math.atan2(-camDz, -camDx);
  }
  return 0;
}

function getRingMetrics(isBoss = false) {
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const camDist = Math.hypot(camera.position.x - px, camera.position.z - pz);
  const major = camDist * (isBoss ? 0.98 : 0.86) + (isBoss ? 6.2 : 2.4);
  const minor = camDist * (isBoss ? 0.78 : 0.66) + (isBoss ? 5.0 : 1.8);
  return { major, minor };
}

function getPositionOnRing(angle, { isBoss = false, distScale = 1.0, radialJitter = 0.0 } = {}) {
  const px = playerGroup.position.x;
  const pz = playerGroup.position.z;
  const { major, minor } = getRingMetrics(isBoss);
  const jitter = radialJitter ? randFloat(-radialJitter, radialJitter) : 0;
  const scale = Math.max(0.72, distScale + jitter);
  const x = px + Math.cos(angle) * major * scale;
  const z = pz + Math.sin(angle) * minor * scale;
  return { x, z };
}

function spawnAtAngle(type, angle, level, opts = {}) {
  if (type !== ENEMY_TYPE.BOSS && availableSlots(level) <= 0) return false;
  const p = getPositionOnRing(angle, opts);
  spawnEnemyAtPosition(p.x, p.z, type);
  return true;
}

function spawnArc(type, count, level, centerAngle, arcWidth, opts = {}) {
  let spawned = 0;
  if (count <= 0) return spawned;
  const safeCount = (type === ENEMY_TYPE.BOSS)
    ? count
    : Math.min(count, availableSlots(level), availableTypeSlots(type, level));
  if (safeCount <= 0) return 0;

  const width = Math.max(0.08, arcWidth);
  const innerBias = opts.innerBias ?? false;
  for (let i = 0; i < safeCount; i++) {
    const t = safeCount === 1 ? 0.5 : (i / Math.max(1, safeCount - 1));
    const spread = (t - 0.5) * width;
    const localJitter = randFloat(-width * 0.18, width * 0.18);
    const angle = normAngle(centerAngle + spread + localJitter);
    const distScale = innerBias ? randFloat(0.82, 0.94) : randFloat(0.90, 1.08);
    if (!spawnAtAngle(type, angle, level, {
      isBoss: opts.isBoss === true,
      distScale,
      radialJitter: opts.radialJitter ?? 0.06,
    })) {
      break;
    }
    spawned++;
  }
  return spawned;
}

function spawnFromArcs(type, count, level, arcs, opts = {}) {
  if (count <= 0 || !arcs.length) return 0;
  const safeCount = (type === ENEMY_TYPE.BOSS) ? count : Math.min(count, availableSlots(level));
  if (safeCount <= 0) return 0;
  const counts = splitCount(safeCount, arcs.length);
  let spawned = 0;
  for (let i = 0; i < arcs.length; i++) {
    const arc = arcs[i];
    spawned += spawnArc(type, counts[i], level, arc.angle, arc.width, { ...opts, innerBias: arc.innerBias ?? opts.innerBias });
  }
  return spawned;
}

function getPressureProfile(level) {
  if (level <= 2) {
    return {
      floor: 12,
      emergencyFloor: 8,
      refillCooldown: 0.55,
      waveCooldownMin: 4.8,
      waveCooldownMax: 6.0,
      waveSizeMin: 5,
      waveSizeMax: 8,
      emergencyBonus: 4,
      supportMax: 0,
    };
  }
  if (level <= 10) {
    return {
      floor: 36,
      emergencyFloor: 24,
      refillCooldown: 0.40,
      waveCooldownMin: 3.4,
      waveCooldownMax: 4.6,
      waveSizeMin: 11,
      waveSizeMax: 15,
      emergencyBonus: 8,
      supportMax: 1,
    };
  }
  if (level <= 30) {
    return {
      floor: 40,
      emergencyFloor: 28,
      refillCooldown: 0.36,
      waveCooldownMin: 3.1,
      waveCooldownMax: 4.2,
      waveSizeMin: 12,
      waveSizeMax: 17,
      emergencyBonus: 9,
      supportMax: 2,
    };
  }
  return {
    floor: 42,
    emergencyFloor: 30,
    refillCooldown: 0.32,
    waveCooldownMin: 2.8,
    waveCooldownMax: 3.8,
    waveSizeMin: 14,
    waveSizeMax: 18,
    emergencyBonus: 10,
    supportMax: 3,
  };
}

function getSupportTypes(activeTypes) {
  return activeTypes.filter(t => t !== ENEMY_TYPE.RUSHER && t !== ENEMY_TYPE.BOSS);
}

function pickSupportType(activeTypes, used = new Set()) {
  const pool = getSupportTypes(activeTypes).filter(t => !used.has(t));
  if (!pool.length) return null;
  const weighted = [];
  for (const t of pool) {
    if (t === ENEMY_TYPE.TANKER || t === ENEMY_TYPE.SHIELDED) {
      weighted.push(t, t);
    } else if (t === ENEMY_TYPE.SNIPER || t === ENEMY_TYPE.TELEPORTER) {
      weighted.push(t, t);
    } else {
      weighted.push(t);
    }
  }
  return weighted[randInt(0, weighted.length - 1)] || null;
}

function spawnTypePressure(type, count, level, moveAngle, reason = 'quota') {
  if (count <= 0) return 0;

  switch (type) {
    case ENEMY_TYPE.RUSHER: {
      const pattern = (reason === 'emergency')
        ? ['rearCollapse', 'encircle', 'pincer'][randInt(0, 2)]
        : ['pincer', 'encircle', 'frontWall', 'rearCollapse'][randInt(0, 3)];

      if (pattern === 'encircle') {
        return spawnFromArcs(type, count, level, shuffle([
          { angle: normAngle(moveAngle),               width: 0.50 },
          { angle: normAngle(moveAngle + Math.PI/2),  width: 0.56 },
          { angle: normAngle(moveAngle - Math.PI/2),  width: 0.56 },
          { angle: normAngle(moveAngle + Math.PI),    width: 0.66, innerBias: true },
        ]));
      }
      if (pattern === 'rearCollapse') {
        return spawnFromArcs(type, count, level, [
          { angle: normAngle(moveAngle + Math.PI),         width: 0.90, innerBias: true },
          { angle: normAngle(moveAngle + Math.PI * 0.68),  width: 0.48 },
          { angle: normAngle(moveAngle - Math.PI * 0.68),  width: 0.48 },
        ]);
      }
      if (pattern === 'frontWall') {
        return spawnFromArcs(type, count, level, [
          { angle: normAngle(moveAngle),              width: 0.85, innerBias: true },
          { angle: normAngle(moveAngle + Math.PI/2), width: 0.42 },
          { angle: normAngle(moveAngle - Math.PI/2), width: 0.42 },
        ]);
      }
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle + Math.PI/2), width: 0.58 },
        { angle: normAngle(moveAngle - Math.PI/2), width: 0.58 },
        { angle: normAngle(moveAngle + Math.PI),   width: 0.46, innerBias: reason === 'emergency' },
      ]);
    }

    case ENEMY_TYPE.ORBITER:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle + Math.PI/2), width: 0.34, innerBias: true },
        { angle: normAngle(moveAngle - Math.PI/2), width: 0.34, innerBias: true },
      ], { radialJitter: 0.04 });

    case ENEMY_TYPE.TANKER:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle), width: 0.38, innerBias: true },
      ], { radialJitter: 0.03 });

    case ENEMY_TYPE.SNIPER:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle + 0.40), width: 0.20 },
        { angle: normAngle(moveAngle - 0.40), width: 0.20 },
      ], { radialJitter: 0.03 });

    case ENEMY_TYPE.TELEPORTER:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle + Math.PI - 0.42), width: 0.20, innerBias: true },
        { angle: normAngle(moveAngle + Math.PI + 0.42), width: 0.20, innerBias: true },
      ], { radialJitter: 0.03 });

    case ENEMY_TYPE.SHIELDED:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle), width: 0.28, innerBias: true },
        { angle: normAngle(moveAngle + Math.PI/2), width: 0.20, innerBias: true },
        { angle: normAngle(moveAngle - Math.PI/2), width: 0.20, innerBias: true },
      ], { radialJitter: 0.03 });

    case ENEMY_TYPE.SPLITTER:
      return spawnFromArcs(type, count, level, [
        { angle: normAngle(moveAngle + Math.PI * 0.80), width: 0.26 },
        { angle: normAngle(moveAngle - Math.PI * 0.80), width: 0.26 },
      ], { radialJitter: 0.02 });

    case ENEMY_TYPE.BOSS:
      return spawnArc(type, count, level, normAngle(moveAngle), 0.18, { isBoss: true, radialJitter: 0.02, innerBias: true });

    default:
      return spawnArc(type, count, level, moveAngle, 0.35);
  }
}

function triggerPressureFormation(level, desiredCount, reason = 'periodic') {
  const slots = availableSlots(level);
  if (slots <= 0 || desiredCount <= 0) return 0;

  const activeTypes = getActiveEnemyTypesForLevel(level);
  const moveAngle = getTravelAngle();
  const profile = getPressureProfile(level);
  const count = Math.min(desiredCount, slots);
  let spawned = 0;

  const supportPool = getSupportTypes(activeTypes);
  let supportCount = 0;
  if (supportPool.length && level >= 6) {
    const maxSupport = Math.min(profile.supportMax, Math.max(1, Math.floor(count / 7)));
    supportCount = clamp(maxSupport, 0, Math.min(3, count));
    if (reason === 'emergency') supportCount = Math.min(maxSupport + 1, Math.min(4, count));
  }

  const rusherCount = Math.max(0, count - supportCount);
  spawned += spawnTypePressure(ENEMY_TYPE.RUSHER, rusherCount, level, moveAngle, reason);

  const used = new Set();
  for (let i = 0; i < supportCount; i++) {
    const pick = pickSupportType(activeTypes, used);
    if (!pick) break;
    used.add(pick);
    spawned += spawnTypePressure(pick, 1, level, moveAngle, reason);
  }

  if (spawned > 0) {
    state.spawn.lastPressureReason = reason;
    state.spawn.lastPressureAt = state.elapsed || 0;
  }
  return spawned;
}

function shouldSuppressSwarmerSurge() {
  return (state.luck || 0) >= 20;
}

function eventChanceMultiplierFromLuck() {
  const L = Math.max(0, Math.floor(state.luck || 0));
  return Math.max(0.35, 1.0 - 0.10 * Math.floor(L / 5));
}

function maybeTriggerSpecialEvents(level) {
  if (state.spawn.eventFiredThisLevel) return;
  const luckMul = eventChanceMultiplierFromLuck();

  if (!shouldSuppressSwarmerSurge()) {
    const surgeChance = 0.055 * luckMul;
    if (Math.random() < surgeChance) {
      const extra = randInt(15, 20);
      const spawned = triggerPressureFormation(level, extra, 'event-surge');
      state.spawn.eventFiredThisLevel = spawned > 0;
      console.log('[SPAWN_EVENT] SwarmerSurge', { level, requested: extra, spawned });
      return;
    }
  }

  if (level >= 30) {
    const reinChance = 0.045 * luckMul;
    if (Math.random() < reinChance) {
      const extra = randInt(2, 3);
      const active = getActiveEnemyTypesForLevel(level);
      const elitePool = active.filter(t => (
        t === ENEMY_TYPE.ORBITER ||
        t === ENEMY_TYPE.TANKER ||
        t === ENEMY_TYPE.SNIPER ||
        t === ENEMY_TYPE.TELEPORTER ||
        t === ENEMY_TYPE.SHIELDED
      ));
      const pick = elitePool.length ? elitePool[randInt(0, elitePool.length - 1)] : ENEMY_TYPE.ORBITER;
      const moveAngle = getTravelAngle();
      const spawned = spawnTypePressure(pick, extra, level, moveAngle, 'event-reinforce');
      state.spawn.eventFiredThisLevel = spawned > 0;
      console.log('[SPAWN_EVENT] EliteReinforcement', { level, type: pick, requested: extra, spawned });
      return;
    }
  }

  if (level >= 51) {
    const ultraChance = 0.018 * luckMul;
    if (Math.random() < ultraChance) {
      const moveAngle = getTravelAngle();
      const spawned = spawnTypePressure(ENEMY_TYPE.SPLITTER, 1, level, moveAngle, 'event-ultra');
      if (spawned > 0) {
        state.spawn.eventFiredThisLevel = true;
        console.log('[SPAWN_EVENT] UltraEliteInterrupt', { level, spawned });
      }
    }
  }
}

function logSpawnSummary(level) {
  const cap = getEnemyCapForLevel(level);
  const lv = getLevelScaling(level);
  const curse = getCurseScaling();
  const active = getActiveEnemyTypesForLevel(level);
  const profile = getPressureProfile(level);

  const perType = {};
  for (const t of active) {
    const b = SPAWN_BASE[t];
    if (!b) continue;
    const effInterval = getEffectiveIntervalSec(t, level);
    const qMin = Math.floor(b.quotaMin * lv.quotaMul * curse.quotaMul);
    const qMax = Math.floor(b.quotaMax * lv.quotaMul * curse.quotaMul);
    perType[t] = { quotaRange: [qMin, qMax], intervalSec: Number(effInterval.toFixed(3)) };
  }

  console.log('[SPAWN_SUMMARY]', {
    level,
    cap,
    pressure: profile,
    levelScale: lv,
    curseScale: { tier: curse.tier, quotaMul: curse.quotaMul, intervalMul: curse.intervalMul },
    activeTypes: active,
    perType,
  });
}

export function initSpawner() {
  state.spawn = {
    timers: {},
    quotas: {},
    bossCooldown: 0,
    pressureWaveCooldown: 0,
    floorRefillCooldown: 0,
    lastLevel: -1,
    eventFiredThisLevel: false,
    lastPressureReason: null,
    lastPressureAt: 0,
  };
}

function ensureSpawnState(level) {
  if (!state.spawn) initSpawner();

  if (state.spawn.lastLevel !== level) {
    state.spawn.lastLevel = level;
    state.spawn.eventFiredThisLevel = false;
    state.spawn.floorRefillCooldown = 0;
    state.spawn.pressureWaveCooldown = 0;

    const types = getActiveEnemyTypesForLevel(level);
    for (const t of types) {
      if (!(t in state.spawn.timers)) state.spawn.timers[t] = 0;
      state.spawn.quotas[t] = getEffectiveQuota(t, level);
    }

    state.spawn.bossCooldown = 0;
    logSpawnSummary(level);
  }
}

function updateBoss(delta, level) {
  const isBossLevel = (level >= 10) && (level % 10 === 0);
  if (!isBossLevel || state.bossAlive) return;

  state.spawn.bossCooldown -= delta;
  if (state.spawn.bossCooldown > 0) return;

  const moveAngle = getTravelAngle();
  spawnTypePressure(ENEMY_TYPE.BOSS, 1, level, moveAngle, 'boss');
  state.bossAlive = true;
  state.spawn.bossCooldown = SPAWN_BASE[ENEMY_TYPE.BOSS].intervalSec;
}

function updatePressureFloor(delta, level) {
  const profile = getPressureProfile(level);
  state.spawn.floorRefillCooldown = Math.max(0, (state.spawn.floorRefillCooldown || 0) - delta);

  const regularCount = countRegularEnemies();
  if (regularCount >= profile.floor) return;
  if (state.spawn.floorRefillCooldown > 0) return;

  const deficit = profile.floor - regularCount;
  const emergency = regularCount <= profile.emergencyFloor;
  let requested = Math.max(deficit, emergency ? deficit + profile.emergencyBonus : Math.ceil(deficit * 0.75));
  requested = Math.min(requested, availableSlots(level));
  if (requested <= 0) return;

  const spawned = triggerPressureFormation(level, requested, emergency ? 'emergency' : 'floor');
  if (spawned > 0) {
    state.spawn.floorRefillCooldown = emergency ? Math.max(0.18, profile.refillCooldown * 0.55) : profile.refillCooldown;
  }
}

function updatePressureWaves(delta, level) {
  const profile = getPressureProfile(level);
  state.spawn.pressureWaveCooldown = Math.max(0, (state.spawn.pressureWaveCooldown || 0) - delta);
  if (state.spawn.pressureWaveCooldown > 0) return;

  const slots = availableSlots(level);
  if (slots <= 0) {
    state.spawn.pressureWaveCooldown = randFloat(profile.waveCooldownMin, profile.waveCooldownMax);
    return;
  }

  const requested = Math.min(slots, randInt(profile.waveSizeMin, profile.waveSizeMax));
  const spawned = triggerPressureFormation(level, requested, 'periodic');
  state.spawn.pressureWaveCooldown = randFloat(profile.waveCooldownMin, profile.waveCooldownMax);

  if (spawned <= 0) {
    state.spawn.pressureWaveCooldown = Math.min(state.spawn.pressureWaveCooldown, 1.5);
  }
}

export function updateSpawner(delta) {
  if (state.gameOver || state.paused) return;

  const level = clamp(Math.floor(state.playerLevel || 1), 1, 999);
  ensureSpawnState(level);

  updateBoss(delta, level);
  updatePressureFloor(delta, level);
  updatePressureWaves(delta, level);
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

    if (Math.random() < 0.15) state.spawn.quotas[t] = getEffectiveQuota(t, level);

    const baseTarget = state.spawn.quotas[t] ?? getEffectiveQuota(t, level);
    const have = countType(t);
    let target = Math.min(baseTarget, getTypeSoftCap(t, level));

    if (t === ENEMY_TYPE.RUSHER && level >= 3) {
      const cap = getEnemyCapForLevel(level);
      const floor = getPressureProfile(level).floor;
      target = Math.max(baseTarget, floor, cap - Math.max(0, countRegularEnemies() - have));
    }

    if (have >= target) continue;

    const need = target - have;
    const moveAngle = getTravelAngle();
    if (base.groupSpawn) {
      const burstSize = randInt(8, 14);
      const requested = (t === ENEMY_TYPE.RUSHER && level >= 3)
        ? Math.max(burstSize, Math.min(need, 18))
        : Math.min(Math.max(need, burstSize), 14);
      spawnTypePressure(t, requested, level, moveAngle, 'quota');
    } else {
      spawnTypePressure(t, need, level, moveAngle, 'quota');
    }
  }
}

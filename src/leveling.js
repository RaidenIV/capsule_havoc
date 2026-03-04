// ─── leveling.js ────────────────────────────────────────────────────────────
// Level + XP reward system based on game_design_doc.md (Option B).
// - Uses per-level XP requirements (not cumulative thresholds)
// - Spike levels: 20 and 40 (Growth bonus applies while at those levels)
//
// Exports:
//   expToNext(level)             -> XP needed to reach next level
//   getPhase(level)              -> 1 | 2 | 3
//   isSpikeLevel(level)          -> boolean
//   getGrowthMultiplier(level)   -> 1 | 2
//   getXPRewardForEnemy(enemyType, level)
//   getCoinTierForEnemy(enemyType)

import { ENEMY_TYPE } from './constants.js';

export function getPhase(level) {
  const L = Math.max(1, Math.floor(level || 1));
  if (L <= 19) return 1;
  if (L <= 39) return 2; // includes 20–39
  return 3;              // includes 40+
}

export function isSpikeLevel(level) {
  const L = Math.max(1, Math.floor(level || 1));
  return L === 20 || L === 40;
}

export function getGrowthMultiplier(level) {
  return isSpikeLevel(level) ? 2 : 1;
}

// XP needed to go from level L -> L+1
export function expToNext(level) {
  const L = Math.max(1, Math.floor(level || 1));

  // L100 is cap (no next)
  if (L >= 100) return 0;

  // Phase 1: 1–19
  if (L <= 19) return Math.round(200 + (L - 1) * 380);

  // Spike: 20 -> 21
  if (L === 20) return 30420;

  // Phase 2: 21–39
  if (L >= 21 && L <= 39) return Math.round(7420 + (L - 20) * 490);

  // Spike: 40 -> 41
  if (L === 40) return 108220;

  // Phase 3: 41–99
  return Math.round(17220 + (L - 40) * 610);
}

export function getXPRewardForEnemy(enemyType, playerLevel) {
  const phase = getPhase(playerLevel);
  let base = 0;

  // Reward tiers (doc Section 7)
  const standard = [40, 120, 310];
  const elite    = [160, 480, 1240];
  const ultra    = [640, 1920, 4960];
  const boss     = [2000, 6000, 15500];

  const idx = phase - 1;

  switch (enemyType) {
    case ENEMY_TYPE.RUSHER:
    case ENEMY_TYPE.ORBITER:
      base = standard[idx];
      break;
    case ENEMY_TYPE.TANKER:
    case ENEMY_TYPE.SNIPER:
    case ENEMY_TYPE.TELEPORTER:
    case ENEMY_TYPE.SHIELDED:
      base = elite[idx];
      break;
    case ENEMY_TYPE.SPLITTER:
      base = ultra[idx];
      break;
    case ENEMY_TYPE.BOSS:
      base = boss[idx];
      break;
    default:
      base = standard[idx];
      break;
  }

  // Growth bonus applies to XP gain while sitting on spike levels 20 and 40
  const growth = getGrowthMultiplier(playerLevel);
  return Math.round(base * growth);
}

export function getCoinTierForEnemy(enemyType) {
  // Coin tiers (doc Section 8)
  // Copper (1): Standard + split minions
  // Silver (5): Elite (Tanker, Sniper, Teleporter, Shielded)
  // Gold (20): Ultra Elite (Splitter)
  // Boss Coin (100): Boss
  //
  // IMPORTANT: coin COLOR should match tier name (copper/silver/gold/white).
  const COPPER = 0xb87333;
  const SILVER = 0xc0c0c0;
  const GOLD   = 0xffd700;
  const WHITE  = 0xffffff;

  switch (enemyType) {
    case ENEMY_TYPE.TANKER:
    case ENEMY_TYPE.SNIPER:
    case ENEMY_TYPE.TELEPORTER:
    case ENEMY_TYPE.SHIELDED:
      return { value: 5, color: SILVER };
    case ENEMY_TYPE.SPLITTER:
      return { value: 20, color: GOLD };
    case ENEMY_TYPE.BOSS:
      return { value: 100, color: WHITE };
    default:
      return { value: 1, color: COPPER };
  }
}


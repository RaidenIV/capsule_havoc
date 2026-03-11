// ─── luck.js ────────────────────────────────────────────────────────────────
// Design-doc Luck stat aggregation + utility helpers.
// Luck is now earned automatically as the player levels up.
// Every 5 levels grants +5 luck, up to a max of 60 at level 60+.

import { state } from './state.js';

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// Auto-luck from level: +5 per 5 levels, capped at 60
function getLevelLuck(){
  const level = Math.max(1, Math.floor(state.playerLevel || 1));
  return clamp(Math.floor(level / 5) * 5, 0, 60);
}

export function recomputeLuck(){
  const boss = state.bossLuck ?? 0;
  state.luck = getLevelLuck() + boss;
  return state.luck;
}

export function getLuck(){
  return recomputeLuck();
}

export function addLuck(amount = 0, source = 'misc'){
  const n = Number(amount) || 0;
  if (source === 'bossWave') state.bossLuck = (state.bossLuck ?? 0) + n;
  else {
    state.bossLuck = (state.bossLuck ?? 0) + n;
  }
  recomputeLuck();
}

// Used by timed arena pickups: luck reduces spawn interval modestly.
export function getLuckSpawnMultiplier(){
  const L = getLuck();
  // 0..60 luck -> 1.0 .. 0.7
  const t = clamp(L / 60, 0, 1);
  return 1.0 - 0.30 * t;
}

// Level-up 4th option chance. Doc: influenced by Luck.
export function getFourthOptionChance(){
  const L = getLuck();
  // 0..60 luck -> 5% .. 30%
  const t = clamp(L / 60, 0, 1);
  return 0.05 + 0.25 * t;
}

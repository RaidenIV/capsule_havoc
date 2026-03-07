// ─── luck.js ────────────────────────────────────────────────────────────────
// Design-doc Luck stat aggregation + utility helpers.
// Luck sources:
//  - Shop purchases: state.upg.luck (tiered)
//  - Boss wave bonuses: state.bossLuck (accumulates)

import { state } from './state.js';

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

// Shop luck tiers: 0..5 -> +0/+5/+10/+15/+20/+25
const SHOP_LUCK = [0, 5, 10, 15, 20, 25];

export function recomputeLuck(){
  const shop = SHOP_LUCK[clamp(state.upg?.luck ?? 0, 0, 5)] ?? 0;
  const boss = state.bossLuck ?? 0;
  state.luck = shop + boss;
  return state.luck;
}

export function getLuck(){
  return recomputeLuck();
}

export function addLuck(amount = 0, source = 'misc'){
  const n = Number(amount) || 0;
  if (source === 'bossWave') state.bossLuck = (state.bossLuck ?? 0) + n;
  else if (source === 'shop') {
    // shop luck is tracked via tier; do nothing here
  } else {
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

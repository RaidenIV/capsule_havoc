// ─── activeEffects.js ───────────────────────────────────────────────────────
// Centralized timed effects from arena pickups / abilities.

import { state } from './state.js';
import { playSound } from './audio.js';

function tkey(name){
  switch (name) {
    case 'doubleDamage': return 'doubleDamage';
    case 'invincibility': return 'invincibility';
    case 'coinValue2x': return 'coinValue2x';
    case 'xp2x': return 'xp2x';
    case 'armor': return 'armor';
    case 'clock': return 'clock';
    case 'blackHole': return 'blackHole';
    case 'coinMagnet': return 'coinMagnet';
    default: return null;
  }
}

export function initActiveEffects(){
  if (!state.effects) {
    state.effects = {
      doubleDamage: 0,
      invincibility: 0,
      coinValue2x: 0,
      xp2x: 0,
      armor: 0,
      clock: 0,
      blackHole: 0,
      coinMagnet: 0,
    };
  }
  if (!state.effectsDur) {
    state.effectsDur = {
      doubleDamage: 0,
      invincibility: 0,
      coinValue2x: 0,
      xp2x: 0,
      armor: 0,
      clock: 0,
      blackHole: 0,
      coinMagnet: 0,
    };
  }
}

export function applyEffect(name, durationSec = 10){
  initActiveEffects();
  const k = tkey(name);
  if (!k) return;
  state.effects[k] = Math.max(state.effects[k] || 0, durationSec);
  state.effectsDur[k] = Math.max(state.effectsDur[k] || 0, durationSec);
  // lightweight audio cues (mapped in audio.js; missing files are non-fatal)
  if (k === 'doubleDamage') playSound('pickup_double_damage', 0.7, 1.0);
  if (k === 'invincibility') playSound('pickup_invincibility', 0.7, 1.0);
  if (k === 'coinValue2x') playSound('pickup_coin_value', 0.7, 1.0);
  if (k === 'xp2x') playSound('pickup_xp', 0.7, 1.0);
  if (k === 'armor') playSound('pickup_armor', 0.7, 1.0);
  if (k === 'clock') playSound('pickup_clock', 0.7, 1.0);
  if (k === 'blackHole') playSound('pickup_black_hole', 0.7, 1.0);
  if (k === 'coinMagnet') playSound('pickup_coin_value', 0.65, 1.08);
}

export function updateActiveEffects(worldDelta){
  initActiveEffects();
  const e = state.effects;
  let anyExpired = false;
  for (const k of Object.keys(e)) {
    if ((e[k] || 0) > 0) {
      e[k] = Math.max(0, e[k] - worldDelta);
      if (e[k] === 0) anyExpired = true;
    }
  }
  if (anyExpired) playSound('pickup_expire', 0.35, 1.0);

  // Drive worldScale for Clock effect.
  // Abilities (Time Slow) already use state.slowTimer/state.slowScale in loop.js.
  if ((e.clock || 0) > 0) {
    // 15% speed; if player uses Time Slow concurrently, the slower wins.
    const clockScale = 0.85;
    state.worldScale = Math.min(state.worldScale || 1.0, clockScale);
  }
}

export function getDamageMultiplier(){
  initActiveEffects();
  return (state.effects.doubleDamage || 0) > 0 ? 2.0 : 1.0;
}

export function getCoinValueMultiplier(){
  initActiveEffects();
  return (state.effects.coinValue2x || 0) > 0 ? 2.0 : 1.0;
}

export function getXPMultiplier(){
  initActiveEffects();
  return (state.effects.xp2x || 0) > 0 ? 2.0 : 1.0;
}

export function isInvincible(){
  initActiveEffects();
  return (state.effects.invincibility || 0) > 0 || !!state.invincible || !!state.dashInvincible || (state.reviveIFrames || 0) > 0;
}

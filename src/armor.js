// ─── armor.js ───────────────────────────────────────────────────────────────
// Armor (3-hit) + extra-life revive logic.

import { state } from './state.js';
import { PLAYER_MAX_HP } from './constants.js';
import { playSound } from './audio.js';
import { updateHealthBar } from './player.js';

export const ARMOR_MAX_PIPS = 3;

export function grantArmor(hits = 3){
  state.armorHits = Math.max(state.armorHits || 0, hits);
  playSound('pickup_armor', 0.7, 1.0);
}

export function addArmorPip(){
  const cur = state.armorHits || 0;
  const next = Math.min(ARMOR_MAX_PIPS, cur + 1);
  state.armorHits = next;
  playSound('pickup_armor', 0.7, 1.0);
}

export function getArmorHits(){
  return state.armorHits || 0;
}

export function applyPlayerDamage(amount, source = 'generic'){
  const dmg = Math.max(0, Number(amount) || 0);
  if (dmg <= 0) return { applied: 0, died: false, revived: false };

  // Invincibility
  if (state.invincible || state.dashInvincible || (state.effects?.invincibility || 0) > 0 || (state.reviveIFrames || 0) > 0) {
    return { applied: 0, died: false, revived: false };
  }

  // Armor absorbs hits
  if ((state.armorHits || 0) > 0) {
    state.armorHits -= 1;
    if (state.armorHits <= 0) playSound('armor_break', 0.8, 1.0);
    else playSound('armor_hit', 0.7, 1.0);
    return { applied: 0, died: false, revived: false };
  }

  state.playerHP -= dmg;
  updateHealthBar();

  if (state.playerHP > 0) {
    playSound('player_hit', 0.6, 0.95 + Math.random() * 0.1);
    return { applied: dmg, died: false, revived: false };
  }

  // Extra life revive
  if ((state.extraLives || 0) > 0) {
    state.extraLives -= 1;
    const maxHP = state.playerMaxHP || PLAYER_MAX_HP;
    state.playerHP = Math.max(1, Math.round(maxHP * 0.60));
    state.reviveIFrames = 2.0;
    updateHealthBar();
    playSound('extra_life_revive', 0.9, 1.0);
    return { applied: dmg, died: false, revived: true };
  }

  return { applied: dmg, died: true, revived: false };
}

export function updateArmorTimers(worldDelta){
  if ((state.reviveIFrames || 0) > 0) state.reviveIFrames = Math.max(0, state.reviveIFrames - worldDelta);
}

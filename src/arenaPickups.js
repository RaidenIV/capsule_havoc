// ─── arenaPickups.js ─────────────────────────────────────────────────────────
// Design doc Section 14 — Arena Pickups
// Owns:
//  - Independent spawn timers per pickup type
//  - Max 2 uncollected pickups on floor (excluding coins/chests)
//  - Missing pickup types: Extra Life, Red Cross
//  - Black Hole sweep mechanic

import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup, updateHealthBar } from './player.js';
import { playSound } from './audio.js';
import { applyEffect } from './activeEffects.js';
import { spawnHealNum } from './damageNumbers.js';
import { collectAllCoins } from './coins.js';
import { ARMOR_MAX_PIPS, addArmorPip } from './armor.js';
import { getLuck } from './luck.js';

function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
function rand(){ return Math.random(); }
function randRange(a,b){ return a + rand()*(b-a); }

// Spawn location near player, but not directly on top.
function randomArenaPos(){
  const a = rand() * Math.PI * 2;
  const r = 6 + rand() * 12;
  return { x: playerGroup.position.x + Math.cos(a)*r, z: playerGroup.position.z + Math.sin(a)*r };
}

// Per-type timer ranges (seconds). Luck reduces the interval (doc: scales intervals).
const TIMER_TABLE = Object.freeze({
  doubleDamage:    { min: 35, max: 50 },
  invincibility:   { min: 55, max: 80 },
  coinValue:       { min: 38, max: 55 },
  xpBoost:         { min: 42, max: 60 },
  clockSlow:       { min: 48, max: 70 },
  blackHole:       { min: 60, max: 90 },
  armor:           { min: 70, max: 105 },
  extraLife:       { min: 95, max: 135 },
  redCross:        { min: 26, max: 42 },
});

// Durations (seconds) for active effects
const EFFECT_DUR = Object.freeze({
  doubleDamage: 10,
  invincibility: 6,
  coinValue: 15,
  xpBoost: 12,
  clockSlow: 8,
  blackHole: 3,
});

const MAX_FLOOR_PICKUPS = 2;

// Simple pickup meshes
const GEO = {
  orb: new THREE.SphereGeometry(0.38, 16, 16),
  cross: new THREE.BoxGeometry(0.18, 0.70, 0.18),
  crossBar: new THREE.BoxGeometry(0.70, 0.18, 0.18),
  ring: new THREE.TorusGeometry(0.45, 0.08, 10, 20),
};

function mat(color, emissive){
  return new THREE.MeshStandardMaterial({
    color,
    emissive: emissive ?? color,
    emissiveIntensity: 0.9,
    metalness: 0.35,
    roughness: 0.35,
    transparent: false,
  });
}

const MAT = Object.freeze({
  doubleDamage: mat(0xff3355, 0xff3355),
  invincibility:mat(0x00e5ff, 0x00e5ff),
  coinValue:    mat(0xffe566, 0xf0a800),
  xpBoost:      mat(0x7cff6b, 0x2aff2a),
  clockSlow:    mat(0xb08cff, 0x6a3cff),
  blackHole:    mat(0x111111, 0x5500ff),
  armor:        mat(0xffffff, 0x00e5ff),
  extraLife:    mat(0xff66ff, 0xff66ff),
  redCross:     mat(0xff4444, 0xff4444),
});

function countFloorPickups(){
  return (state.arenaPickups || []).filter(p => !p.collected).length;
}

function luckIntervalMul(){
  // Luck reduces intervals to a floor.
  const luck = getLuck();
  return clamp(1.0 - (luck / 160), 0.55, 1.0);
}

function schedule(type){
  const t = TIMER_TABLE[type];
  if (!t) return 9999;
  const mul = luckIntervalMul();
  return randRange(t.min, t.max) * mul;
}

export function initArenaPickups(){
  state.arenaPickups = [];
  state.pickupTimers = {};
  for (const k of Object.keys(TIMER_TABLE)) state.pickupTimers[k] = schedule(k);
}

function makePickup(type, pos){
  const group = new THREE.Group();

  if (type === 'redCross') {
    const v = new THREE.Mesh(GEO.cross, MAT.redCross.clone());
    const h = new THREE.Mesh(GEO.crossBar, MAT.redCross.clone());
    group.add(v); group.add(h);
  } else {
    const mesh = new THREE.Mesh(GEO.orb, (MAT[type] || MAT.xpBoost).clone());
    group.add(mesh);
    if (type === 'blackHole') {
      const ring = new THREE.Mesh(GEO.ring, MAT.blackHole.clone());
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    }
  }

  group.position.set(pos.x, 0.55, pos.z);
  scene.add(group);

  return {
    type,
    grp: group,
    life: 18.0,
    collected: false,
    bob: rand()*Math.PI*2,
  };
}

function spawn(type){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];
  const pos = randomArenaPos();
  state.arenaPickups.push(makePickup(type, pos));
}

function applyPickup(type){
  if (type === 'armor') {
    // Armor pip (no timer effect)
    addArmorPip();
    playSound('armor', 0.75, 1.0);
    return;
  }

  if (type === 'extraLife') {
    // Bank only one; second converts to coins.
    if ((state.extraLives || 0) >= 1) {
      state.coins += 250;
      const c = document.getElementById('coin-count');
      if (c) c.textContent = state.coins;
      playSound('coin', 0.7, 1.05);
    } else {
      state.extraLives = 1;
      playSound('life', 0.8, 1.0);
    }
    return;
  }

  if (type === 'redCross') {
    // Heal if low, else coins (doc rule)
    const hpPct = (state.playerHP / (state.playerMaxHP || 1));
    if (hpPct < 0.60) {
      const amt = Math.round((state.playerMaxHP || 100) * 0.35);
      state.playerHP = Math.min(state.playerMaxHP, state.playerHP + amt);
      updateHealthBar();
      spawnHealNum(playerGroup.position, amt);
      playSound('heal', 0.85, 1.0);
    } else {
      state.coins += 150;
      const c = document.getElementById('coin-count');
      if (c) c.textContent = state.coins;
      playSound('coin', 0.75, 1.02);
    }
    return;
  }

  if (type === 'blackHole') {
    // Sweep for 3s; also do an immediate snap collection of coins.
    applyEffect('blackHole', EFFECT_DUR.blackHole);
    const gained = collectAllCoins();
    console.log('[Pickups] Black Hole sweep: collected coins', gained);
    playSound('blackhole', 0.8, 0.95);
    return;
  }

  // Timed effects
  const dur = EFFECT_DUR[type] ?? 8;
  applyEffect(type, dur);
  playSound('powerup', 0.7, 1.0);
}

export function updateArenaPickups(dt, elapsed){
  if (!Array.isArray(state.arenaPickups)) state.arenaPickups = [];
  if (!state.pickupTimers) initArenaPickups();

  // Timers run concurrently, but we enforce a hard floor limit.
  const floorCount = countFloorPickups();
  const canSpawnMore = floorCount < MAX_FLOOR_PICKUPS;

  for (const type of Object.keys(TIMER_TABLE)) {
    if (!canSpawnMore) break;
    state.pickupTimers[type] -= dt;
    if (state.pickupTimers[type] <= 0) {
      spawn(type);
      state.pickupTimers[type] = schedule(type);
    }
  }

  // Update existing pickups
  for (let i = state.arenaPickups.length - 1; i >= 0; i--) {
    const p = state.arenaPickups[i];
    p.life -= dt;
    p.bob += dt * 3.0;
    p.grp.position.y = 0.55 + Math.sin(p.bob) * 0.12;
    p.grp.rotation.y += dt * 1.2;

    if (p.life <= 0) {
      scene.remove(p.grp);
      state.arenaPickups.splice(i, 1);
      continue;
    }

    const dx = playerGroup.position.x - p.grp.position.x;
    const dz = playerGroup.position.z - p.grp.position.z;
    if (dx*dx + dz*dz < 0.95*0.95) {
      scene.remove(p.grp);
      state.arenaPickups.splice(i, 1);
      applyPickup(p.type);
    }
  }
}

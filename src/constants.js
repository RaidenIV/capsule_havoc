// ─── constants.js ────────────────────────────────────────────────────────────
// All compile-time game constants. Nothing here should change at runtime.
// Import with: import { PLAYER_SPEED, ELITE_TYPES, ... } from './constants.js';

// ── Movement ─────────────────────────────────────────────────────────────────
export const PLAYER_SPEED          = 7;
export const ENEMY_SPEED           = 2.8;
export const BULLET_SPEED          = 14;
export const BULLET_LIFETIME       = 2.2;

// ── Health / Combat ──────────────────────────────────────────────────────────
export const PLAYER_MAX_HP         = 100;
export const ENEMY_HP              = 30;
export const ENEMY_CONTACT_DPS     = 18;
export const ENEMY_BULLET_SPEED    = 8;
export const ENEMY_BULLET_LIFETIME = 3.0;
export const ENEMY_BULLET_DMG      = 8;
export const BASE_BULLET_DMG       = 10;
export const STAGGER_DURATION      = 0.12;
export const SPAWN_FLASH_DURATION  = 0.65;

// ── Dash / Slow-motion ───────────────────────────────────────────────────────
export const DASH_SPEED      = 28;
export const DASH_DURATION   = 0.18;
export const DASH_COOLDOWN   = 1.4;
export const DASH_SLOW_SCALE  = 0.15;
export const SLOW_SNAP_RATE   = 22;
export const SLOW_RECOVER_RATE = 7;

// ── Pickups ───────────────────────────────────────────────────────────────────
export const HEALTH_PICKUP_CHANCE = 0.08;
export const HEALTH_RESTORE       = 25;

// ── Elite fire rates per minLevel ─────────────────────────────────────────────
export const ELITE_FIRE_RATE = { 1: 3.0, 3: 2.5, 5: 2.0, 7: 1.5, 9: 1.2, 10: 0.9 };

// ── XP / Levelling ────────────────────────────────────────────────────────────
export const XP_THRESHOLDS = [0, 500, 1500, 4000, 8000, 16000, 32000, 64000, 128000, 256000, 512000];
export const XP_PER_KILL_BY_LEVEL  = [10, 10, 20,  40,  50,  75, 100, 125, 150, 175, 200];
export const COIN_VALUE_BY_LEVEL   = [ 1,  2,  4,   8,  16,  32,  64, 128, 256, 512, 1024];

// Per-level enemy HP/coin scaling [hpBonus, coinVal]
export const LEVEL_ENEMY_CONFIG = [
  [0.00,    1], [1.00,    2], [1.00,    4], [1.00,    8],
  [1.00,   16], [1.00,   32], [1.00,   64], [1.00,  128],
  [1.00,  256], [1.00,  512], [1.00, 1024],
];

// Elite types unlocked at each player level
export const ELITE_TYPES = [
  { minLevel:  1, color: 0xff7700, sizeMult: 2.00, hpMult:   5, expMult:  2, coinMult:  2, count:  5 },
  { minLevel:  3, color: 0x00bb44, sizeMult: 2.00, hpMult:  15, expMult:  4, coinMult:  4, count: 10 },
  { minLevel:  5, color: 0x9b30ff, sizeMult: 2.00, hpMult:  50, expMult:  8, coinMult:  8, count: 15 },
  { minLevel:  7, color: 0x888888, sizeMult: 2.00, hpMult: 120, expMult: 16, coinMult: 16, count: 20 },
  { minLevel:  9, color: 0x00cccc, sizeMult: 2.50, hpMult: 200, expMult: 32, coinMult: 32, count: 25 },
  { minLevel: 10, color: 0x111111, sizeMult: 3.00, hpMult: 400, expMult: 64, coinMult: 64, count: 30 },
];

// Weapon config per level: [fireInterval, waveBullets, dmgMultiplier, orbitCount, orbitRadius, orbitSpeed, orbitColor]
export const WEAPON_CONFIG = [
  [0.850,  8, 1.0,  0,  0.0,  0.0, 0x00eeff],
  [0.850, 10, 1.5,  0,  0.0,  0.0, 0x00eeff],
  [0.425, 10, 1.5,  6,  2.0,  2.0, 0x00ff66],
  [0.425, 10, 2.0,  8,  3.0,  3.0, 0x00ff66],
  [0.425, 10, 2.0, 10,  4.0,  4.0, 0x0088ff],
  [0.213, 10, 4.0, 10,  5.0,  5.0, 0x0088ff],
  [0.213, 10, 4.0, 12,  6.0,  6.0, 0xaa00ff],
  [0.213, 10, 8.0, 12,  7.0,  7.0, 0xaa00ff],
  [0.106, 10, 8.0, 12,  8.0,  8.0, 0x00cccc],
  [0.106, 10,16.0, 14,  9.0,  9.0, 0xffffff],
  [0.106, 10,16.0, 16, 10.0, 10.0, 0xffffff],
];

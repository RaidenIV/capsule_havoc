// ─── constants.js ────────────────────────────────────────────────────────────
// All compile-time game constants. Nothing here should change at runtime.
// Import with: import { PLAYER_SPEED, ELITE_TYPES, ... } from './constants.js';

// ── Slash attack ──────────────────────────────────────────────────────────────
export const SLASH_RADIUS      = 4.0;             // blade reach
export const SLASH_INNER_R     = 0.55;            // starts past player body
export const SLASH_VISUAL_ARC  = Math.PI * 0.80;  // ~144° — wider wedge like reference image
export const SLASH_HIT_ARC     = Math.PI * 0.85;  // hitbox slightly wider
export const SLASH_INTERVAL    = 1.0;
export const SLASH_DAMAGE      = 20;
export const SLASH_DURATION    = 0.30;            // total life (s)
export const SLASH_SWING_TIME  = 0.05;            // blade sweeps in this time (2× faster)
export const SLASH_FADE_TIME   = 0.25;            // fades after peak

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
export const HEALTH_PICKUP_CHANCE = 0.02; // reduced by 75%
export const HEALTH_RESTORE       = 0.20; // restores 20% of max HP
export const LEVEL_UP_HEAL_FRACTION = 0.25;
export const ITEM_ATTRACT_SPEED = 34.0;
export const MAGNET_ATTRACT_RANGE_BASE = 3.0;
export const MAGNET_ATTRACT_RANGE_BONUS_PER_TIER = 0.125; // +12.5% radius per tier
export const MAGNET_POWERUP_RANGE = 18.0;
export const XP_GROWTH_BONUS_PER_TIER = 0.10;

// ── Elite fire rates per minLevel ─────────────────────────────────────────────
export const ELITE_FIRE_RATE = { 1: 3.0, 3: 2.5, 5: 2.0, 7: 1.5, 9: 1.2, 10: 0.9 };

// ── XP / Levelling ────────────────────────────────────────────────────────────
export const MAX_LEVEL = 100;
export const XP_THRESHOLDS = [
  0, // 0
  0, // 1
  100, // 2
  220, // 3
  370, // 4
  560, // 5
  800, // 6
  1100, // 7
  1470, // 8
  1920, // 9
  2460, // 10
  3100, // 11
  3850, // 12
  4720, // 13
  5720, // 14
  6860, // 15
  8150, // 16
  9600, // 17
  11220, // 18
  13020, // 19
  15010, // 20
  17200, // 21
  19600, // 22
  22220, // 23
  25070, // 24
  28160, // 25
  31500, // 26
  35100, // 27
  38970, // 28
  43120, // 29
  47560, // 30
  52300, // 31
  57350, // 32
  62720, // 33
  68420, // 34
  74460, // 35
  80850, // 36
  87600, // 37
  94720, // 38
  102220, // 39
  110110, // 40
  118400, // 41
  127100, // 42
  136220, // 43
  145770, // 44
  155760, // 45
  166200, // 46
  177100, // 47
  188470, // 48
  200320, // 49
  212660, // 50
  225500, // 51
  238850, // 52
  252720, // 53
  267120, // 54
  282060, // 55
  297550, // 56
  313600, // 57
  330220, // 58
  347420, // 59
  365210, // 60
  383600, // 61
  402600, // 62
  422220, // 63
  442470, // 64
  463360, // 65
  484900, // 66
  507100, // 67
  529970, // 68
  553520, // 69
  577760, // 70
  602700, // 71
  628350, // 72
  654720, // 73
  681820, // 74
  709660, // 75
  738250, // 76
  767600, // 77
  797720, // 78
  828620, // 79
  860310, // 80
  892800, // 81
  926100, // 82
  960220, // 83
  995170, // 84
  1030960, // 85
  1067600, // 86
  1105100, // 87
  1143470, // 88
  1182720, // 89
  1222860, // 90
  1263900, // 91
  1305850, // 92
  1348720, // 93
  1392520, // 94
  1437260, // 95
  1482950, // 96
  1529600, // 97
  1577220, // 98
  1625820, // 99
  1675410, // 100
];
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
  [1.000,  6, 1.0,  0,  0.0,  0.0, 0x00eeff],
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


// ── Waves / Shop ───────────────────────────────────────────────────────────
export const STANDARD_ENEMY_SIZE_MULT = 0.75;
export const WEAPON_TIER_COSTS = [2,4,8,16,32,64,128,256,512,1024];
export const WAVE_CONFIG = [
  { wave: 1, standardCount: 50, boss: { color: 0xff7700, sizeMult: 1, health: 100, expMult: 2, count: 1 } },
  { wave: 2, standardCount: 75, boss: { color: 0x00bb44, sizeMult: 1.25, health: 200, expMult: 4, count: 2 } },
  { wave: 3, standardCount: 100, boss: { color: 0x9b30ff, sizeMult: 1.5, health: 300, expMult: 8, count: 3 } },
  { wave: 4, standardCount: 125, boss: { color: 0x888888, sizeMult: 1.75, health: 400, expMult: 16, count: 4 } },
  { wave: 5, standardCount: 150, boss: { color: 0x00cccc, sizeMult: 2, health: 500, expMult: 32, count: 5 } },
  { wave: 6, standardCount: 175, boss: { color: 0x111111, sizeMult: 2.25, health: 600, expMult: 64, count: 6 } },
  { wave: 7, standardCount: 200, boss: { color: 0x00eeff, sizeMult: 2.5, health: 700, expMult: 128, count: 7 } },
  { wave: 8, standardCount: 225, boss: { color: 0x00ff66, sizeMult: 2.75, health: 800, expMult: 256, count: 8 } },
  { wave: 9, standardCount: 250, boss: { color: 0xaa00ff, sizeMult: 3.0, health: 900, expMult: 512, count: 10 } },
  { wave: 10, standardCount: 300, boss: { color: 0x0088ff, sizeMult: 1.0, health: 1000, expMult: 1024, count: 4 } },
];


// ── Design-doc enemy progression helpers (Option B) ───────────────────────────
export const ENEMY_TYPE = Object.freeze({
  RUSHER: 'RUSHER',
  ORBITER: 'ORBITER',
  TANKER: 'TANKER',
  SNIPER: 'SNIPER',
  TELEPORTER: 'TELEPORTER',
  SHIELDED: 'SHIELDED',
  SPLITTER: 'SPLITTER',
  BOSS: 'BOSS',
});

export function getEnemyCapForLevel(level){
  const L = Math.max(1, Math.floor(level || 1));
  if (L <= 2) return 20;
  return 60;
}

export function getActiveEnemyTypesForLevel(level){
  const L = Math.max(1, Math.floor(level||1));
  const types = [ENEMY_TYPE.RUSHER];
  if (L >= 6) types.push(ENEMY_TYPE.ORBITER);
  if (L >= 11) types.push(ENEMY_TYPE.TANKER);
  if (L >= 21) types.push(ENEMY_TYPE.SNIPER);
  if (L >= 31) types.push(ENEMY_TYPE.TELEPORTER);
  if (L >= 41) types.push(ENEMY_TYPE.SHIELDED);
  if (L >= 51) types.push(ENEMY_TYPE.SPLITTER);
  return types;
}

// enemy defs: percent values are fractions of player max HP (e.g. 0.10 = 10%)
export const ENEMY_DEFS = Object.freeze({
  [ENEMY_TYPE.RUSHER]:     { color: 0x888888, sizeMult: 0.75, hpPct: 0.08, contactPct: 0.10, shoot: false, metallic: false },
  [ENEMY_TYPE.ORBITER]:    { color: 0x00cc44, sizeMult: 1.00, hpPct: 0.50, contactPct: 0.15, shoot: true,  bulletPct: 0.10, fireRate: 4.00, bulletSpeedMult: 1.00, metallic: false, orbitR: 6.5 },
  [ENEMY_TYPE.TANKER]:     { color: 0x2b2b2b, sizeMult: 1.50, hpPct: 2.00, contactPct: 0.20, shoot: true,  bulletPct: 0.20, fireRate: 4.50, bulletSpeedMult: 0.85, metallic: false },
  [ENEMY_TYPE.SNIPER]:     { color: 0x9b30ff, sizeMult: 1.00, hpPct: 3.00, contactPct: 0.10, shoot: true,  bulletPct: 0.333, fireRate: 3.70, bulletSpeedMult: 1.35, metallic: false },
  [ENEMY_TYPE.TELEPORTER]: { color: 0xe0e0e0, sizeMult: 0.75, hpPct: 3.00, contactPct: 0.333, shoot: false, metallic: false, teleportWhenBelow: 0.50 },
  [ENEMY_TYPE.SHIELDED]:   { color: 0x4aa3ff, sizeMult: 1.25, hpPct: 0.50, shieldPct: 1.50, contactPct: 0.20, shoot: false, metallic: false },
  [ENEMY_TYPE.SPLITTER]:   { color: 0x80FB37, sizeMult: 2.00, hpPct: 3.00, contactPct: 0.30, shoot: true, bulletPct: 0.25, fireRate: 4.00, bulletSpeedMult: 1.20, metallic: false, splitCountMin: 2, splitCountMax: 3 },
  [ENEMY_TYPE.BOSS]:       { color: 0x111111, sizeMult: 3.00, hpPct: 4.00, contactPct: 0.50, shoot: true,  bulletPct: 0.33, fireRate: 1.75, bulletSpeedMult: 1.10, metallic: true },
});

export function isBossLevel(level){
  const L = Math.max(1, Math.floor(level||1));
  return L >= 10 && (L % 10 === 0);
}

export function getBossScaleForLevel(level){
  // Boss scaling per appearance (design doc Section 4)
  // Wave levels: 10,20,30,40,50,60,70 then +20% HP / +10% DMG per wave from 80+.
  const L = Math.max(1, Math.floor(level||1));
  const bossLvl = Math.floor(L / 10) * 10; // snap down to 10s
  const table = {
    10: { hpMult: 1.00, dmgMult: 1.00 },
    20: { hpMult: 1.20, dmgMult: 1.10 },
    30: { hpMult: 1.40, dmgMult: 1.20 },
    40: { hpMult: 1.60, dmgMult: 1.30 },
    50: { hpMult: 1.80, dmgMult: 1.40 },
    60: { hpMult: 2.00, dmgMult: 1.50 },
    70: { hpMult: 2.20, dmgMult: 1.60 },
  };
  if (bossLvl <= 70) return table[bossLvl] || { hpMult: 1, dmgMult: 1 };

  const wave = Math.max(0, Math.floor((bossLvl - 70) / 10)); // 80=>1, 90=>2, 100=>3
  return { hpMult: 2.20 + 0.20 * wave, dmgMult: 1.60 + 0.10 * wave };
}

// Player scaling (Section 6)
export function getPlayerMaxHPForLevel(level){
  const L = Math.max(1, Math.floor(level||1));
  return 100 + 5 * (L - 1);
}

export function getPlayerBaseDamageForLevel(level){
  const L = Math.max(1, Math.floor(level || 1));
  const n = Math.max(0, L - 1);
  return 10 + Math.floor(n * 0.20) + Math.floor(Math.sqrt(n) * 2.0);
}

export function getEnemyHealthScaleForLevel(level){
  const L = Math.max(1, Math.floor(level || 1));
  const n = Math.max(0, L - 1);
  return 1 + (n * 0.007) + (Math.floor(n / 10) * 0.05);
}

export function getEnemyDamageScaleForLevel(level){
  const L = Math.max(1, Math.floor(level || 1));
  const n = Math.max(0, L - 1);
  return 1 + (n * 0.006) + (Math.floor(n / 10) * 0.04);
}

export function getMagnetAttractRangeForTier(tier = 0, powerupActive = false){
  const t = Math.max(0, Math.min(5, Math.floor(tier || 0)));
  const range = MAGNET_ATTRACT_RANGE_BASE * (1 + MAGNET_ATTRACT_RANGE_BONUS_PER_TIER * t);
  return powerupActive ? Math.max(range, MAGNET_POWERUP_RANGE) : range;
}

export function getXPGrowthBonusForTier(tier = 0){
  const t = Math.max(0, Math.min(5, Math.floor(tier || 0)));
  return XP_GROWTH_BONUS_PER_TIER * t;
}

// ─── state.js ────────────────────────────────────────────────────────────────
// Central mutable game state. Exported as a single plain object so any module
// can read and write properties without ES-module immutability constraints.
// Import with: import { state } from './state.js';

export const state = {
  // ── Game flow ───────────────────────────────────────────────────────────────
  gameOver:    false,
  paused: false,
  pendingShop: false,
  spawnTimer: 0,
  bossRespawnTimer: 0,
  bossAlive: false,
  invincible:  false,
  dashInvincible: false,
  gameSession: 0,

  // ── Active effects & pickups (design doc) ───────────────────────────────
  effects: {
    doubleDamage: 0,
    invincibility: 0,
    coinValue2x: 0,
    xp2x: 0,
    armor: 0,
    clock: 0,
    blackHole: 0,
    coinMagnet: 0,
  },

  // Armor hits (3-hit pickup) and revive i-frames
  armorHits: 0,
  reviveIFrames: 0,
  bossLuck: 0,

  // ── UI mode ─────────────────────────────────────────────────────────────────
  uiMode: 'menu',   // 'menu' | 'playing'
  loopStarted: false,
      // incremented on restart to cancel stale setTimeout callbacks

  // ── Visual settings ─────────────────────────────────────────────────────────
  visuals: {
    shadows: 'high',
    bloom: true,
    reflections: true,
    accentLights: true,
  },

  // ── Stats ────────────────────────────────────────────────────────────────────
  kills:   0,
  elapsed: 0,
  coins:   0,

  // ── Meta stats (design doc) ───────────────────────────────────────────────
  luck: 0,
  curseTier: 0,

  // ── Player ───────────────────────────────────────────────────────────────────
  playerMaxHP: 100,
  playerHP: 100,
  playerXP:    0,
  playerLevel: 0,

  // Cached base damage from level (Section 6)
  playerBaseDMG: 10,

  // ── Shoot timing ────────────────────────────────────────────────────────────
  shootTimer:      0,
  bulletWaveAngle: 0,
  spawnTickTimer:  0,
  maxEnemies:      50,



  // ── Waves / Shop ───────────────────────────────────────────────────────────
  wave: 1,
  wavePhase: 'standard', // 'standard' | 'boss' | 'upgrade'
  waveSpawnRemaining: 0,
  bossSpawnRemaining: 0,
  wavePendingStart: false,

  upgradeOpen: false,
  weaponTier: 0,

  // ── Design-doc shop upgrades (tiers) ─────────────────────────────────────
  upg: {
    // Weapons
    laserFire: 0,     // 0..5 (unlocks / tiers player lasers)
    orbit: 0,         // 0..5 (orbit weapon tiers)

    dmg: 0,           // 0..5
    fireRate: 0,      // 0..5
    projSpeed: 0,     // 0..4
    piercing: 0,      // 0..3
    multishot: 0,     // 0..3

    // Movement
    moveSpeed: 0,     // 0..5
    dash: 0,          // 0..3
    magnet: 0,        // 0..4

    // Abilities
    shield: 0,        // 0..3
    burst: 0,         // 0..4
    timeSlow: 0,      // 0..3

    // Power Ups
    maxHealth: 0,     // 0..5
    regen: 0,         // 0..4
    xpGrowth: 0,      // 0..4
    coinBonus: 0,     // 0..3
    curse: 0,         // 0..3
    luck: 0,          // 0..3
  },

  // ── Ability timers ───────────────────────────────────────────────────────
  shieldCharges: 0,
  shieldRecharge: 0,
  shieldHitCD: 0,
  burstCooldown: 0,
  burstRequested: false,
  slowCooldown: 0,
  slowTimer: 0,
  slowScale: 0.5,
  slowRequested: false,

  // Arena pickup entities (clock, black hole, etc.)
  arenaPickups: [],

  // ── Shop upgrades ─────────────────────────────────────────────────────────
  pickupRangeLvl: 0,   // increases coin attraction distance
  extraLives:     0,   // consumed on death
  cosmetic: {
    playerColor: 'default',
  },
  // ── Dash / Slow-motion ───────────────────────────────────────────────────────
  hasDash:       false,  // unlocked via upgrade shop
  dashTimer:     0,
  dashCooldown:  0,
  dashCooldownMax: 0,
  dashVX:        0,
  dashVZ:        0,
  lastMoveX:     0,
  lastMoveZ:     1,
  dashGhostTimer:0,
  worldScale:    1.0,

  // ── Contact damage accumulation ──────────────────────────────────────────────
  contactDmgAccum: 0,
  contactDmgTimer: 0,

  // ── Input ────────────────────────────────────────────────────────────────────
  keys: { w: false, a: false, s: false, d: false },

  // ── Live entity arrays ───────────────────────────────────────────────────────
  enemies:      [],
  bullets:      [],
  enemyBullets: [],
  particles:    [],
  damageNums:   [],
  coinPickups:  [],
  healthPickups:[],
  chests:       [],
  dashStreaks:  [],
  orbitRings:   [],
  orbitHitActive: new Set(),

  // ── Panel ────────────────────────────────────────────────────────────────────
  panelOpen: false,
  activeTab: 'scene',
};

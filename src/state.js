// ─── state.js ────────────────────────────────────────────────────────────────
// Central mutable game state. Exported as a single plain object so any module
// can read and write properties without ES-module immutability constraints.
// Import with: import { state } from './state.js';

export const state = {
  // ── Game flow ───────────────────────────────────────────────────────────────
  gameOver:    false,
  paused:      false,
  invincible:  false,
  gameSession: 0,

  // ── UI mode ─────────────────────────────────────────────────────────────────
  uiMode: 'menu',   // 'menu' | 'playing'
  loopStarted: false,
      // incremented on restart to cancel stale setTimeout callbacks

  // ── Stats ────────────────────────────────────────────────────────────────────
  kills:   0,
  elapsed: 0,
  coins:   0,

  // ── Player ───────────────────────────────────────────────────────────────────
  playerHP:    100,
  playerXP:    0,
  playerLevel: 0,

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
  // ── Dash / Slow-motion ───────────────────────────────────────────────────────
  hasDash:       false,  // unlocked via upgrade shop
  dashTimer:     0,
  dashCooldown:  0,
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
  dashStreaks:  [],
  orbitRings:   [],
  orbitHitActive: new Set(),

  // ── Panel ────────────────────────────────────────────────────────────────────
  panelOpen: false,
  activeTab: 'scene',
};

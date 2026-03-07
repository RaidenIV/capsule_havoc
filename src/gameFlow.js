// ─── gameFlow.js ──────────────────────────────────────────────────────────────
import { state } from './state.js';
import { PLAYER_MAX_HP } from './constants.js';
import { scene, renderer, labelRenderer } from './renderer.js';
import { playerGroup, playerMesh, hbObj, dashBarObj, updateHealthBar, updateDashBar } from './player.js';
import { updateXP } from './xp.js';
import { spawnEnemyAtEdge, removeCSS2DFromGroup } from './enemies.js';
import { initSpawner } from './spawner.js';
import { destroyOrbitBullets, syncOrbitBullets } from './weapons.js';
import { _particleMeshPool } from './particles.js';
import { startMusic, stopMusic, pauseMusic, resumeMusic, playSound } from './audio.js';
import { recordRun } from './ui/highScores.js';
import { applyCosmetics } from './materials.js';
import { resetPowerupNotifications } from './hudEffects.js';

export { pauseMusic, resumeMusic }; // re-export so panel/index.js can use them

const timerEl      = document.getElementById('timer-value');
const killsEl      = document.getElementById('kills-value');
const coinCountEl  = document.getElementById('coin-count');
const gameOverEl   = document.getElementById('game-over');
const finalStatsEl = document.getElementById('final-stats');
const countdownEl  = document.getElementById('countdown');
const countdownNum = document.getElementById('countdown-num');

export function formatTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return m + ':' + s;
}

// ── Countdown overlay ─────────────────────────────────────────────────────────
export function startCountdown(onDone) {
  // Nothing (including floor) should be visible/loaded during countdown.
  // Hide renderers entirely until the countdown completes.
  if (renderer?.domElement) renderer.domElement.style.display = 'none';
  if (labelRenderer?.domElement) labelRenderer.domElement.style.display = 'none';

  playerMesh.visible = false; hbObj.visible = false; dashBarObj.visible = false;

  // Hide HUD during countdown
  const hudEls = [
    'ui',
    'hud-top-left',
    'coin-hud',
    'xp-hud',
    'fpsOverlay',
    'livesHud',
    'instructions',
    'tab-hint',
  ].map(id => document.getElementById(id));
  hudEls.forEach(el => { if (el) el.style.visibility = 'hidden'; });

  // Hide any bullets already in scene
  state.bullets.forEach(b => { const o = b.obj ?? b.mesh; if (o) o.visible = false; });
  // Hide any enemy bullets already in scene
  state.enemyBullets.forEach(b => { if (b.core) b.core.visible = false; if (b.mesh) b.mesh.visible = false; if (b.obj) b.obj.visible = false; });
  state.orbitRings.forEach(r => r.meshes.forEach(m => { m.visible = false; }));

  // Hide enemies
  state.enemies.forEach(e => { e.grp.visible = false; });
  const steps = [
    { text: '3',       size: '180px', color: '#ffffff', shadow: '0 0 42px rgba(255,255,255,0.45)' },
    { text: '2',       size: '180px', color: '#ffffff', shadow: '0 0 42px rgba(255,255,255,0.45)' },
    { text: '1',       size: '180px', color: '#ffffff', shadow: '0 0 42px rgba(255,255,255,0.45)' },
    { text: 'SURVIVE', size: '88px',  color: '#ff3535', shadow: '0 0 60px rgba(255,53,53,0.9)' },
  ];
  let idx = 0;
  countdownEl.classList.add('show');
  state.paused = true;
  playSound('countdown', 0.9, 1.0); // play once when countdown begins

  function showStep() {
    const s = steps[idx];
    countdownNum.style.fontSize   = s.size;
    countdownNum.style.color      = s.color;
    countdownNum.style.textShadow = s.shadow;
    countdownNum.textContent      = s.text;
    countdownNum.style.animation  = 'none';
    void countdownNum.offsetWidth;
    countdownNum.style.animation  = '';
    idx++;
    const delay = s.text === 'SURVIVE' ? 900 : 800;
    if (idx < steps.length) {
      setTimeout(showStep, delay);
    } else {
      setTimeout(() => {
        countdownEl.classList.remove('show');
        state.paused = false;

        // Reveal renderers only once the countdown finishes.
        if (renderer?.domElement) renderer.domElement.style.display = '';
        if (labelRenderer?.domElement) labelRenderer.domElement.style.display = '';

        playerMesh.visible = true;
        hbObj.visible = true;
        dashBarObj.visible = !!state.hasDash;
        // Restore HUD
        hudEls.forEach(el => { if (el) el.style.visibility = ''; });
        // Restore bullets and orbit rings
        state.bullets.forEach(b => { const o = b.obj ?? b.mesh; if (o) o.visible = true; });
        state.orbitRings.forEach(r => r.meshes.forEach(m => { m.visible = true; }));
        // Restore enemy bullets
        state.enemyBullets.forEach(b => { if (b.core) b.core.visible = true; if (b.mesh) b.mesh.visible = true; if (b.obj) b.obj.visible = true; });
        // Restore enemies
        state.enemies.forEach(e => { e.grp.visible = true; });

        // Ensure gameplay actually begins after countdown (some builds defer spawning until unpaused).
        // If no enemies exist yet, seed a small initial pack so the player sees action immediately.
        if (!state.gameOver && state.enemies.length === 0) {
          for (let k = 0; k < 4; k++) spawnEnemyAtEdge();
        }
        // Reset spawn tick so the spawn system (wave-based or level-based) can begin immediately.
        state.spawnTickTimer = 0;

        startMusic();
        if (onDone) onDone();
      }, delay);
    }
  }
  showStep();
}

// ── Game over / victory ───────────────────────────────────────────────────────
export function triggerGameOver() {
  state.gameOver = true;
  stopMusic();
  playSound('gameover', 0.9);
  finalStatsEl.textContent = `${formatTime(state.elapsed)} — ${state.kills} destroyed — ${state.coins} coins`;
  recordRun({ kills: state.kills, elapsed: state.elapsed, coins: state.coins, victory: false });
  gameOverEl.classList.add('show');
}

export function triggerVictory() {
  state.gameOver = true;
  stopMusic();
  playSound('victory', 0.9);
  const h1 = document.querySelector('#game-over h1');
  h1.textContent  = 'VICTORY';
  h1.style.color  = '#ffe066';
  h1.style.textShadow = '0 0 60px rgba(255,224,102,0.9)';
  finalStatsEl.textContent = `All 100 enemies defeated! ${formatTime(state.elapsed)} — ${state.coins} coins`;
  recordRun({ kills: state.kills, elapsed: state.elapsed, coins: state.coins, victory: true });
  gameOverEl.classList.add('show');
}

// ── Full restart ──────────────────────────────────────────────────────────────
export function restartGame(opts = {}) {
  const startCountdownNow = (opts.startCountdown !== false);
  state.gameSession++;

  state.enemies.forEach(e => { removeCSS2DFromGroup(e.grp); scene.remove(e.grp); });
  state.enemies.length = 0;

  state.bullets.forEach(b => { const o = b.obj ?? b.mesh; if (o) scene.remove(o); });
  state.bullets.length = 0;

  // Enemy bullets are two-mesh projectiles (core + glow). Make sure we remove BOTH,
  // otherwise orphaned cores can remain in the scene looking like "frozen" lasers.
  state.enemyBullets.forEach(b => {
    try {
      if (b.core) { scene.remove(b.core); b.mat?.dispose?.(); }
      if (b.mesh) scene.remove(b.mesh);
      b.extraMat?.dispose?.();
    } catch {}
  });
  state.enemyBullets.length = 0;

  state.particles.forEach(p => { scene.remove(p.mesh); _particleMeshPool.push(p.mesh); });
  state.particles.length = 0;

  state.damageNums.forEach(d => {
    scene.remove(d.spr); d.spr.material.map.dispose(); d.spr.material.dispose();
  });
  state.damageNums.length = 0;

  state.coinPickups.forEach(cp => { scene.remove(cp.mesh); cp.mat.dispose(); });
  state.coinPickups.length = 0;

  state.healthPickups.forEach(hp => { scene.remove(hp.mesh); hp.mat.dispose(); });
  state.healthPickups.length = 0;

  if (Array.isArray(state.arenaPickups)) {
    state.arenaPickups.forEach(p => { try { scene.remove(p.mesh); p.mat?.dispose?.(); } catch {} });
    state.arenaPickups.length = 0;
  }

  if (state.chests) {
    state.chests.forEach(c => { try { scene.remove(c.mesh); c.mesh.material?.dispose?.(); } catch {} });
    state.chests.length = 0;
  }

  state.dashStreaks.forEach(ds => { scene.remove(ds.mesh); ds.mat.dispose(); });
  state.dashStreaks.length = 0;

  if (Array.isArray(state.targetedShots)) {
    state.targetedShots.forEach(s => { try { scene.remove(s.obj); } catch {} });
    state.targetedShots.length = 0;
  }
  if (Array.isArray(state.lightningFx)) {
    state.lightningFx.forEach(fx => { try { scene.remove(fx.mesh); fx.geo?.dispose?.(); fx.mat?.dispose?.(); } catch {} });
    state.lightningFx.length = 0;
  }

  destroyOrbitBullets();

  playerGroup.position.set(0, 0, 0);
  state.playerHP    = PLAYER_MAX_HP;
  state.playerMaxHP = PLAYER_MAX_HP;
  state.kills       = 0;
  state.elapsed     = 0;
  state.shootTimer  = 0;
  state.bulletWaveAngle = 0;
  state.dashTimer   = 0; state.dashCooldown = 0; state.dashGhostTimer = 0;
  state.worldScale  = 1.0;
  state.contactDmgAccum = 0; state.contactDmgTimer = 0;
  state.spawnTickTimer  = 0;
  state.playerXP    = 0;
  state.playerLevel = 1;
  initSpawner();
  state.coins       = 0;
  state.weaponTier  = 0; // lasers are upgrade-only; player starts with slash only
  state.pickupRangeLvl = 0;
  state.upg = {
    laserFire:0, orbit:0,
    dmg:0, fireRate:0, projSpeed:0, laserRange:0, piercing:0, multishot:0,
    orbitDamage:0, orbitRange:0, orbitSpeed:0,
    targetedFire:0, targetedDamage:0, targetedCooldown:0, targetedRange:0,
    lightning:0, lightningDamage:0, lightningCooldown:0,
    moveSpeed:0, dash:0, magnet:0,
    shield:0, burst:0, timeSlow:0,
    maxHealth:0, regen:0, xpGrowth:0, coinBonus:0, curse:0, luck:0,
  };
  state.luck = 0;
  state.bossLuck = 0;
  state.curseTier = 0;
  state.shieldCharges = 0;
  state.shieldRecharge = 0;
  state.shieldHitCD = 0;
  state.burstCooldown = 0;
  state.slowCooldown = 0;
  state.slowTimer = 0;
  state.extraLives  = 0;
  state.armorHits   = 0;
  state.reviveIFrames = 0;
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
  state.effectsDur = {};
  state.targetedShotTimer = 0;
  state.lightningTimer = 0;
  state.targetedShots = [];
  state.lightningFx = [];
  state.bossLuck = 0;
  state.arenaPickups = [];
  state.pendingShop = false;
  state.bossAlive   = false;
  state.bossRespawnTimer = 0;
  state.spawnTimer  = 0;
  if (state.cosmetic) state.cosmetic.playerColor = 'default';
  state.upgradeOpen = false;
  state.wave        = 1;
  state.wavePhase   = null;
  state.waveSpawnRemaining = 0;
  state.bossSpawnRemaining = 0;
  state.wavePendingStart   = true;
  state.gameOver    = false;

  updateHealthBar(); updateDashBar();
  updateXP(0);
  syncOrbitBullets();
  try { applyCosmetics(); } catch {}

  if (killsEl)     killsEl.textContent    = '0';
  if (timerEl)     timerEl.textContent    = '00:00';
  if (coinCountEl) coinCountEl.textContent = '0';

  resetPowerupNotifications();

  gameOverEl.classList.remove('show');
  const h1 = document.querySelector('#game-over h1');
  if (h1) { h1.textContent = 'DESTROYED'; h1.style.color = ''; h1.style.textShadow = ''; }
  document.querySelectorAll('.lvl-cb').forEach(lb => lb.classList.remove('active'));

  // Wave system handles spawns (no initial enemies here)

  if (startCountdownNow) startCountdown();
}
// ─── gameFlow.js ──────────────────────────────────────────────────────────────
import { state } from './state.js';
import { PLAYER_MAX_HP } from './constants.js';
import { scene } from './renderer.js';
import { playerGroup, playerMesh, hbObj, dashBarObj, updateHealthBar, updateDashBar } from './player.js';
import { updateXP } from './xp.js';
import { spawnEnemyAtEdge, removeCSS2DFromGroup } from './enemies.js';
import { destroyOrbitBullets, syncOrbitBullets } from './weapons.js';
import { _particleMeshPool } from './particles.js';
import { startMusic, stopMusic, pauseMusic, resumeMusic } from './audio.js';
import { recordRun } from './ui/highScores.js';

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
  playerMesh.visible = false; hbObj.visible = false; dashBarObj.visible = false;
  const steps = [
    { text: '3',       size: '120px', color: '#00e5ff', shadow: '0 0 40px rgba(0,229,255,0.8)' },
    { text: '2',       size: '120px', color: '#00e5ff', shadow: '0 0 40px rgba(0,229,255,0.8)' },
    { text: '1',       size: '120px', color: '#00e5ff', shadow: '0 0 40px rgba(0,229,255,0.8)' },
    { text: 'SURVIVE', size: '64px',  color: '#ff3535', shadow: '0 0 60px rgba(255,53,53,0.9)' },
  ];
  let idx = 0;
  countdownEl.classList.add('show');
  state.paused = true;

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
        playerMesh.visible = hbObj.visible = dashBarObj.visible = true;
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
  finalStatsEl.textContent = `${formatTime(state.elapsed)} — ${state.kills} destroyed — ${state.coins} coins`;
  recordRun({ kills: state.kills, elapsed: state.elapsed, coins: state.coins, victory: false });
  gameOverEl.classList.add('show');
}

export function triggerVictory() {
  state.gameOver = true;
  stopMusic();
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

  state.bullets.forEach(b => scene.remove(b.mesh));
  state.bullets.length = 0;

  state.enemyBullets.forEach(b => scene.remove(b.mesh));
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

  state.dashStreaks.forEach(ds => { scene.remove(ds.mesh); ds.mat.dispose(); });
  state.dashStreaks.length = 0;

  destroyOrbitBullets();

  playerGroup.position.set(0, 0, 0);
  state.playerHP    = PLAYER_MAX_HP;
  state.kills       = 0;
  state.elapsed     = 0;
  state.shootTimer  = 0;
  state.bulletWaveAngle = 0;
  state.dashTimer   = 0; state.dashCooldown = 0; state.dashGhostTimer = 0;
  state.worldScale  = 1.0;
  state.contactDmgAccum = 0; state.contactDmgTimer = 0;
  state.spawnTickTimer  = 0;
  state.playerXP    = 0;
  state.playerLevel = 0;
  state.coins       = 0;
  state.gameOver    = false;

  updateHealthBar(); updateDashBar();
  updateXP(0);

  if (killsEl)     killsEl.textContent    = '0';
  if (timerEl)     timerEl.textContent    = '00:00';
  if (coinCountEl) coinCountEl.textContent = '0';

  gameOverEl.classList.remove('show');
  const h1 = document.querySelector('#game-over h1');
  if (h1) { h1.textContent = 'DESTROYED'; h1.style.color = ''; h1.style.textShadow = ''; }
  document.querySelectorAll('.lvl-cb').forEach(lb => lb.classList.remove('active'));

  if (!opts.skipInitialSpawn) {
    for (let i = 0; i < 20; i++) spawnEnemyAtEdge();
  }

  if (startCountdownNow) startCountdown();
}

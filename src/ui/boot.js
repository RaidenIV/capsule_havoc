// ─── ui/boot.js ─────────────────────────────────────────────────────────────
// Technical boot/loader screen: pure terminal text (no panels/cards).
// The screen prints "module load" lines one-by-one, then reveals PRESS START.
// Audio is intentionally NOT played here; we only unlock/init audio on PRESS START.

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

const MODULES = [
  'core/state.js',
  'core/constants.js',
  'gfx/renderer.js',
  'gfx/postfx/bloom.js',
  'io/input.js',
  'sim/spawner.js',
  'sim/enemyAI.js',
  'sim/weapons.js',
  'sim/coins.js',
  'sim/chests.js',
  'sim/arenaPickups.js',
  'ui/menu.js',
  'ui/upgrades.js',
  'ui/hudEffects.js',
  'audio/audio.js',
];

function fmtOk(name){
  // Keep it minimal, technical, and game-oriented.
  return `[ OK ] ${name}`;
}

function fmtInfo(msg){
  return `[ .. ] ${msg}`;
}

export function initBootUI({ onStart }){
  const boot = document.getElementById('boot-screen');
  const term = document.getElementById('boot-terminal');
  const startWrap = document.getElementById('boot-start-wrap');
  const startBtn = document.getElementById('boot-start');

  if (!boot || !term || !startWrap || !startBtn) {
    // If markup is missing, fall back immediately.
    onStart?.();
    return { destroy(){} };
  }

  let destroyed = false;
  let ready = false;

  function append(line){
    term.textContent += (term.textContent ? '\n' : '') + line;
    // keep recent output visible; no scrolling UI, just jump to bottom
    boot.scrollTop = boot.scrollHeight;
  }

  async function run(){
    append('C.HAVOC // BOOTSTRAP');
    append('SECURE MODE: ENABLED');
    append('INITIALIZING RUNTIME…');
    await sleep(250);

    // Print module loads one-by-one
    for (let i=0; i<MODULES.length && !destroyed; i++){
      const name = MODULES[i];
      append(fmtInfo(`loading ${name}`));
      await sleep(110);

      append(fmtOk(name));
      await sleep(70);
    }

    if (destroyed) return;

    append('');
    append(fmtInfo('verifying asset bundles…'));
    await sleep(160);
    append('[ OK ] assets verified');
    await sleep(120);

    append(fmtInfo('establishing combat link…'));
    await sleep(160);
    append('[ OK ] combat link established');

    append('');
    append('READY.');
    ready = true;
    startWrap.hidden = false;
    startBtn.focus();
  }

  function handleStart(){
    if (!ready) return;
    if (destroyed) return;
    destroyed = true;

    startBtn.disabled = true;
    startWrap.hidden = true;
    boot.classList.add('boot-hidden');

    onStart?.();
  }

  startBtn.addEventListener('click', handleStart);

  function keyHandler(e){
    if (e.code === 'Enter' || e.code === 'Space') {
      e.preventDefault();
      handleStart();
    }
  }
  window.addEventListener('keydown', keyHandler);

  run();

  return {
    destroy(){
      destroyed = true;
      window.removeEventListener('keydown', keyHandler);
    }
  };
}

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

const ASCII_TITLE = String.raw`
  ██████╗ █████╗ ██████╗ ███████╗██╗   ██╗██╗     ███████╗
 ██╔════╝██╔══██╗██╔══██╗██╔════╝██║   ██║██║     ██╔════╝
 ██║     ███████║██████╔╝███████╗██║   ██║██║     █████╗  
 ██║     ██╔══██║██╔═══╝ ╚════██║██║   ██║██║     ██╔══╝  
 ╚██████╗██║  ██║██║     ███████║╚██████╔╝███████╗███████╗
  ╚═════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝ ╚══════╝╚══════╝

   ██╗  ██╗ █████╗ ██╗   ██╗ ██████╗  ██████╗
   ██║  ██║██╔══██╗██║   ██║██╔═══██╗██╔════╝
   ███████║███████║██║   ██║██║   ██║██║     
   ██╔══██║██╔══██║╚██╗ ██╔╝██║   ██║██║     
   ██║  ██║██║  ██║ ╚████╔╝ ╚██████╔╝╚██████╗
   ╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝   ╚═════╝  ╚═════╝
`;

function setProgress(pct){
  const clamped = Math.max(0, Math.min(100, pct));
  const width = 36;
  const filled = Math.round((clamped/100) * width);
  const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
  return `[${bar}] ${String(Math.round(clamped)).padStart(3,' ')}%`;
}

export function initBootUI({ onStart }){
  const boot = document.getElementById('boot-screen');
  const ascii = document.getElementById('boot-ascii');
  const term = document.getElementById('boot-terminal');
  const progress = document.getElementById('boot-progress');
  const startWrap = document.getElementById('boot-start-wrap');
  const startBtn = document.getElementById('boot-start');

  if (!boot || !ascii || !term || !progress || !startWrap || !startBtn) {
    // If markup is missing, fall back immediately.
    onStart?.();
    return { destroy(){} };
  }

  let destroyed = false;
  let ready = false;

  const MAX_LINES = 14;
  const lines = [];
  function append(line){
    lines.push(line);
    while (lines.length > MAX_LINES) lines.shift(); // old lines disappear (no scroll)
    term.textContent = lines.join('
');
  }

  async function run(){
  // Title + initial status
  ascii.textContent = ASCII_TITLE.trimEnd();
  append('');
  append('C.HAVOC // LOADER');
  append('MODE............. TERMINAL');
  append('SECURITY......... ENABLED');
  append('SESSION.......... ' + Math.random().toString(16).slice(2,10).toUpperCase());
  append('');

  const extraSteps = 2; // asset verify + combat link
  const totalSteps = MODULES.length + extraSteps;
  let done = 0;

  function step(label){
    // label unused but helpful for debugging if needed
    done++;
    const pct = (done / totalSteps) * 100;
    progress.textContent = setProgress(pct);
  }

  // start at 0%
  progress.textContent = setProgress(0);

  append(fmtInfo('initializing runtime…'));
  await sleep(220);

  // Print module loads one-by-one
  for (let i=0; i<MODULES.length && !destroyed; i++){
    const name = MODULES[i];
    append(fmtInfo(`loading ${name}`));
    await sleep(95);

    append(fmtOk(name));
    step(name);
    await sleep(55);
  }

  if (destroyed) return;

  append('');
  append(fmtInfo('verifying asset bundles…'));
  await sleep(160);
  append('[ OK ] assets verified');
  step('assets');
  await sleep(90);

  append(fmtInfo('establishing combat link…'));
  await sleep(160);
  append('[ OK ] combat link established');
  step('link');

  append('');
  append('READY.');
  ready = true;

  // Only reveal PRESS START once the full sequence is complete.
  startWrap.hidden = false;
    startBtn.dataset.ready = 'true';
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

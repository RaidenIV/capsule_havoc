// ─── ui/boot.js ─────────────────────────────────────────────────────────────
// Pure terminal-style boot screen (no scrolling). Prints module load lines,
// advances a progress bar, then reveals PRESS START when progress reaches 100%.

function $(id){ return document.getElementById(id); }

const MODULES = [
  'core/renderer',
  'core/bloom',
  'core/postfx',
  'core/input',
  'core/audio',
  'sim/state',
  'sim/xp',
  'sim/spawner',
  'sim/enemies',
  'sim/weapons',
  'sim/pickups',
  'sim/chests',
  'sim/coins',
  'ui/hud',
  'ui/menu',
  'ui/shop',
  'ui/overlays',
  'assets/textures',
  'assets/sfx',
  'assets/shaders',
  'net/telemetry',
  'integrity/check',
];

function fmtLine(name, i, total){
  const pct = Math.floor(((i+1) / total) * 100);
  const stamp = new Date().toISOString().split('T')[1].replace('Z','');
  return `[${stamp}] LOAD ${name} ... OK  (${pct}%)`;
}

export function runBootSequence({ onStart } = {}){
  const boot = $('boot-screen');
  const term = $('boot-terminal');
  const bar  = $('boot-progress-bar');
  const btn  = $('boot-start-btn');

  if (!boot || !term || !bar || !btn) {
    // Nothing to do; fall back
    onStart?.();
    return;
  }

  // Fixed-size line buffer to prevent scrolling
  const maxLines = 18;
  const lines = [];
  let i = 0;

  // Ensure START is hidden until progress hits 100%
  btn.style.display = 'none';
  btn.setAttribute('aria-hidden','true');
  btn.disabled = true;

  const tick = () => {
    if (i < MODULES.length) {
      lines.push(fmtLine(MODULES[i], i, MODULES.length));
      if (lines.length > maxLines) lines.shift();
      term.textContent = lines.join('\n');

      const pct = Math.floor(((i+1) / MODULES.length) * 100);
      bar.style.width = `${pct}%`;
      i++;

      // Slightly variable cadence to feel “real”
      const delay = 70 + Math.floor(Math.random() * 90);
      window.setTimeout(tick, delay);
      return;
    }

    // Completed: force 100%, then reveal START
    bar.style.width = '100%';

    // Add final line
    lines.push('[OK] SYSTEM READY — AWAITING OPERATOR INPUT');
    while (lines.length > maxLines) lines.shift();
    term.textContent = lines.join('\n');

    btn.style.display = 'inline-block';
    btn.removeAttribute('aria-hidden');
    btn.disabled = false;
    btn.focus();

    const start = async () => {
      // prevent double fires + any “popping” during transitions
      btn.disabled = true;
      btn.style.display = 'none';

      // hide boot immediately
      boot.classList.add('boot-hidden');

      // detach listeners
      btn.removeEventListener('click', start);
      window.removeEventListener('keydown', onKey);

      onStart?.();
    };

    const onKey = (e) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        start();
      }
    };

    btn.addEventListener('click', start);
    window.addEventListener('keydown', onKey);
  };

  tick();
}

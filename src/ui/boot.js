// ─── ui/boot.js ──────────────────────────────────────────────────────────────
// Boot / loading screen with terminal-style log + PRESS START gate.
// Owns the first user gesture so audio can reliably unlock before splash SFX.

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

function mkLine(text, cls){
  const div = document.createElement('div');
  div.className = 'boot-line' + (cls ? ' ' + cls : '');
  div.textContent = text;
  return div;
}

export async function runBootScreen({ onStart }){
  const boot = document.getElementById('boot-screen');
  const term = document.getElementById('boot-terminal');
  const btn  = document.getElementById('boot-start');

  if (!boot || !term || !btn){
    // If boot screen isn't present, just start immediately.
    onStart?.();
    return;
  }

  // Ensure initial state
  boot.classList.remove('fade-out');
  term.innerHTML = '';
  btn.disabled = true;
  btn.classList.remove('ready');

  const lines = [
    ['> waking reactor core…', 'boot-prompt'],
    ['OK   power bus stable', 'boot-ok'],
    ['> calibrating thrusters…', 'boot-prompt'],
    ['OK   vector lock acquired', 'boot-ok'],
    ['> mounting arena geometry…', 'boot-prompt'],
    ['OK   navmesh compiled', 'boot-ok'],
    ['> loading weapon systems…', 'boot-prompt'],
    ['OK   emitters online', 'boot-ok'],
    ['> verifying SFX bank…', 'boot-prompt'],
    ['WARN audio locked until user input', 'boot-warn'],
    ['> standing by…', 'boot-prompt'],
  ];

  for (let i=0; i<lines.length; i++){
    const [t, cls] = lines[i];
    term.appendChild(mkLine(t, cls));
    // keep latest visible (even though overflow hidden; this prevents layout jumps)
    term.scrollTop = term.scrollHeight;
    await sleep(150 + (i%3)*30);
  }

  // Enable start
  btn.disabled = false;
  btn.classList.add('ready');

  const start = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    btn.classList.remove('ready');

    boot.classList.add('fade-out');
    boot.addEventListener('animationend', () => {
      boot.remove();
    }, { once: true });

    await onStart?.();
  };

  btn.addEventListener('click', start, { once: true });

  // Keyboard start (Enter / Space)
  const onKey = (e) => {
    if (e.code === 'Enter' || e.code === 'Space'){
      window.removeEventListener('keydown', onKey);
      start();
    }
  };
  window.addEventListener('keydown', onKey);
}

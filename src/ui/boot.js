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
    ['[BOOT] TACTICAL SYSTEMS INITIALIZING…', 'boot-prompt'],
    ['OK   secure channel: ESTABLISHED', 'boot-ok'],
    ['> verifying IFF transponder…', 'boot-prompt'],
    ['OK   IFF: GREEN / FRIENDLY', 'boot-ok'],
    ['> loading mission package: OPERATION HAVOC…', 'boot-prompt'],
    ['OK   ROE profile loaded', 'boot-ok'],
    ['> syncing sat-nav / arena grid…', 'boot-prompt'],
    ['OK   grid lock acquired', 'boot-ok'],
    ['> arming weapons matrix…', 'boot-prompt'],
    ['OK   emitters online', 'boot-ok'],
    ['> validating armor & shield protocols…', 'boot-prompt'],
    ['OK   defensive systems nominal', 'boot-ok'],
    ['> staging audio assets…', 'boot-prompt'],
    ['WARN audio interlock: awaiting user input', 'boot-warn'],
    ['> awaiting command…', 'boot-prompt'],
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

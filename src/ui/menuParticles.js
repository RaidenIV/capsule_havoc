// ─── ui/menuParticles.js ─────────────────────────────────────────────────────
// Floating spherical particles that sit behind the DOM-based main menu.

const PARTICLE_COUNT = 22;
const MIN_SIZE = 12;
const MAX_SIZE = 54;
const DRIFT_RANGE = 90;

function rand(min, max) {
  return min + Math.random() * (max - min);
}

export function initMenuParticles(menuRoot) {
  const layer = menuRoot?.querySelector('#menu-particles');
  if (!menuRoot || !layer) return { start() {}, stop() {} };

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const particles = [];
  let frameId = 0;
  let running = false;
  let bounds = { width: 1, height: 1 };

  function refreshBounds() {
    bounds.width = Math.max(1, layer.clientWidth || menuRoot.clientWidth || window.innerWidth);
    bounds.height = Math.max(1, layer.clientHeight || menuRoot.clientHeight || window.innerHeight);
  }

  function buildParticle(index) {
    const el = document.createElement('div');
    el.className = 'menu-particle';

    const size = rand(MIN_SIZE, MAX_SIZE);
    const depth = rand(0.55, 1.2);
    const particle = {
      el,
      size,
      baseX: rand(-size, bounds.width + size),
      baseY: rand(-size, bounds.height + size),
      driftX: rand(-DRIFT_RANGE, DRIFT_RANGE),
      driftY: rand(-DRIFT_RANGE, DRIFT_RANGE),
      speedX: rand(0.12, 0.32),
      speedY: rand(0.08, 0.22),
      pulseSpeed: rand(0.5, 1.2),
      pulsePhase: rand(0, Math.PI * 2),
      opacityBase: rand(0.14, 0.36),
      depth,
      phaseX: rand(0, Math.PI * 2),
      phaseY: rand(0, Math.PI * 2),
      scaleBase: rand(0.82, 1.18),
      spin: rand(-10, 10),
      wrapPad: Math.max(40, size * 1.5),
    };

    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.filter = `blur(${Math.max(0, (1.08 - depth) * 5.5).toFixed(2)}px)`;
    el.style.zIndex = String(index % 4);

    layer.appendChild(el);
    return particle;
  }

  function wrapParticle(particle) {
    const pad = particle.wrapPad;
    if (particle.baseX < -pad) particle.baseX = bounds.width + pad;
    if (particle.baseX > bounds.width + pad) particle.baseX = -pad;
    if (particle.baseY < -pad) particle.baseY = bounds.height + pad;
    if (particle.baseY > bounds.height + pad) particle.baseY = -pad;
  }

  function animate(now) {
    if (!running) return;

    const t = now * 0.001;
    for (const p of particles) {
      p.baseY -= 0.03 * p.depth;
      p.baseX += Math.sin(t * 0.12 + p.phaseY) * 0.02 * p.depth;
      wrapParticle(p);

      const x = p.baseX + Math.sin(t * p.speedX + p.phaseX) * p.driftX;
      const y = p.baseY + Math.cos(t * p.speedY + p.phaseY) * p.driftY;
      const pulse = 0.82 + ((Math.sin(t * p.pulseSpeed + p.pulsePhase) + 1) * 0.18);
      const scale = p.scaleBase * pulse;
      const opacity = Math.max(0.06, Math.min(0.5, p.opacityBase * pulse));

      p.el.style.opacity = opacity.toFixed(3);
      p.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)}) rotate(${(p.spin * Math.sin(t * 0.35 + p.phaseX)).toFixed(2)}deg)`;
    }

    frameId = requestAnimationFrame(animate);
  }

  function ensureParticles() {
    if (particles.length) return;
    refreshBounds();
    for (let i = 0; i < (reducedMotion ? 10 : PARTICLE_COUNT); i += 1) {
      particles.push(buildParticle(i));
    }
  }

  function start() {
    ensureParticles();
    refreshBounds();
    if (running) return;
    running = true;
    frameId = requestAnimationFrame(animate);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
  }

  window.addEventListener('resize', refreshBounds, { passive: true });

  return { start, stop };
}

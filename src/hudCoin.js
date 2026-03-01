// ─── hudCoin.js ───────────────────────────────────────────────────────────────
// Renders an exact replica of the in-game coin into the HUD canvas.
// Uses a dedicated micro Three.js renderer so it perfectly matches the
// CylinderGeometry / MeshStandardMaterial coin from pickups.js.

import * as THREE from 'three';

export function initHudCoin() {
  const canvas = document.getElementById('coin-canvas');
  if (!canvas) return;

  const W = 56, H = 56; // internal resolution (2× for crispness)
  canvas.width  = W;
  canvas.height = H;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H);
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 10);
  camera.position.set(0, 0.6, 1.8);
  camera.lookAt(0, 0, 0);

  // Exact same geometry + material as pickups.js
  const geo = new THREE.CylinderGeometry(0.22, 0.22, 0.08, 12);
  const mat = new THREE.MeshStandardMaterial({
    color:             0xffe566,
    emissive:          0xf0a800,
    emissiveIntensity: 0.6,
    metalness:         0.9,
    roughness:         0.2,
  });
  const coin = new THREE.Mesh(geo, mat);
  coin.rotation.x = Math.PI / 2;
  scene.add(coin);

  // Lighting that matches the in-game sunLight + fillLight feel
  const sun = new THREE.DirectionalLight(0xffffff, 8);
  sun.position.set(1, 2, 2);
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0xffe566, 3);
  fill.position.set(-1, 0.5, -1);
  scene.add(fill);

  scene.add(new THREE.AmbientLight(0xffffff, 1.5));

  // Spin on its own RAF loop (independent of main game loop)
  let angle = 0;
  function animate() {
    requestAnimationFrame(animate);
    angle += 0.04;
    coin.rotation.z = angle;
    renderer.render(scene, camera);
  }
  animate();
}

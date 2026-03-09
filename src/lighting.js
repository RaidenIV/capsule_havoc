// ─── lighting.js ──────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';

export const ambientLight = new THREE.AmbientLight(0x1a2433, 0.72);
scene.add(ambientLight);

export const hemiLight = new THREE.HemisphereLight(0xe9f5ff, 0x0c1018, 1.08);
scene.add(hemiLight);

export const sunLight = new THREE.DirectionalLight(0xf8fbff, 7.2);
sunLight.position.set(16, 28, 14);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(4096, 4096);
sunLight.shadow.camera.near   = 0.1;
sunLight.shadow.camera.far    = 150;
sunLight.shadow.camera.left   = -44;
sunLight.shadow.camera.right  =  44;
sunLight.shadow.camera.top    =  44;
sunLight.shadow.camera.bottom = -44;
sunLight.shadow.bias = -0.00012;
sunLight.shadow.normalBias = 0.035;
scene.add(sunLight);
scene.add(sunLight.target);

export const fillLight = new THREE.DirectionalLight(0xd9e7ff, 2.15);
fillLight.position.set(-18, 11, -14);
scene.add(fillLight);

export const rimLight = new THREE.DirectionalLight(0xb8d6ff, 1.32);
rimLight.position.set(6, 6, -26);
scene.add(rimLight);

// Branched, crackling helper lights around the player. These are brighter than
// the previous pass so the scene keeps its old readability while still feeling
// like electrically fractured light rather than plain circular orbit lights.
export const orbitLights = [
  { light: new THREE.PointLight(0xeaf7ff, 10.8, 22, 2), angle: 0.0, radius: 5.2, speed: 2.0, yOff: 3.8, phase: 0.0, branch: 1.00 },
  { light: new THREE.PointLight(0xd8ecff, 8.9, 20, 2), angle: 1.8, radius: 6.1, speed: 1.55, yOff: 3.2, phase: 1.4, branch: 0.82 },
  { light: new THREE.PointLight(0xf8fbff, 7.1, 18, 2), angle: 3.3, radius: 4.0, speed: 2.45, yOff: 4.4, phase: 2.8, branch: 0.62 },
];
orbitLights.forEach(({ light }) => {
  light.castShadow = false;
  scene.add(light);
});

export function updateOrbitLights(delta, playerPosition) {
  const t = Number(state.elapsed || 0);
  orbitLights.forEach((ol, idx) => {
    ol.angle += ol.speed * delta;

    const forkA = Math.sin(t * (4.4 + idx * 0.75) + ol.phase) * (1.15 * ol.branch);
    const forkB = Math.sin(t * (8.2 + idx * 1.35) + ol.phase * 1.7) * (0.72 * ol.branch);
    const jitter = Math.sin(t * (17.0 + idx * 3.3) + ol.phase * 2.2) * (0.32 * ol.branch);

    const radial = ol.radius + forkA;
    const tangentScale = 1.85 + forkB;

    const x = playerPosition.x
      + Math.cos(ol.angle) * radial
      + Math.cos(ol.angle + Math.PI * 0.5) * tangentScale
      + Math.cos(ol.angle * 2.1 + ol.phase) * jitter;

    const z = playerPosition.z
      + Math.sin(ol.angle) * radial
      + Math.sin(ol.angle + Math.PI * 0.5) * tangentScale
      + Math.sin(ol.angle * 1.7 + ol.phase) * jitter;

    const y = ol.yOff
      + Math.sin(t * (6.0 + idx * 0.9) + ol.phase) * (0.55 * ol.branch)
      + Math.max(0, Math.sin(t * (12.5 + idx * 1.8) + ol.phase)) * (0.35 * ol.branch);

    ol.light.position.set(x, y, z);

    const crackle = 0.86
      + Math.max(0, Math.sin(t * (15.5 + idx * 4.2) + ol.phase)) * 0.58
      + Math.max(0, Math.sin(t * (28.0 + idx * 6.0) + ol.phase * 1.6)) * 0.22;

    const base = idx === 0 ? 10.8 : idx === 1 ? 8.9 : 7.1;
    ol.light.intensity = base * crackle;
  });
}

// Keep the shadow-casting sun centred on the player
export function updateSunPosition(playerPosition) {
  sunLight.position.set(playerPosition.x + 16, 28, playerPosition.z + 14);
  sunLight.target.position.copy(playerPosition);
  sunLight.target.updateMatrixWorld();
}

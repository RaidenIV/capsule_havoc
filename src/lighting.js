// ─── lighting.js ──────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';

export const ambientLight = new THREE.AmbientLight(0x111827, 0.42);
scene.add(ambientLight);

export const hemiLight = new THREE.HemisphereLight(0xe7f4ff, 0x0a0d12, 0.75);
scene.add(hemiLight);

export const sunLight = new THREE.DirectionalLight(0xf7fbff, 5.8);
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

export const fillLight = new THREE.DirectionalLight(0xc7d9ff, 1.35);
fillLight.position.set(-18, 10, -14);
scene.add(fillLight);

export const rimLight = new THREE.DirectionalLight(0xaec8ff, 0.82);
rimLight.position.set(6, 5, -26);
scene.add(rimLight);

// Branching, cool-white crackle lights inspired by Lichtenberg figures.
// These are kept subtle so the scene still reads as grounded rather than neon.
export const orbitLights = [
  { light: new THREE.PointLight(0xe6f6ff, 8.2, 18, 2), angle: 0.0,  radius: 4.8, speed: 1.9, yOff: 3.4, phase: 0.0, branch: 1.00 },
  { light: new THREE.PointLight(0xcfe6ff, 6.6, 16, 2), angle: 1.6,  radius: 5.9, speed: 1.4, yOff: 2.9, phase: 1.7, branch: 0.78 },
  { light: new THREE.PointLight(0xf8fbff, 5.2, 14, 2), angle: 3.2,  radius: 3.7, speed: 2.3, yOff: 4.1, phase: 3.1, branch: 0.56 },
];
orbitLights.forEach(({ light }) => {
  light.castShadow = false;
  scene.add(light);
});

export function updateOrbitLights(delta, playerPosition) {
  const t = Number(state.elapsed || 0);
  orbitLights.forEach((ol, idx) => {
    ol.angle += ol.speed * delta;
    const fork = Math.sin(t * (4.5 + idx * 0.8) + ol.phase) * 0.85;
    const branch = Math.sin(t * (7.0 + idx * 1.1) + ol.phase * 1.9) * 0.42;
    const radial = ol.radius + fork * (1.1 * ol.branch);
    const tangential = branch * (1.6 * ol.branch);
    const x = playerPosition.x + Math.cos(ol.angle) * radial + Math.cos(ol.angle + Math.PI * 0.5) * tangential;
    const z = playerPosition.z + Math.sin(ol.angle) * radial + Math.sin(ol.angle + Math.PI * 0.5) * tangential;
    const y = ol.yOff + Math.sin(t * (5.8 + idx)) * (0.42 * ol.branch);
    ol.light.position.set(x, y, z);

    const crackle = 0.78 + Math.max(0, Math.sin(t * (16.0 + idx * 4.0) + ol.phase)) * 0.42;
    ol.light.intensity = (idx === 0 ? 8.2 : idx === 1 ? 6.6 : 5.2) * crackle;
  });
}

// Keep the shadow-casting sun centred on the player
export function updateSunPosition(playerPosition) {
  sunLight.position.set(playerPosition.x + 16, 28, playerPosition.z + 14);
  sunLight.target.position.copy(playerPosition);
  sunLight.target.updateMatrixWorld();
}

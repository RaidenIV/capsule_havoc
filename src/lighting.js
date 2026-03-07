// ─── lighting.js ──────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';

export const ambientLight = new THREE.AmbientLight(0x0a0a1a, 0);
scene.add(ambientLight);

export const sunLight = new THREE.DirectionalLight(0xffffff, 15);
sunLight.position.set(15, 30, 20);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near   = 0.1;
sunLight.shadow.camera.far    = 150;
sunLight.shadow.camera.left   = -50;
sunLight.shadow.camera.right  =  50;
sunLight.shadow.camera.top    =  50;
sunLight.shadow.camera.bottom = -50;
scene.add(sunLight);

export const fillLight = new THREE.DirectionalLight(0x1133ff, 0);
fillLight.position.set(-15, 8, -20);
scene.add(fillLight);

export const rimLight = new THREE.DirectionalLight(0xff1133, 0);
rimLight.position.set(0, 4, -30);
scene.add(rimLight);

// Animated orbit point lights — produce the sweeping metallic reflections
export const orbitLights = [
  { light: new THREE.PointLight(0x0088ff,  80, 60), angle: 0,           radius: 18, speed: 0, yOff:  6 },
  { light: new THREE.PointLight(0xff0033,  80, 60), angle: Math.PI,     radius: 18, speed: 0, yOff:  6 },
  { light: new THREE.PointLight(0x00ffaa,  50, 40), angle: Math.PI / 2, radius: 12, speed: 0, yOff: 10 },
  { light: new THREE.PointLight(0xffffff, 120, 30), angle: 1.2,         radius:  5, speed: 0, yOff:  8 },
];
orbitLights.forEach(ol => scene.add(ol.light));

// Call once per tick from loop.js
export function updateOrbitLights(delta, playerPosition) {
  orbitLights.forEach(ol => {
    ol.angle += ol.speed * delta;
    ol.light.position.set(
      playerPosition.x + Math.cos(ol.angle) * ol.radius,
      ol.yOff,
      playerPosition.z + Math.sin(ol.angle) * ol.radius
    );
  });
}

// Keep the shadow-casting sun centred on the player
export function updateSunPosition(playerPosition) {
  sunLight.position.set(playerPosition.x + 15, 30, playerPosition.z + 20);
  sunLight.target.position.copy(playerPosition);
  sunLight.target.updateMatrixWorld();
}

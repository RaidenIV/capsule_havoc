// ─── materials.js ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { state } from './state.js';

// ── Geometry params (mutated by control panel) ────────────────────────────────
export const playerGeoParams = { radius: 0.4,   length: 1.2,  capSegs: 8, radial: 16 };
export const enemyGeoParams  = { radius: playerGeoParams.radius * 0.75, length: playerGeoParams.length * 0.75, capSegs: 8, radial: 16 };
export const bulletGeoParams = { radius: 0.045, length: 0.55, capSegs: 4, radial:  6 };

// ── Geometries ────────────────────────────────────────────────────────────────
export let playerGeo = new THREE.CapsuleGeometry(
  playerGeoParams.radius, playerGeoParams.length, playerGeoParams.capSegs, playerGeoParams.radial
);
export let enemyGeo = new THREE.CapsuleGeometry(
  enemyGeoParams.radius, enemyGeoParams.length, enemyGeoParams.capSegs, enemyGeoParams.radial
);
export let bulletGeo = new THREE.CapsuleGeometry(
  bulletGeoParams.radius, bulletGeoParams.length, bulletGeoParams.capSegs, bulletGeoParams.radial
);
export const enemyBulletGeo = new THREE.CapsuleGeometry(0.045, 0.55, 4, 6);

// ── Materials ─────────────────────────────────────────────────────────────────
export const playerMat = new THREE.MeshPhysicalMaterial({
  color: 0x0044cc, metalness: 0.67, roughness: 0.0,
  clearcoat: 1.0, clearcoatRoughness: 0.0, envMapIntensity: 0.0,
  emissive: 0x000000, emissiveIntensity: 1.0,
});
export const playerBaseColor = playerMat.color.clone(); // restored after dash flash

export const enemyMat = new THREE.MeshPhysicalMaterial({
  color: 0x888888, metalness: 0.67, roughness: 0.0,
  clearcoat: 1.0, clearcoatRoughness: 0.0, envMapIntensity: 0.0,
  emissive: 0x000000, emissiveIntensity: 1.0,
});
export const bulletMat = new THREE.MeshStandardMaterial({
  color: 0xffffff, emissive: 0xff1100, emissiveIntensity: 4.0,
  metalness: 0.0, roughness: 0.2,
});

// ── Enemy bullet material cache ───────────────────────────────────────────────
const _eBulletMatCache = new Map();
export function getEnemyBulletMat(color) {
  let m = _eBulletMatCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: color, emissiveIntensity: 4.0,
      metalness: 0.0, roughness: 0.2,
    });
    _eBulletMatCache.set(color, m);
  }
  return m;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
// Y position so capsule's bottom hemisphere rests exactly on the floor
export function floorY(p) { return p.radius + p.length / 2; }

// After editing enemyMat in the panel, propagate to all live enemies
export function syncEnemyMats(enemies) {
  enemies.forEach(e => {
    if (!e.eliteType) {
      e.mat.color.copy(enemyMat.color);
      e.baseColor.copy(enemyMat.color);
    }
    e.mat.metalness = enemyMat.metalness;
    e.mat.roughness = enemyMat.roughness;
    if (e.mat.clearcoat          !== undefined) e.mat.clearcoat          = enemyMat.clearcoat;
    if (e.mat.clearcoatRoughness !== undefined) e.mat.clearcoatRoughness = enemyMat.clearcoatRoughness;
    if (e.mat.envMapIntensity    !== undefined) e.mat.envMapIntensity    = enemyMat.envMapIntensity;
    if (e.mat.emissive && enemyMat.emissive)    e.mat.emissive.copy(enemyMat.emissive);
    e.mat.emissiveIntensity = enemyMat.emissiveIntensity;
    e.mat.needsUpdate = true;
  });
}

// Setters so control panel can replace let-exported geometries
export function setPlayerGeo(g) { playerGeo = g; }
export function setEnemyGeo(g)  { enemyGeo  = g; }
export function setBulletGeo(g) { bulletGeo = g; }

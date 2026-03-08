// ─── player.js ────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { scene, ISO_FWD, ISO_RIGHT } from './renderer.js';
import { state } from './state.js';
import {
  PLAYER_SPEED, DASH_SPEED, DASH_DURATION, DASH_COOLDOWN,
  DASH_SLOW_SCALE, SLOW_SNAP_RATE, SLOW_RECOVER_RATE, PLAYER_MAX_HP,
} from './constants.js';
import {
  playerGeo, playerMat, playerBaseColor, playerGeoParams, floorY,
} from './materials.js';
import { pushOutOfProps } from './terrain.js';

// ── Scene graph ───────────────────────────────────────────────────────────────
export const playerGroup = new THREE.Group();
scene.add(playerGroup);

export const playerMesh = new THREE.Mesh(playerGeo, playerMat);
playerMesh.position.y = floorY(playerGeoParams);
playerMesh.castShadow = true;
playerGroup.add(playerMesh);
// ── Shield / armor indicators ──────────────────────────────────────────────
export const PLAYER_BODY_RADIUS = 0.6;
export const SHIELD_RADIUS = 1.5;

function enableBloomRecursive(obj){
  obj.traverse(child => { child.layers?.enable?.(1); });
  return obj;
}

function makeShieldIndicator(){
  const root = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(SHIELD_RADIUS, 28, 22),
    new THREE.MeshPhysicalMaterial({
      color: 0x49f5c8,
      emissive: 0x0fffd0,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.14,
      transmission: 0.35,
      metalness: 0.05,
      roughness: 0.12,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
      depthWrite: false,
    })
  );
  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(SHIELD_RADIUS * 0.985, 0.038, 12, 72),
    new THREE.MeshBasicMaterial({ color: 0x7dffea, transparent: true, opacity: 0.34, depthWrite: false })
  );
  ringA.rotation.x = Math.PI / 2;
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(SHIELD_RADIUS * 0.94, 0.026, 10, 64),
    new THREE.MeshBasicMaterial({ color: 0x0fffd0, transparent: true, opacity: 0.26, depthWrite: false })
  );
  ringB.rotation.y = Math.PI / 2;
  root.add(shell, ringA, ringB);
  root.userData.shell = shell;
  root.userData.ringA = ringA;
  root.userData.ringB = ringB;
  root.position.y = playerMesh.position.y;
  root.visible = false;
  return enableBloomRecursive(root);
}

function makeArmorIndicator(){
  const root = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(SHIELD_RADIUS, 24, 18),
    new THREE.MeshBasicMaterial({
      color: 0xffd46b,
      transparent: true,
      opacity: 0.10,
      wireframe: true,
      depthWrite: false,
    })
  );
  const cage = new THREE.Mesh(
    new THREE.IcosahedronGeometry(SHIELD_RADIUS * 0.985, 1),
    new THREE.MeshBasicMaterial({ color: 0xfff0a8, transparent: true, opacity: 0.18, wireframe: true, depthWrite: false })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(SHIELD_RADIUS * 0.90, 0.03, 10, 64),
    new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.24, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2;
  root.add(shell, cage, ring);
  root.userData.shell = shell;
  root.userData.cage = cage;
  root.userData.ring = ring;
  root.position.y = playerMesh.position.y;
  root.visible = false;
  return enableBloomRecursive(root);
}

const shieldGlow = makeShieldIndicator();
playerGroup.add(shieldGlow);

export function hasShieldBubble() {
  return (state.shieldCharges || 0) > 0;
}

const armorGlow = makeArmorIndicator();
playerGroup.add(armorGlow);

// ── Invincibility indicator (white bloom) ───────────────────────────────────
// Instead of a visible sphere, we drive bloom from the player mesh itself by
// temporarily enabling the bloom layer and boosting emissive to white.


// ── Health bar (CSS2D) ────────────────────────────────────────────────────────
const hbWrap = document.createElement('div');
hbWrap.className = 'health-bar-wrap';
export const hbFill = document.createElement('div');
hbFill.className = 'health-bar-fill';
hbWrap.appendChild(hbFill);
export const hbObj = new CSS2DObject(hbWrap);
hbObj.position.set(0, 2.6, 0);
playerGroup.add(hbObj);

// ── Dash cooldown bar (CSS2D) ─────────────────────────────────────────────────
const dashWrap = document.createElement('div');
// Keep a tight vertical stack with the health bar
dashWrap.style.cssText = 'width:72px;height:5px;background:rgba(0,0,0,0.6);border:1px solid rgba(0,180,255,0.35);border-radius:3px;overflow:hidden;margin-top:1px;';
const dashFill = document.createElement('div');
dashFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(to right,#0088cc,#00ccff);border-radius:3px;transition:width 0.05s linear;';
dashWrap.appendChild(dashFill);
export const dashBarObj = new CSS2DObject(dashWrap);
// Position just under the health bar
dashBarObj.position.set(0, 2.48, 0);
// Hidden until the dash upgrade is owned
dashBarObj.visible = false;
playerGroup.add(dashBarObj);

export function updateDashBar() {
  // Dash UI should only exist once the dash is unlocked.
  if (!state.hasDash) {
    dashBarObj.visible = false;
    return;
  }
  dashBarObj.visible = true;
  const denom = Math.max(0.01, state.dashCooldownMax || (DASH_COOLDOWN * 2));
  const pct = state.dashCooldown > 0
    ? Math.max(0, 1 - state.dashCooldown / denom) : 1;
  dashFill.style.width = (pct * 100) + '%';
}
export function updateHealthBar() {
  const maxHP = (state.playerMaxHP ?? PLAYER_MAX_HP);
  const pct = Math.max(0, state.playerHP / maxHP) * 100;
  hbFill.style.width = pct + '%';
  hbFill.style.background = pct < 30
    ? 'linear-gradient(to right,#006600,#00aa00)'
    : 'linear-gradient(to right,#00aa00,#44ff44)';
}

// ── Dash ghost (afterimage) ───────────────────────────────────────────────────
export function stampDashGhost() {
  const mat = new THREE.MeshPhysicalMaterial({
    color: playerBaseColor.clone(),
    metalness: playerMat.metalness,
    roughness: playerMat.roughness,
    transparent: true, opacity: 0.55, depthWrite: false,
  });
  const ghost = new THREE.Group();
  ghost.position.copy(playerGroup.position);
  const inner = new THREE.Mesh(playerGeo, mat);
  inner.position.copy(playerMesh.position);
  inner.rotation.copy(playerMesh.rotation);
  ghost.add(inner);
  scene.add(ghost);
  const FADE = 0.28;
  state.dashStreaks.push({ mesh: ghost, mat, life: FADE, maxLife: FADE });
}

// ── Per-frame player update ───────────────────────────────────────────────────
const _v  = new THREE.Vector3();
let _glowTime = 0;

export function updatePlayer(delta, worldScale) {
  _glowTime += delta;
  const abilitySlow = state.slowTimer > 0 ? (state.slowScale || 0.5) : 1.0;
  const pickupSlow = (state.effects?.clock || 0) > 0 ? 0.15 : 1.0;
  const slowTarget = Math.min(abilitySlow, pickupSlow);
  const wsTarget = state.dashTimer > 0 ? Math.min(DASH_SLOW_SCALE, slowTarget) : slowTarget;
  const wsRate   = wsTarget < worldScale ? SLOW_SNAP_RATE : SLOW_RECOVER_RATE;
  state.worldScale += (wsTarget - state.worldScale) * Math.min(1, wsRate * delta);

  // Regular movement (always full speed)
  _v.set(0, 0, 0);
  if (state.keys.w) _v.addScaledVector(ISO_FWD,   1);
  if (state.keys.s) _v.addScaledVector(ISO_FWD,  -1);
  if (state.keys.a) _v.addScaledVector(ISO_RIGHT, -1);
  if (state.keys.d) _v.addScaledVector(ISO_RIGHT,  1);
  if (_v.lengthSq() > 0) {
    _v.normalize();
    state.lastMoveX = _v.x; state.lastMoveZ = _v.z;
    const dirX = _v.x;
    const dirZ = _v.z;
    const msTier = Math.max(0, state.upg?.moveSpeed || 0);
    const speed = PLAYER_SPEED * (1 + 0.08 * msTier);
    _v.multiplyScalar(speed * delta);
    playerGroup.position.add(_v);
    state.playerVel = { x: dirX, z: dirZ };
  } else {
    // No movement input
    state.playerVel = state.playerVel || { x: 0, z: 0 };
    state.playerVel.x = 0; state.playerVel.z = 0;
  }

  // Dash (player stays at full speed — world slows around them)
  if (state.dashTimer > 0) {
    state.dashTimer -= delta;
    const dashSpeed = Math.max(0, state.dashSpeed || (DASH_SPEED * 0.5));
    playerGroup.position.x += state.dashVX * dashSpeed * delta;
    playerGroup.position.z += state.dashVZ * dashSpeed * delta;
    state.playerVel = { x: state.dashVX, z: state.dashVZ };
    playerMesh.rotation.z = state.dashVX * -0.4;
    state.dashGhostTimer -= delta;
    if (state.dashGhostTimer <= 0) { stampDashGhost(); state.dashGhostTimer = 0.035; }
  }
  if (state.dashCooldown > 0) {
    state.dashCooldown -= delta;
    if (state.dashCooldown < 0) state.dashCooldown = 0;
  }
  updateDashBar();

  // Restore material color after dash
  if (state.dashTimer <= 0) {
    playerMat.color.copy(playerBaseColor);
    playerMat.emissive.setRGB(0, 0, 0);
    playerMat.emissiveIntensity = 1.0;
  }

  pushOutOfProps(playerGroup.position, playerGeoParams.radius);

  // Lean in movement direction
  if (state.dashTimer <= 0) {
    const LEAN = 0.28;
    if (_v.lengthSq() > 0) {
      const mv = _v.clone().normalize();
      playerMesh.rotation.x += ( mv.z * LEAN - playerMesh.rotation.x) * 12 * delta;
      playerMesh.rotation.z += (-mv.x * LEAN - playerMesh.rotation.z) * 12 * delta;
    } else {
      playerMesh.rotation.x += (0 - playerMesh.rotation.x) * 12 * delta;
      playerMesh.rotation.z += (0 - playerMesh.rotation.z) * 12 * delta;
    }
  }
  // ── Player status glows (bloom layer) ─────────────────────────────────────
  // Shield indicator: shield charges from the shop ability.
  const shieldOn = (state.shieldCharges || 0) > 0;
  shieldGlow.visible = shieldOn;
  if (shieldOn) {
    const shieldPulse = Math.sin(_glowTime * 7.0);
    shieldGlow.userData.shell.material.opacity = 0.12 + shieldPulse * 0.025;
    shieldGlow.userData.ringA.material.opacity = 0.26 + shieldPulse * 0.05;
    shieldGlow.userData.ringB.material.opacity = 0.22 + Math.cos(_glowTime * 5.6) * 0.04;
    shieldGlow.userData.ringA.rotation.z = _glowTime * 1.6;
    shieldGlow.userData.ringB.rotation.x = _glowTime * 1.1;
    shieldGlow.scale.setScalar(1.0 + shieldPulse * 0.015);
  }

  // Armor indicator: armor powerup grants hits.
  const armorOn = (state.armorHits || 0) > 0;
  armorGlow.visible = armorOn;
  if (armorOn) {
    const armorPulse = Math.sin(_glowTime * 5.2);
    armorGlow.userData.shell.material.opacity = 0.08 + armorPulse * 0.02;
    armorGlow.userData.cage.material.opacity = 0.14 + Math.cos(_glowTime * 4.2) * 0.04;
    armorGlow.userData.ring.material.opacity = 0.20 + armorPulse * 0.04;
    armorGlow.userData.cage.rotation.y = _glowTime * 0.9;
    armorGlow.userData.cage.rotation.x = _glowTime * 0.45;
    armorGlow.userData.ring.rotation.z = _glowTime * 1.3;
    armorGlow.scale.setScalar(1.0 + armorPulse * 0.012);
  }

  // Invincibility indicator: ONLY the invincibility powerup (not dash iframes).
  const invOn = (state.effects?.invincibility || 0) > 0;
  if (invOn) {
    playerMesh.layers.enable(1); // drive bloom from the player mesh
    const pulse = 1.0 + Math.sin(_glowTime * 10.0) * 0.15;
    playerMat.emissive.set(0xffffff);
    playerMat.emissiveIntensity = 0.8 * pulse;
  } else {
    playerMesh.layers.disable(1);
    playerMat.emissive.setRGB(0, 0, 0);
    playerMat.emissiveIntensity = 1.0;
  }

}

// ── Update dash afterimage ghosts ────────────────────────────────────────────
export function updateDashStreaks(delta) {
  for (let i = state.dashStreaks.length - 1; i >= 0; i--) {
    const ds = state.dashStreaks[i];
    ds.life -= delta;
    if (ds.life <= 0) {
      scene.remove(ds.mesh); ds.mat.dispose();
      state.dashStreaks.splice(i, 1);
      continue;
    }
    ds.mat.opacity = (ds.life / ds.maxLife) * 0.55;
  }
}

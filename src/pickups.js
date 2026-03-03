// ─── pickups.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { PLAYER_MAX_HP, HEALTH_PICKUP_CHANCE, HEALTH_RESTORE } from './constants.js';
import { playerGroup, updateHealthBar } from './player.js';
import { spawnHealNum } from './damageNumbers.js';
import { playSound } from './audio.js';

// ── Health pickup ──────────────────────────────────────────────────────────────
const plusHorizGeo  = new THREE.BoxGeometry(0.72, 0.22, 0.18);
const plusVertGeo   = new THREE.BoxGeometry(0.22, 0.72, 0.18);
const healthMatBase = new THREE.MeshPhysicalMaterial({
  color: 0xff1a3a, emissive: 0xff0022, emissiveIntensity: 1.6,
  metalness: 0.1, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.1,
});

export function spawnHealthPickup(pos) {
  const mat   = healthMatBase.clone();
  const group = new THREE.Group();
  [plusHorizGeo, plusVertGeo].forEach(g => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = true; m.layers.enable(1);
    group.add(m);
  });
  const angle = Math.random() * Math.PI * 2;
  const r     = 0.3 + Math.random() * 0.8;
  group.position.set(pos.x + Math.cos(angle)*r, 0.55, pos.z + Math.sin(angle)*r);
  scene.add(group);
  state.healthPickups.push({ mesh: group, mat, life: 15.0, attracting: false });
}

// ── Update ────────────────────────────────────────────────────────────────────
const ATTRACT_DIST_HP   = [5.0,5.5,6.0,6.5,7.0,7.5,8.0,8.5,9.0,9.5,10.0]; // same magnet range as coins
const ATTRACT_SPD_HP    = 9.0;
const COLLECT_HP        = 0.8;

export function updatePickups(worldDelta, playerLevel, elapsed) {
  const baseAttract = ATTRACT_DIST_HP[Math.min(playerLevel, 10)];
  const bonus = Math.max(0, (state.upg?.magnet || 0)) * 1.25; // shop upgrade (design doc)
  const attractDist = baseAttract + bonus;

  // ── Health packs ─────────────────────────────────────────────────────────────
  for (let i = state.healthPickups.length - 1; i >= 0; i--) {
    const hp = state.healthPickups[i];
    hp.life -= worldDelta;
    if (hp.life <= 0) { scene.remove(hp.mesh); hp.mat.dispose(); state.healthPickups.splice(i, 1); continue; }
    if (hp.life < 2.0) { hp.mat.opacity = hp.life / 2.0; hp.mat.transparent = true; }

    const dx = playerGroup.position.x - hp.mesh.position.x;
    const dz = playerGroup.position.z - hp.mesh.position.z;
    const dist = Math.sqrt(dx*dx + dz*dz);
    if (dist < COLLECT_HP) {
      scene.remove(hp.mesh); hp.mat.dispose();
      state.healthPickups.splice(i, 1);
      const maxHP = (state.playerMaxHP || PLAYER_MAX_HP);
      const heal = Math.round(maxHP * 0.30);
      const healed = Math.min(heal, maxHP - state.playerHP);
      state.playerHP = Math.min(maxHP, state.playerHP + heal);
      updateHealthBar();
      playSound('heal', 0.6, 1.0);
      if (healed > 0) spawnHealNum(healed);
      continue;
    }
    if (dist < attractDist) hp.attracting = true;
    if (hp.attracting) {
      const spd = ATTRACT_SPD_HP * worldDelta;
      hp.mesh.position.x += (dx/dist) * Math.min(spd, dist);
      hp.mesh.position.z += (dz/dist) * Math.min(spd, dist);
    }
    hp.mesh.rotation.y   = elapsed * 1.8 + i;
    hp.mesh.position.y   = 0.55 + Math.sin(elapsed * 3.5 + i) * 0.12;
  }
}

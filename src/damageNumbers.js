// ─── damageNumbers.js ─────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';
import { state } from './state.js';
import { playerGroup } from './player.js';

const dmgCanvasPool = [];

function makeSprite(text, fillStyle) {
  const c = dmgCanvasPool.pop() ||
    Object.assign(document.createElement('canvas'), { width: 256, height: 128 });
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.font = 'bold 64px ui-sans-serif,system-ui';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle   = fillStyle;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 10;
  ctx.strokeText(text, c.width/2, c.height/2);
  ctx.fillText(text,   c.width/2, c.height/2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  spr.scale.set(1.9, 0.95, 1);
  return { spr, tex, canvas: c };
}

export function spawnPlayerDamageNum(amount) {
  const obj = makeSprite('-' + Math.round(amount), 'rgba(255,60,60,1.0)');
  obj.spr.position.copy(playerGroup.position);
  obj.spr.position.y += 3.5 + Math.random() * 0.5;
  obj.spr.position.x += (Math.random() - 0.5) * 0.8;
  obj.spr.position.z += (Math.random() - 0.5) * 0.8;
  scene.add(obj.spr);
  state.damageNums.push({ ...obj, life: 0.8, vy: 2.0 + Math.random() * 0.6 });
}

export function spawnEnemyDamageNum(amount, enemy) {
  const obj = makeSprite('-' + Math.round(amount), '#ffffff');
  obj.spr.position.copy(enemy.grp.position);
  obj.spr.position.y += 3.0 + Math.random() * 0.5;
  obj.spr.position.x += (Math.random() - 0.5) * 0.8;
  obj.spr.position.z += (Math.random() - 0.5) * 0.8;
  scene.add(obj.spr);
  state.damageNums.push({ ...obj, life: 0.7, vy: 1.8 + Math.random() * 0.5 });
}

export function spawnHealNum(amount) {
  const obj = makeSprite('+' + Math.round(amount), '#44ff66');
  obj.spr.position.copy(playerGroup.position);
  obj.spr.position.y += 3.5 + Math.random() * 0.5;
  obj.spr.position.x += (Math.random() - 0.5) * 0.8;
  obj.spr.position.z += (Math.random() - 0.5) * 0.8;
  scene.add(obj.spr);
  state.damageNums.push({ ...obj, life: 0.85, vy: 2.2 });
}

export function updateDamageNums(worldDelta) {
  for (let i = state.damageNums.length - 1; i >= 0; i--) {
    const dn = state.damageNums[i];
    dn.life -= worldDelta;
    if (dn.life <= 0) {
      scene.remove(dn.spr);
      dn.spr.material.map.dispose(); dn.spr.material.dispose();
      dmgCanvasPool.push(dn.canvas);
      state.damageNums.splice(i, 1);
      continue;
    }
    dn.spr.position.y += dn.vy * worldDelta;
    dn.vy *= 0.95;
    const t = dn.life / 0.7;
    dn.spr.material.opacity = Math.min(1, t * 2);
    const s = 0.9 + (1 - t) * 0.35;
    dn.spr.scale.set(1.9*s, 0.95*s, 1);
  }
}

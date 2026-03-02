// ─── enemyAI.js ─────────────────────────────────────────────────────────────
// This module exists to match the design doc's separation of concerns.
// The current codebase keeps most movement + shooting logic in enemies.js.
// To avoid a risky full refactor, we provide the expected exports and
// implement decollision + despawn checks here. enemies.js can optionally
// call these helpers.

import { CAM_D } from './renderer.js';

export function applyDecollision(enemies){
  // Simple pairwise push (O(n^2), but capped at 50 enemies so OK)
  const n = enemies.length;
  for (let i = 0; i < n; i++) {
    const a = enemies[i];
    if (!a || a.dead) continue;
    for (let j = i + 1; j < n; j++) {
      const b = enemies[j];
      if (!b || b.dead) continue;
      const ax = a.grp.position.x, az = a.grp.position.z;
      const bx = b.grp.position.x, bz = b.grp.position.z;
      const dx = bx - ax, dz = bz - az;
      const d2 = dx*dx + dz*dz;
      const min = ((a.scaleMult||1) + (b.scaleMult||1)) * 0.55;
      if (d2 > 0 && d2 < min*min) {
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.45;
        const nx = dx / d;
        const nz = dz / d;
        a.grp.position.x -= nx * push;
        a.grp.position.z -= nz * push;
        b.grp.position.x += nx * push;
        b.grp.position.z += nz * push;
      }
    }
  }
}

export function checkDespawn(enemies, playerPos){
  // Remove enemies far beyond camera distance without awarding XP/coins.
  const base = (Number.isFinite(CAM_D) ? CAM_D : 18);
  const maxR = base * 4.5;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e || e.dead) continue;
    const dx = e.grp.position.x - playerPos.x;
    const dz = e.grp.position.z - playerPos.z;
    if (dx*dx + dz*dz > maxR*maxR) {
      e.dead = true;
      try { e.grp.parent?.remove?.(e.grp); } catch {}
      enemies.splice(i, 1);
    }
  }
}

export function updateEnemyAI(enemies, playerPos, delta){
  // Movement is handled in enemies.js for now; we still apply decollision.
  applyDecollision(enemies);
  checkDespawn(enemies, playerPos);
}

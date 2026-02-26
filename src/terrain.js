// ─── terrain.js ───────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { scene } from './renderer.js';

// ── Config ────────────────────────────────────────────────────────────────────
const CHUNK_SIZE  = 20;
const CHUNK_RANGE = 4; // visible in each direction (9×9 grid)

let showGround = true;
let showGrid   = true;

// ── Shared geometries ─────────────────────────────────────────────────────────
const chunkPlaneGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE);
const propGeoBox    = new THREE.BoxGeometry(1, 1, 1);
const propGeoCyl    = new THREE.CylinderGeometry(0.5, 0.65, 1, 6);

// ── Flat collider list for per-frame checks: { wx, wz, radius } ───────────────
export const propColliders = [];

const chunks = new Map(); // key → { grp, groundMesh, gridHelper, propData[] }

// Seeded per-chunk pseudo-random
function cRand(cx, cz, idx) {
  const s = Math.sin(cx * 127.1 + cz * 311.7 + idx * 74.3) * 43758.5453;
  return s - Math.floor(s);
}

function makeChunkGroundMat(cx, cz) {
  const hue  = (cRand(cx, cz, 0) - 0.5) * 0.04;
  const base = new THREE.Color(0x0d0d1a);
  base.r = Math.max(0, base.r + hue);
  base.g = Math.max(0, base.g + hue * 0.5);
  base.b = Math.min(1, base.b + Math.abs(hue));
  return new THREE.MeshStandardMaterial({ color: base, metalness: 0.3, roughness: 0.9 });
}

function makePropMaterial(cx, cz, idx) {
  const v  = cRand(cx, cz, idx + 20);
  const ei = v < 0.15 ? 0.25 : 0;
  const col = v < 0.5 ? new THREE.Color(0x0d0e1f) : new THREE.Color(0x12131f);
  return new THREE.MeshStandardMaterial({
    color: col, metalness: 0.6, roughness: 0.65,
    emissive: new THREE.Color(0x000820), emissiveIntensity: ei,
  });
}

function chunkKey(cx, cz) { return `${cx},${cz}`; }

function createChunk(cx, cz) {
  const key = chunkKey(cx, cz);
  if (chunks.has(key)) return;

  const wx = cx * CHUNK_SIZE;
  const wz = cz * CHUNK_SIZE;
  const grp = new THREE.Group();
  grp.position.set(wx, 0, wz);

  const groundMesh = new THREE.Mesh(chunkPlaneGeo, makeChunkGroundMat(cx, cz));
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  groundMesh.visible = showGround;
  grp.add(groundMesh);

  const gridHelper = new THREE.GridHelper(CHUNK_SIZE, 10, 0x1a1a33, 0x111122);
  gridHelper.position.y = 0.015;
  gridHelper.visible = showGrid;
  grp.add(gridHelper);

  const propCount = 1 + Math.floor(cRand(cx, cz, 1) * 5);
  const propData  = [];
  const halfC     = CHUNK_SIZE * 0.5 - 2.5;

  for (let p = 0; p < propCount; p++) {
    const lx   = (cRand(cx, cz, p*7+2) * 2 - 1) * halfC;
    const lz   = (cRand(cx, cz, p*7+3) * 2 - 1) * halfC;
    const useBox   = cRand(cx, cz, p*7+4) > 0.45;
    const sizeClass = cRand(cx, cz, p*7+5);

    let scaleXZ, scaleY;
    if      (sizeClass < 0.35) { scaleXZ = 0.3 + cRand(cx,cz,p*7+6)*0.8; scaleY = 0.2 + cRand(cx,cz,p*7+7)*0.5; }
    else if (sizeClass < 0.70) { scaleXZ = 1.0 + cRand(cx,cz,p*7+6)*1.5; scaleY = 0.8 + cRand(cx,cz,p*7+7)*1.5; }
    else                       { scaleXZ = 1.5 + cRand(cx,cz,p*7+6)*2.0; scaleY = 2.5 + cRand(cx,cz,p*7+7)*5.0; }

    const mesh = new THREE.Mesh(useBox ? propGeoBox : propGeoCyl, makePropMaterial(cx, cz, p));
    mesh.scale.set(scaleXZ, scaleY, scaleXZ);
    mesh.position.set(lx, scaleY * 0.5, lz);
    mesh.castShadow = mesh.receiveShadow = true;
    grp.add(mesh);

    const collider = { wx: wx + lx, wz: wz + lz, radius: scaleXZ * 0.55 };
    propColliders.push(collider);
    propData.push({ mesh, collider });
  }

  scene.add(grp);
  chunks.set(key, { grp, groundMesh, gridHelper, propData });
}

function removeChunk(key) {
  const c = chunks.get(key);
  if (!c) return;
  scene.remove(c.grp);
  c.groundMesh.material.dispose();
  c.propData.forEach(({ mesh, collider }) => {
    mesh.material.dispose();
    const idx = propColliders.indexOf(collider);
    if (idx !== -1) propColliders.splice(idx, 1);
  });
  chunks.delete(key);
}

// Update which chunks are loaded around the player
const _chunkNeeded = new Set();
export function updateChunks(playerPosition) {
  const pcx = Math.round(playerPosition.x / CHUNK_SIZE);
  const pcz = Math.round(playerPosition.z / CHUNK_SIZE);
  _chunkNeeded.clear();
  for (let dx = -CHUNK_RANGE; dx <= CHUNK_RANGE; dx++) {
    for (let dz = -CHUNK_RANGE; dz <= CHUNK_RANGE; dz++) {
      const key = chunkKey(pcx + dx, pcz + dz);
      _chunkNeeded.add(key);
      if (!chunks.has(key)) createChunk(pcx + dx, pcz + dz);
    }
  }
  for (const key of chunks.keys()) {
    if (!_chunkNeeded.has(key)) removeChunk(key);
  }
}

// Proxies for control panel visibility toggles
export const ground = {
  get visible() { return showGround; },
  set visible(v) { showGround = v; chunks.forEach(c => { c.groundMesh.visible = v; }); },
};
export const grid = {
  get visible() { return showGrid; },
  set visible(v) { showGrid = v; chunks.forEach(c => { c.gridHelper.visible = v; }); },
};

// ── Line-of-sight check (segment vs all prop colliders) ──────────────────────
export function hasLineOfSight(ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 0.001) return true;
  const inv = 1 / len2;
  for (const c of propColliders) {
    const ex = c.wx - ax, ez = c.wz - az;
    const t  = Math.max(0, Math.min(1, (ex*dx + ez*dz) * inv));
    const cx = ax + t*dx - c.wx, cz = az + t*dz - c.wz;
    if (cx*cx + cz*cz < c.radius * c.radius) return false;
  }
  return true;
}

// ── Enemy steering (blends desired direction with prop + peer avoidance) ──────
const _steerOut = { sx: 0, sz: 0 };
export function steerAroundProps(ex, ez, tx, tz, capsuleR, enemies, selfIdx) {
  const ddx = tx - ex, ddz = tz - ez;
  const dlen = Math.sqrt(ddx*ddx + ddz*ddz);
  if (dlen < 0.01) { _steerOut.sx = _steerOut.sz = 0; return _steerOut; }
  const nx = ddx / dlen, nz = ddz / dlen;
  const LOOK = Math.max(4.5, capsuleR * 10);
  let avX = 0, avZ = 0;

  for (const c of propColliders) {
    const minClear = c.radius + capsuleR + 0.5;
    const cx = c.wx - ex, cz = c.wz - ez;
    const dd = Math.sqrt(cx*cx + cz*cz);
    if (dd < minClear * 1.8 && dd > 0.001) {
      const rep = (1 - dd / (minClear*1.8)) * 1.8;
      avX -= (cx/dd)*rep; avZ -= (cz/dd)*rep;
    }
    const along = cx*nx + cz*nz;
    if (along < -capsuleR || along > LOOK) continue;
    const px = cx - along*nx, pz = cz - along*nz;
    const pd = Math.sqrt(px*px + pz*pz);
    if (pd >= minClear) continue;
    const str = Math.pow((minClear - pd) / minClear, 0.7) * 2.2;
    const side = (px*(-nz) + pz*nx) < 0 ? 1 : -1;
    avX += side * (-nz) * str; avZ += side * nx * str;
  }

  if (enemies && selfIdx !== undefined) {
    const selfR = capsuleR;
    for (let j = 0; j < enemies.length; j++) {
      if (j === selfIdx || enemies[j].dead) continue;
      const o  = enemies[j];
      const oR = 0.4 * (o.scaleMult || 1); // enemyGeoParams.radius baked as 0.4
      const sep = selfR + oR + 0.35;
      const ox = o.grp.position.x - ex, oz = o.grp.position.z - ez;
      const od = Math.sqrt(ox*ox + oz*oz);
      if (od < sep && od > 0.001) {
        const rep = (1 - od/sep) * 1.2;
        avX -= (ox/od)*rep; avZ -= (oz/od)*rep;
      }
    }
  }

  if (avX === 0 && avZ === 0) { _steerOut.sx = nx; _steerOut.sz = nz; return _steerOut; }
  const bx = nx + avX, bz = nz + avZ;
  const bl = Math.sqrt(bx*bx + bz*bz);
  if (bl > 0.001) { _steerOut.sx = bx/bl; _steerOut.sz = bz/bl; }
  else { _steerOut.sx = nx; _steerOut.sz = nz; }
  return _steerOut;
}

// ── Push a position out of overlapping prop colliders ─────────────────────────
export function pushOutOfProps(pos, capsuleR) {
  for (const c of propColliders) {
    const minDist = c.radius + capsuleR;
    const dx = pos.x - c.wx, dz = pos.z - c.wz;
    const d2 = dx*dx + dz*dz;
    if (d2 < minDist*minDist && d2 > 1e-8) {
      const d = Math.sqrt(d2), ov = minDist - d;
      pos.x += (dx/d)*ov; pos.z += (dz/d)*ov;
    }
  }
}

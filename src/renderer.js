// ─── renderer.js ─────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

// ── WebGL Renderer ────────────────────────────────────────────────────────────
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.3;
document.body.appendChild(renderer.domElement);
// Ensure WebGL canvas covers the full viewport (prevents top bars from layout)
renderer.domElement.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;display:block;z-index:1;';

// ── CSS2D Renderer (health bars, damage numbers) ──────────────────────────────
export const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.style.cssText = 'position:fixed;top:0;left:0;pointer-events:none;z-index:5;';
document.body.appendChild(labelRenderer.domElement);

// ── Scene ─────────────────────────────────────────────────────────────────────
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080810);
scene.fog = new THREE.Fog(0x080810, 1, 200);

// ── Environment Map (makes metallic capsules reflect vivid colours) ───────────
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileEquirectangularShader();

const envScene = new THREE.Scene();
const skyGeo = new THREE.SphereGeometry(5, 32, 32);
skyGeo.scale(-1, -1, -1);
envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ color: 0x050510 })));

[
  { col: 0x0066ff, pos: [  4,  2,  0 ] },
  { col: 0xff0022, pos: [ -4,  2,  0 ] },
  { col: 0xffffff, pos: [  0,  4,  0 ] },
  { col: 0x00ffcc, pos: [  0, -1,  4 ] },
  { col: 0xff6600, pos: [  0,  2, -4 ] },
  { col: 0x8800ff, pos: [  2, -1, -3 ] },
].forEach(({ col, pos }) => {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 16, 16),
    new THREE.MeshBasicMaterial({ color: col })
  );
  m.position.set(...pos);
  envScene.add(m);
});

scene.environment = pmrem.fromScene(envScene).texture;
scene.environmentIntensity = 1.8;
pmrem.dispose();

// ── Isometric Orthographic Camera ─────────────────────────────────────────────
export const CAM_D = 18;
export let aspect = window.innerWidth / window.innerHeight;
export const camera = new THREE.OrthographicCamera(
  -CAM_D * aspect, CAM_D * aspect, CAM_D, -CAM_D, -100, 500
);
export const CAM_OFFSET = new THREE.Vector3(28, 28, 28);
camera.position.copy(CAM_OFFSET);
camera.lookAt(0, 0, 0);

// ── Isometric movement direction vectors ──────────────────────────────────────
export const ISO_FWD   = new THREE.Vector3(-1, 0, -1).normalize();
export const ISO_RIGHT = new THREE.Vector3( 1, 0, -1).normalize();

// ── Resize handler ────────────────────────────────────────────────────────────
// bloom.js calls onResize() too — both are registered in main.js
export function onRendererResize() {
  aspect = window.innerWidth / window.innerHeight;
  camera.left   = -CAM_D * aspect;
  camera.right  =  CAM_D * aspect;
  camera.top    =  CAM_D;
  camera.bottom = -CAM_D;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// ─── bloom.js ─────────────────────────────────────────────────────────────────
// Three-layer custom Gaussian bloom:
//   Layer 0 (global)  — whole scene, tunable threshold + strength
//   Layer 1 (bullet)  — bullet-only pass, tight threshold for laser glow
//   Layer 2 (expl)    — explosion particles + dash ghosts
import * as THREE from 'three';
import { renderer, camera, scene } from './renderer.js';

const W = window.innerWidth,  H = window.innerHeight;
const BW = Math.round(W / 2), BH = Math.round(H / 2);

const rtOpts = {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat, type: THREE.HalfFloatType,
};

// Full-res scene buffer + half-res ping-pong per layer
export const rtScene       = new THREE.WebGLRenderTarget(W,  H,  rtOpts);
const rtBright             = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtPingA              = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtPingB              = new THREE.WebGLRenderTarget(BW, BH, rtOpts);

export const rtBulletScene = new THREE.WebGLRenderTarget(W,  H,  rtOpts);
const rtBulletBright       = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtBulletPingA        = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtBulletPingB        = new THREE.WebGLRenderTarget(BW, BH, rtOpts);

export const rtExplScene   = new THREE.WebGLRenderTarget(W,  H,  rtOpts);
const rtExplBright         = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtExplPingA          = new THREE.WebGLRenderTarget(BW, BH, rtOpts);
const rtExplPingB          = new THREE.WebGLRenderTarget(BW, BH, rtOpts);

// Full-screen quad shared by all passes
const fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsScene  = new THREE.Scene();
const fsMesh   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
fsScene.add(fsMesh);

function fsPass(mat, target) {
  fsMesh.material = mat;
  renderer.setRenderTarget(target ?? null);
  renderer.render(fsScene, fsCamera);
}

// ── Threshold shader ──────────────────────────────────────────────────────────
export const threshMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, threshold: { value: 1.0 } },
  vertexShader:   `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float threshold; varying vec2 vUv;
    void main(){
      vec4 c=texture2D(tDiffuse,vUv);
      float b=dot(c.rgb,vec3(0.2126,0.7152,0.0722));
      float k=smoothstep(threshold-0.05,threshold+0.15,b);
      gl_FragColor=vec4(c.rgb*k,1.0);
    }`,
});

// ── Separable Gaussian blur (13-tap) ─────────────────────────────────────────
export const blurMat = new THREE.ShaderMaterial({
  uniforms: {
    tDiffuse:   { value: null },
    uDir:       { value: new THREE.Vector2(1, 0) },
    uTexelSize: { value: new THREE.Vector2(1 / BW, 1 / BH) },
  },
  vertexShader:   `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uTexelSize; varying vec2 vUv;
    void main(){
      vec2 step=uDir*uTexelSize;
      float w[5]; w[0]=0.22702;w[1]=0.19459;w[2]=0.12162;w[3]=0.05405;w[4]=0.01621;
      vec4 col=texture2D(tDiffuse,vUv)*w[0];
      for(int i=1;i<5;i++){
        vec2 o=float(i)*step;
        col+=texture2D(tDiffuse,vUv+o)*w[i]+texture2D(tDiffuse,vUv-o)*w[i];
      }
      gl_FragColor=col;
    }`,
});

// ── Composite shader: scene + three additive bloom layers ────────────────────
export const compositeMat = new THREE.ShaderMaterial({
  uniforms: {
    tScene:       { value: null },
    tBloom:       { value: null },
    tBloomBullet: { value: null },
    tBloomExpl:   { value: null },
    strength:     { value: 0.0 },
    bulletStrength:{ value: 0.9 },
    explStrength:  { value: 4.0 },
  },
  vertexShader:   `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.); }`,
  fragmentShader: `
    uniform sampler2D tScene,tBloom,tBloomBullet,tBloomExpl;
    uniform float strength,bulletStrength,explStrength;
    varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),0.,1.); }
    void main(){
      vec3 s=texture2D(tScene,vUv).rgb;
      vec3 col=s+texture2D(tBloom,vUv).rgb*strength
              +texture2D(tBloomBullet,vUv).rgb*bulletStrength
              +texture2D(tBloomExpl,vUv).rgb*explStrength;
      col=aces(col);
      col=pow(col,vec3(1.0/2.2));
      gl_FragColor=vec4(col,1.0);
    }`,
});

// ── Bloom config objects (kept in sync with UI sliders) ───────────────────────
export const globalBloom = { threshold: 1.0, strength: 0.0 };
export const bulletBloom = { enabled: true, threshold: 0.3, strength: 0.9 };
export const explBloom   = {
  stdThreshold: 0.0, stdStrength: 0.2,
  eliteThreshold: 0.0, eliteStrength: 0.2,
};

// Explosion bloom dirty flag — updated in particles.js, consumed here
export let _activeExplThreshold = explBloom.stdThreshold;
export let _activeExplStrength  = explBloom.stdStrength;
export let _explBloomDirty      = false;
export function setExplBloom(threshold, strength) {
  _activeExplThreshold = threshold;
  _activeExplStrength  = strength;
  _explBloomDirty = true;
}
export function consumeExplBloomDirty() {
  if (!_explBloomDirty) return;
  _activeExplThreshold = _activeExplThreshold; // already set by setExplBloom
  _explBloomDirty = false;
}

// ── Helper: one Gaussian blur pass (H then V, repeated iterations times) ─────
function gaussianBlur(srcTarget, pingA, pingB, iterations = 3) {
  for (let i = 0; i < iterations; i++) {
    blurMat.uniforms.tDiffuse.value = i === 0 ? srcTarget.texture : rtPingB.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    fsPass(blurMat, pingA);
    blurMat.uniforms.tDiffuse.value = pingA.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    fsPass(blurMat, pingB);
  }
  return pingB;
}

// ── Main render function — called once per tick ───────────────────────────────
export function renderBloom() {
  // 1) Full scene → rtScene
  renderer.setRenderTarget(rtScene);
  renderer.clear();
  camera.layers.set(0);
  renderer.render(scene, camera);

  // 2) Bullet-only pass (layer 1)
  if (bulletBloom.enabled) {
    renderer.setRenderTarget(rtBulletScene);
    renderer.clear();
    camera.layers.set(1);
    renderer.render(scene, camera);
    threshMat.uniforms.tDiffuse.value = rtBulletScene.texture;
    threshMat.uniforms.threshold.value = bulletBloom.threshold;
    fsPass(threshMat, rtBulletBright);
    gaussianBlur(rtBulletBright, rtBulletPingA, rtBulletPingB);
  }

  // 3) Explosion / dash layer (layer 2)
  renderer.setRenderTarget(rtExplScene);
  renderer.clear();
  camera.layers.set(2);
  renderer.render(scene, camera);
  threshMat.uniforms.tDiffuse.value = rtExplScene.texture;
  threshMat.uniforms.threshold.value = _activeExplThreshold;
  fsPass(threshMat, rtExplBright);
  gaussianBlur(rtExplBright, rtExplPingA, rtExplPingB);

  // 4) Global bloom (layer 0 = full scene already in rtScene)
  threshMat.uniforms.tDiffuse.value  = rtScene.texture;
  threshMat.uniforms.threshold.value = globalBloom.threshold;
  fsPass(threshMat, rtBright);
  // Reuse rtPingA / rtPingB for global blur (after bullet pass is done)
  for (let i = 0; i < 3; i++) {
    blurMat.uniforms.tDiffuse.value = i === 0 ? rtBright.texture : rtPingB.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    fsPass(blurMat, rtPingA);
    blurMat.uniforms.tDiffuse.value = rtPingA.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    fsPass(blurMat, rtPingB);
  }

  // 5) Composite to screen
  compositeMat.uniforms.tScene.value       = rtScene.texture;
  compositeMat.uniforms.tBloom.value       = rtPingB.texture;
  compositeMat.uniforms.tBloomBullet.value = bulletBloom.enabled ? rtBulletPingB.texture : rtBulletScene.texture;
  compositeMat.uniforms.tBloomExpl.value   = rtExplPingB.texture;
  compositeMat.uniforms.strength.value     = globalBloom.strength;
  renderer.setRenderTarget(null);
  renderer.clear();
  fsPass(compositeMat, null);

  // Restore all layers for label renderer and next frame
  camera.layers.enable(0);
  camera.layers.enable(1);
  camera.layers.enable(2);
}

// ── Resize ────────────────────────────────────────────────────────────────────
export function onBloomResize() {
  const W2 = window.innerWidth, H2 = window.innerHeight;
  const BW2 = Math.round(W2 / 2), BH2 = Math.round(H2 / 2);
  [rtScene, rtBulletScene, rtExplScene].forEach(rt => rt.setSize(W2, H2));
  [rtBright, rtPingA, rtPingB,
   rtBulletBright, rtBulletPingA, rtBulletPingB,
   rtExplBright, rtExplPingA, rtExplPingB].forEach(rt => rt.setSize(BW2, BH2));
  blurMat.uniforms.uTexelSize.value.set(1 / BW2, 1 / BH2);
}

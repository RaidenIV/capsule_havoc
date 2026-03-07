// ─── visuals.js ─────────────────────────────────────────────────────────────
import { state } from './state.js';
import { renderer, setEnvironmentReflectionsEnabled } from './renderer.js';
import { sunLight, orbitLights } from './lighting.js';

const KEY = 'capsuleHavoc.visuals.v1';
const SHADOW_MAP = { off: 0, low: 512, medium: 1024, high: 2048 };
const DEFAULTS = {
  shadows: 'high',
  bloom: true,
  reflections: true,
  accentLights: true,
};

function normalizeVisuals(input = {}) {
  const merged = { ...DEFAULTS, ...(input || {}) };
  if (!['off', 'low', 'medium', 'high'].includes(merged.shadows)) merged.shadows = 'high';
  merged.bloom = !!merged.bloom;
  merged.reflections = !!merged.reflections;
  merged.accentLights = !!merged.accentLights;
  return merged;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state.visuals)); } catch {}
}

function applyShadowQuality(quality) {
  const size = SHADOW_MAP[quality] ?? 2048;
  const enabled = quality !== 'off';

  renderer.shadowMap.enabled = enabled;
  sunLight.castShadow = enabled;

  if (enabled) {
    sunLight.shadow.mapSize.set(size, size);
  }

  if (sunLight.shadow.map) {
    try { sunLight.shadow.map.dispose(); } catch {}
    sunLight.shadow.map = null;
  }
  sunLight.shadow.needsUpdate = true;
  renderer.shadowMap.needsUpdate = true;
}

function applyAccentLights(enabled) {
  orbitLights.forEach(({ light }) => { light.visible = !!enabled; });
}

export function getVisualSettings() {
  return normalizeVisuals(state.visuals);
}

export function applyVisualSettings(partial = {}, { save = true } = {}) {
  const next = normalizeVisuals({ ...state.visuals, ...(partial || {}) });
  state.visuals = next;

  applyShadowQuality(next.shadows);
  setEnvironmentReflectionsEnabled(next.reflections);
  applyAccentLights(next.accentLights);

  if (save) persist();
  return next;
}

export function loadSavedVisualSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeVisuals(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function applySavedVisualSettings() {
  const saved = loadSavedVisualSettings();
  return applyVisualSettings(saved, { save: false });
}

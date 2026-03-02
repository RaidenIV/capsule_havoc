// ─── chests.js ──────────────────────────────────────────────────────────────
// Wrapper module (design-doc split). Source-of-truth currently lives in pickups.js
// and ui/upgrades.js.

export { spawnChest } from './pickups.js';
export { openChestReward as openChestOverlay } from './ui/upgrades.js';

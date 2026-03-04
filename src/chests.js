// ─── chests.js ──────────────────────────────────────────────────────────────
// Design-doc split module. In this build, world chests are spawned/updated in pickups.js,
// while the chest reward overlay lives in ui/chestOverlay.js. This module provides a
// stable API for other modules.

export { spawnChest } from './pickups.js';
export { openChestOverlay, closeChestOverlay } from './ui/chestOverlay.js';

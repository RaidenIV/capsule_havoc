// ─── ui/chestOverlay.js ─────────────────────────────────────────────────────
// Design-doc file. The actual overlay is implemented inside ui/upgrades.js.
// This file re-exports a stable API so other modules can import without
// depending on upgrades.js internals.

export { openChestReward as openChestOverlay, closeUpgradeShopIfOpen as closeChestOverlay } from './upgrades.js';

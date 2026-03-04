// ─── ui/chestOverlay.js ─────────────────────────────────────────────────────
// Stable chest overlay API.
// The overlay implementation currently lives in ui/upgrades.js (to share styles).
// This wrapper provides consistent named exports for the rest of the game.

export async function openChestOverlay(tier = 'standard') {
  const mod = await import('./upgrades.js');
  // Prefer openChestReward (current), fall back to openChestOverlay if renamed.
  const fn = mod.openChestReward || mod.openChestOverlay;
  if (typeof fn === 'function') fn(tier);
}

export async function closeChestOverlay() {
  const mod = await import('./upgrades.js');
  const fn = mod.closeUpgradeShopIfOpen || mod.closeChestOverlay;
  if (typeof fn === 'function') fn();
}

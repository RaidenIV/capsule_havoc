// ─── ui/chestOverlay.js ─────────────────────────────────────────────────────
// Stable chest overlay API.
// We use dynamic import to avoid hard ESM named-export coupling across versions.

export async function openChestReward(tier = 'standard') {
  const mod = await import('./upgrades.js');
  if (typeof mod.openChestReward === 'function') {
    return mod.openChestReward(tier);
  }
  console.warn('[chestOverlay] openChestReward not found in ui/upgrades.js; tier=', tier);
}

export async function closeChestOverlay() {
  const mod = await import('./upgrades.js');
  if (typeof mod.closeUpgradeShopIfOpen === 'function') {
    return mod.closeUpgradeShopIfOpen();
  }
}

// Back-compat aliases
export const openChestOverlay = openChestReward;

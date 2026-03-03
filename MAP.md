# CAPSULE HAVOC — Module Architecture Map

## Folder Structure

```
capsule_havoc/
├── index.html                  # HTML shell + DOM overlays (HUD, menus, banners, shop)
├── MAP.md                      # This file
├── styles/
│   └── main.css                # All styling
├── assets/
│   ├── images/
│   ├── music/                  # theme.wav
│   └── sfx/                    # All SFX (.wav) — see audio.js for full list
└── src/
    ├── main.js                 # App bootstrap (menu → game, wiring, restarts)
    ├── loop.js                 # Main game loop (update/render order, all per-frame calls)
    ├── state.js                # Shared runtime state (single mutable object)
    ├── input.js                # Keyboard bindings (WASD, Shift dash, E burst, Q slow, M mute)
    ├── gameFlow.js             # Game lifecycle (countdown, game over/victory, restart)
    ├── constants.js            # All tunables (speeds, HP, SLASH_INTERVAL=1.0s, WEAPON_CONFIG, etc.)
    │
    ├── renderer.js             # Three.js renderer/scene/camera setup
    ├── bloom.js                # 3-layer custom Gaussian bloom pipeline
    ├── lighting.js             # Lights + per-tick orbit/sun updates
    ├── materials.js            # Shared geometries, materials, cosmetics
    ├── terrain.js              # Procedural chunks, prop colliders, LOS, steering
    ├── particles.js            # Pooled explosion particles
    ├── damageNumbers.js        # Floating damage/heal number sprites
    │
    ├── player.js               # Player movement, dash, health/dash bars, lean
    ├── enemies.js              # Enemy lifecycle: spawn, update, AI, death, loot drop
    │                           #   Contact damage: discrete hit model (1 hit/sec,
    │                           #   sound + damage number fire once per interval)
    ├── enemyAI.js              # Decollision push system, despawn distance checks
    ├── spawner.js              # Per-type spawn timers, quotas, screen cap, direction bias
    ├── weapons.js              # Bullets, orbit rings, slash VFX/damage
    │                           #   performSlash() — called by loop on SLASH_INTERVAL timer
    ├── pickups.js              # Coins, health packs, chest proximity collection
    ├── arenaPickups.js         # Timed arena pickups (double damage, clock, black hole, etc.)
    ├── coins.js                # Re-export shim → pickups.js (spawnCoins, dropLoot)
    ├── chests.js               # Re-export shim → pickups.js + ui/upgrades.js
    ├── armor.js                # Armor charges, extra-life revive, applyPlayerDamage()
    ├── activeEffects.js        # Timed effect state (doubleDamage, invincibility, clock, etc.)
    ├── xp.js                   # XP award, level-up, weapon config accessors
    │                           #   Damage formula: DMG(L) = 10 + floor((L-1)² / 50)
    ├── leveling.js             # 3-phase XP formula, spike levels (20/40), XP rewards by class
    ├── luck.js                 # Luck stat aggregation (shop + boss waves + curse)
    ├── hudCoin.js              # Spinning 3D coin in HUD canvas
    ├── hudEffects.js           # HUD badges for active timed effects + armor pips
    ├── hudLevel.js             # Level number HUD element
    ├── audio.js                # AudioContext, all SFX loading, music controls, volume
    │
    ├── upgrades.js             # Re-export shim → ui/upgrades.js
    ├── panel/
    │   └── index.js            # Dev/tuning control panel (Tab key)
    └── ui/
        ├── menu.js             # Main menu controller (start, scores, settings pages)
        ├── scores.js           # High score list renderer
        ├── highScores.js       # High score storage (localStorage, top 10)
        ├── settings.js         # Audio settings UI (mute, music vol, sfx vol)
        ├── storage.js          # localStorage JSON helpers (loadJSON, saveJSON)
        ├── upgrades.js         # 4-tab upgrade shop + chest reward overlay
        │                       #   Tabs: Weapons · Movement · Abilities · Power Ups
        │                       #   Weapon lasers start LOCKED (weaponTier=0);
        │                       #   first weapon upgrade purchased unlocks bullets
        └── chestOverlay.js     # Re-export shim → ui/upgrades.js (openChestReward)
```

---

## File Responsibilities

### `index.html`
Pure HTML shell. Contains the DOM structure (HUD, control panel markup, overlays),
the `<link>` to `styles/main.css`, the THREE.js importmap, and a single
`<script type="module" src="./src/main.js">`. Zero game logic.

### `styles/main.css`
All CSS extracted verbatim from the original `<style>` block. Covers: HUD, game-over
screen, countdown, pause overlay, control panel (light-mode QR aesthetic), health/elite
bars, sliders, toggles, and tab layout.

---

### `src/constants.js`
**Imports:** nothing  
**Exports:** every magic number — movement speeds, HP values, dash parameters,
slow-motion rates, XP thresholds, ELITE_TYPES, WEAPON_CONFIG, LEVEL_ENEMY_CONFIG.  
Change values here to tune game feel without touching logic files.

### `src/state.js`
**Imports:** nothing  
**Exports:** `state` — one plain mutable object holding all runtime data:
entity arrays (`enemies`, `bullets`, `particles` …), scalar game state (`gameOver`,
`kills`, `playerHP` …), input keys, dash/slowmo vars, panel state.  
Every module reads/writes `state` directly. No getters/setters needed.

---

### `src/renderer.js`
**Imports:** THREE  
**Exports:** `renderer`, `labelRenderer`, `scene`, `camera`, `CAM_OFFSET`,
`ISO_FWD`, `ISO_RIGHT`, `onRendererResize()`  
Creates the WebGL + CSS2D renderers, the scene, fog, ortho camera, and the
custom PMREM environment map used for metallic reflections.

### `src/bloom.js`
**Imports:** THREE, renderer.js  
**Exports:** `renderBloom()`, `threshMat`, `compositeMat`, `blurMat`,
`globalBloom`, `bulletBloom`, `explBloom`, render targets, `setExplBloom()`,
`onBloomResize()`  
Three-layer custom Gaussian bloom (no UnrealBloom artefacts): global, bullet,
and explosion layers composited with ACES tonemapping.

### `src/lighting.js`
**Imports:** THREE, renderer.js, state.js  
**Exports:** `ambientLight`, `sunLight`, `fillLight`, `rimLight`, `orbitLights[]`,
`updateOrbitLights(delta, playerPosition)`, `updateSunPosition(playerPosition)`  
Declares all lights and exports per-tick update functions called from loop.js.

---

### `src/terrain.js`
**Imports:** THREE, renderer.js  
**Exports:** `propColliders[]`, `updateChunks(playerPos)`, `hasLineOfSight()`,
`steerAroundProps()`, `pushOutOfProps()`, `ground`, `grid`  
Procedurally generates 20×20 unit chunks as the player moves (9×9 grid radius).
Each chunk has a ground plane, grid helper, and 1–5 randomised props.
`propColliders` is a flat array of `{wx, wz, radius}` used for fast per-frame
bullet/enemy/player collision and LOS checks.

### `src/materials.js`
**Imports:** THREE, state.js  
**Exports:** `playerMat`, `enemyMat`, `bulletMat`, `playerBaseColor`,
`playerGeo`, `enemyGeo`, `bulletGeo`, `enemyBulletGeo`, `*GeoParams`,
`floorY(params)`, `getEnemyBulletMat(color)`, `syncEnemyMats(enemies)`,
`setPlayerGeo()`, `setEnemyGeo()`, `setBulletGeo()`  
Single source of truth for all capsule materials and geometries. The `set*Geo()`
setters exist because `let` exports can't be reassigned from outside the module.

---

### `src/player.js`
**Imports:** THREE, CSS2DObject, renderer.js, state.js, constants.js, materials.js, terrain.js  
**Exports:** `playerGroup`, `playerMesh`, `hbObj`, `dashBarObj`,
`updatePlayer(delta, worldScale)`, `updateDashStreaks(delta)`,
`updateHealthBar()`, `updateDashBar()`, `stampDashGhost()`  
Owns the player's scene graph and all player-tick logic: WASD movement,
dash execution, slow-motion `worldScale` ramping, health/dash bar sync,
prop collision pushout, and capsule lean.

### `src/enemies.js`
**Imports:** THREE, CSS2DObject, renderer.js, state.js, constants.js, materials.js,
player.js, terrain.js, damageNumbers.js, particles.js, pickups.js, xp.js  
**Exports:** `spawnEnemy()`, `spawnEnemyAtEdge()`, `spawnLevelElites()`,
`updateEliteBar()`, `killEnemy(j)`, `updateEnemies(delta, worldDelta, elapsed)`,
`removeCSS2DFromGroup()`, `setLevelUpCallback()`, `setVictoryCallback()`  
Manages the full enemy lifecycle. Callbacks are injected from `main.js` to break
the `enemies ↔ weapons` circular dependency.

### `src/weapons.js`
**Imports:** THREE, renderer.js, state.js, constants.js, materials.js,
player.js, terrain.js, damageNumbers.js, enemies.js, xp.js  
**Exports:** `shootBulletWave()`, `updateBullets(wd)`, `updateEnemyBullets(wd)`,
`updateOrbitBullets(wd)`, `syncOrbitBullets()`, `destroyOrbitBullets()`  
Auto-shoot, 360° bullet waves, orbiting bullet rings, and enemy projectiles.
All movement uses `worldDelta` so it slows during dash.

### `src/pickups.js`
**Imports:** THREE, renderer.js, state.js, constants.js, player.js, damageNumbers.js  
**Exports:** `spawnCoins()`, `spawnHealthPickup()`, `dropLoot()`, `updatePickups(wd, level, elapsed)`  
Coins and health packs: spawn, attract toward player, collect, age out.

### `src/particles.js`
**Imports:** THREE, renderer.js, state.js, bloom.js  
**Exports:** `spawnExplosion(pos, eliteType)`, `updateParticles(worldDelta)`,
`explConfig`, `_particleMeshPool`  
Pooled sphere meshes for explosions (standard = fire palette, elite = type colour).
Signals the bloom pipeline which explosion threshold/strength to use each frame.

### `src/damageNumbers.js`
**Imports:** THREE, renderer.js, state.js, player.js  
**Exports:** `spawnPlayerDamageNum()`, `spawnEnemyDamageNum()`, `spawnHealNum()`,
`updateDamageNums(worldDelta)`  
Canvas-based sprite floaters. Canvas elements are pooled and recycled.

---

### `src/xp.js`
**Imports:** state.js, constants.js  
**Exports:** `updateXP(amount)`, `getXPPerKill()`, `getCoinValue()`, `getEnemyHP()`,
`getWeaponConfig()`, `getBulletDamage()`, `getFireInterval()`, `getWaveBullets()`  
XP/levelling logic and all "current-level" config accessors. Updates the XP HUD.

### `src/input.js`
**Imports:** state.js, constants.js, renderer.js  
**Exports:** `initInput({ togglePanel, restartGame, togglePause })`  
Keyboard handler. Callbacks injected from main.js to avoid circular imports with
panel.js and gameFlow.js.

### `src/loop.js`
**Imports:** everything  
**Exports:** `tick()`, `clock`  
The single `requestAnimationFrame` loop. Calls every per-frame update function in
the correct order. `worldDelta = delta × state.worldScale` is forwarded to all
world-sim updates so slow-motion is transparent to each system.

### `src/gameFlow.js`
**Imports:** state.js, constants.js, renderer.js, player.js, xp.js, enemies.js, weapons.js, particles.js  
**Exports:** `startCountdown(onDone?)`, `triggerGameOver()`, `triggerVictory()`,
`restartGame(opts?)`, `formatTime(secs)`  
Countdown sequence, game-over/victory overlays, and full restart (cleans up every
entity array and resets all state).

### `src/panel/index.js`
**Imports:** THREE, renderer.js, state.js, lighting.js, bloom.js, materials.js,
player.js, particles.js, terrain.js, xp.js, weapons.js, gameFlow.js, loop.js  
**Exports:** `togglePanel()`, `togglePause()`, `updatePauseBtn()`, `showNotif(msg)`  
The entire control panel in one file: open/close with pause, tab switching, section
collapse, all slider bindings → Three.js properties, bidirectional range↔number sync,
per-section and global reset, JSON export/import, invincibility toggle, level skip.

### `src/main.js`
**Imports:** all of the above  
**Exports:** nothing (side effects only)  
The root module. Injects callbacks to break circular deps, exposes `window.restartGame`
for the HTML restart button, registers the resize listener, spawns initial enemies,
and fires the game loop.

---

## Dependency Flow

```
constants.js ──────────────────────────────────────────────────┐
state.js ──────────────────────────────────────────────────────┤
                                                                ↓
renderer.js → bloom.js → lighting.js                      (all modules)
     ↓
terrain.js → materials.js
     ↓              ↓
  player.js ←───────┘
     ↓
  xp.js → enemies.js ←──── weapons.js
              ↑                  ↑
         particles.js       orbitBullets
         pickups.js ← damageNumbers.js
              ↓
         gameFlow.js → loop.js → main.js
                                    ↓
                               panel/index.js
                               input.js
```

**Key circular-dep solution:** `enemies.js::killEnemy` needs `syncOrbitBullets` from
`weapons.js`, and `weapons.js::updateOrbitBullets` needs `killEnemy` from `enemies.js`.
Resolved in `main.js` by injecting `syncOrbitBullets` via `setLevelUpCallback()` —
so neither module imports the other for this path.

---

## Running Locally

Requires a local HTTP server (ES modules block `file://` loading):

```bash
# Python
python3 -m http.server 8080

# Node / npx
npx serve .

# Then open:
http://localhost:8080
```

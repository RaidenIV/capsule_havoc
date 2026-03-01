# CAPSULE HAVOC — Module Architecture Map

## Folder Structure

```
capsule_havoc/
├── index.html                  # HTML shell + DOM overlays (HUD, menus, banners, shop)
├── MAP.md                      # Notes / map doc
├── styles/
│   └── main.css                # All styling (menu, HUD, pause, shop, panel, banners)
├── assets/
│   ├── images/                 # Logo / images
│   ├── music/                  # Music tracks (theme.wav)
│   └── sfx/                    # SFX (.wav)
└── src/
    ├── main.js                 # App bootstrap (menu → game, wiring, restarts)
    ├── loop.js                 # Main game loop (update/render, wave flow, pause/shop gating)
    ├── state.js                # Shared runtime state (paused, uiMode, wave state, coins, etc.)
    ├── input.js                # Keyboard/mouse bindings (ESC pause, etc.)
    ├── gameFlow.js             # Game lifecycle (countdown, game over/victory, restart)
    ├── constants.js            # Tunables + configs (waves, weapons, etc.)
    │
    ├── renderer.js             # Three.js renderer/scene/camera setup
    ├── bloom.js                # Post FX bloom pipeline
    ├── lighting.js             # Lighting updates
    ├── materials.js            # Shared materials/geometries helpers
    ├── terrain.js              # Terrain + prop collision data
    ├── particles.js            # Particle FX
    ├── damageNumbers.js        # Damage number popups
    │
    ├── player.js               # Player movement + HP + visuals
    ├── enemies.js              # Enemies (spawn/update/boss params)
    ├── weapons.js              # Weapons + slash logic/VFX, bullet/orbit behavior
    ├── pickups.js              # Coins/XP pickups + collection
    ├── xp.js                   # Upgrade-derived stats (fire interval, dmg, bullet count, etc.)
    ├── hudCoin.js              # HUD coin display logic (coin widget/animation)
    ├── audio.js                # Music/SFX + volume routing (master/music/sfx + mixer)
    │
    ├── upgrades.js             # Upgrade/shop logic (overlay + purchases) 
    ├── panel/
    │   └── index.js            # Dev/tuning control panel
    │
    └── ui/                     # Menu screens (modular UI)
        ├── menu.js
        ├── scores.js
        ├── highScores.js
        ├── settings.js
        ├── storage.js
        └── upgrades.js         # Upgrade Shop UI (overlay)
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

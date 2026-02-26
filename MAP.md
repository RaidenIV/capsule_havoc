# CAPSULE HAVOC — Module Architecture Map

## Folder Structure

```
capsule-havoc/
├── index.html
│   └─ HTML shell + importmap + top-level UI mount points.
│      Contains the menu screen markup (Start / High Scores / Settings) and the game HUD containers.
│
├── styles/
│   └── main.css
│       └─ All CSS for the project: layout, HUD, overlays, control panel styling, and menu screens.
│          Includes “screen mode” rules (menu vs playing), z-index layering, and responsive tweaks.
│
└── src/
    ├── main.js
    │   └─ App entry point. Initializes subsystems, wires modules together, and controls boot flow.
    │      In v3: starts in Menu mode and only begins a run after Start is clicked.
    │
    ├── constants.js
    │   └─ Compile-time tuning constants: sizes, speeds, timings, spawn limits, damage scalars,
    │      chunk/map parameters, and other fixed configuration values.
    │
    ├── state.js
    │   └─ Single mutable runtime state container shared across modules:
    │      game flags (paused/gameOver/victory), timers, score, player/enemy arrays,
    │      UI mode (menu/playing), and references to key scene objects.
    │
    ├── renderer.js
    │   └─ Three.js renderer setup: WebGLRenderer, camera, scene, resize handling,
    │      optional CSS2D renderer, environment/background configuration.
    │
    ├── bloom.js
    │   └─ Custom post-processing bloom pipeline (Gaussian, multi-layer).
    │      Owns bloom passes, thresholds/strength, and per-layer composition.
    │
    ├── lighting.js
    │   └─ Scene lighting definitions + updates: key/fill/rim lights,
    │      animated orbit lights, and any lighting-related runtime sync.
    │
    ├── terrain.js
    │   └─ Procedural map/arena generation: chunk creation, props placement,
    │      collider generation, LOS helpers, steering/avoidance data used by AI.
    │
    ├── materials.js
    │   └─ Centralized materials + geometries: capsule/enemy meshes, floor/ground material,
    │      emissive/bloom-related material parameters, and sync helpers (e.g., syncEnemyMats).
    │
    ├── player.js
    │   └─ Player entity implementation: mesh creation, movement/dash logic,
    │      health/dash UI bars, dash ghost visuals, and per-frame player updates.
    │
    ├── enemies.js
    │   └─ Enemy lifecycle: spawn logic, stagger rules, movement/steering toward player,
    │      enemy shooting, hit/kill handling, and killEnemy() side effects (drops/score/etc.).
    │
    ├── weapons.js
    │   └─ Weapon system: auto-shoot controller, player bullets, orbit bullets,
    │      enemy bullets, projectile pooling/cleanup, and weapon-specific tuning hooks.
    │
    ├── pickups.js
    │   └─ Pickup entities (coins/health packs): spawn rules, magnet/attract behavior,
    │      collision collection, and applying rewards (HP/score/xp).
    │
    ├── particles.js
    │   └─ Explosion/impact particle pool: spawn bursts, update particles each frame,
    │      and manage recycling (performance-friendly particle reuse).
    │
    ├── damageNumbers.js
    │   └─ Floating combat text: damage/heal numbers rendered as canvas sprites,
    │      pooling, animation (rise/fade), and spawning helpers.
    │
    ├── xp.js
    │   └─ XP/level progression system: XP gain, level-ups, accessors for weapon/enemy configs,
    │      and scaling rules tied to difficulty progression.
    │
    ├── input.js
    │   └─ Keyboard (and possibly pointer) input listeners: key down/up tracking,
    │      exposing a queryable input state used by player/controls.
    │
    ├── loop.js
    │   └─ Main tick() game loop: fixed/variable timestep handling, calling per-module updates,
    │      rendering, and respecting pause/menu gating.
    │
    ├── gameFlow.js
    │   └─ High-level run flow: countdown, start/end transitions, victory/gameover triggers,
    │      restartGame(), and run finalization (including high score recording in v3).
    │
    ├── audio.js
    │   └─ Audio system: music + SFX routing, volume/mute control functions,
    │      persistence hooks used by Settings, and any unlock/resume logic for web audio.
    │
    ├── panel/
    │   └── index.js
    │       └─ In-game control panel UI: open/close, tabs, sliders, real-time sync into materials,
    │          lighting/bloom controls, reset/export/import JSON, and other dev-tuning controls.
    │
    └── ui/
        ├── menu.js
        │   └─ Menu screen controller (Start / High Scores / Settings navigation),
        │      drives mode switching between menu screens and gameplay.
        │
        ├── scores.js
        │   └─ High Scores screen renderer: builds the list UI, formats entries,
        │      handles Back / Clear actions via highScores.js.
        │
        ├── highScores.js
        │   └─ High score persistence: addScore(), getScores(), clearScores(),
        │      sorting and truncation rules, localStorage storage key management.
        │
        ├── settings.js
        │   └─ Settings screen logic: binds UI inputs to audio.js (mute/music/sfx),
        │      loads/saves settings via storage.js and updates live audio state.
        │
        └── storage.js
            └─ Lightweight JSON localStorage helpers: get/set with defaults,
               schema-safe parsing, and simple namespacing for keys.
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

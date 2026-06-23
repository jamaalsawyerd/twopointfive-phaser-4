# AGENTS.md

## Repository overview

This repository contains a Phaser 4 demo/game plus a reusable 2.5D engine/plugin called TwoPointFive. The core engine lives in `src/twopointfive/`, while the Phaser game/demo glue lives in `src/phaser-game.ts` and `src/game/`.

There is also an older ImpactJS demo/port in `impact-version/`, served separately from `impact-index.html`.

## Essential commands

Use the Node version in `.nvmrc` (`24.11.1`).

```bash
npm install
npm run build
npm start
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

Notes:
- `npm run build` executes `node build.js` and writes the bundled demo to `dist/game.js`.
- `npm start` rebuilds first, then runs `dev-server.js` on port `8080`.
- `npm run lint` only targets `src/`.
- `npm run format` runs ESLint fixers on `src/` and Prettier on `src/**/*.ts`.

## Project structure

- `src/twopointfive/` — engine/plugin code: renderer, cameras, world maps, collision, entity base class, timer, utilities, and public exports.
- `src/game/` — Phaser demo game objects and gameplay entities.
- `src/phaser-game.ts` — Phaser scene bootstrap, asset loading, plugin setup, HUD, input, and spawn logic.
- `media/` — shared assets used by the demo.
- `impact-version/` — original ImpactJS demo, engine copy, and Weltmeister editor files.
- `index.html` — Phaser demo entry point.
- `impact-index.html` — Impact demo entry point.
- `weltmeister.html` — Weltmeister editor entry point.
- `dev-server.js` — local static server plus Weltmeister browse/glob/save API replacements.
- `build.js` — esbuild bundle script.

## Architecture and control flow

### Phaser path

1. `src/phaser-game.ts` registers `TwoPointFivePlugin` as a global Phaser plugin.
2. The scene uses `scene.tpf` (scene plugin) to create the engine renderer, camera, and game state.
3. `MainScene.preload()` loads textures, audio, JSON level data, and web fonts.
4. `MainScene.create()` wires tilesets, light-map pixels, entity classes, HUD objects, pointer lock, and the `Extern` object that draws the 2.5D world inside the Phaser scene.
5. `MainScene.update()` forwards delta time to `tpf.update(delta)` and handles spawn timers.
6. `GameState.loadLevel()` builds maps, collision, lighting, culled sectors, and entities from Impact-style level JSON.
7. Entities update themselves through the shared `EntityContext` and render through the engine renderer.

### Engine path

- `src/twopointfive/entity.ts` is the base physics/rendering entity. It handles velocity, gravity, collision trace, animation updates, and light/sector updates.
- `src/twopointfive/game.ts` owns the level, entity registry, collision map, light map, and pairwise entity collision checks.
- `src/twopointfive/world/map.ts` and `wall-map.ts` build tile meshes from level layers.
- `src/twopointfive/world/light-map.ts` converts light-layer data plus image pixels into per-tile colors.
- `src/twopointfive/renderer/renderer.ts` batches quads into WebGL and handles fog, camera, and texture uploads.
- `src/twopointfive/two-point-five-plugin.ts` bridges Phaser with the engine and exposes `scene.tpf`.
- `src/twopointfive/render-adapter.ts` is a seam for the world render path (`LegacyWebGLRenderAdapter` is the only implementation).
- `src/twopointfive/entity-display-adapter.ts` is a seam for entity rendering. The only implementation is `LegacyEntityDisplayAdapter` (a no-op): entities draw themselves as WebGL billboard quads inside the Extern pass, so they depth-test against walls and pick up fog and lighting. A `ProjectedSpriteEntityDisplayAdapter` (Phaser `Image` sprites) was tried but retired — see the Phaser 4 rendering constraints below.

## Phaser 4 rendering constraints (important — verified against phaser@4.2.0)

Before proposing any "move the renderer to Phaser-native" work, know these hard facts about Phaser 4:

- **No 3D `Mesh`/`Plane` GameObject.** Phaser 4 removed both (see `node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md`: *"`Mesh` and `Plane` have been removed… proper 3D support is planned for the future."*). Only `Mesh2D` exists, which is strictly 2D (`[x,y,u,v]` vertices, no z, no per-vertex color, no projection). **There is nothing to port the 2.5D world geometry onto.** Do not plan a "world → Phaser Mesh" migration; it is not possible in 4.x.
- **GameObjects do not use the WebGL depth buffer.** `setDepth()` is purely a display-list sort key (painter's algorithm), not GPU depth testing. Two consequences:
  - True per-pixel occlusion only happens inside the custom WebGL pass (the `Extern`). The custom renderer here is the *sanctioned* Phaser 4 way to do 3D, not legacy debt.
  - Entities therefore render as WebGL billboard quads inside the Extern pass (`LegacyEntityDisplayAdapter`), where they depth-test against walls. An earlier attempt rendered entities as Phaser `Image` sprites (`ProjectedSpriteEntityDisplayAdapter`), but those **cannot be occluded by walls** — Phaser composites them over the whole world Extern — so that adapter was removed. Do not reintroduce Phaser-GameObject-based entity rendering expecting wall occlusion; it cannot work until Phaser ships real 3D.
- **The v3 `Pipeline` system is gone** (no `setPipeline`). Custom shaders use RenderNodes, `Phaser.GameObjects.Shader`, or **Filters** (`setUniform`-based).

### Extension point: world Filters

`Components.Filters` is mixed into the base `GameObject`, so the world `Extern` supports Phaser's Filters system. The plugin exposes this as the idiomatic customization surface:

- `scene.tpf.enableWorldFilters()` enables filters on the world Extern and returns its `internal`/`external` filter lists, e.g. `scene.tpf.enableWorldFilters()?.internal.addColorMatrix().grayscale()`. Built-in filters and custom `Phaser.Filters.Controller` subclasses both work; they affect only the world, not the HUD.
- This relies on `TpfExtern.render` binding `drawingContext.framebuffer` (per Phaser's own Extern docs) so the world renders into the filterable target. `TpfExtern.render` must keep the Phaser 4 signature `(renderer, drawingContext, calcMatrix, displayList, displayListIndex)`.
- Worked example of a **custom GLSL** world filter: `src/game/filters/crt-filter.ts` (CRT scanlines + vignette). It shows the two halves of a Phaser 4 filter — a `BaseFilterShader` RenderNode (GLSL + `programManager.setUniform`) and a `Filters.Controller` subclass — linked by a node name and registered via the game config's `render.renderNodes` map (the runtime treats each map value as the node constructor, so the `RenderNodesConfig` type is cast away). `MainScene` toggles it with the **F** key.

## Data and level format

Observed level data is Impact/Weltmeister-shaped JSON:
- `layer[]` entries with `name` values such as `floor`, `ceiling`, `walls`, `collision`, and `light`
- `tilesize`
- `data` as a 2D number array
- `tilesetName`
- `entities[]` with `type`, `x`, `y`, and `settings`

`MainScene` loads `media/levels/base1.json` and expects the same structure when loading other levels.

## Naming and style patterns

- TypeScript uses `strict: true` and ES module imports with the `~/*` path alias mapping to `src/*`.
- Files use `.ts` imports with explicit extensions.
- The codebase often prefers concrete classes with shared base types and record-based settings bags.
- `_`-prefixed fields are common for internal mutable scene/entity state.
- The ESLint config explicitly allows several patterns already used in the codebase: `_`-prefixed unused args, empty override hooks, dynamic `delete` in wall-sector code, and `||` defaults.
- `no-non-null-assertion`, `no-explicit-any`, and `no-unnecessary-condition` are warnings rather than hard errors.

## Testing and verification

There is no dedicated automated test suite in `package.json`. The normal verification loop is:
1. `npm run build`
2. `npm run lint`
3. `npm run format:check`
4. Launch with `npm start` and verify the demo in the browser

## Important gotchas

- `build.js` bundles `src/phaser-game.ts` to `dist/game.js`; `index.html` loads that bundle directly.
- `npm start` rebuilds before serving and uses `dev-server.js` instead of a generic static server so Weltmeister can browse entity/level files and save `.js` levels.
- `src/phaser-game.ts` expects WebGL and Phaser's `Extern` path for rendering the 2.5D world.
- Level loading depends on named layers matching the engine's expected names; if a tileset is missing, the layer is skipped.
- The player, weapon, and enemy systems use callback-heavy settings objects to inject images, sounds, scene hooks, and factories at spawn time.
- A separate ImpactJS demo and Weltmeister editor exist under `impact-version/`; do not assume changes to the Phaser path automatically apply there.
- `src/twopointfive/world/map.ts` and `wall-map.ts` contain special handling for tile seams and wall-face removal; changes there can affect rendering artifacts immediately.

## Working guidance for agents

- Read the relevant source file before editing it; many classes rely on implicit settings injection from `MainScene`.
- Prefer following existing patterns in nearby files instead of introducing new abstractions.
- Be careful with constructor signatures: some entities are spawned through factories that accept either classes or plain factory functions.
- Verify both Phaser and engine-side implications when changing level loading, entity spawning, or rendering paths.

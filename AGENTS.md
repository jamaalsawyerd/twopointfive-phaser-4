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
- `npm start` runs `dev-server.js --live --typecheck` under `node --watch` on port `8080`. esbuild's watch mode rebuilds `dist/game.js` whenever a bundled file changes and open Phaser demo tabs reload; `index.html` and `media/` changes reload them too. A failed build keeps the last good bundle and logs the error in the terminal and the tab's console.
- `--typecheck` runs `tsc --watch` in the same terminal, since esbuild only strips types. `node --watch` restarts the server when `dev-server.js` or `build.js` change, and open tabs reload once it is back. Plain `node dev-server.js` is still a static server with no build.
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
- `dev-server.js` — local static server plus Weltmeister browse/glob/save API replacements, live reload (`--live`), and type checking (`--typecheck`).
- `build.js` — esbuild bundle script; exports `buildOptions`, which the dev server's live mode reuses.

## Architecture and control flow

### Phaser path

1. `src/phaser-game.ts` registers `TwoPointFivePlugin` as a global Phaser plugin.
2. The scene uses `scene.tpf` (scene plugin) to create the engine renderer, camera, and game state.
3. `MainScene.preload()` loads textures, audio, JSON level data, and web fonts.
4. `MainScene.create()` wires tilesets, light-map pixels, entity classes, HUD objects, pointer lock, and the `Extern` object that draws the 2.5D world inside the Phaser scene. The HUD (weapon image, icons, text) is entirely native Phaser GameObjects — there is no engine-side HUD/ortho pass.
5. `MainScene.update()` forwards delta time to `tpf.update(delta)` and handles spawn timers.
6. `GameState.loadLevel()` builds maps, collision, lighting, culled sectors, and entities from Impact-style level JSON.
7. Entities update themselves through the shared `EntityContext` and render through the engine renderer.

### Engine path

- `src/twopointfive/entity.ts` is the base physics/rendering entity. It handles velocity, gravity, collision trace, animation updates, and light/sector updates. `setMaterial(key, uniforms)` / `clearMaterial()` select a custom shader (material) for the entity's billboard.
- `src/twopointfive/game.ts` owns the level, entity registry, collision map, light map, and pairwise entity collision checks.
- `src/twopointfive/world/map.ts` and `wall-map.ts` build tile meshes from level layers.
- `src/twopointfive/world/light-map.ts` converts light-layer data plus image pixels into per-tile colors.
- `src/twopointfive/renderer/renderer.ts` is the batching facade: camera/fog state, texture binding, draw stats, and quad/mesh submission. All GL resources live behind Phaser wrappers.
- `src/twopointfive/renderer/tpf-quad-batch.ts` is the `TPFQuadBatch` RenderNode (registered with Phaser's RenderNodeManager at runtime). It owns the shader programs, the composable material registry, the vertex layout (`pos vec3, uv vec2, color vec4`), and per-(material × fog) program+VAO suites. The fog GLSL is a snippet composed after each material's fragment body, so custom materials keep fog automatically.
- `src/twopointfive/two-point-five-plugin.ts` bridges Phaser with the engine and exposes `scene.tpf` (including `registerMaterial(key, config)` and `setView`/`getView`).
- `src/twopointfive/view.ts` resolves a `TPFViewConfig` (what the user asked for) into a `TPFResolvedView` (canvas size, the world's rectangle within it, internal render resolution, effective vertical/horizontal FOV). Pure functions, no Phaser or GL — projection changes belong here, not in `renderToGL`. The plugin holds the normalized `TPFViewState` and calls `_applyView()` to push results to the renderer and camera, emitting `viewchange` when the result actually differs.
- `src/twopointfive/render-adapter.ts` is a seam for the world render path (`LegacyWebGLRenderAdapter` is the only implementation).
- `src/twopointfive/entity-display-adapter.ts` is a seam for entity rendering. The only implementation is `LegacyEntityDisplayAdapter` (a no-op): entities draw themselves as WebGL billboard quads inside the Extern pass, so they depth-test against walls and pick up fog and lighting. For per-entity custom shaders use `entity.setMaterial` (stays in the depth-tested pass). A `ProjectedSpriteEntityDisplayAdapter` (Phaser `Image` sprites) was tried but retired — see the Phaser 4 rendering constraints below.

### Phaser renderer integration (how the engine uses Phaser 4's WebGL layer)

The engine contains no raw GL resource management; everything routes through Phaser 4's renderer infrastructure, so state tracking, context-loss recovery, and shader registration are shared with Phaser itself:

- **Textures** come from Phaser's `TextureManager` (`TextureSource.glTexture`, a `WebGLTextureWrapper`). The seam-expanded tileset canvas is registered as a `__tpf_seams_<name>` canvas texture and reused across scene restarts. Phaser uploads textures with `UNPACK_FLIP_Y_WEBGL` enabled, so engine UV math mirrors V (see `Tile.setTile` and `Quad`'s default UV).
- **Programs** are `WebGLProgramWrapper`s from `renderer.createProgram`; uniforms go through `setUniform` + `bind()` (queued, diff-checked).
- **Buffers/attributes** use `WebGLVertexBufferLayoutWrapper` + `WebGLVAOWrapper`; the CPU-side batch buffer is a view over the layout wrapper's ArrayBuffer.
- **GL state** (blend, depth test, scissor, viewport, clear color, texture units) goes through `glWrapper.update*` / `glTextureUnits.bind`, so Phaser's tracker always knows the truth. Nothing is saved/restored by hand: Phaser wraps every Extern render in `YieldContext`/`RebindContext`, which re-establishes bindings afterward. Depth test is explicitly left disabled at the end of the pass because Phaser's 2D pipeline never sets it.
- Still raw by necessity: `gl.clear`/`gl.drawArrays` (actions, not state) and the filter depth-renderbuffer attach in the plugin (Phaser allocates filter framebuffers color-only).

## Phaser 4 rendering constraints (important — verified against phaser@4.2.1)

Before proposing any "move the renderer to Phaser-native" work, know these hard facts about Phaser 4:

- **No 3D `Mesh`/`Plane` GameObject.** Phaser 4 removed both (see `node_modules/phaser/changelog/v4/4.0/MIGRATION-GUIDE.md`: *"`Mesh` and `Plane` have been removed… proper 3D support is planned for the future."*). Only `Mesh2D` exists (added in 4.2.0), and it is a 2D deformation primitive — the successor to v3 `Mesh` in name only. **There is nothing to port the 2.5D world geometry onto.** Do not plan a "world → Phaser Mesh2D" migration; it is not possible in 4.x. Four independent blockers, each against what `TPFQuadBatch` needs:
  - **No z.** Vertices are `[x, y, u, v]` with a step of 4 (`gameobjects/mesh2d/Mesh2D.js`). The engine layout is `pos vec3, uv vec2, color vec4`.
  - **No projection.** `SubmitterMeshToQuad` transforms vertices via `transformerNode.transformVertex` → `TransformMatrix.transformPoint`, a 2×3 CPU affine matrix. The quad vertex shader is `gl_Position = uProjectionMatrix * vec4(inPosition, 1.0, 1.0)` (`renderer/webgl/shaders/src/ShaderQuad.vert`) — z and w are hardcoded literals, so there is no perspective divide.
  - **No per-vertex color.** Tint is constant per GameObject; `SubmitterMeshToQuad._submitQuad` emits it as `tint, tint, tint, tint` to all four corners. The 4.2.0 changelog states it directly: *"Mesh2D and Tile objects support constant tint via `tint2`."* The light map needs per-vertex `vec4`.
  - **No depth test.** Mesh2D batches into the ordinary quad `BatchHandler`; the renderer default is `depthTest: false` (`renderer/webgl/parameters/WebGLGlobalParametersFactory.js`). Ordering is painter's algorithm — see the next bullet.

  Fog is a fifth problem: the engine composes a per-fragment GLSL snippet using view depth, and Mesh2D exposes no fragment hook. With no depth buffer, a filter-based substitute can only work in screen space.

  **The CPU-projection workaround is a trap.** You *can* project vertices to screen space yourself with `PerspectiveCamera` and feed the resulting 2D x/y to Mesh2D — the geometry lands in the right place, which makes this look viable. It is not. With `w` pinned to `1.0`, UVs interpolate linearly in *screen* space, i.e. affine texture mapping (PS1-style warping) — worst exactly where this engine lives, on large floor/ceiling quads at grazing angles, and only fixable by heavy subdivision that costs back whatever batching gained. On top of that you would hand-roll per-frame triangle z-sorting (still wrong for interpenetrating geometry), rehome the light map into per-value GameObjects or baked textures, and move vertex transforms from GPU to main thread. Strictly worse than the current renderer on every axis.

  **Where Mesh2D does fit: the HUD.** It is already pure Phaser GameObjects with no depth or fog requirement, so none of the blockers apply. E.g. `src/game/tpf/hud-blood.ts` is a flat `Image` that could become a warped non-rectangular splat, batching with the other HUD sprites. Additive polish, not a rendering change.
- **GameObjects do not use the WebGL depth buffer.** `setDepth()` is purely a display-list sort key (painter's algorithm), not GPU depth testing. Two consequences:
  - True per-pixel occlusion only happens inside the custom WebGL pass (the `Extern`). The custom renderer here is the *sanctioned* Phaser 4 way to do 3D, not legacy debt.
  - Entities therefore render as WebGL billboard quads inside the Extern pass (`LegacyEntityDisplayAdapter`), where they depth-test against walls. An earlier attempt rendered entities as Phaser `Image` sprites (`ProjectedSpriteEntityDisplayAdapter`), but those **cannot be occluded by walls** — Phaser composites them over the whole world Extern — so that adapter was removed. Do not reintroduce Phaser-GameObject-based entity rendering expecting wall occlusion; it cannot work until Phaser ships real 3D.
- **The v3 `Pipeline` system is gone** (no `setPipeline`). Custom shaders use RenderNodes, `Phaser.GameObjects.Shader`, or **Filters** (`setUniform`-based).

### Extension point: entity materials (per-entity custom shaders)

The sanctioned way to give an entity a custom shader while keeping wall occlusion and fog:

- Register a material once: `scene.tpf.registerMaterial(key, { fragmentUniforms, fragmentBody, uniforms })`. The body runs after `gl_FragColor = tex * vColor;` and may modify `gl_FragColor`; the fog snippet is composed after it automatically.
- Apply per entity: `entity.setMaterial(key, perEntityUniforms?)`, remove with `entity.clearMaterial()`.
- Entities sharing a material key (with no per-entity uniforms) batch into one draw call; per-entity uniforms force a flush per entity.
- Worked example in `src/phaser-game.ts`: **G** toggles `demo-pulse`, demonstrating animated uniforms (a shared `uniforms` object whose `time` is mutated in `update()`; the node re-applies material uniforms on each activation) and persistence (while on, `update()` sweeps newly spawned entities into the material).

### Extension point: world Filters

`Components.Filters` is mixed into the base `GameObject`, so the world `Extern` supports Phaser's Filters system. The plugin exposes this as the idiomatic customization surface:

- `scene.tpf.enableWorldFilters()` enables filters on the world Extern and returns its `internal`/`external` filter lists, e.g. `scene.tpf.enableWorldFilters()?.internal.addColorMatrix().grayscale()`. Built-in filters and custom `Phaser.Filters.Controller` subclasses both work; they affect only the world, not the HUD.
- This relies on `TpfExtern.render` binding `drawingContext.framebuffer` (per Phaser's own Extern docs) so the world renders into the filterable target. `TpfExtern.render` must keep the Phaser 4 signature `(renderer, drawingContext, calcMatrix, displayList, displayListIndex)`.
- Worked example of a **custom GLSL** world filter: `src/game/filters/wavy-filter.ts` (animated sine-wave UV displacement, like heat haze/underwater). It shows the two halves of a Phaser 4 filter — a `BaseFilterShader` RenderNode (GLSL + `programManager.setUniform`) and a `Filters.Controller` subclass — linked by a node name and registered via the game config's `render.renderNodes` map (the runtime treats each map value as the node constructor, so the `RenderNodesConfig` type is cast away). `MainScene` toggles it with the **F** key.

## Data and level format

Observed level data is Impact/Weltmeister-shaped JSON:
- `layer[]` entries with `name` values such as `floor`, `ceiling`, `walls`, `collision`, and `light`
- `tilesize`
- `data` as a 2D number array
- `tilesetName`
- `entities[]` with `type`, `x`, `y`, and `settings`

`MainScene` loads `media/levels/base1.json` and expects the same structure when loading other levels.

### View, aspect ratio, and internal resolution

- The canvas drawing buffer is the game config's `width`/`height`: Phaser 4's `ScaleManager` sets `canvas.width = baseSize.width`, and `zoom` only affects CSS. So those numbers *are* the internal render resolution and their ratio is the aspect.
- The demo runs `Scale.EXPAND`: one axis stays at the config size (480 tall) and the other grows to the parent, so the aspect follows the window while fill cost stays bounded. `index.html` gives `#game` real dimensions (`position: fixed; inset: 0`) because EXPAND/RESIZE derive the canvas from the parent's bounding box — a bare div in a centring flex container collapses or feeds back against its own canvas.
- Two non-obvious ScaleManager behaviours, both verified against 4.2.1: under EXPAND/RESIZE `game.scale.resize()` is overwritten by the next `updateScale` (resize the parent instead), and `refresh()` uses the parent size sampled at the end of the *previous* refresh (call `getParentBounds()` first when driving a resize by hand). No mode applies `devicePixelRatio`; that needs `Scale.NONE` plus a manual `resize(css * dpr)`.
- HUD layout lives in `MainScene.layoutHud(view)` and runs from `viewchange`, so resizes and `setView` calls share one path. The plugin clears `viewchange` listeners on scene shutdown (they capture Game Objects the shutdown destroys), so subscribe from `create()`.
- `view.aspect` set makes `view.world` a centred sub-rectangle of the canvas (pillar/letterbox); the bars are simply canvas the world never touches, so they show Phaser's `backgroundColor`. `view.internal` is the resolution the world renders at, which `resolution`/`scale` decouple from `view.world`. The three size fields are not interchangeable — read the one that matches your intent, and `view.offscreen` says whether internal differs from world.
- **Off-screen path** (`view.offscreen`): the world renders into a plugin-owned colour+depth framebuffer (`_ensureWorldTarget`), then `_blitWorldTarget` draws it as one full-screen quad onto the world rect. The blit uses identity view/projection matrices, so the quad's NDC coordinates land exactly on the GL viewport — which is already the world rect, so no extra transform is needed. Its UVs are unflipped (`setUV(0, 0, 1, 1)`) because a render target is written bottom-up by GL, unlike Phaser's `UNPACK_FLIP_Y` image uploads.
- The blit material sets `alphaDiscard: false`. The base fragment shader discards texels below alpha 0.8 to stop billboard cutouts writing depth; for a full-screen copy that would punch holes, so materials can opt out.
- While off-screen, `TpfExtern` skips `_attachFilterDepthBuffer`: the world's own target carries depth, and the filter framebuffer only ever receives the flat blit.
- Changing resolution or filter reallocates the target; clearing the setting frees it. Both resources are Phaser wrappers, so context loss is handled by the same machinery as every other engine texture.
- **Anchor HUD elements to `view.world`, not the canvas.** `world.x`/`world.y` are non-zero whenever an aspect is set. `TPFRect` is y-down from the top-left to match Phaser coordinates; the y-flip into GL's y-up viewport/scissor happens in `_renderWorld`.
- `gl.clear` is bounded by the **scissor box, not the viewport**, so the world pass scissors to the world rect before clearing — without it the depth/colour clear wipes the bars. The scissor is enabled only when the rect does not cover the target, and is restored to disabled at the end of the pass alongside depth test.
- Weapon subclasses that change `offset` or tile size after `super()` must call `updateHudAnchor()` rather than recomputing `pos` by hand; the arithmetic includes the `hudX`/`hudY` view origin and skipping it mis-places the weapon when the view is inset.
- Horizontal FOV is `2·atan(tan(fovV/2)·aspect)`, not `fov * aspect`. The old approximation over-estimated above aspect 1.0 (harmless over-draw) but under-estimated below it, culling sectors that were still on screen. Sector culling reads it via `context.horizontalFov()`.
- `_renderWorld()` holds the shared world render body; `renderToGL()` (the Extern path) and `draw()` (the standalone path) both call it, so changes land in both. `renderToGL` takes the `DrawingContext` size because a filter that requests padding renders into a larger context.

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
- `npm start` uses `dev-server.js` instead of a generic static server so Weltmeister can browse entity/level files and save `.js` levels.
- The live-reload script is injected into `index.html` as it is served (the file on disk has none) and never into `weltmeister.html`, where a reload would discard unsaved level edits; the Impact demo does not live-reload either. Pages opt in through `liveReloadPages` in `dev-server.js`.
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

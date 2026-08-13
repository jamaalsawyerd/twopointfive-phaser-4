# TwoPointFive

TwoPointFive provides a 2.5D (pseudo-3D) viewport for game worlds: perspective camera, tile-based floor/walls/ceiling with sector culling, and 3D-positioned entities.

## Phaser 4 Plugin

This repository includes a **Phaser 4**-compatible plugin (converted from the original ImpactJS version).

## Repo Organization

- **`impact-version/`** — The entire Impact TwoPointFive demo game, including the complete ImpactJS engine.
- **`media/`** — Shared assets (tilesets, levels, etc.) used by both the Impact and Phaser versions.
- **`src/`** — Phaser 4 / TypeScript source:
  - **`src/game/`** — All game-specific classes (entities, weapons, pickups, etc.).
  - **`src/twopointfive/`** — The TwoPointFive plugin: renderer, camera, world (map, culling, light map, collision), entities, and plugin entry.
  - **`src/phaser-game.ts`** — Phaser game bootstrap and scene logic (loading, level, update, render).
- **`index.html`** — Entry point for the Phaser demo; **`impact-index.html`** — Entry point for the Impact demo; **`weltmeister.html`** — Entry point for the Weltmeister editor.
- Use the Node version in **`.nvmrc`** when cloning; then `npm install`, `npm run build`, and `npm start` (or any static server).

### Quick start

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Serve: `npm start`
4. Open the Phaser demo at http://localhost:8080/index.html

The ImpactJS version of the game demo is served from http://localhost:8080/impact-index.html
The Weltmeister editor is served from http://localhost:8080/weltmeister.html

### Usage in your Phaser game

1. Register the global plugin in your game config:

```javascript
plugins: {
  global: [
    { key: 'TwoPointFivePlugin', plugin: TwoPointFivePlugin, start: true }
  ]
}
```

2. In a scene that uses 2.5D:
   - Call `this.tpf.setTileset(name, texture)` for each tileset (after loading).
   - Call `this.tpf.setLightMapPixels(name, imageData)` if you use a light layer.
   - Call `this.tpf.registerEntityClass('EntityTypeName', YourEntityClass)` before loading a level.
   - Call `this.tpf.loadLevel(levelData)` with Impact-style level JSON (layers: floor, ceiling, walls, collision, light; entities array).
   - In `update()` call `this.tpf.update(delta)`.
   - In the scene's `render` event call `this.tpf.draw()`.
   - Hide the default Phaser camera if you use only the 2.5D view: `this.cameras.main.setVisible(false)`.

3. Entity classes should extend `TPF.TPFEntity` and receive a `context` (collisionMap, culledSectors, renderer, camera, gravity, tick). Use `this.context` in `update()` and `updateQuad()`.

### Configuring the view

The camera and render target are configured through a single view object. Every field is optional
and updates merge, so you only name what you want to change. Changes apply immediately.

```javascript
this.tpf.setView({ fov: 90 });                       // just the field of view
this.tpf.setView({ fovAxis: 'horizontal', fov: 100 });
this.tpf.setView({ maxAspect: '21:9' });              // stop widening past ultrawide
this.tpf.setView({ aspect: '4:3' });                  // 4:3 view inside any canvas shape
```

To configure before the first frame renders, pass it as plugin boot data instead:

```javascript
plugins: {
  global: [
    { key: 'TwoPointFivePlugin', plugin: TwoPointFivePlugin, start: true,
      data: { view: { fov: 90 } } }
  ]
}
```

| Field | Default | Meaning |
| --- | --- | --- |
| `aspect` | `null` | Locks the 2.5D view to this ratio (`16 / 9`, `'4:3'`), centred in the canvas with bars on the two spare sides. `null` fills the canvas. |
| `resolution` | `null` | Renders the world at this size and scales it onto the screen. A number is the height in pixels (width follows the view's shape); `{ width, height }` is explicit. |
| `scale` | `null` | Renders the world at this fraction of its on-screen size. `0.5` halves it; `2` supersamples. Ignored if `resolution` is set. |
| `filter` | `'nearest'` | How the world is sampled when scaled. `'nearest'` for hard retro pixels, `'linear'` for smoothing (use with supersampling). |
| `fov` | `75` | Field of view in degrees, on the axis given by `fovAxis`. |
| `fovAxis` | `'vertical'` | `'vertical'` keeps the vertical view fixed so a wider viewport shows more to the sides (classic FPS behaviour). `'horizontal'` keeps the horizontal view fixed instead. |
| `maxAspect` | `null` | Stops the horizontal view widening past this aspect (`1.75`, `'21:9'`). Useful to keep ultrawide viewports from looking distorted. No effect when `fovAxis` is `'horizontal'`. |
| `near` / `far` | `1` / `10000` | Clip plane distances in world units. |
| `preset` | — | Named shorthand applied before the other fields in the same call. Currently `'fill'`. |

`this.tpf.fov` still works as a plain property and now applies immediately when assigned.

**Reading the view.** `this.tpf.getView()` returns the resolved result — never recompute these by
hand:

```javascript
const view = this.tpf.getView();
view.canvas;    // { width, height } of the drawing buffer
view.world;     // { x, y, width, height } the 2.5D view occupies within the canvas
view.internal;  // { width, height } the world is rendered at
view.aspect;    // width / height of view.world
view.fov;       // { vertical, horizontal } effective degrees, after fovAxis and maxAspect
view.near;      // clip plane distances
view.far;
```

**Fixed aspect ratio.** With `aspect` set, the 2.5D view becomes a centred rectangle and the spare
space on the two remaining sides shows the Phaser game's `backgroundColor`. The HUD still covers the
whole canvas, so anchor HUD elements to `view.world` — its `x`/`y` are the view's top-left corner,
which is no longer `0, 0`:

```javascript
const { x, y, width, height } = this.tpf.getView().world;
healthIcon.setPosition(x + 96, y + height - 20);   // bottom-left of the 2.5D view
```

Position HUD elements against `view.world` rather than the canvas size, so they stay correct
whether or not the world has its own aspect ratio. To follow changes, listen for `viewchange`:

```javascript
this.tpf.events.on('viewchange', (view) => {
  healthIcon.setPosition(view.world.x + 96, view.world.y + view.world.height - 20);
});
```

Invalid values (a negative `fov`, a malformed aspect string, `far` below `near`) log one warning,
keep the previous value, and never throw.

### Internal resolution

The 2.5D world can render at its own resolution, independent of the canvas. It goes into an
off-screen buffer and is scaled onto its on-screen rectangle, so the HUD, text, and any other Phaser
Game Objects stay crisp at full canvas resolution:

```javascript
this.tpf.setView({ resolution: 240 });                  // chunky 240p world, sharp HUD
this.tpf.setView({ scale: 0.5 });                       // half resolution, whatever the canvas size
this.tpf.setView({ scale: 2, filter: 'linear' });       // supersampled: renders 2x, downsamples
this.tpf.setView({ resolution: null, scale: null });    // back to rendering at screen resolution
```

Press **R** in the demo to cycle native → 240p → 120p → 2× supersampled and watch the HUD stay sharp.

The projection always uses the on-screen rectangle's aspect ratio, so the internal size only changes
how densely the image is sampled — it never distorts geometry. A `{ width, height }` whose ratio
differs from the view's is therefore legal; it just samples one axis more finely than the other.

This is the setting to combine with `Scale.RESIZE` below: let the canvas and HUD match the window
while the world's cost stays bounded.

```javascript
// Crisp HUD at window resolution, world capped at 720p
const { width, height } = this.tpf.getView().canvas;
this.tpf.setView({ resolution: Math.min(height, 720) });
```

The off-screen buffer is allocated only while it is needed, resized when the resolution or the
canvas changes, and freed when you clear the setting.

### Sizing the canvas to the window

The canvas drawing buffer is the game config's `width`/`height`: Phaser sets `canvas.width` from
them directly, so those numbers are the internal render resolution and their ratio is the aspect.
The Phaser scale mode decides whether they stay fixed:

| Mode | Buffer | Use when |
| --- | --- | --- |
| `Scale.FIT` | fixed at `width`×`height`, upscaled by CSS | you want one predictable resolution |
| `Scale.EXPAND` | one axis pinned to the config, the other grows to fill the parent | you want the window's shape without unbounded cost — **the demo's default** |
| `Scale.RESIZE` | matches the parent exactly | you want native sizing and accept the fill cost |

The engine follows all three automatically: a canvas resize re-resolves the view and emits
`viewchange`. Two things to get right:

1. **The parent element needs real dimensions.** `EXPAND` and `RESIZE` derive the canvas from the
   parent's bounding box, so a bare `<div>` in a centring flex container collapses or feeds back
   against the canvas inside it. Give it a size — the demo uses `#game { position: fixed; inset: 0 }`.
2. **Lay the HUD out from `viewchange`**, not once at create. See `layoutHud` in
   `src/phaser-game.ts` for the pattern.

Two behaviours of Phaser's ScaleManager are worth knowing, since neither is obvious:

- Under `EXPAND`/`RESIZE`, `game.scale.resize(w, h)` has no lasting effect — the next `updateScale`
  recomputes the size from the parent and overwrites it. Resize the parent element instead.
- `refresh()` reads the parent size captured at the end of the *previous* refresh. Call
  `getParentBounds()` first if you need it applied immediately; the normal per-frame path already
  samples it, so this only matters when driving a resize by hand.

**High-DPI displays.** No mode accounts for `devicePixelRatio`: the buffer is sized in CSS pixels, so
a 2× display upscales and looks slightly soft. `EXPAND`/`RESIZE` cannot be corrected after the fact
because `updateScale` reassigns `canvas.width` on every refresh. For native crispness use
`Scale.NONE` with your own resize listener:

```javascript
const dpr = window.devicePixelRatio || 1;
window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth * dpr, window.innerHeight * dpr);
});
```

### Level format

Keep the Impact/Weltmeister level structure: `layer[]` with `name` (floor, ceiling, walls, collision, light), `tilesize`, `data` (2D array), `tilesetName`; and `entities[]` with `type`, `x`, `y`, `settings`. Export level as JSON and load with `scene.load.json('level', url)`.

---

## TwoPointFive for Impact (original)

The original plugin targets the [Impact HTML5 Game Engine](http://impactjs.com/).


### Demo
[Super Blob Blaster](http://phoboslab.org/twopointfive/)


A demo game that uses this plugin is included in this repository.

Please note that you need a license for Impact to run the Impact demo and Weltmeister editor. The `impact-version/impact/` and `impact-version/weltmeister/` directories from Impact are expected under `impact-version/`.


### Usage

The demo game and its sources in `impact-version/game/` should give you a good overview on how to use the plugin. 

The most importantant thing for your entities is to subclass them from `tpf.Entity` rather than from `ig.Entity`. The `tpf.Entity` provides some capabilities to position and draw them in 3D space. Each entity has an additional `.z` property for `.pos` and `.vel` that determines its vertical position and speed in the world.

The layers in your level need to be named in a certain way for TwoPointFive to recognize them. The tile layers for the graphics need to be named `floor`, `ceiling` and `walls`. An additional `light` layer provides an additional tint for each of the tiles in the level. Note that the tilesize for each of these layers must be the same. Again, have a look a the included `impact-version/game/levels/base1.js` for an example.


TwoPointFive comes with some additions to Impact's Debug Module. To load it, simply require the `plugins.twopointfive.debug` module in your `main.js`.


### A note about Tile Seams

Whenever drawing parts of an image in WebGL, such is done here when drawing tiles, WebGL may sample pixels from a region of the image that is outside the one you specified. This happens mostly due to rounding errors and will result in ugly seams between tiles.

TwoPointFive attempts to work around this issue by redrawing your tileset into a slightly larger image and adding a 1 pixel border around each tile. This 1px border is a copy of the neighboring pixels. Whenever WebGL now samples a texture slightly outside the tile boundary, it will sample from this 1px border and thus avoid any seams in your map.

If you do not want this behaviour, you can disable it by setting `tpf.Map.fixTileSeams = false;` before calling `ig.main()`.

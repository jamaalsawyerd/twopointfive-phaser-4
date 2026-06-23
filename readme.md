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

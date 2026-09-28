/**
 * HUD minimap: a circular map in the top-right corner of the 2.5D view that turns with the camera, so the
 * way the player faces is always up. Walls are drawn Doom-automap style, as lines where solid tiles meet
 * floor; the player, enemies and pickups sit on top, and each of those layers toggles on its own. Fog of
 * war limits enemies and pickups to what the player can see and dims the map outside the view cone, and the
 * automap option hides the walls they have not looked at yet.
 *
 * Built from plain Phaser Game Objects. A Container clipped to a disc by an internal Mask filter holds the
 * map and markers; an unclipped overlay holds the ring, the compass N and rim pips for enemies past the
 * edge. MainScene creates one after loading the level and calls setViewRect() from layoutHud().
 */
import Phaser from 'phaser';
import type GameState from '~/twopointfive/game.ts';
import type TPFEntity from '~/twopointfive/entity.ts';
import type PerspectiveCamera from '~/twopointfive/renderer/perspective-camera.ts';
import type TileMap from '~/twopointfive/world/map.ts';
import type { TileFace, TPFRect } from '~/twopointfive/types.ts';

/** The minimap's independently toggled layers. */
export type MinimapLayer = 'map' | 'player' | 'enemies' | 'pickups';

/** How an entity appears on the minimap; returned by HudMinimapOptions.classify. */
export interface MinimapMarkerStyle {
  layer: 'enemies' | 'pickups';
  /** Texture key of a sprite to show as a small upright icon. Takes precedence over `shape`. */
  icon?: string;
  /** Built-in marker used when there is no icon. Default 'dot'. */
  shape?: 'dot' | 'ring';
  /** Tint for the built-in shapes and for rim pips. Default white. */
  color?: number;
  /**
   * Under fog of war, stays on the map once the player has seen it, until it is gone. Suits things that
   * stay put, like pickups; moving enemies are better shown only while in sight.
   */
  remember?: boolean;
}

export interface HudMinimapOptions {
  gameState: GameState;
  /** The minimap follows this camera rather than an entity, so it always matches the 3D view. */
  camera: PerspectiveCamera;
  /** Maps an entity to its marker, or null to leave it off. Called for every entity, every frame. */
  classify: (entity: TPFEntity) => MinimapMarkerStyle | null;
  /** How far the player can see, in world units: the view cone, fog of war and automap stop here. Default unlimited. */
  visibleRange?: number;
  /** Starting visibility per layer. Layers not named start visible. */
  layers?: Partial<Record<MinimapLayer, boolean>>;
  /** Starting radius in tiles, snapped to the nearest zoom step. Default 6. */
  rangeTiles?: number;
  /**
   * Start with fog of war on: enemies show only while in sight, remembered pickups once seen, and the map
   * dims outside the view cone. Default off.
   */
  fogOfWar?: boolean;
  /** Start with the automap on: only the walls the player has looked at are drawn. Default off. */
  automap?: boolean;
  /** Text style for the compass label, to match the rest of the HUD. Its font size is replaced. */
  textStyle?: Phaser.Types.GameObjects.Text.TextStyle;
  /** Display depth; the overlay draws one above it. Default 1000, like the rest of the HUD. */
  depth?: number;
}

// Sizes are pixels at the reference view height; setViewRect() multiplies them by the HUD scale.
const DIAMETER = 192;
/** Inset from the view's right edge, matching the inset of the HUD's left column. */
const MARGIN_RIGHT = 32;
const MARGIN_TOP = 24;
const RING_WIDTH = 3;
const WALL_WIDTH = 2;
const ARROW_SIZE = 14;
const DOT_SIZE = 7;
const RING_MARKER_SIZE = 10;
const ICON_SIZE = 14;
const ICON_PLATE_SIZE = 18;
const PIP_SIZE = 9;
const COMPASS_FONT_SIZE = 16;

/** Zoom steps, as the radius shown in tiles. */
const ZOOM_STEPS = [4, 6, 8, 12];

/** Alpha for a remembered entity that is not in sight right now. */
const REMEMBERED_ALPHA = 0.6;
/** How strongly fog of war darkens the map outside the view cone. */
const SHADE_ALPHA = 0.55;
/** Angle between the automap's reveal rays: at the level's fog range that is under 5 world units apart. */
const REVEAL_RAY_SPACING = (0.5 * Math.PI) / 180;

const BACKGROUND_COLOR = 0x030b12;
const BACKGROUND_ALPHA = 0.85;
/** The Doom automap's wall red. */
const WALL_COLOR = '#d8442f';
const RING_COLOR = '#c9d3dc';
const OUTLINE_COLOR = 'rgba(0, 0, 0, 0.8)';
const WHITE = 0xffffff;

/**
 * Texture keys. Textures belong to the game rather than the scene, so these outlive scene restarts and
 * are redrawn in place, like the engine's __tpf_seams_ tileset textures.
 */
const KEY = {
  disc: '__minimap_disc',
  ring: '__minimap_ring',
  map: '__minimap_map',
  shade: '__minimap_shade',
  wedge: '__minimap_wedge',
  arrow: '__minimap_arrow',
  dot: '__minimap_dot',
  ringMarker: '__minimap_ring_marker',
  pip: '__minimap_pip',
};
const ICON_PREFIX = '__minimap_icon_';

/** One bit per tile face, for the per-tile face masks. */
const FACE_BITS: Record<TileFace, number> = { top: 1, right: 2, bottom: 4, left: 8 };

/**
 * Uploads a canvas texture with linear filtering, so edges stay smooth as the map turns. Every upload resets
 * filtering to the game's default, which is nearest because antialias is off, so this sets it each time.
 */
function upload(texture: Phaser.Textures.CanvasTexture): void {
  texture.refresh();
  texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

/** Redraws the canvas texture for `key` at the given size, creating it on first use, and uploads it. */
function drawTexture(
  textures: Phaser.Textures.TextureManager,
  key: string,
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void,
): void {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const texture = textures.exists(key)
    ? (textures.get(key) as Phaser.Textures.CanvasTexture)
    : textures.createCanvas(key, w, h);
  if (!texture) throw new Error(`HudMinimap: cannot create texture "${key}"`);
  texture.setSize(w, h);
  texture.context.clearRect(0, 0, w, h);
  draw(texture.context, w, h);
  upload(texture);
}

/** Starts a new path holding one circle. */
function circlePath(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
}

/** Index of the zoom step closest to `tiles`. */
function nearestZoomIndex(tiles: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i] - tiles) < Math.abs(ZOOM_STEPS[best] - tiles)) best = i;
  }
  return best;
}

/**
 * Finds the wall faces to draw: each side of a solid collision tile that borders open floor. That is the
 * rule WallMap.eraseDisconnectedWalls keeps wall quads by, applied to the tiles CollisionMap rays test.
 */
function findWallFaces(solid: number[][], cols: number, rows: number, floor: TileMap | null): Uint8Array {
  const faces = new Uint8Array(cols * rows);
  if (!floor) return faces;
  const isSolid = (tx: number, ty: number): boolean =>
    tx >= 0 && ty >= 0 && tx < cols && ty < rows && solid[ty][tx] === 1;
  const isOpen = (tx: number, ty: number): boolean => floor.hasTile(tx, ty) && !isSolid(tx, ty);
  for (let ty = 0; ty < rows; ty++) {
    for (let tx = 0; tx < cols; tx++) {
      if (!isSolid(tx, ty)) continue;
      let bits = 0;
      if (isOpen(tx, ty - 1)) bits |= FACE_BITS.top;
      if (isOpen(tx + 1, ty)) bits |= FACE_BITS.right;
      if (isOpen(tx, ty + 1)) bits |= FACE_BITS.bottom;
      if (isOpen(tx - 1, ty)) bits |= FACE_BITS.left;
      faces[ty * cols + tx] = bits;
    }
  }
  return faces;
}

/**
 * Whether something at (dx, dy) from the viewer, `distance` away and `halfWidth` across, is inside a view
 * cone facing (fx, fy) with half-angle `halfFov`. The cone is widened by the thing's own angular size, so
 * one straddling the edge of the screen counts.
 */
function inViewCone(
  dx: number,
  dy: number,
  distance: number,
  halfWidth: number,
  fx: number,
  fy: number,
  halfFov: number,
): boolean {
  if (distance === 0) return true;
  const halfAngle = Math.min(Math.PI, halfFov + Math.atan2(halfWidth, distance));
  return (dx * fx + dy * fy) / distance >= Math.cos(halfAngle);
}

/** Images reused frame to frame inside one Container, so markers are not created and destroyed each frame. */
class SpritePool {
  readonly container: Phaser.GameObjects.Container;
  private _scene: Phaser.Scene;
  private _images: Phaser.GameObjects.Image[];
  private _used: number;

  constructor(scene: Phaser.Scene) {
    this._scene = scene;
    this.container = new Phaser.GameObjects.Container(scene);
    this._images = [];
    this._used = 0;
  }

  begin(): void {
    this._used = 0;
  }

  /** Shows the next image in the pool at (x, y), reset to no rotation and full alpha. */
  place(key: string, x: number, y: number, tint: number): Phaser.GameObjects.Image {
    let image: Phaser.GameObjects.Image;
    if (this._used < this._images.length) {
      image = this._images[this._used];
      if (image.texture.key !== key) image.setTexture(key);
    } else {
      image = new Phaser.GameObjects.Image(this._scene, 0, 0, key);
      this.container.add(image);
      this._images.push(image);
    }
    this._used++;
    return image.setPosition(x, y).setTint(tint).setRotation(0).setAlpha(1).setVisible(true);
  }

  /** Hides the images this frame did not place. */
  end(): void {
    for (let i = this._used; i < this._images.length; i++) this._images[i].setVisible(false);
  }

  /** Re-reads each image's size from its texture, after the textures were redrawn at a new scale. */
  resync(): void {
    for (const image of this._images) image.setTexture(image.texture.key);
  }
}

/** Circular, rotating HUD minimap; see the file header. */
export class HudMinimap {
  private _scene: Phaser.Scene;
  private _gameState: GameState;
  private _camera: PerspectiveCamera;
  private _classify: (entity: TPFEntity) => MinimapMarkerStyle | null;
  private _visibleRange: number;
  private _layers: Record<MinimapLayer, boolean>;
  private _zoomIndex: number;
  private _maxTextureSize: number;

  // Level geometry, read once: the collision grid's size and its wall faces (FACE_BITS per tile).
  private _tilesize: number;
  private _cols: number;
  private _rows: number;
  private _faces: Uint8Array;

  // Fog of war and automap. What the player sees is recorded even while these toggles are off.
  private _fogOfWar: boolean;
  private _automap: boolean;
  /** Entities with a `remember` style that the player has seen. */
  private _seen: WeakSet<TPFEntity>;
  /** Per tile, the FACE_BITS the automap's reveal rays have hit. */
  private _revealed: Uint8Array;
  // Camera pose at the last reveal pass, which only reruns when it changes.
  private _revealX: number;
  private _revealY: number;
  private _revealYaw: number;

  // Layout, from setViewRect(): the HUD scale, the on-screen diameter and the horizontal FOV in radians.
  private _scale: number;
  private _diameter: number;
  private _horizontalFov: number;

  // How the world maps onto the map texture: pixels per world unit, padding and wall line width in pixels.
  private _bakeScale: number;
  private _bakePad: number;
  private _bakeLineWidth: number;

  // Sprites copied into icon textures so far, and icon keys whose sprite does not exist.
  private _icons: Set<string>;
  private _missingIcons: Set<string>;

  private _window: Phaser.GameObjects.Container;
  private _background: Phaser.GameObjects.Image;
  private _map: Phaser.GameObjects.Image;
  private _shade: Phaser.GameObjects.Image;
  private _wedge: Phaser.GameObjects.Image;
  private _pickups: SpritePool;
  private _enemies: SpritePool;
  private _arrow: Phaser.GameObjects.Image;
  private _overlay: Phaser.GameObjects.Container;
  private _ring: Phaser.GameObjects.Image;
  private _pips: SpritePool;
  private _north: Phaser.GameObjects.Text;

  private _onPreRender: () => void;
  private _onShutdown: () => void;

  constructor(scene: Phaser.Scene, options: HudMinimapOptions) {
    this._scene = scene;
    this._gameState = options.gameState;
    this._camera = options.camera;
    this._classify = options.classify;
    this._visibleRange = options.visibleRange ?? Infinity;
    this._layers = { map: true, player: true, enemies: true, pickups: true, ...options.layers };
    this._zoomIndex = nearestZoomIndex(options.rangeTiles ?? 6);
    const renderer = scene.renderer;
    this._maxTextureSize =
      renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? renderer.getMaxTextureSize() : 4096;

    const collisionMap = options.gameState.collisionMap;
    const solid = 'data' in collisionMap ? collisionMap.data : [];
    this._tilesize = collisionMap.tilesize;
    this._rows = solid.length;
    this._cols = this._rows ? solid[0].length : 0;
    this._faces = findWallFaces(solid, this._cols, this._rows, options.gameState.getMapByName('floor'));

    this._fogOfWar = options.fogOfWar ?? false;
    this._automap = options.automap ?? false;
    this._seen = new WeakSet();
    this._revealed = new Uint8Array(this._faces.length);
    this._revealX = NaN;
    this._revealY = NaN;
    this._revealYaw = NaN;

    this._scale = 1;
    this._diameter = DIAMETER;
    this._horizontalFov = Math.PI / 2;
    this._bakeScale = 1;
    this._bakePad = 0;
    this._bakeLineWidth = WALL_WIDTH;
    this._icons = new Set();
    this._missingIcons = new Set();

    // Every image starts on Phaser's always-present __WHITE texture; _layout() draws and assigns the real ones.
    const image = (): Phaser.GameObjects.Image => new Phaser.GameObjects.Image(scene, 0, 0, '__WHITE');
    this._background = image().setTint(BACKGROUND_COLOR).setAlpha(BACKGROUND_ALPHA);
    this._map = image();
    this._shade = image();
    this._wedge = image();
    this._arrow = image();
    this._ring = image();
    this._pickups = new SpritePool(scene);
    this._enemies = new SpritePool(scene);
    this._pips = new SpritePool(scene);
    this._north = new Phaser.GameObjects.Text(scene, 0, 0, 'N', {
      ...options.textStyle,
      fontSize: `${COMPASS_FONT_SIZE}px`,
    }).setOrigin(0.5);

    const depth = options.depth ?? 1000;
    // Children draw in order. The shade dims the map but not the markers above it; enemies draw above
    // pickups, and the player arrow above everything.
    this._window = scene.add
      .container(0, 0, [
        this._background,
        this._map,
        this._shade,
        this._wedge,
        this._pickups.container,
        this._enemies.container,
        this._arrow,
      ])
      .setDepth(depth);
    this._overlay = scene.add.container(0, 0, [this._ring, this._pips.container, this._north]).setDepth(depth + 1);

    this._layout();
    // Clip the window to a disc. An internal Mask stretches its texture over the object's filter
    // framebuffer, which Phaser sizes from the Container's setSize() (done in _layout); with no size set it
    // would cover the whole camera instead. Masks are filters, so no stencil buffer is needed (the game has none).
    this._window.enableFilters();
    this._window.filters?.internal.addMask(KEY.disc);
    this._applyLayers();

    // PRE_RENDER fires after the plugin's postupdate has moved the entities and the camera, so the minimap
    // never trails the 3D view by a frame, as it would if MainScene.update() drove it.
    this._onPreRender = this.update.bind(this);
    this._onShutdown = this.destroy.bind(this);
    scene.events.on(Phaser.Scenes.Events.PRE_RENDER, this._onPreRender);
    // Scene shutdown does not remove PRE_RENDER listeners, so without this each restart would leave the
    // previous minimap updating destroyed objects.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown);
  }

  /**
   * Re-anchors to the top-right corner of a new view rectangle, e.g. from the plugin's `viewchange` event.
   * `scale` sizes it like the rest of the HUD; `horizontalFovDeg` shapes the view cone.
   */
  setViewRect(rect: TPFRect, scale = 1, horizontalFovDeg?: number): void {
    const fov = horizontalFovDeg === undefined ? this._horizontalFov : (horizontalFovDeg * Math.PI) / 180;
    const rescaled = scale !== this._scale;
    const fovChanged = fov !== this._horizontalFov;
    this._scale = scale;
    this._horizontalFov = fov;
    this._diameter = Math.round(DIAMETER * scale);
    // A wider or narrower view sees different walls, so the next frame reveals again.
    if (fovChanged) this._revealYaw = NaN;

    const x = rect.x + rect.width - MARGIN_RIGHT * scale - this._diameter / 2;
    const y = rect.y + MARGIN_TOP * scale + this._diameter / 2;
    this._window.setPosition(x, y);
    this._overlay.setPosition(x, y);

    // Textures are drawn at on-screen size so they stay sharp, so a new scale redraws them. The window is
    // resized rather than scaled for the same reason: its filter framebuffer is allocated at its unscaled
    // size, and scaling the Container would stretch that render and blur it.
    if (rescaled) this._layout();
    else if (fovChanged) this._drawCone();
  }

  /**
   * Syncs the minimap with the camera and the entities. Runs on PRE_RENDER. What the player sees is
   * recorded even while the minimap is hidden, since that does not depend on the HUD.
   */
  update(): void {
    const camera = this._camera;
    const camX = camera.position[0];
    const camY = camera.position[2];
    // The smoothed yaw the 3D view renders with. Rotating the map by it turns the player's forward
    // vector, (-sin yaw, -cos yaw) in EntityPlayer's movement code, to straight up.
    const yaw = camera.rotation[1];
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const draw = this._window.visible;

    this._reveal(camX, camY, yaw);
    if (draw) {
      // The whole map is one quad, turned about the player's point on the texture.
      this._map
        .setOrigin(
          (this._bakePad + camX * this._bakeScale) / this._map.width,
          (this._bakePad + camY * this._bakeScale) / this._map.height,
        )
        .setRotation(yaw);

      // True north, (0, -1) on the map, after the same rotation.
      const rim = this._diameter / 2 + (RING_WIDTH * this._scale) / 2;
      this._north.setPosition(sin * rim, -cos * rim);
    }
    this._updateEntities(camX, camY, cos, sin, draw);
  }

  /** Shows or hides the whole minimap. While hidden it draws nothing but still records what the player sees. */
  setVisible(visible: boolean): this {
    this._window.setVisible(visible);
    this._overlay.setVisible(visible);
    return this;
  }

  /** Flips the whole minimap on or off; returns whether it is now shown. */
  toggleVisible(): boolean {
    this.setVisible(!this._window.visible);
    return this._window.visible;
  }

  setLayerVisible(layer: MinimapLayer, visible: boolean): this {
    this._layers[layer] = visible;
    this._applyLayers();
    return this;
  }

  /** Flips one layer; returns whether it is now shown. */
  toggleLayer(layer: MinimapLayer): boolean {
    this.setLayerVisible(layer, !this._layers[layer]);
    return this._layers[layer];
  }

  isLayerVisible(layer: MinimapLayer): boolean {
    return this._layers[layer];
  }

  /**
   * Fog of war: enemies show only while the player can see them, remembered pickups once seen, and the map
   * dims outside the view cone.
   */
  get fogOfWar(): boolean {
    return this._fogOfWar;
  }

  setFogOfWar(on: boolean): this {
    this._fogOfWar = on;
    this._applyLayers();
    return this;
  }

  /** Flips fog of war; returns whether it is now on. */
  toggleFogOfWar(): boolean {
    this.setFogOfWar(!this._fogOfWar);
    return this._fogOfWar;
  }

  /** Automap: only the walls the player has looked at are drawn, as in Doom. */
  get automap(): boolean {
    return this._automap;
  }

  setAutomap(on: boolean): this {
    if (on !== this._automap) {
      this._automap = on;
      this._bakeMap();
    }
    return this;
  }

  /** Flips the automap; returns whether it is now on. */
  toggleAutomap(): boolean {
    this.setAutomap(!this._automap);
    return this._automap;
  }

  /** The radius shown, in tiles. */
  get rangeTiles(): number {
    return ZOOM_STEPS[this._zoomIndex];
  }

  /** Shows less of the map, larger. Returns the new radius in tiles. */
  zoomIn(): number {
    return this._setZoom(this._zoomIndex - 1);
  }

  /** Shows more of the map, smaller. Returns the new radius in tiles. */
  zoomOut(): number {
    return this._setZoom(this._zoomIndex + 1);
  }

  /** Stops updating and destroys the minimap's Game Objects. Runs by itself on scene shutdown. */
  destroy(): void {
    this._scene.events.off(Phaser.Scenes.Events.PRE_RENDER, this._onPreRender);
    this._scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this._onShutdown);
    this._window.destroy();
    this._overlay.destroy();
  }

  private _setZoom(index: number): number {
    const clamped = Phaser.Math.Clamp(index, 0, ZOOM_STEPS.length - 1);
    if (clamped !== this._zoomIndex) {
      this._zoomIndex = clamped;
      // Lines are drawn at on-screen scale, so a new zoom redraws them rather than stretching the texture.
      this._bakeMap();
      this._drawCone();
    }
    return this.rangeTiles;
  }

  /** On-screen pixels per world unit at the current size and zoom. */
  private _pxPerUnit(): number {
    return this._diameter / 2 / (this.rangeTiles * this._tilesize);
  }

  private _applyLayers(): void {
    const layers = this._layers;
    this._map.setVisible(layers.map);
    this._shade.setVisible(layers.map && this._fogOfWar);
    this._wedge.setVisible(layers.player);
    this._arrow.setVisible(layers.player);
    this._pickups.container.setVisible(layers.pickups);
    this._enemies.container.setVisible(layers.enemies);
    this._pips.container.setVisible(layers.enemies);
  }

  /**
   * Records which entities the player can see and, when `draw` is set, positions their markers: inside the
   * disc as markers, and past its edge as rim pips for enemies. Under fog of war only entities in sight are
   * drawn, plus remembered ones at reduced alpha.
   */
  private _updateEntities(camX: number, camY: number, cos: number, sin: number, draw: boolean): void {
    const k = this._pxPerUnit();
    const radius = this._diameter / 2;
    const pipRadius = radius - PIP_SIZE * this._scale * 0.6;
    const range = this.rangeTiles * this._tilesize;
    const halfFov = this._horizontalFov / 2;
    const collisionMap = this._gameState.collisionMap;
    if (draw) {
      this._pickups.begin();
      this._enemies.begin();
      this._pips.begin();
    }
    // The plugin replaces this array on every update, so it is read fresh each frame rather than kept.
    for (const entity of this._gameState.entities) {
      if (entity._killed) continue;
      const style = this._classify(entity);
      if (!style) continue;
      const shown = draw && this._layers[style.layer];
      const remember = style.remember === true;
      const dx = entity.pos.x + entity.size.x / 2 - camX;
      const dy = entity.pos.y + entity.size.y / 2 - camY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      // Sight costs a raycast, so it is only worked out when something depends on it: a marker the fog of
      // war might hide, or a first sighting worth remembering. The cheap tests go first.
      const inSight =
        ((shown && this._fogOfWar) || (remember && !this._seen.has(entity))) &&
        distance <= this._visibleRange &&
        inViewCone(dx, dy, distance, entity.size.x / 2, -sin, -cos, halfFov) &&
        collisionMap.lineOfSight(camX, camY, camX + dx, camY + dy);
      if (inSight && remember) this._seen.add(entity);
      if (!shown) continue;

      let alpha = 1;
      if (this._fogOfWar && !inSight) {
        if (!remember || !this._seen.has(entity)) continue;
        alpha = REMEMBERED_ALPHA;
      }
      // The rotation Phaser applies to the map image, so every marker stays on its spot of the map.
      const px = (dx * cos - dy * sin) * k;
      const py = (dx * sin + dy * cos) * k;
      const enemy = style.layer === 'enemies';
      if (distance * k <= radius) {
        const key = this._markerKey(style);
        const tint = key.startsWith(ICON_PREFIX) ? WHITE : (style.color ?? WHITE);
        (enemy ? this._enemies : this._pickups).place(key, px, py, tint).setAlpha(alpha);
      } else if (enemy && distance > 0) {
        // Past the edge: pin a pip to the rim, pointing at the enemy and fading with distance.
        const pip = this._pips.place(
          KEY.pip,
          (px / (distance * k)) * pipRadius,
          (py / (distance * k)) * pipRadius,
          style.color ?? WHITE,
        );
        pip
          .setRotation(Math.atan2(py, px) + Math.PI / 2)
          .setAlpha(Phaser.Math.Clamp(1.5 - distance / (2 * range), 0.3, 1) * alpha);
      }
    }
    if (draw) {
      this._pickups.end();
      this._enemies.end();
      this._pips.end();
    }
  }

  /**
   * Casts a fan of rays across the horizontal FOV, out to visibleRange, and records each wall face they hit:
   * the walls the player has looked at, which is what Doom's automap shows. Reruns only when the camera has
   * moved or turned. With the automap on, newly seen faces are drawn straight onto the map texture.
   */
  private _reveal(camX: number, camY: number, yaw: number): void {
    if (camX === this._revealX && camY === this._revealY && yaw === this._revealYaw) return;
    this._revealX = camX;
    this._revealY = camY;
    this._revealYaw = yaw;

    const collisionMap = this._gameState.collisionMap;
    const half = Math.min(Math.PI, this._horizontalFov / 2);
    const rays = Math.max(1, Math.ceil((2 * half) / REVEAL_RAY_SPACING));
    // Newly revealed faces, as (tile index, face bits) pairs.
    const fresh: number[] = [];
    for (let i = 0; i <= rays; i++) {
      // Facing a yaw of `a` looks along (-sin a, -cos a), as in EntityPlayer; the fan spans yaw ± half.
      const a = yaw - half + (2 * half * i) / rays;
      const hit = collisionMap.raycast(camX, camY, -Math.sin(a), -Math.cos(a), this._visibleRange);
      if (!hit) continue;
      const index = hit.tileY * this._cols + hit.tileX;
      const bit = FACE_BITS[hit.face] & this._faces[index] & ~this._revealed[index];
      if (!bit) continue;
      this._revealed[index] |= bit;
      fresh.push(index, bit);
    }
    if (!fresh.length || !this._automap) return;

    const texture = this._scene.textures.get(KEY.map) as Phaser.Textures.CanvasTexture;
    const ctx = texture.context;
    this._wallStroke(ctx);
    ctx.beginPath();
    for (let i = 0; i < fresh.length; i += 2) this._traceFaces(ctx, fresh[i], fresh[i + 1]);
    ctx.stroke();
    upload(texture);
  }

  /** The texture a style's marker uses: its icon once that sprite has been copied, else the built-in shape. */
  private _markerKey(style: MinimapMarkerStyle): string {
    const icon = style.icon;
    if (icon !== undefined && !this._missingIcons.has(icon)) {
      if (this._icons.has(icon) || this._drawIcon(icon)) {
        this._icons.add(icon);
        return ICON_PREFIX + icon;
      }
      this._missingIcons.add(icon);
    }
    return style.shape === 'ring' ? KEY.ringMarker : KEY.dot;
  }

  /**
   * Copies a sprite into a small icon texture, smoothed down to marker size. A separate copy leaves the
   * sprite's own texture alone: the 3D billboards sample that same GL texture with nearest filtering.
   */
  private _drawIcon(key: string): boolean {
    const textures = this._scene.textures;
    const source = textures.exists(key) ? textures.get(key).getSourceImage() : null;
    if (!(source instanceof HTMLImageElement || source instanceof HTMLCanvasElement)) return false;
    const frame = textures.getFrame(key);
    const plate = ICON_PLATE_SIZE * this._scale;
    const size = ICON_SIZE * this._scale;
    drawTexture(textures, ICON_PREFIX + key, plate, plate, (ctx, w, h) => {
      // A pale plate behind the sprite, so dark sprites still read against the dark disc.
      circlePath(ctx, w / 2, h / 2, w / 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
      ctx.fill();
      const fit = Math.min(size / frame.cutWidth, size / frame.cutHeight);
      const dw = frame.cutWidth * fit;
      const dh = frame.cutHeight * fit;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        source,
        frame.cutX,
        frame.cutY,
        frame.cutWidth,
        frame.cutHeight,
        (w - dw) / 2,
        (h - dh) / 2,
        dw,
        dh,
      );
    });
    return true;
  }

  /** Redraws every size-dependent texture at the current scale and resizes what shows them. */
  private _layout(): void {
    const s = this._scale;
    const d = this._diameter;
    const textures = this._scene.textures;

    this._window.setSize(d, d);
    this._background.setDisplaySize(d, d);

    // The mask. Stretched over the window's d x d filter framebuffer, its edge is the minimap's edge.
    drawTexture(textures, KEY.disc, d, d, (ctx, w) => {
      circlePath(ctx, w / 2, w / 2, w / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    const ringWidth = RING_WIDTH * s;
    const ringSize = d + (ringWidth + 2 * s) * 2;
    drawTexture(textures, KEY.ring, ringSize, ringSize, (ctx, w) => {
      // The ring's inner edge sits on the disc's edge, over a dark halo for contrast against the world.
      circlePath(ctx, w / 2, w / 2, d / 2 + ringWidth / 2);
      ctx.lineWidth = ringWidth + 2 * s;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
      ctx.lineWidth = ringWidth;
      ctx.strokeStyle = RING_COLOR;
      ctx.stroke();
    });

    const arrow = ARROW_SIZE * s;
    drawTexture(textures, KEY.arrow, arrow + 4 * s, arrow + 4 * s, (ctx, w) => {
      // A chevron that always points up, because up is always the way the player faces.
      const c = w / 2;
      ctx.beginPath();
      ctx.moveTo(c, c - arrow / 2);
      ctx.lineTo(c + arrow * 0.42, c + arrow / 2);
      ctx.lineTo(c, c + arrow * 0.2);
      ctx.lineTo(c - arrow * 0.42, c + arrow / 2);
      ctx.closePath();
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    });

    // Markers are drawn white with a dark rim, so a tint colours the fill and leaves the rim dark.
    const dot = DOT_SIZE * s;
    drawTexture(textures, KEY.dot, dot + 2 * s, dot + 2 * s, (ctx, w) => {
      circlePath(ctx, w / 2, w / 2, dot / 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = s;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
    });

    const ringMarker = RING_MARKER_SIZE * s;
    drawTexture(textures, KEY.ringMarker, ringMarker + 2 * s, ringMarker + 2 * s, (ctx, w) => {
      circlePath(ctx, w / 2, w / 2, ringMarker / 2 - s);
      ctx.lineWidth = 4 * s;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
      ctx.lineWidth = 2 * s;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    });

    const pip = PIP_SIZE * s;
    drawTexture(textures, KEY.pip, pip + 2 * s, pip + 2 * s, (ctx, w) => {
      // Points up; _updateEntities() turns each pip towards its enemy.
      const c = w / 2;
      ctx.beginPath();
      ctx.moveTo(c, c - pip / 2);
      ctx.lineTo(c + pip / 2, c + pip / 2);
      ctx.lineTo(c - pip / 2, c + pip / 2);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = s;
      ctx.strokeStyle = OUTLINE_COLOR;
      ctx.stroke();
    });

    for (const key of this._icons) this._drawIcon(key);

    this._arrow.setTexture(KEY.arrow);
    this._ring.setTexture(KEY.ring);
    this._north.setScale(s);
    this._pickups.resync();
    this._enemies.resync();
    this._pips.resync();
    this._bakeMap();
    this._drawCone();
  }

  /**
   * Draws the wall lines at on-screen scale, so they keep the same width at every zoom; with the automap
   * on, only the faces the player has seen. At runtime the map is a single quad: update() only moves its
   * origin and turns it.
   */
  private _bakeMap(): void {
    const lineWidth = WALL_WIDTH * this._scale;
    const pad = Math.ceil(lineWidth);
    const pxPerTile = this._pxPerUnit() * this._tilesize;
    // A level too big for one texture at this scale is drawn smaller and scaled back up.
    const fit = Math.min(1, this._maxTextureSize / (Math.max(this._cols, this._rows) * pxPerTile + pad * 2));
    const tile = pxPerTile * fit;
    this._bakeScale = tile / this._tilesize;
    this._bakePad = pad;
    this._bakeLineWidth = lineWidth * fit;
    drawTexture(this._scene.textures, KEY.map, this._cols * tile + pad * 2, this._rows * tile + pad * 2, (ctx) => {
      this._wallStroke(ctx);
      ctx.beginPath();
      for (let i = 0; i < this._faces.length; i++) {
        const faces = this._automap ? this._faces[i] & this._revealed[i] : this._faces[i];
        if (faces) this._traceFaces(ctx, i, faces);
      }
      ctx.stroke();
    });
    this._map.setTexture(KEY.map).setScale(1 / fit);
  }

  /** Sets the Doom-red wall stroke, at the line width of the current bake. */
  private _wallStroke(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth = this._bakeLineWidth;
    // Round caps close the corners where one tile's face meets the next.
    ctx.lineCap = 'round';
  }

  /** Adds the given faces (FACE_BITS) of the tile at `index` to the current path, in map-texture pixels. */
  private _traceFaces(ctx: CanvasRenderingContext2D, index: number, faces: number): void {
    const tile = this._bakeScale * this._tilesize;
    const x0 = this._bakePad + (index % this._cols) * tile;
    const y0 = this._bakePad + Math.floor(index / this._cols) * tile;
    const x1 = x0 + tile;
    const y1 = y0 + tile;
    if (faces & FACE_BITS.top) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y0);
    }
    if (faces & FACE_BITS.bottom) {
      ctx.moveTo(x0, y1);
      ctx.lineTo(x1, y1);
    }
    if (faces & FACE_BITS.left) {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x0, y1);
    }
    if (faces & FACE_BITS.right) {
      ctx.moveTo(x1, y0);
      ctx.lineTo(x1, y1);
    }
  }

  /**
   * Draws the view cone, the horizontal FOV out to the edge of what the player can see, in two textures: the
   * pale wedge in front of the arrow, and the shade with a cone-shaped hole that dims the rest of the map
   * under fog of war. The cone always points up, so neither changes as the player turns.
   */
  private _drawCone(): void {
    const d = this._diameter;
    const length = Math.min(d / 2, this._visibleRange * this._pxPerUnit());
    const half = Math.min(Math.PI, this._horizontalFov / 2);
    const conePath = (ctx: CanvasRenderingContext2D, c: number): void => {
      ctx.beginPath();
      ctx.moveTo(c, c);
      // Canvas angles run clockwise from +x, so straight up is -PI/2.
      ctx.arc(c, c, length, -Math.PI / 2 - half, -Math.PI / 2 + half);
      ctx.closePath();
    };

    drawTexture(this._scene.textures, KEY.wedge, length * 2, length * 2, (ctx, w) => {
      const c = w / 2;
      const gradient = ctx.createRadialGradient(c, c, 0, c, c, length);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      conePath(ctx, c);
      ctx.fill();
    });

    drawTexture(this._scene.textures, KEY.shade, d, d, (ctx, w) => {
      const c = w / 2;
      ctx.fillStyle = `rgba(0, 0, 0, ${SHADE_ALPHA})`;
      ctx.fillRect(0, 0, w, w);
      // Cut the cone out of the shade, easing back to full shade over its last stretch, like the fog it stands for.
      const gradient = ctx.createRadialGradient(c, c, 0, c, c, length);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(0.8, 'rgba(0, 0, 0, 1)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = gradient;
      conePath(ctx, c);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    });

    this._wedge.setTexture(KEY.wedge);
    this._shade.setTexture(KEY.shade);
  }
}

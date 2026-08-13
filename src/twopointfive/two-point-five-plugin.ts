/**
 * Phaser integration: scene plugin (scene.tpf) and TpfExtern game object. The plugin loads levels,
 * runs entity updates from the Phaser scene lifecycle, and provides renderToGL for the Extern.
 */
import Phaser from 'phaser';
import * as TPF from './index.ts';
import type { ImageInfo, TilesetInfo, EntityContext, TPFTexture, TPFViewConfig, TPFResolvedView } from './types.ts';
import { DEFAULT_VIEW_STATE, mergeViewConfig, resolveView } from './view.ts';
import type { TPFViewState } from './view.ts';
import Quad from './renderer/quad.ts';
import type { LightMapPixels } from './world/light-map.ts';
import type Renderer from './renderer/renderer.ts';
import type PerspectiveCamera from './renderer/perspective-camera.ts';
import type GameState from './game.ts';
import type { GameContext } from './game.ts';
import { LegacyEntityDisplayAdapter } from './entity-display-adapter.ts';
import type { TPFEntityDisplayAdapter } from './entity-display-adapter.ts';
import TwoPointFiveInputController from './input-controller.ts';
import { LegacyWebGLRenderAdapter } from './render-adapter.ts';
import TwoPointFiveSoundController from './sound-controller.ts';
import TwoPointFiveTimeController from './time-controller.ts';
import { glState } from './renderer/renderer.ts';
import type { TPFRenderAdapter } from './render-adapter.ts';
import type Animation from '~/game/tpf/animation.ts';
import type TPFEntity from './entity.ts';

// Augment Phaser.Scene so `this.tpf` is typed
declare module 'phaser' {
  interface Scene {
    tpf: TwoPointFiveScenePlugin;
  }
}

/** Material key for the full-screen pass that scales the off-screen world onto the screen. */
const BLIT_MATERIAL = { key: '__tpf_blit' };

/**
 * Identity matrices for the blit. With no view or projection transform, the blit quad's vertices are
 * already in normalised device coordinates, so a 2x2 quad centred on the origin exactly covers the
 * current GL viewport — which is set to the world rectangle, placing the blit without extra maths.
 */
const IDENTITY_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** The off-screen colour+depth target the world renders into when its resolution differs. */
interface WorldTarget {
  texture: TPFTexture;
  framebuffer: Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper;
  width: number;
  height: number;
  filter: 'nearest' | 'linear';
}

type PhaserTextureInput =
  | string
  | Phaser.Textures.Texture
  | { getSourceImage?(): HTMLImageElement | HTMLCanvasElement };

/**
 * TpfExtern is a Phaser.GameObjects.Extern that renders the TwoPointFive
 * 2.5D world as part of the Phaser scene graph.
 */
class TpfExtern extends Phaser.GameObjects.Extern {
  _tpf: TwoPointFiveScenePlugin;

  constructor(scene: Phaser.Scene, tpfPlugin: TwoPointFiveScenePlugin) {
    super(scene);
    this._tpf = tpfPlugin;
  }

  render(
    phaserRenderer: Phaser.Renderer.WebGL.WebGLRenderer,
    drawingContext: Phaser.Renderer.WebGL.DrawingContext,
    _calcMatrix: Phaser.GameObjects.Components.TransformMatrix,
    _displayList: Phaser.GameObjects.GameObject[],
    _displayListIndex: number,
  ): void {
    const tpf = this._tpf;
    if (!tpf) return;

    // Bind the DrawingContext framebuffer so the 2.5D world renders into Phaser's render
    // target. This is what lets Phaser Filters enabled on this Extern (see the plugin's
    // enableWorldFilters) post-process the world output the idiomatic Phaser 4 way.
    phaserRenderer.glWrapper.updateBindingsFramebuffer(
      {
        bindings: { framebuffer: drawingContext.framebuffer },
      } as unknown as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters,
      true,
    );

    const gl = phaserRenderer.gl;

    // A non-null webGLFramebuffer means we are rendering into an off-screen target (e.g. an active
    // world filter). Phaser allocates those framebuffers color-only (no depth attachment), which
    // would break the world's depth testing and make geometry/entities draw through each other.
    // Attach a managed depth buffer for the duration of this render, then detach it so Phaser's
    // pooled framebuffer is left exactly as we found it. The main canvas already has depth.
    const framebuffer = drawingContext.framebuffer as unknown as { webGLFramebuffer: WebGLFramebuffer | null } | null;
    // When the world renders at its own resolution it uses its own target, which already carries a
    // depth attachment — the filter framebuffer then only receives the flat blit and needs none.
    const needsDepth = !!framebuffer?.webGLFramebuffer && !tpf.getView().offscreen;
    if (needsDepth) {
      tpf._attachFilterDepthBuffer(gl, drawingContext.width, drawingContext.height);
    }

    // Render at the DrawingContext's size rather than the canvas size: a filter that requests
    // padding (blur, glow) renders into a larger context, and the viewport must agree with the
    // depth buffer attached just above or the two disagree about the render target's size.
    // Filters with padding also offset the scene within that context; the world rectangle is
    // centred in it, which is exact for the symmetric padding the built-in filters produce.
    tpf.renderToGL(gl, drawingContext.width, drawingContext.height, drawingContext.framebuffer);

    if (needsDepth) {
      tpf._detachFilterDepthBuffer(gl);
    }
  }
}

/**
 * Global plugin: registers the scene plugin and exposes TPF.
 */
class TwoPointFivePlugin extends Phaser.Plugins.BasePlugin {
  TPF: typeof TPF;
  /**
   * View configuration supplied as plugin boot data, applied by each scene plugin before its first
   * frame. Configuring here rather than in `create()` avoids a frame rendered at default settings:
   *
   *   plugins: { global: [{ key: 'TwoPointFivePlugin', plugin: TwoPointFivePlugin, start: true,
   *                         data: { view: { fov: 90 } } }] }
   */
  viewConfig: TPFViewConfig | null;

  constructor(pluginManager: Phaser.Plugins.PluginManager) {
    super(pluginManager);
    this.viewConfig = null;
    if (!pluginManager.get('TwoPointFiveScenePlugin')) {
      pluginManager.registerGameObject('twopointfive', function (this: Phaser.GameObjects.GameObjectFactory) {
        return this;
      });
      pluginManager.installScenePlugin(
        'TwoPointFiveScenePlugin',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        TwoPointFiveScenePlugin as unknown as Function,
        'tpf',
        undefined,
      );
    }
    this.TPF = TPF;
  }

  /** Receives the `data` object from the game config's plugin entry. */
  init(data?: { view?: TPFViewConfig } | null): void {
    if (data?.view) this.viewConfig = data.view;
  }
}

/**
 * Scene plugin: provides scene.tpf with loadLevel, update, draw, camera, etc.
 */
class TwoPointFiveScenePlugin extends Phaser.Plugins.ScenePlugin {
  declare game: Phaser.Game;
  declare scene: Phaser.Scene;

  renderer: Renderer | null;
  camera: PerspectiveCamera | null;
  gameState: GameState | null;
  entityClasses: Record<
    string,
    new (x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity
  >;
  tilesets: Record<string, TilesetInfo>;
  lightMapPixels: Record<string, LightMapPixels>;
  _gameContext: GameContext | null;
  gravity: number;
  sectorSize: number;
  /**
   * Emits `viewchange` with the resolved view whenever the view changes, from a canvas resize or
   * from setView(). Subscribe to lay out HUD elements instead of recomputing sizes by hand:
   *   scene.tpf.events.on('viewchange', (view) => icon.setPosition(view.world.x + 16, ...));
   *
   * Listeners are cleared on scene shutdown, because they normally close over Game Objects that the
   * shutdown destroys. Subscribe from create() so a restarted scene re-subscribes with fresh ones.
   */
  events: Phaser.Events.EventEmitter;
  _viewState: TPFViewState;
  _resolvedView: TPFResolvedView | null;
  backgroundAnims: Record<string, Record<number, Animation>>;
  renderAdapter: TPFRenderAdapter;
  entityDisplayAdapter: TPFEntityDisplayAdapter;
  inputController: TwoPointFiveInputController | null;
  soundController: TwoPointFiveSoundController | null;
  timeController: TwoPointFiveTimeController | null;
  extern: TpfExtern | null;
  _filterDepthBuffer: WebGLRenderbuffer | null;
  _filterDepthWidth: number;
  _filterDepthHeight: number;
  _worldTarget: WorldTarget | null;
  _blitQuad: Quad | null;

  constructor(scene: Phaser.Scene, pluginManager: Phaser.Plugins.PluginManager, pluginKey: string) {
    super(scene, pluginManager, pluginKey);
    this.game = scene.game;
    this.scene = scene;
    this.renderer = null;
    this.camera = null;
    this.gameState = null;
    this.entityClasses = {};
    this.tilesets = {};
    this.lightMapPixels = {};
    this._gameContext = null;
    this.gravity = 4;
    this.sectorSize = 4;
    this.events = new Phaser.Events.EventEmitter();
    this._viewState = { ...DEFAULT_VIEW_STATE };
    this._resolvedView = null;
    this.backgroundAnims = {};
    this.renderAdapter = new LegacyWebGLRenderAdapter();
    this.entityDisplayAdapter = new LegacyEntityDisplayAdapter();
    this.inputController = null;
    this.soundController = null;
    this.timeController = null;
    this.extern = null;
    this._filterDepthBuffer = null;
    this._filterDepthWidth = 0;
    this._filterDepthHeight = 0;
    this._worldTarget = null;
    this._blitQuad = null;
  }

  // boot() runs only once per scene (Phaser registers it via once(BOOT)). Per-run state that
  // shutdown() tears down is set up in _onSceneStart, which fires on every start including
  // scene.restart(); otherwise restarting leaves the postupdate listener and controllers gone,
  // which freezes entity simulation (e.g. the player can't move after dying and restarting).
  /**
   * Field of view in degrees, on the axis given by the view's `fovAxis` (vertical by default).
   * Backed by setView(), so assigning it applies immediately rather than waiting for a resize.
   */
  get fov(): number {
    return this._viewState.fov;
  }

  set fov(value: number) {
    this.setView({ fov: value });
  }

  /**
   * Updates the view. Fields not named are left alone, so `setView({ fov: 90 })` changes only the
   * field of view. Applies immediately and emits `viewchange` if anything actually changed.
   */
  setView(config: TPFViewConfig): TPFResolvedView {
    this._viewState = mergeViewConfig(this._viewState, config);
    return this._applyView();
  }

  /**
   * The current resolved view: canvas size, the world's rectangle within it, the resolution the
   * world renders at, and the effective vertical/horizontal field of view in degrees.
   */
  getView(): TPFResolvedView {
    if (!this._resolvedView) this._resolvedView = this._resolveCurrentView();
    return this._resolvedView;
  }

  _resolveCurrentView(): TPFResolvedView {
    return resolveView(this._viewState, this.game.scale.width, this.game.scale.height);
  }

  /**
   * Recomputes the resolved view and pushes it to the renderer and camera. Emits `viewchange` only
   * when the result differs, so per-frame or no-op calls stay quiet.
   */
  _applyView(): TPFResolvedView {
    const previous = this._resolvedView;
    const view = this._resolveCurrentView();
    this._resolvedView = view;

    if (this.renderer) this.renderer.setSize(view.internal.width, view.internal.height);
    if (this.camera) this.camera.updateProjection(view.fov.vertical, view.aspect, view.near, view.far);

    if (!previous || JSON.stringify(previous) !== JSON.stringify(view)) {
      this.events.emit('viewchange', view);
    }
    return view;
  }

  boot(): void {
    const bootConfig = (this.pluginManager.get('TwoPointFivePlugin') as TwoPointFivePlugin | null)?.viewConfig;
    if (bootConfig) this._viewState = mergeViewConfig(this._viewState, bootConfig);

    const game = this.game;
    if (game.renderer && (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl) {
      this._initRenderer((game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
    } else {
      this.scene.sys.events.once('start', () => {
        if (game.renderer && (game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl) {
          this._initRenderer((game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
        }
      });
    }
    this.scene.sys.events.on('start', this._onSceneStart, this);
    this.scene.sys.events.on('shutdown', this.shutdown, this);
    this.scene.sys.events.on('destroy', this.destroy, this);
  }

  _onSceneStart(): void {
    this.scene.sys.events.off('postupdate', this._onScenePostUpdate, this);
    this.scene.sys.events.on('postupdate', this._onScenePostUpdate, this);
    if (!this.inputController) this.inputController = new TwoPointFiveInputController(this.scene);
    if (!this.soundController) this.soundController = new TwoPointFiveSoundController(this.scene);
    if (!this.timeController) this.timeController = new TwoPointFiveTimeController(this.scene);
    this.timeController.bind();
    this.scene.scale.off('resize', this._onResize, this);
    this.scene.scale.on('resize', this._onResize, this);
  }

  _initRenderer(gl: WebGLRenderingContext): void {
    if (this.renderer) return;
    const globalPlugin = this.pluginManager.get('TwoPointFivePlugin') as TwoPointFivePlugin | null;
    const tpf = globalPlugin?.TPF ? globalPlugin.TPF : TPF;
    this.renderer = new tpf.Renderer(gl, this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer);
    this.renderer.whiteTexture = this._getTextureWrapper('__WHITE');
    const view = this._resolveCurrentView();
    this.renderer.setSize(view.internal.width, view.internal.height);
    this.camera = new tpf.PerspectiveCamera(view.fov.vertical, view.aspect, view.near, view.far);
    this.camera.depthTest = true;
    // The blit keeps every texel: the base shader's alpha discard exists to stop billboard cutouts
    // writing depth, which is meaningless for a full-screen copy and would punch holes in it.
    this.renderer.registerMaterial(BLIT_MATERIAL.key, { alphaDiscard: false });
    this.gameState = new tpf.GameState(this._getGameContext());
    this._applyView();
  }

  _getGameContext(): GameContext {
    if (this._gameContext) {
      this._gameContext.renderer = this.renderer;
      this._gameContext.camera = this.camera;
      this._gameContext.displayAdapter = this.entityDisplayAdapter;
      return this._gameContext;
    }
    this._gameContext = {
      renderer: this.renderer,
      camera: this.camera,
      entityClasses: this.entityClasses,
      backgroundAnims: this.backgroundAnims,
      displayAdapter: this.entityDisplayAdapter,
      gravity: this.gravity,
      tick: 1 / 60,
      getTileset: (name: string) => this.tilesets[name] || null,
      getLightMapPixels: (name: string) => this.lightMapPixels[name] || null,
      // True horizontal FOV, not fov * aspect: that approximation over-estimates above aspect 1.0
      // (harmless over-draw) but under-estimates below it, which culls sectors that are still on
      // screen and makes geometry pop at the left and right edges in tall viewports.
      horizontalFov: () => this.getView().fov.horizontal,
    };
    return this._gameContext;
  }

  _onResize(): void {
    if (!this.renderer || !this.camera) return;
    this._applyView();
  }

  registerEntityClass(
    typeName: string,
    Class: new (x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity,
  ): void {
    this.entityClasses[typeName] = Class;
  }

  _resolveSourceImage(imageOrTexture: PhaserTextureInput): HTMLImageElement | HTMLCanvasElement | null {
    const texture = typeof imageOrTexture === 'string' ? this.scene.textures.get(imageOrTexture) : imageOrTexture;
    const img =
      'getSourceImage' in texture && texture.getSourceImage
        ? (texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement)
        : (texture as unknown as HTMLImageElement);
    return img || null;
  }

  /** Returns the Phaser-managed GL texture wrapper for a texture key or Texture object. */
  _getTextureWrapper(keyOrTexture: PhaserTextureInput): TPFTexture | null {
    const texture =
      typeof keyOrTexture === 'string'
        ? this.scene.textures.exists(keyOrTexture)
          ? this.scene.textures.get(keyOrTexture)
          : null
        : (keyOrTexture as Phaser.Textures.Texture);
    const source = texture && 'source' in texture ? texture.source[0] : null;
    return source?.glTexture || null;
  }

  setTileset(name: string, imageOrTexture: PhaserTextureInput): TilesetInfo | null {
    if (!this.renderer) return null;
    const img = this._resolveSourceImage(imageOrTexture);
    if (!img) return null;
    const globalPlugin = this.pluginManager.get('TwoPointFivePlugin') as TwoPointFivePlugin | null;
    const tpf = globalPlugin?.TPF ? globalPlugin.TPF : TPF;
    const expanded = tpf.expandSeams(img as HTMLImageElement, 64);
    // The seam-expanded canvas is registered with Phaser's TextureManager so the GL texture is
    // Phaser-managed (context-loss safe). Textures persist across scene restarts, so reuse the key.
    let texture: TPFTexture | null = null;
    if (expanded.canvas) {
      const seamKey = `__tpf_seams_${name}`;
      if (!this.scene.textures.exists(seamKey)) {
        this.scene.textures.addCanvas(seamKey, expanded.canvas);
      }
      texture = this._getTextureWrapper(seamKey);
    }
    if (!texture) texture = this._getTextureWrapper(imageOrTexture);
    if (!texture) return null;
    this.tilesets[name] = {
      texture,
      width: img.width,
      height: img.height,
      textureWidth: expanded.textureWidth || img.width,
      textureHeight: expanded.textureHeight || img.height,
      seamsExpanded: expanded.seamsExpanded,
    };
    return this.tilesets[name];
  }

  setLightMapPixels(name: string, imageData: LightMapPixels): void {
    this.lightMapPixels[name] = imageData;
  }

  loadLevel(data: import('./types.ts').LevelData): void {
    if (!this.gameState) return;
    this.gameState.context = this._getGameContext();
    this.gameState.sectorSize = this.sectorSize;
    this.gameState.loadLevel(data);
  }

  _onScenePostUpdate(_time: number, delta: number): void {
    this.update(delta);
  }

  update(delta?: number): void {
    if (!this.gameState?.entities) return;
    const tick = (delta || this.game.loop.delta) / 1000;
    const ctx = this.gameState.context;
    if (ctx) ctx.tick = tick;
    const entities = this.gameState.entities.slice();
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      if (!ent._killed && ent.update) {
        if (ent.context) ent.context.tick = tick;
        ent.update();
      }
    }
    this.gameState.checkEntities();

    this.gameState.entities = this.gameState.entities.filter((e) => !e._killed);
  }

  createExtern(): TpfExtern {
    const ext = new TpfExtern(this.scene, this);
    this.scene.add.existing(ext);
    this.extern = ext;
    return ext;
  }

  getExtern(): TpfExtern | null {
    return this.extern;
  }

  /**
   * Attach a managed depth renderbuffer to the currently bound framebuffer, sized to match it.
   * Used by TpfExtern when the world renders into a color-only off-screen filter framebuffer, so
   * depth testing (and therefore wall/entity occlusion) keeps working while a world filter is active.
   */
  _attachFilterDepthBuffer(gl: WebGLRenderingContext, width: number, height: number): void {
    if (!this._filterDepthBuffer || this._filterDepthWidth !== width || this._filterDepthHeight !== height) {
      if (this._filterDepthBuffer) gl.deleteRenderbuffer(this._filterDepthBuffer);
      this._filterDepthBuffer = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, this._filterDepthBuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);
      this._filterDepthWidth = width;
      this._filterDepthHeight = height;
    }
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._filterDepthBuffer);
  }

  _detachFilterDepthBuffer(gl: WebGLRenderingContext): void {
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, null);
  }

  /**
   * Returns the off-screen colour+depth target for the given size, creating or recreating it when
   * the size or filtering changes. Both resources are Phaser-managed, so context loss is handled by
   * the same machinery as every other engine texture.
   */
  _ensureWorldTarget(width: number, height: number, filter: 'nearest' | 'linear'): WorldTarget | null {
    if (!this.renderer) return null;
    const existing = this._worldTarget;
    if (existing?.width === width && existing.height === height && existing.filter === filter) {
      return existing;
    }
    this._destroyWorldTarget();

    const phaserRenderer = this.renderer.phaserRenderer;
    const gl = this.renderer.gl;
    const glFilter = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
    // flipY false: this texture is rendered into by GL rather than uploaded from an image, so it is
    // already bottom-up and the blit's UVs are set to match.
    const texture = phaserRenderer.createTexture2D(
      0,
      glFilter,
      glFilter,
      gl.CLAMP_TO_EDGE,
      gl.CLAMP_TO_EDGE,
      gl.RGBA,
      // Null pixels allocates empty storage at width x height. Phaser's typings require an object
      // here, but the runtime explicitly handles null (see WebGLTextureWrapper).
      null as unknown as object,
      width,
      height,
      false,
      true,
      false,
    );
    // addDepthBuffer: the world depth-tests against itself inside this target, so it needs its own
    // depth attachment. (No stencil: WebGL1 cannot combine a separate depth and stencil renderbuffer.)
    const framebuffer = phaserRenderer.createFramebuffer(texture, false, true);

    this._worldTarget = { texture, framebuffer, width, height, filter };
    return this._worldTarget;
  }

  _destroyWorldTarget(): void {
    const target = this._worldTarget;
    if (!target) return;
    target.framebuffer.destroy();
    target.texture.destroy();
    this._worldTarget = null;
  }

  /**
   * Draws the off-screen world onto the screen as one full-screen quad. The GL viewport is already
   * the world rectangle, and the blit uses identity matrices, so the quad's normalised device
   * coordinates land exactly on that rectangle with no further transform.
   */
  _blitWorldTarget(target: WorldTarget): void {
    const renderer = this.renderer!;
    if (!this._blitQuad) {
      this._blitQuad = new Quad(2, 2);
      // The default UVs compensate for Phaser's UNPACK_FLIP_Y uploads. A render target is written
      // by GL bottom-up, so the blit samples it unflipped instead.
      this._blitQuad.setUV(0, 0, 1, 1);
      this._blitQuad.material = BLIT_MATERIAL;
    }
    this._blitQuad.texture = target.texture;

    const glWrapper = renderer.phaserRenderer.glWrapper;
    glWrapper.updateDepthTest({ depthTest: false });
    renderer.depthTest = false;

    renderer.node.setCamera(IDENTITY_MATRIX, IDENTITY_MATRIX);
    renderer.pushQuad(this._blitQuad);
    renderer.flush();
  }

  /**
   * Enables Phaser Filters on the world Extern and returns its `internal`/`external` filter
   * lists. Lets callers post-process the rendered 2.5D world the idiomatic Phaser 4 way, e.g.
   * `scene.tpf.enableWorldFilters()?.internal.addColorMatrix().grayscale()`. The lists also
   * accept custom `Phaser.Filters.Controller` subclasses for bespoke shaders. Returns null if
   * the Extern has not been created yet (call after createExtern).
   */
  enableWorldFilters(): Phaser.Types.GameObjects.FiltersInternalExternal | null {
    if (!this.extern) return null;
    this.extern.enableFilters();
    return this.extern.filters;
  }

  /**
   * Renders the world into whatever framebuffer is currently bound. Shared by the Extern path
   * (renderToGL) and the standalone path (draw) so both stay in step; the caller is responsible
   * for binding the target first.
   *
   * targetWidth/targetHeight default to the canvas size and exist so a caller rendering into a
   * differently-sized target (a padded filter context) can say so. outputFramebuffer is the
   * framebuffer to return to after an off-screen pass; null means the canvas.
   */
  _renderWorld(
    targetWidth?: number,
    targetHeight?: number,
    outputFramebuffer?: Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper | null,
  ): void {
    if (!this.gameState || !this.renderer) return;
    if (!this.renderer.whiteTexture) {
      this.renderer.whiteTexture = this._getTextureWrapper('__WHITE');
    }

    // All GL state changes go through Phaser's state tracker (glWrapper), so nothing needs to be
    // saved or restored by hand: the Extern render is followed by Phaser's RebindContext node,
    // which re-establishes bindings from tracked state. Depth test and scissor are the exceptions —
    // Phaser's 2D pass never sets them, so both are restored at the end of the pass.
    const glWrapper = this.renderer.phaserRenderer.glWrapper;
    const view = this.getView();
    const width = targetWidth || view.canvas.width;
    const height = targetHeight || view.canvas.height;

    // Place the world rectangle in the render target. A filter that requests padding renders into a
    // larger context and offsets the scene within it; the built-in padded filters (blur, glow) pad
    // symmetrically, so centring the rectangle in the target lands it correctly and is exact when
    // there is no padding at all.
    const rect = view.world;
    const offsetX = (width - view.canvas.width) / 2;
    const offsetY = (height - view.canvas.height) / 2;
    // GL's viewport and scissor are y-up from the bottom; TPFRect is y-down from the top so it can
    // be used directly for Phaser HUD coordinates.
    const glX = Math.round(rect.x + offsetX);
    const glY = Math.round(height - (rect.y + offsetY + rect.height));
    const coversTarget = glX === 0 && glY === 0 && rect.width === width && rect.height === height;

    // When the world renders at its own resolution it goes into an off-screen target first, filling
    // it completely, and is scaled onto the world rectangle afterwards.
    const target = view.offscreen
      ? this._ensureWorldTarget(view.internal.width, view.internal.height, view.filter)
      : null;
    if (!target) this._destroyWorldTarget();

    if (target) {
      glWrapper.updateBindingsFramebuffer(glState({ bindings: { framebuffer: target.framebuffer } }), true);
      glWrapper.updateViewport(glState({ viewport: [0, 0, target.width, target.height] }));
      glWrapper.updateScissorEnabled(glState({ scissor: { enable: false } }));
    } else {
      glWrapper.updateViewport(glState({ viewport: [glX, glY, rect.width, rect.height] }));
      // gl.clear is bounded by the scissor box, not the viewport, so without this the world's colour
      // and depth clear would wipe the whole target including the letterbox bars.
      if (coversTarget) {
        glWrapper.updateScissorEnabled(glState({ scissor: { enable: false } }));
      } else {
        glWrapper.updateScissor(glState({ scissor: { enable: true, box: [glX, glY, rect.width, rect.height] } }));
      }
    }

    this.renderer.prepare();

    this.renderer.texture = null;
    if (this.renderer.fog) {
      this.renderer.setFog(this.renderer.fog.color, this.renderer.fog.near, this.renderer.fog.far);
    }

    const ctx = this.gameState.context;
    ctx.tick = (this.game.loop.delta || 16) / 1000;

    this.renderAdapter.renderFrame({
      renderer: this.renderer,
      gameState: this.gameState,
      camera: this.camera!,
    });

    if (target) {
      // Back to the caller's framebuffer, then scale the target onto the world rectangle. The
      // scissor matters here too: the blit quad covers the viewport exactly, but keeping the box
      // means a stray sample can never touch the bars.
      glWrapper.updateBindingsFramebuffer(glState({ bindings: { framebuffer: outputFramebuffer ?? null } }), true);
      glWrapper.updateViewport(glState({ viewport: [glX, glY, rect.width, rect.height] }));
      if (!coversTarget) {
        glWrapper.updateScissor(glState({ scissor: { enable: true, box: [glX, glY, rect.width, rect.height] } }));
      }
      this._blitWorldTarget(target);
    }

    glWrapper.updateDepthTest({ depthTest: false });
    this.renderer.depthTest = false;
    if (!coversTarget) {
      glWrapper.updateScissorEnabled(glState({ scissor: { enable: false } }));
    }
  }

  /** Renders the world into the currently bound framebuffer. Called by TpfExtern. */
  renderToGL(
    gl: WebGLRenderingContext,
    targetWidth?: number,
    targetHeight?: number,
    outputFramebuffer?: Phaser.Renderer.WebGL.Wrappers.WebGLFramebufferWrapper | null,
  ): void {
    if (!this.renderer && gl) {
      this._initRenderer(gl);
    }
    this._renderWorld(targetWidth, targetHeight, outputFramebuffer);
  }

  /** Renders the world straight to the canvas, for scenes driving the engine without an Extern. */
  draw(): void {
    if (!this.renderer && this.game.renderer && (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl) {
      this._initRenderer((this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
    }
    if (!this.renderer) return;
    this.renderer.phaserRenderer.glWrapper.updateBindingsFramebuffer(glState({ bindings: { framebuffer: null } }));
    this._renderWorld();
  }

  getCamera(): PerspectiveCamera | null {
    return this.camera;
  }

  getRenderer(): Renderer | null {
    if (this.renderer) return this.renderer;
    if (
      this.game.renderer &&
      (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl &&
      this.scene.sys.isActive()
    ) {
      this._initRenderer((this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
    }
    return this.renderer;
  }

  getGameState(): GameState | null {
    return this.gameState;
  }

  setEntityDisplayAdapter(adapter: TPFEntityDisplayAdapter): void {
    this.entityDisplayAdapter.shutdown();
    this.entityDisplayAdapter = adapter;
    if (this._gameContext) {
      this._gameContext.displayAdapter = adapter;
    }
  }

  getInputController(): TwoPointFiveInputController | null {
    if (!this.inputController && this.scene.sys.isActive()) {
      this.inputController = new TwoPointFiveInputController(this.scene);
    }
    return this.inputController;
  }

  getSoundController(): TwoPointFiveSoundController | null {
    if (!this.soundController && this.scene.sys.isActive()) {
      this.soundController = new TwoPointFiveSoundController(this.scene);
    }
    return this.soundController;
  }

  getTimeController(): TwoPointFiveTimeController | null {
    if (!this.timeController && this.scene.sys.isActive()) {
      this.timeController = new TwoPointFiveTimeController(this.scene);
      this.timeController.bind();
    }
    return this.timeController;
  }

  loadImage(phaserTexture: PhaserTextureInput): ImageInfo | null {
    if (!this.renderer) return null;
    const img = this._resolveSourceImage(phaserTexture);
    const glTexture = this._getTextureWrapper(phaserTexture);
    if (!img || !glTexture) return null;
    return {
      texture: glTexture,
      width: img.width,
      height: img.height,
    };
  }

  setFog(color: number, near: number, far: number): void {
    if (this.renderer) this.renderer.setFog(color, near, far);
  }

  /**
   * Registers a composable entity/quad material (GLSL uniforms + fragment body) with the
   * TPFQuadBatch render node. Apply it per entity via entity.setMaterial(key, uniforms).
   * The engine's fog is composed after the material body automatically.
   */
  registerMaterial(key: string, config: import('./renderer/tpf-quad-batch.ts').TPFMaterialConfig): void {
    this.getRenderer()?.registerMaterial(key, config);
  }

  shutdown(): void {
    // viewchange listeners typically capture Game Objects this shutdown destroys; keeping them
    // would leave stale references and would double up when a restarted scene subscribes again.
    this.events.removeAllListeners();
    this.renderAdapter.shutdown();
    this.entityDisplayAdapter.shutdown();
    this.inputController?.destroy();
    this.inputController = null;
    this.soundController?.clear();
    this.soundController = null;
    this.timeController?.unbind();
    this.timeController = null;
    this.extern = null;
    this.scene.sys.events.off('postupdate', this._onScenePostUpdate, this);
    this.scene.scale.off('resize', this._onResize, this);
  }

  destroy(): void {
    this.shutdown();
    this.events.removeAllListeners();
    this._destroyWorldTarget();
    this._blitQuad = null;
    if (this._filterDepthBuffer && this.renderer) {
      this.renderer.gl.deleteRenderbuffer(this._filterDepthBuffer);
      this._filterDepthBuffer = null;
    }
    this.renderer = null;
    this.camera = null;
    this.gameState = null;
  }
}

export { TwoPointFivePlugin, TwoPointFiveScenePlugin };

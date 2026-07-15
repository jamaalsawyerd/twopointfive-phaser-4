/**
 * Phaser integration: scene plugin (scene.tpf) and TpfExtern game object. The plugin loads levels,
 * runs entity updates from the Phaser scene lifecycle, and provides renderToGL for the Extern.
 */
import Phaser from 'phaser';
import * as TPF from './index.ts';
import type { ImageInfo, TilesetInfo, EntityContext, TPFTexture } from './types.ts';
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
    const offscreen = !!framebuffer?.webGLFramebuffer;
    if (offscreen) {
      tpf._attachFilterDepthBuffer(gl, drawingContext.width, drawingContext.height);
    }

    tpf.renderToGL(gl);

    if (offscreen) {
      tpf._detachFilterDepthBuffer(gl);
    }
  }
}

/**
 * Global plugin: registers the scene plugin and exposes TPF.
 */
class TwoPointFivePlugin extends Phaser.Plugins.BasePlugin {
  TPF: typeof TPF;

  constructor(pluginManager: Phaser.Plugins.PluginManager) {
    super(pluginManager);
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
  fov: number;
  sectorSize: number;
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
    this.fov = 75;
    this.sectorSize = 4;
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
  }

  // boot() runs only once per scene (Phaser registers it via once(BOOT)). Per-run state that
  // shutdown() tears down is set up in _onSceneStart, which fires on every start including
  // scene.restart(); otherwise restarting leaves the postupdate listener and controllers gone,
  // which freezes entity simulation (e.g. the player can't move after dying and restarting).
  boot(): void {
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
    const width = this.game.scale.width;
    const height = this.game.scale.height;
    this.renderer.setSize(width, height);
    this.camera = new tpf.PerspectiveCamera(this.fov, width / height, 1, 10000);
    this.camera.depthTest = true;
    this.gameState = new tpf.GameState(this._getGameContext());
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
      horizontalFov: () => this.fov * this.camera!.aspect,
    };
    return this._gameContext;
  }

  _onResize(gameSize: Phaser.Structs.Size): void {
    if (!this.renderer || !this.camera) return;
    const w = gameSize.width;
    const h = gameSize.height;
    this.renderer.setSize(w, h);
    this.camera.updateProjection(this.fov, w / h, 1, 10000);
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

  renderToGL(gl: WebGLRenderingContext): void {
    if (!this.gameState) return;
    if (!this.renderer && gl) {
      this._initRenderer(gl);
    }
    if (!this.renderer) return;
    if (!this.renderer.whiteTexture) {
      this.renderer.whiteTexture = this._getTextureWrapper('__WHITE');
    }

    // All GL state changes go through Phaser's state tracker (glWrapper), so nothing needs to be
    // saved or restored by hand: the Extern render is followed by Phaser's RebindContext node,
    // which re-establishes bindings from tracked state. Depth test is the exception — Phaser's 2D
    // pass never sets it, so it must be left disabled at the end of the pass.
    const glWrapper = this.renderer.phaserRenderer.glWrapper;
    glWrapper.updateViewport(glState({ viewport: [0, 0, this.renderer.width, this.renderer.height] }));
    glWrapper.updateScissorEnabled(glState({ scissor: { enable: false } }));

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

    glWrapper.updateDepthTest({ depthTest: false });
    this.renderer.depthTest = false;
  }

  draw(): void {
    if (!this.gameState) return;
    if (!this.renderer && this.game.renderer && (this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl) {
      this._initRenderer((this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer).gl);
    }
    if (!this.renderer) return;
    const glWrapper = this.renderer.phaserRenderer.glWrapper;
    glWrapper.updateBindingsFramebuffer(glState({ bindings: { framebuffer: null } }));
    glWrapper.updateViewport(glState({ viewport: [0, 0, this.renderer.width, this.renderer.height] }));
    glWrapper.updateScissorEnabled(glState({ scissor: { enable: false } }));
    this.renderer.prepare();
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

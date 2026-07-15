/**
 * WebGL renderer facade for the 2.5D world: batching, camera, fog, textures, and draw stats.
 * The shader programs, materials, vertex layout, and batch buffer are owned by the TPFQuadBatch
 * render node (registered with Phaser's RenderNodeManager at runtime); this class drives it from
 * GameState.draw(): setCamera() then draw quads (tiles, entities) with the active material.
 */
import Quad from './quad.ts';
import type PerspectiveCamera from './perspective-camera.ts';
import type Phaser from 'phaser';
import type { TPFTexture, TPFQuadMaterial } from '~/twopointfive/types.ts';
import { TPFQuadBatchNode, TPF_QUAD_BATCH_NODE, DEFAULT_MATERIAL } from './tpf-quad-batch.ts';
import type { TPFMaterialConfig } from './tpf-quad-batch.ts';

/**
 * Phaser's typings declare glWrapper state arrays as typed arrays, but the runtime (and Phaser's
 * own WebGLGlobalParametersFactory) uses plain number arrays. Cast through this helper.
 */
function glState(state: object): Phaser.Types.Renderer.WebGL.WebGLGlobalParameters {
  return state as Phaser.Types.Renderer.WebGL.WebGLGlobalParameters;
}
export { glState };

interface TileMeshLike {
  length: number;
  texture: TPFTexture | null;
  buffer: Float32Array;
}

export interface FogState {
  color: number;
  near: number;
  far: number;
}

class Renderer {
  bufferSize: number;
  buffer: Float32Array;
  texture: TPFTexture | null;
  bufferIndex: number;
  gl: WebGLRenderingContext;
  drawCalls: number;
  _currentDrawCalls: number;
  _currentQuadCount: number;
  quadCount: number;
  depthTest: boolean;
  wireframe: boolean;
  fog: FogState | null;
  fullscreenFlags: Record<string, unknown>;
  canvas: HTMLCanvasElement | null;
  /** The Phaser renderer that owns the program/buffer wrappers. */
  phaserRenderer: Phaser.Renderer.WebGL.WebGLRenderer;
  /** The render node owning programs, materials, vertex layout, and the batch buffer. */
  node: TPFQuadBatchNode;
  /** 1x1 white texture used for untextured quads; injected by the plugin (Phaser's __WHITE). */
  whiteTexture: TPFTexture | null;
  width: number;
  height: number;

  constructor(
    canvasOrGL: HTMLCanvasElement | WebGLRenderingContext,
    phaserRenderer: Phaser.Renderer.WebGL.WebGLRenderer,
  ) {
    this.texture = null;
    this.bufferIndex = 0;
    this.gl = null!;
    this.drawCalls = 0;
    this._currentDrawCalls = 0;
    this._currentQuadCount = 0;
    this.quadCount = 0;
    this.depthTest = true;
    this.wireframe = false;
    this.fog = null;
    this.fullscreenFlags = {};
    this.canvas = null;
    this.width = 0;
    this.height = 0;

    if (canvasOrGL && typeof (canvasOrGL as HTMLCanvasElement).getContext === 'function') {
      const canvas = canvasOrGL as HTMLCanvasElement;
      this.canvas = canvas;
      const webglOptions: WebGLContextAttributes = {
        alpha: false,
        premultipliedAlpha: false,
        antialias: false,
        stencil: false,
        preserveDrawingBuffer: true,
      };
      this.gl = (canvas.getContext('webgl', webglOptions) ||
        canvas.getContext('experimental-webgl', webglOptions)) as WebGLRenderingContext;
      this.setSize(canvas.width, canvas.height);
    } else if (canvasOrGL && (canvasOrGL as WebGLRenderingContext).canvas) {
      this.gl = canvasOrGL as WebGLRenderingContext;
      this.canvas = (canvasOrGL as WebGLRenderingContext).canvas as HTMLCanvasElement;
    } else if (canvasOrGL) {
      this.gl = canvasOrGL as WebGLRenderingContext;
      this.canvas = ((canvasOrGL as WebGLRenderingContext).canvas as HTMLCanvasElement) || null;
    }

    this.phaserRenderer = phaserRenderer;
    const nodes = phaserRenderer.renderNodes;
    if (!nodes.hasNode(TPF_QUAD_BATCH_NODE)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      nodes.addNodeConstructor(TPF_QUAD_BATCH_NODE, TPFQuadBatchNode as unknown as Function);
    }
    this.node = nodes.getNode(TPF_QUAD_BATCH_NODE) as TPFQuadBatchNode;
    this.node.init();
    this.bufferSize = this.node.bufferSize;
    this.buffer = this.node.buffer;
    this.node.activate(DEFAULT_MATERIAL, true);
    this.prepare();
    this.whiteTexture = null;
  }

  /** Registers a composable material (see TPFQuadBatchNode) usable via Quad.material. */
  registerMaterial(key: string, config: TPFMaterialConfig): void {
    this.node.registerMaterial(key, config);
  }

  setFog(color: number | false | undefined, near?: number, far?: number): void {
    this.flush();
    if (color === false || typeof color === 'undefined') {
      this.fog = null;
      this.node.setFog(null);
    } else {
      this.fog = { color, near: near!, far: far! };
      const c1 = ((color & 0xff0000) >> 16) / 255;
      const c2 = ((color & 0x00ff00) >> 8) / 255;
      const c3 = ((color & 0x0000ff) >> 0) / 255;
      this.node.setFog({ color: [c1, c2, c3], near: near!, far: far! });
    }
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.phaserRenderer.glWrapper.updateViewport(glState({ viewport: [0, 0, this.width, this.height] }));
  }

  /** Sets the clear color through Phaser's state tracker. */
  setClearColor(r: number, g: number, b: number, a: number): void {
    this.phaserRenderer.glWrapper.updateColorClearValue(glState({ colorClearValue: [r, g, b, a] }));
  }

  clear(color?: boolean, depth?: boolean, stencil?: boolean): void {
    this.gl.clear(
      (color ? this.gl.COLOR_BUFFER_BIT : 0) |
        (depth ? this.gl.DEPTH_BUFFER_BIT : 0) |
        (stencil ? this.gl.STENCIL_BUFFER_BIT : 0),
    );
  }

  prepare(): void {
    const gl = this.gl;
    const glWrapper = this.phaserRenderer.glWrapper;
    glWrapper.updateDepthTest({ depthTest: this.depthTest });
    glWrapper.updateBlend(
      glState({
        blend: {
          enabled: true,
          color: [0, 0, 0, 0],
          equation: [gl.FUNC_ADD, gl.FUNC_ADD],
          func: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA],
        },
      }),
    );
    this.node.activate(this.node.activeMaterial, true);
    this.setClearColor(0, 0, 0, 1);
  }

  flush(): void {
    if (this.bufferIndex === 0) return;
    this._currentDrawCalls++;
    this._currentQuadCount += this.bufferIndex;
    this.node.upload(this.bufferIndex);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, this.bufferIndex * Quad.VERTICES);
    this.bufferIndex = 0;
  }

  render(callback: (renderer: Renderer) => void): void {
    if (this.wireframe) this.clear(true, true, true);
    callback(this);
    this.flush();
    this.drawCalls = this._currentDrawCalls;
    this.quadCount = this._currentQuadCount;
    this._currentDrawCalls = 0;
    this._currentQuadCount = 0;
  }

  setCamera(camera: PerspectiveCamera): void {
    this.flush();
    this.node.setCamera(camera.view(), camera.projection());
    if (camera.depthTest !== this.depthTest) {
      this.depthTest = camera.depthTest;
      this.phaserRenderer.glWrapper.updateDepthTest({ depthTest: this.depthTest });
    }
  }

  setTexture(texture: TPFTexture | null): void {
    texture = texture || this.whiteTexture;
    if (!texture || texture === this.texture) return;
    this.flush();
    this.texture = texture;
    this.phaserRenderer.glTextureUnits.bind(texture, 0);
  }

  /** Activates a quad material (null means the default); flushes if the material changes. */
  setMaterial(material: TPFQuadMaterial | null): void {
    const next = material || DEFAULT_MATERIAL;
    const active = this.node.activeMaterial;
    if (next === active) return;
    // Same key with no per-quad uniforms renders identically — keep batching, don't flush.
    if (next.key === active.key && !next.uniforms && !active.uniforms) return;
    this.flush();
    this.node.activate(next);
  }

  pushQuad(quad: Quad): void {
    this.setMaterial(quad.material);
    this.setTexture(quad.texture);
    if (this.bufferIndex + 1 >= this.bufferSize) this.flush();
    quad.copyToBuffer(this.buffer, this.bufferIndex * Quad.SIZE);
    this.bufferIndex++;
  }

  pushMesh(mesh: TileMeshLike): void {
    this.flush();
    this.setMaterial(null);
    this.setTexture(mesh.texture);
    this._currentQuadCount += mesh.length;
    const polygonMode = this.wireframe ? this.gl.LINES : this.gl.TRIANGLES;
    // Meshes upload through the shared Phaser-managed buffer, in chunks if they exceed it.
    let offset = 0;
    while (offset < mesh.length) {
      const chunk = Math.min(mesh.length - offset, this.bufferSize);
      this.buffer.set(mesh.buffer.subarray(offset * Quad.SIZE, (offset + chunk) * Quad.SIZE));
      this.node.upload(chunk);
      this.gl.drawArrays(polygonMode, 0, chunk * Quad.VERTICES);
      this._currentDrawCalls++;
      offset += chunk;
    }
  }
}

export default Renderer;

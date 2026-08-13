/**
 * TPFQuadBatch: a Phaser RenderNode that owns the 2.5D engine's shader programs, materials,
 * vertex layout, and batch buffer. Registered with Phaser's RenderNodeManager at runtime by the
 * Renderer, so shaders live in the same registry as Phaser's own nodes (and the wavy filter node).
 *
 * Materials are composable fragment-shader fragments: a material contributes uniform declarations
 * and a body that runs after the base texture*color is computed; the engine's fog snippet is
 * composed after the material body, so custom materials keep fog automatically. Programs are
 * compiled lazily per (material, fog on/off) and cached, each with its own VAO over the shared
 * vertex layout (pos vec3, uv vec2, color vec4).
 */
import Phaser from 'phaser';
import Quad from './quad.ts';
import type { TPFProgram, TPFQuadMaterial } from '~/twopointfive/types.ts';

export const TPF_QUAD_BATCH_NODE = 'TPFQuadBatch';

/** Shared material object for quads with no explicit material. */
export const DEFAULT_MATERIAL: TPFQuadMaterial = { key: 'default' };

/** A registered material: GLSL uniform declarations, a fragment body, and default uniform values. */
export interface TPFMaterialConfig {
  /** GLSL uniform declarations, e.g. 'uniform vec3 tintColor;'. */
  fragmentUniforms?: string;
  /** GLSL statements run after `gl_FragColor = tex * vColor;`; may modify gl_FragColor. */
  fragmentBody?: string;
  /** Default uniform values applied when the material is activated. */
  uniforms?: Record<string, number | number[]>;
  /**
   * Whether to discard nearly-transparent texels (the default, which is what keeps billboard
   * sprites from writing depth around their cutouts). Set false for materials that must keep every
   * texel, such as a full-screen blit or an additive effect.
   */
  alphaDiscard?: boolean;
}

interface ProgramSuite {
  program: TPFProgram;
  vao: Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper;
}

interface FogUniformState {
  color: [number, number, number];
  near: number;
  far: number;
}

const VertexShader = [
  'precision highp float;',
  'attribute vec3 pos;',
  'attribute vec2 uv;',
  'attribute vec4 color;',
  'varying vec4 vColor;',
  'varying vec2 vUv;',
  'uniform mat4 view;',
  'uniform mat4 projection;',
  'void main(void) {',
  '  vColor = color;',
  '  vUv = uv;',
  '  gl_Position = projection * view * vec4(pos, 1.0);',
  '}',
].join('\n');

/** Fog as a separable snippet: declarations and an application block composed into fragment shaders. */
const FogSnippets = {
  Uniforms: ['uniform vec3 fogColor;', 'uniform float fogNear;', 'uniform float fogFar;'].join('\n'),
  Apply: [
    '  float depth = gl_FragCoord.z / gl_FragCoord.w;',
    '  float fogFactor = smoothstep( fogFar, fogNear, depth );',
    '  fogFactor = 1.0 - clamp( fogFactor, 0.2, 1.0);',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor.rgb, fogFactor);',
  ].join('\n'),
};

function composeFragmentShader(material: TPFMaterialConfig, fog: boolean): string {
  return [
    'precision highp float;',
    'varying vec4 vColor;',
    'varying vec2 vUv;',
    'uniform sampler2D texture;',
    fog ? FogSnippets.Uniforms : '',
    material.fragmentUniforms || '',
    'void main(void) {',
    '  vec4 tex = texture2D(texture, vUv);',
    material.alphaDiscard === false ? '' : '  if( tex.a < 0.8 ) discard;',
    '  gl_FragColor = tex * vColor;',
    material.fragmentBody || '',
    fog ? FogSnippets.Apply : '',
    '}',
  ]
    .filter(Boolean)
    .join('\n');
}

export class TPFQuadBatchNode extends Phaser.Renderer.WebGL.RenderNodes.RenderNode {
  /** Capacity of the shared vertex buffer in quads; also the chunk size for mesh uploads. */
  bufferSize: number;
  /** CPU-side view over the vertex buffer; the Renderer writes quads here. */
  buffer: Float32Array;

  vertexLayout: Phaser.Renderer.WebGL.Wrappers.WebGLVertexBufferLayoutWrapper | null;
  _materials: Map<string, TPFMaterialConfig>;
  _suites: Map<string, ProgramSuite>;
  _activeSuite: ProgramSuite | null;
  _activeMaterial: TPFQuadMaterial;
  _view: Float32Array | null;
  _projection: Float32Array | null;
  _fog: FogUniformState | null;

  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(TPF_QUAD_BATCH_NODE, manager);
    this.bufferSize = 2048;
    this.buffer = null!;
    this.vertexLayout = null;
    this._materials = new Map([['default', {}]]);
    this._suites = new Map();
    this._activeSuite = null;
    this._activeMaterial = DEFAULT_MATERIAL;
    this._view = null;
    this._projection = null;
    this._fog = null;
  }

  get phaserRenderer(): Phaser.Renderer.WebGL.WebGLRenderer {
    return this.manager.renderer;
  }

  /** Creates the shared vertex layout/buffer on first use. */
  init(): void {
    if (this.vertexLayout) return;
    const Wrappers = Phaser.Renderer.WebGL.Wrappers;
    // The runtime constructor is (renderer, layout, buffer?); the published typings list an extra
    // program parameter that the implementation does not take, so cast to the real signature.
    const LayoutWrapper = Wrappers.WebGLVertexBufferLayoutWrapper as unknown as new (
      renderer: Phaser.Renderer.WebGL.WebGLRenderer,
      layout: object,
      buffer?: Phaser.Renderer.WebGL.Wrappers.WebGLBufferWrapper,
    ) => Phaser.Renderer.WebGL.Wrappers.WebGLVertexBufferLayoutWrapper;
    this.vertexLayout = new LayoutWrapper(this.phaserRenderer, {
      usage: 'DYNAMIC_DRAW',
      count: this.bufferSize * Quad.VERTICES,
      layout: [
        { name: 'pos', size: 3, type: 'FLOAT', normalized: false },
        { name: 'uv', size: 2, type: 'FLOAT', normalized: false },
        { name: 'color', size: 4, type: 'FLOAT', normalized: false },
      ],
    });
    this.buffer = new Float32Array(this.vertexLayout.buffer.dataBuffer);
  }

  /**
   * Registers (or replaces) a material. Programs are compiled lazily on first use.
   * Replacing a material invalidates its cached programs.
   */
  registerMaterial(key: string, config: TPFMaterialConfig): void {
    this._materials.set(key, config);
    this._suites.delete(`${key}|plain`);
    this._suites.delete(`${key}|fog`);
  }

  hasMaterial(key: string): boolean {
    return this._materials.has(key);
  }

  _getSuite(key: string, fog: boolean): ProgramSuite {
    const suiteKey = `${key}|${fog ? 'fog' : 'plain'}`;
    let suite = this._suites.get(suiteKey);
    if (suite) return suite;
    let material = this._materials.get(key);
    if (!material) {
      console.warn(`TPFQuadBatch: unknown material "${key}", falling back to default`);
      material = this._materials.get('default')!;
    }
    this.init();
    const renderer = this.phaserRenderer;
    const program = renderer.createProgram(VertexShader, composeFragmentShader(material, fog));
    program.setUniform('texture', 0);
    const vao = new Phaser.Renderer.WebGL.Wrappers.WebGLVAOWrapper(renderer, program, undefined, [this.vertexLayout!]);
    suite = { program, vao };
    this._suites.set(suiteKey, suite);
    return suite;
  }

  /** Uploads pending quads from the batch buffer to the GPU. */
  upload(quadCount: number): void {
    this.vertexLayout!.buffer.update(quadCount * Quad.SIZE * Float32Array.BYTES_PER_ELEMENT);
  }

  /** Stores camera matrices and applies them to the active program. */
  setCamera(view: Float32Array, projection: Float32Array): void {
    this._view = view;
    this._projection = projection;
    if (this._activeSuite) {
      this._activeSuite.program.setUniform('view', view);
      this._activeSuite.program.setUniform('projection', projection);
      this._activeSuite.program.bind();
    }
  }

  /** Enables fog (uniform state) or disables it (null); reactivates the current material. */
  setFog(fog: FogUniformState | null): void {
    this._fog = fog;
    this.activate(this._activeMaterial, true);
  }

  /**
   * Activates a material: selects (or compiles) the program for the current fog state, applies
   * camera/fog/material uniforms, binds the program and its VAO. The caller must flush first.
   */
  activate(material: TPFQuadMaterial, force?: boolean): void {
    if (!force && material === this._activeMaterial && this._activeSuite) return;
    const suite = this._getSuite(material.key, !!this._fog);
    this._activeSuite = suite;
    this._activeMaterial = material;
    const program = suite.program;
    if (this._view) program.setUniform('view', this._view);
    if (this._projection) program.setUniform('projection', this._projection);
    if (this._fog) {
      program.setUniform('fogColor', this._fog.color);
      program.setUniform('fogNear', this._fog.near);
      program.setUniform('fogFar', this._fog.far);
    }
    const config = this._materials.get(material.key);
    if (config?.uniforms) {
      for (const name in config.uniforms) program.setUniform(name, config.uniforms[name]);
    }
    if (material.uniforms) {
      for (const name in material.uniforms) program.setUniform(name, material.uniforms[name]);
    }
    program.bind();
    this.phaserRenderer.glWrapper.updateVAO({ vao: suite.vao });
  }

  get activeMaterial(): TPFQuadMaterial {
    return this._activeMaterial;
  }
}

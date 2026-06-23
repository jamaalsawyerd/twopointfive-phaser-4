/**
 * Example custom world filter: a CRT effect (animated scanlines + vignette) that demonstrates how
 * to add a bespoke GLSL shader over the rendered 2.5D world using Phaser 4's Filters system.
 *
 * A Phaser 4 filter has two halves:
 *   - a RenderNode (the shader side, `FilterCRTRenderNode`) that owns the GLSL and sets uniforms, and
 *   - a Controller (the parameter side, `CRTFilterController`) that lives in a Game Object's filter list.
 * They are linked by a shared node name (`CRT_FILTER_NODE`). The render node must be registered with
 * the renderer once via the game config's `render.renderNodes` map.
 *
 * Usage (see MainScene's 'F' key toggle):
 *   const filters = scene.tpf.enableWorldFilters();
 *   filters?.internal.add(new CRTFilterController(filters.internal.camera));
 */
import Phaser from 'phaser';

/** Shared name linking the controller to its render node; also the render-node registration key. */
export const CRT_FILTER_NODE = 'FilterCRT';

// Filter fragment shaders follow Phaser 4's template: the first line is the shaderName pragma, the
// input image is `uMainSampler`, and the screen-space UV is the `outTexCoord` varying (0..1).
const FRAGMENT_SHADER = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uResolution;',
  'uniform float uIntensity;',
  'uniform float uTime;',
  'varying vec2 outTexCoord;',
  'void main () {',
  '  vec4 color = texture2D(uMainSampler, outTexCoord);',
  '  // Scanlines: darken alternating rows, scrolling slowly over time.',
  '  float scan = sin((outTexCoord.y * uResolution.y * 0.5) - uTime * 3.0);',
  '  color.rgb *= 1.0 - uIntensity * 0.35 * (0.5 + 0.5 * scan);',
  '  // Vignette toward the edges.',
  '  vec2 d = outTexCoord - 0.5;',
  '  float vignette = smoothstep(0.75, 0.25, dot(d, d) * 2.0);',
  '  color.rgb *= mix(1.0, vignette, uIntensity * 0.5);',
  '  gl_FragColor = color;',
  '}',
].join('\n');

/**
 * The shader side of the CRT filter. Registered under `CRT_FILTER_NODE` via the game config and
 * constructed automatically by the renderer when a `CRTFilterController` is active.
 */
export class FilterCRTRenderNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(CRT_FILTER_NODE, manager, undefined, FRAGMENT_SHADER);
  }

  setupUniforms(controller: Phaser.Filters.Controller, drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    const pm = this.programManager;
    const crt = controller as CRTFilterController;
    // Drive the animation from the engine clock so the effect is self-contained (no per-frame wiring).
    const time = this.manager.renderer.game.loop.time / 1000;
    pm.setUniform('uResolution', [drawingContext.width, drawingContext.height]);
    pm.setUniform('uIntensity', crt.intensity);
    pm.setUniform('uTime', time);
  }
}

/**
 * The parameter side of the CRT filter. Add an instance to a filter list to activate the effect;
 * toggle it later via `controller.active`. `intensity` (0..1) scales scanline + vignette strength.
 */
export class CRTFilterController extends Phaser.Filters.Controller {
  intensity: number;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, intensity = 1) {
    super(camera, CRT_FILTER_NODE);
    this.intensity = intensity;
  }
}

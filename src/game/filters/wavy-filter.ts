/**
 * Example custom world filter: a wavy effect (animated sine-wave UV displacement, like heat haze or
 * being underwater) that demonstrates how to add a bespoke GLSL shader over the rendered 2.5D world
 * using Phaser 4's Filters system.
 *
 * A Phaser 4 filter has two halves:
 *   - a RenderNode (the shader side, `FilterWavyRenderNode`) that owns the GLSL and sets uniforms, and
 *   - a Controller (the parameter side, `WavyFilterController`) that lives in a Game Object's filter list.
 * They are linked by a shared node name (`WAVY_FILTER_NODE`). The render node must be registered with
 * the renderer once via the game config's `render.renderNodes` map.
 *
 * Usage (see MainScene's 'F' key toggle):
 *   const filters = scene.tpf.enableWorldFilters();
 *   filters?.internal.add(new WavyFilterController(filters.internal.camera));
 */
import Phaser from 'phaser';

/** Shared name linking the controller to its render node; also the render-node registration key. */
export const WAVY_FILTER_NODE = 'FilterWavy';

// Filter fragment shaders follow Phaser 4's template: the first line is the shaderName pragma, the
// input image is `uMainSampler`, and the screen-space UV is the `outTexCoord` varying (0..1).
const FRAGMENT_SHADER = [
  '#pragma phaserTemplate(shaderName)',
  'precision mediump float;',
  'uniform sampler2D uMainSampler;',
  'uniform vec2 uResolution;',
  'uniform float uIntensity;',
  'uniform float uAmplitude;',
  'uniform float uFrequency;',
  'uniform float uSpeed;',
  'uniform float uTime;',
  'varying vec2 outTexCoord;',
  'void main () {',
  "  // Displace each pixel's sample position with two perpendicular sine waves. Amplitude is",
  '  // specified in pixels and converted per-axis so the wobble is aspect-ratio independent.',
  '  vec2 amp = uIntensity * uAmplitude / uResolution;',
  '  vec2 uv = outTexCoord;',
  '  uv.x += sin(uv.y * uFrequency + uTime * uSpeed) * amp.x;',
  '  // Slightly detuned frequency/speed on the other axis so the motion never visibly loops.',
  '  uv.y += cos(uv.x * uFrequency * 0.8 + uTime * uSpeed * 1.3) * amp.y;',
  '  // Clamp so displaced samples never wrap to the opposite screen edge.',
  '  gl_FragColor = texture2D(uMainSampler, clamp(uv, 0.0, 1.0));',
  '}',
].join('\n');

/**
 * The shader side of the wavy filter. Registered under `WAVY_FILTER_NODE` via the game config and
 * constructed automatically by the renderer when a `WavyFilterController` is active.
 */
export class FilterWavyRenderNode extends Phaser.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager: Phaser.Renderer.WebGL.RenderNodes.RenderNodeManager) {
    super(WAVY_FILTER_NODE, manager, undefined, FRAGMENT_SHADER);
  }

  setupUniforms(controller: Phaser.Filters.Controller, drawingContext: Phaser.Renderer.WebGL.DrawingContext): void {
    const pm = this.programManager;
    const wavy = controller as WavyFilterController;
    // Drive the animation from the engine clock so the effect is self-contained (no per-frame wiring).
    const time = this.manager.renderer.game.loop.time / 1000;
    pm.setUniform('uResolution', [drawingContext.width, drawingContext.height]);
    pm.setUniform('uIntensity', wavy.intensity);
    pm.setUniform('uAmplitude', wavy.amplitude);
    pm.setUniform('uFrequency', wavy.frequency);
    pm.setUniform('uSpeed', wavy.speed);
    pm.setUniform('uTime', time);
  }
}

/**
 * The parameter side of the wavy filter. Add an instance to a filter list to activate the effect;
 * toggle it later via `controller.active`. `intensity` (0..1) scales the overall displacement,
 * `amplitude` is the maximum displacement in pixels, `frequency` is the wave count across the
 * screen (in radians), and `speed` is the scroll rate of the waves.
 */
export class WavyFilterController extends Phaser.Filters.Controller {
  intensity: number;
  amplitude: number;
  frequency: number;
  speed: number;

  constructor(camera: Phaser.Cameras.Scene2D.Camera, intensity = 1, amplitude = 8, frequency = 24, speed = 2) {
    super(camera, WAVY_FILTER_NODE);
    this.intensity = intensity;
    this.amplitude = amplitude;
    this.frequency = frequency;
    this.speed = speed;
  }
}

/**
 * WebGL renderer for the 2.5D world: shaders, buffer batching, camera/projection, fog, and draw.
 * Used by the plugin and GameState.draw(); setCamera() then draw quads (tiles, entities) with the active program.
 */
import Program from './program.ts';
import Quad from './quad.ts';
import type OrthoCamera from './ortho-camera.ts';
import type PerspectiveCamera from './perspective-camera.ts';

interface TileMeshLike {
  length: number;
  texture: WebGLTexture | null;
  buffer: Float32Array;
}

const Shaders = {
  Vertex: [
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
  ].join('\n'),
  Fragment: [
    'precision highp float;',
    'varying vec4 vColor;',
    'varying vec2 vUv;',
    'uniform sampler2D texture;',
    'void main(void) {',
    '  vec4 tex = texture2D(texture, vUv);',
    '  if( tex.a < 0.8 ) discard;',
    '  gl_FragColor = tex * vColor;',
    '}',
  ].join('\n'),
  FragmentWithFog: [
    'precision highp float;',
    'varying vec4 vColor;',
    'varying vec2 vUv;',
    'uniform sampler2D texture;',
    'uniform vec3 fogColor;',
    'uniform float fogNear;',
    'uniform float fogFar;',
    'void main(void) {',
    '  float depth = gl_FragCoord.z / gl_FragCoord.w;',
    '  float fogFactor = smoothstep( fogFar, fogNear, depth );',
    '  fogFactor = 1.0 - clamp( fogFactor, 0.2, 1.0);',
    '  vec4 tex = texture2D(texture, vUv);',
    '  if( tex.a < 0.8 ) discard;',
    '  gl_FragColor = tex * vColor;',
    '  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor.rgb, fogFactor);',
    '}',
  ].join('\n'),
};

export interface FogState {
  color: number;
  near: number;
  far: number;
}

class Renderer {
  static Shaders = Shaders;

  bufferSize: number;
  buffer: Float32Array;
  texture: WebGLTexture | null;
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
  programDefault: Program;
  programFog: Program;
  program: Program;
  glBuffer: WebGLBuffer;
  whiteTexture: WebGLTexture;
  width: number;
  height: number;

  constructor(canvasOrGL: HTMLCanvasElement | WebGLRenderingContext) {
    this.bufferSize = 64;
    this.buffer = null!;
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

    this.programDefault = new Program(this.gl, Shaders.Vertex, Shaders.Fragment);
    this.programFog = new Program(this.gl, Shaders.Vertex, Shaders.FragmentWithFog);
    this.program = this.programDefault;
    this.buffer = new Float32Array(this.bufferSize * Quad.SIZE);
    this.glBuffer = this.gl.createBuffer()!;
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.glBuffer);
    this.prepare();
    this.whiteTexture = this.loadTexture(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 1, 1);
    this.setProgram(this.programDefault);
  }

  setFog(color: number | false | undefined, near?: number, far?: number): void {
    if (color === false || typeof color === 'undefined') {
      this.setProgram(this.programDefault, true);
      this.fog = null;
    } else {
      this.setProgram(this.programFog, true);
      this.fog = { color, near: near!, far: far! };
      const c1 = ((color & 0xff0000) >> 16) / 255;
      const c2 = ((color & 0x00ff00) >> 8) / 255;
      const c3 = ((color & 0x0000ff) >> 0) / 255;
      this.gl.uniform3f(this.program.uniform.fogColor, c1, c2, c3);
      this.gl.uniform1f(this.program.uniform.fogNear, near!);
      this.gl.uniform1f(this.program.uniform.fogFar, far!);
    }
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.gl.viewport(0, 0, this.width, this.height);
  }

  loadTexture(
    img: HTMLImageElement | HTMLCanvasElement | ImageBitmap | Uint8Array,
    width?: number,
    height?: number,
  ): WebGLTexture {
    const texture = this.gl.createTexture();
    const previousFlipY = this.gl.getParameter(this.gl.UNPACK_FLIP_Y_WEBGL) as boolean;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false);
    if (img instanceof Uint8Array && width && height) {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        width,
        height,
        0,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img,
      );
    } else {
      this.gl.texImage2D(
        this.gl.TEXTURE_2D,
        0,
        this.gl.RGBA,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
        img as TexImageSource,
      );
    }
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, previousFlipY);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.bindTexture(this.gl.TEXTURE_2D, null);
    this.texture = null;
    return texture;
  }

  clear(color?: boolean, depth?: boolean, stencil?: boolean): void {
    this.gl.clear(
      (color ? this.gl.COLOR_BUFFER_BIT : 0) |
        (depth ? this.gl.DEPTH_BUFFER_BIT : 0) |
        (stencil ? this.gl.STENCIL_BUFFER_BIT : 0),
    );
  }

  prepare(): void {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.glBuffer);
    this.gl.enable(this.gl.DEPTH_TEST);
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
    this.gl.useProgram(this.program.program);
    this.gl.clearColor(0, 0, 0, 1);
    const floatSize = Float32Array.BYTES_PER_ELEMENT;
    const vertSize = floatSize * Quad.VERTEX_SIZE;
    this.gl.enableVertexAttribArray(this.program.attribute.pos);
    this.gl.vertexAttribPointer(this.program.attribute.pos, 3, this.gl.FLOAT, false, vertSize, 0 * floatSize);
    this.gl.enableVertexAttribArray(this.program.attribute.uv);
    this.gl.vertexAttribPointer(this.program.attribute.uv, 2, this.gl.FLOAT, false, vertSize, 3 * floatSize);
    this.gl.enableVertexAttribArray(this.program.attribute.color);
    this.gl.vertexAttribPointer(this.program.attribute.color, 4, this.gl.FLOAT, false, vertSize, 5 * floatSize);
  }

  flush(): void {
    if (this.bufferIndex === 0) return;
    this._currentDrawCalls++;
    this._currentQuadCount += this.bufferIndex;
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.buffer, this.gl.DYNAMIC_DRAW);
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

  setCamera(camera: PerspectiveCamera | OrthoCamera): void {
    this.flush();
    this.gl.uniformMatrix4fv(this.program.uniform.projection, false, camera.projection());
    this.gl.uniformMatrix4fv(this.program.uniform.view, false, camera.view());
    if (camera.depthTest !== this.depthTest) {
      this.depthTest = camera.depthTest;
      if (this.depthTest) this.gl.enable(this.gl.DEPTH_TEST);
      else this.gl.disable(this.gl.DEPTH_TEST);
    }
  }

  setTexture(texture: WebGLTexture | null): void {
    texture = texture || this.whiteTexture;
    if (texture === this.texture) return;
    this.flush();
    this.texture = texture;
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
  }

  setProgram(program: Program, force?: boolean): void {
    if (program === this.program && !force) return;
    this.flush();
    this.program = program;
    this.gl.useProgram(this.program.program);
  }

  pushQuad(quad: Quad): void {
    this.setTexture(quad.texture);
    if (this.bufferIndex + 1 >= this.bufferSize) this.flush();
    quad.copyToBuffer(this.buffer, this.bufferIndex * Quad.SIZE);
    this.bufferIndex++;
  }

  pushMesh(mesh: TileMeshLike): void {
    this.flush();
    this._currentDrawCalls++;
    this._currentQuadCount += mesh.length;
    this.setTexture(mesh.texture);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, mesh.buffer, this.gl.DYNAMIC_DRAW);
    const polygonMode = this.wireframe ? this.gl.LINES : this.gl.TRIANGLES;
    this.gl.drawArrays(polygonMode, 0, mesh.length * Quad.VERTICES);
  }
}

export default Renderer;

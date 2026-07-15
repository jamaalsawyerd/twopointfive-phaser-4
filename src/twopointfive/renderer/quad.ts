/**
 * Single quad (two triangles) for tiles and sprites. Vertex buffer layout: pos, uv, color per vertex.
 * Position/rotation/size changes set _dirty; draw path recalculates and uploads. Used by Tile and HudTile.
 */
import { vec3, mat4 } from 'gl-matrix';
import type { Color, ColorA, TPFTexture, TPFQuadMaterial } from '~/twopointfive/types.ts';

/** 6 vertices, 9 floats each (pos xyz, uv uv, color rgba). */
class Quad {
  static readonly VERTEX_SIZE = 9;
  static readonly VERTICES = 6;
  static readonly SIZE = Quad.VERTEX_SIZE * Quad.VERTICES;

  texture: TPFTexture | null;
  /** Optional material (shader) for this quad; null renders with the default program. */
  material: TPFQuadMaterial | null;
  width: number;
  height: number;
  color: ColorA;
  position: vec3;
  rotation: vec3;
  _dirty: boolean;
  _verts: Float32Array;
  _vertsPos: Float32Array[];

  constructor(width?: number, height?: number, texture?: TPFTexture | null) {
    this.texture = texture || null;
    this.material = null;
    this.width = width || 1;
    this.height = height || 1;
    this.color = { r: 1, g: 1, b: 1, a: 1 };
    this.position = vec3.create();
    this.rotation = vec3.create();
    this._dirty = true;
    this._verts = new Float32Array(Quad.SIZE);
    this._vertsPos = [
      this._verts.subarray(0 * 9, 0 * 9 + 3),
      this._verts.subarray(1 * 9, 1 * 9 + 3),
      this._verts.subarray(2 * 9, 2 * 9 + 3),
      this._verts.subarray(3 * 9, 3 * 9 + 3),
      this._verts.subarray(4 * 9, 4 * 9 + 3),
      this._verts.subarray(5 * 9, 5 * 9 + 3),
    ];
    // Textures are Phaser-managed and uploaded with UNPACK_FLIP_Y_WEBGL, so V runs bottom-up.
    this.setUV(0, 1, 1, 0);
    this.setColor(this.color);
    this.setAlpha(this.color.a);
  }

  _recalcPositions(): void {
    if (!vec3 || !mat4) return;
    const vp = this._vertsPos;
    const rot = this.rotation;
    const m = mat4.identity(mat4.create());
    const sx2 = this.width / 2;
    const sy2 = this.height / 2;
    vp[0][0] = -sx2;
    vp[0][1] = -sy2;
    vp[0][2] = 0;
    vp[1][0] = sx2;
    vp[1][1] = -sy2;
    vp[1][2] = 0;
    vp[2][0] = -sx2;
    vp[2][1] = sy2;
    vp[2][2] = 0;
    vp[3][0] = sx2;
    vp[3][1] = sy2;
    vp[3][2] = 0;
    mat4.translate(m, m, this.position);
    if (rot[0]) mat4.rotateX(m, m, rot[0]);
    if (rot[1]) mat4.rotateY(m, m, rot[1]);
    if (rot[2]) mat4.rotateZ(m, m, rot[2]);
    vec3.transformMat4(vp[0] as unknown as vec3, vp[0] as unknown as vec3, m);
    vec3.transformMat4(vp[1] as unknown as vec3, vp[1] as unknown as vec3, m);
    vec3.transformMat4(vp[2] as unknown as vec3, vp[2] as unknown as vec3, m);
    vec3.transformMat4(vp[3] as unknown as vec3, vp[3] as unknown as vec3, m);
    vp[4].set(vp[2]);
    vp[5].set(vp[1]);
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this._dirty = true;
  }

  setPosition(x: number, y: number, z: number): void {
    this.position[0] = x;
    this.position[1] = y;
    this.position[2] = z;
    this._dirty = true;
  }

  setRotation(x: number, y: number, z: number): void {
    this.rotation[0] = x;
    this.rotation[1] = y;
    this.rotation[2] = z;
    this._dirty = true;
  }

  setUV(x1: number, y1: number, x2: number, y2: number): void {
    const v = this._verts;
    v[3] = x1;
    v[4] = y1;
    v[12] = x2;
    v[13] = y1;
    v[21] = x1;
    v[22] = y2;
    v[30] = x2;
    v[31] = y2;
    v[39] = x1;
    v[40] = y2;
    v[48] = x2;
    v[49] = y1;
  }

  setColor(c: Color): void {
    this.color.r = c.r;
    this.color.g = c.g;
    this.color.b = c.b;
    const v = this._verts;
    const r = c.r,
      g = c.g,
      b = c.b;
    v[5] = r;
    v[6] = g;
    v[7] = b;
    v[14] = r;
    v[15] = g;
    v[16] = b;
    v[23] = r;
    v[24] = g;
    v[25] = b;
    v[32] = r;
    v[33] = g;
    v[34] = b;
    v[41] = r;
    v[42] = g;
    v[43] = b;
    v[50] = r;
    v[51] = g;
    v[52] = b;
  }

  setAlpha(a: number): void {
    const v = this._verts;
    this.color.a = a;
    v[8] = a;
    v[17] = a;
    v[26] = a;
    v[35] = a;
    v[44] = a;
    v[53] = a;
  }

  copyToBuffer(buffer: Float32Array, index: number): void {
    if (this._dirty) {
      this._recalcPositions();
      this._dirty = false;
    }
    buffer.set(this._verts, index);
  }

  static setUVInBuffer(buffer: Float32Array, offset: number, x1: number, y1: number, x2: number, y2: number): void {
    const b = offset * Quad.SIZE;
    const v = buffer;
    v[b + 3] = x1;
    v[b + 4] = y1;
    v[b + 12] = x2;
    v[b + 13] = y1;
    v[b + 21] = x1;
    v[b + 22] = y2;
    v[b + 30] = x2;
    v[b + 31] = y2;
    v[b + 39] = x1;
    v[b + 40] = y2;
    v[b + 48] = x2;
    v[b + 49] = y1;
  }
}

export default Quad;

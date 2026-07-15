/**
 * Tile: one quad with UVs from a tileset; used by Map/WallMap for world geometry and by entities for sprites.
 * TileMesh batches many tiles into one buffer for draw.
 */
import Quad from '~/twopointfive/renderer/quad.ts';
import type Renderer from '~/twopointfive/renderer/renderer.ts';
import type { ImageInfo, TPFTexture } from '~/twopointfive/types.ts';
import type Animation from '~/game/tpf/animation.ts';

/** Single tile from a tileset image; setTile() updates UVs; seamsExpanded adds 2px spacing. */
class Tile {
  tile: number;
  scale: number;
  image: ImageInfo;
  tileWidth: number;
  tileHeight: number;
  quad: Quad;
  anim: Animation | null;

  constructor(image: ImageInfo, tile: number, tileWidth: number, tileHeight?: number, scale?: number) {
    this.tile = -1;
    this.scale = scale || 1;
    this.image = image;
    this.tileWidth = tileWidth;
    this.tileHeight = tileHeight || tileWidth;
    this.anim = null;
    this.quad = new Quad(this.tileWidth * this.scale, this.tileHeight * this.scale, image.texture);
    this.setTile(tile || 0);
  }

  setTile(t: number): void {
    if (t === this.tile) return;
    this.tile = t;
    const texW = this.image.textureWidth || this.image.width;
    const texH = this.image.textureHeight || this.image.height;
    const tileSpacing = this.image.seamsExpanded ? 2 : 0;
    const cols = Math.floor(this.image.width / this.tileWidth);
    const tx = t % cols;
    const ty = Math.floor(t / cols);
    const px = (tx * this.tileWidth + tx * tileSpacing) / texW;
    const py = (ty * this.tileHeight + ty * tileSpacing) / texH;
    const wx = this.tileWidth / texW;
    const wy = this.tileHeight / texH;
    // py measures from the image top; textures upload flipped (Phaser default), so mirror V.
    this.quad.setUV(px, 1 - (py + wy), px + wx, 1 - py);
  }

  setTileInBuffer(buffer: Float32Array, offset: number, t: number): void {
    const texW = this.image.textureWidth || this.image.width;
    const texH = this.image.textureHeight || this.image.height;
    const tileSpacing = this.image.seamsExpanded ? 2 : 0;
    const cols = Math.floor(this.image.width / this.tileWidth);
    const tx = t % cols;
    const ty = Math.floor(t / cols);
    const px = (tx * this.tileWidth + tx * tileSpacing) / texW;
    const py = (ty * this.tileHeight + ty * tileSpacing) / texH;
    const wx = this.tileWidth / texW;
    const wy = this.tileHeight / texH;
    Quad.setUVInBuffer(buffer, offset, px, 1 - (py + wy), px + wx, 1 - py);
  }

  draw(renderer: Renderer): void {
    renderer.pushQuad(this.quad);
  }
}

interface AnimatedTileEntry {
  tile: Tile;
  offset: number;
}

class TileMesh {
  animatedTiles: AnimatedTileEntry[];
  length: number;
  buffer: Float32Array;
  texture: TPFTexture | null;

  constructor(tiles: Tile[]) {
    this.animatedTiles = [];
    this.length = tiles.length;
    this.buffer = null!;
    this.texture = null;
    if (!this.length) return;
    this.buffer = new Float32Array(Quad.SIZE * this.length);
    this.texture = tiles[0].quad.texture;
    for (let i = 0; i < this.length; i++) {
      const tile = tiles[i];
      tile.quad.copyToBuffer(this.buffer, i * Quad.SIZE);
      if (tile.anim) {
        this.animatedTiles.push({ tile, offset: i });
      }
    }
  }

  updateAnimations(): void {
    for (let i = 0; i < this.animatedTiles.length; i++) {
      const at = this.animatedTiles[i];
      at.tile.setTileInBuffer(this.buffer, at.offset, at.tile.anim!.tile);
    }
  }
}

export { Tile, TileMesh, Quad };

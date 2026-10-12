/**
 * Floor/ceiling tile map: grid of Tile instances, light application, and rect queries.
 * Created from level layer data; used by CulledSectors for sector geometry. WallMap extends this for walls.
 */
import { Tile } from './tile.ts';
import type { ImageInfo } from '~/twopointfive/types.ts';
import type LightMap from './light-map.ts';
import type Animation from '../animation.ts';

const DEG_TO_RAD = Math.PI / 180;

/** Tile grid with tileset; yOffset flips for floor vs ceiling. */
class Map {
  static fixTileSeams = true;

  tilesize: number;
  data: number[][];
  tiles: ImageInfo;
  height: number;
  width: number;
  tileData: Record<number, Record<number, unknown>>;
  yOffset: number;
  anims: Record<number, Animation>;
  name: string;

  constructor(
    tilesize: number,
    data: number[][],
    tileset: ImageInfo,
    orientation: string,
    anims?: Record<number, Animation>,
  ) {
    this.tilesize = tilesize;
    this.data = data;
    this.tiles = tileset;
    this.height = data.length;
    this.width = data[0] ? data[0].length : 0;
    this.tileData = {};
    this.yOffset = (this.tilesize / 2) * (orientation === 'floor' ? -1 : 1);
    this.anims = anims || {};
    this.name = '';

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const tile = this.data[y][x];
        if (tile !== 0) {
          if (!this.tileData[y]) this.tileData[y] = {};
          const anim = this.anims[tile - 1] || null;
          this.tileData[y][x] = this.createTileAtPosition(tile - 1, x, y, anim);
        }
      }
    }
  }

  getTile(x: number, y: number): number {
    const tx = Math.floor(x / this.tilesize);
    const ty = Math.floor(y / this.tilesize);
    if (tx >= 0 && tx < this.width && ty >= 0 && ty < this.height) {
      return this.data[ty][tx];
    }
    return 0;
  }

  hasTile(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && !!this.data[y] && !!this.data[y][x];
  }

  createTileAtPosition(tile: number, x: number, y: number, anim: Animation | null): unknown {
    const t = new Tile(this.tiles, tile, this.tilesize);
    t.quad.setPosition(x * this.tilesize + this.tilesize / 2, this.yOffset, y * this.tilesize + this.tilesize / 2);
    t.quad.setRotation(-90 * DEG_TO_RAD, 0, 0);
    t.anim = anim;
    return t;
  }

  applyLightMap(lightMap: LightMap): void {
    for (const y in this.tileData) {
      for (const x in this.tileData[y]) {
        const tile = this.tileData[y][x as unknown as number] as Tile;
        const rx = (x as unknown as number) | 0;
        const ry = (y as unknown as number) | 0;
        tile.quad.setColor(lightMap.getLight(rx, ry));
      }
    }
  }

  getTilesInRect(xs: number, ys: number, w: number, h: number): Tile[] {
    const tiles: Tile[] = [];
    for (let y = ys; y < ys + h; y++) {
      if (!this.tileData[y]) continue;
      for (let x = xs; x < xs + w; x++) {
        if (!this.tileData[y][x]) continue;
        tiles.push(this.tileData[y][x] as Tile);
      }
    }
    return tiles;
  }
}

export default Map;

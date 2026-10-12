/**
 * Wall map: each cell is four quads (top/bottom/left/right) with rotations. Extends Map.
 * eraseDisconnectedWalls() removes walls not touching floor; used after level load.
 */
import Map from './map.ts';
import { Tile } from './tile.ts';
import type LightMap from './light-map.ts';
import type Animation from '../animation.ts';

interface WallOffset {
  x: number;
  y: number;
  rot: number;
}

const OFFSETS: Record<string, WallOffset> = {
  top: { x: 0, y: -1, rot: Math.PI },
  bottom: { x: 0, y: 1, rot: 0 },
  right: { x: 1, y: 0, rot: Math.PI / 2 },
  left: { x: -1, y: 0, rot: -Math.PI / 2 },
};

class WallMap extends Map {
  createTileAtPosition(tile: number, x: number, y: number, anim: Animation | null): unknown {
    const tiles: Record<string, Tile> = {};
    for (const name in OFFSETS) {
      const off = OFFSETS[name];
      const t = new Tile(this.tiles, tile, this.tilesize);
      t.quad.setPosition((x + off.x / 2 + 0.5) * this.tilesize, 0, (y + off.y / 2 + 0.5) * this.tilesize);
      t.quad.setRotation(0, off.rot, 0);
      t.anim = anim;
      tiles[name] = t;
    }
    return tiles;
  }

  applyLightMap(lightMap: LightMap): void {
    for (const y in this.tileData) {
      for (const x in this.tileData[y]) {
        const tiles = this.tileData[y][x as unknown as number] as Record<string, Tile>;
        const rx = (x as unknown as number) | 0;
        const ry = (y as unknown as number) | 0;
        for (const name in tiles) {
          const off = OFFSETS[name];
          tiles[name].quad.setColor(lightMap.getLight(rx + off.x, ry + off.y));
        }
      }
    }
  }

  getTilesInRect(xs: number, ys: number, w: number, h: number): Tile[] {
    const tiles: Tile[] = [];
    for (let y = ys; y < ys + h; y++) {
      for (let x = xs; x < xs + w; x++) {
        for (const name in OFFSETS) {
          const off = OFFSETS[name];
          const tx = x - off.x;
          const ty = y - off.y;
          if (this.hasTile(tx, ty) && (this.tileData[ty][tx] as Record<string, Tile>)[name]) {
            tiles.push((this.tileData[ty][tx] as Record<string, Tile>)[name]);
          }
        }
      }
    }
    return tiles;
  }

  eraseDisconnectedWalls(floorMap: Map): void {
    for (const y in this.tileData) {
      for (const x in this.tileData[y]) {
        const tiles = this.tileData[y][x as unknown as number] as Record<string, Tile>;
        const rx = (x as unknown as number) | 0;
        const ry = (y as unknown as number) | 0;
        for (const name in OFFSETS) {
          const off = OFFSETS[name];
          if (!floorMap.hasTile(rx + off.x, ry + off.y)) {
            delete tiles[name];
          }
        }
      }
    }
  }
}

(WallMap as unknown as Record<string, unknown>).offsets = OFFSETS;
export default WallMap;

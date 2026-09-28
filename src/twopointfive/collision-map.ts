/**
 * Tile-based collision for entity movement. trace() returns final position and collision flags;
 * used by TPFEntity.update() and GameState._separateX/Y. Stepped per-tile for accuracy.
 * raycast() and lineOfSight() answer visibility queries by walking a ray through the grid.
 * staticNoCollision is a no-op implementation used before a level is loaded.
 */
import type { TraceResult, CollisionMapLike, RaycastHit, TileFace } from './types.ts';

/** Tile grid (1 = solid); trace() advances a point by (vx, vy) and reports hits. */
class CollisionMap {
  tilesize: number;
  data: number[][];
  height: number;
  width: number;

  static staticNoCollision: CollisionMapLike = {
    tilesize: 64,
    trace(x: number, y: number, vx: number, vy: number): TraceResult {
      return {
        pos: { x: x + vx, y: y + vy },
        collision: { x: false, y: false, slope: false },
        tile: { x: 0, y: 0 },
      };
    },
    raycast(): RaycastHit | null {
      return null;
    },
    lineOfSight(): boolean {
      return true;
    },
  };

  constructor(tilesize: number, data: number[][]) {
    this.tilesize = tilesize;
    this.data = data;
    this.height = data.length;
    this.width = data[0] ? data[0].length : 0;
  }

  /** Advance (x,y) by (vx,vy) in steps of tilesize; return final pos and collision.x/y/slope. */
  trace(x: number, y: number, vx: number, vy: number, objectWidth: number, objectHeight: number): TraceResult {
    const res: TraceResult = {
      collision: { x: false, y: false, slope: false },
      pos: { x: x, y: y },
      tile: { x: 0, y: 0 },
    };

    const steps = Math.ceil((Math.max(Math.abs(vx), Math.abs(vy)) + 0.1) / this.tilesize);
    if (steps > 1) {
      let sx = vx / steps;
      let sy = vy / steps;

      for (let i = 0; i < steps && (sx || sy); i++) {
        this._traceStep(res, x, y, sx, sy, objectWidth, objectHeight, vx, vy, i);

        x = res.pos.x;
        y = res.pos.y;
        if (res.collision.x) {
          sx = 0;
          vx = 0;
        }
        if (res.collision.y) {
          sy = 0;
          vy = 0;
        }
        if (res.collision.slope) {
          break;
        }
      }
    } else {
      this._traceStep(res, x, y, vx, vy, objectWidth, objectHeight, vx, vy, 0);
    }

    return res;
  }

  _traceStep(
    res: TraceResult,
    x: number,
    y: number,
    vx: number,
    vy: number,
    width: number,
    height: number,
    _rvx: number,
    _rvy: number,
    step: number,
  ): void {
    res.pos.x += vx;
    res.pos.y += vy;

    let t = 0;

    // Horizontal collision (walls)
    if (vx) {
      const pxOffsetX = vx > 0 ? width : 0;
      const tileOffsetX = vx < 0 ? this.tilesize : 0;

      const firstTileY = Math.max(Math.floor(y / this.tilesize), 0);
      const lastTileY = Math.min(Math.ceil((y + height) / this.tilesize), this.height);
      const tileX = Math.floor((res.pos.x + pxOffsetX) / this.tilesize);

      let prevTileX = Math.floor((x + pxOffsetX) / this.tilesize);
      if (step > 0 || tileX === prevTileX || prevTileX < 0 || prevTileX >= this.width) {
        prevTileX = -1;
      }

      if (tileX >= 0 && tileX < this.width) {
        for (let tileY = firstTileY; tileY < lastTileY; tileY++) {
          t = this.data[tileY][tileX];
          if (t === 1) {
            res.collision.x = true;
            res.tile.x = t;
            x = res.pos.x = tileX * this.tilesize - pxOffsetX + tileOffsetX;
            break;
          }
        }
      }
    }

    // Vertical collision (floor, ceiling)
    if (vy) {
      const pxOffsetY = vy > 0 ? height : 0;
      const tileOffsetY = vy < 0 ? this.tilesize : 0;

      const firstTileX = Math.max(Math.floor(res.pos.x / this.tilesize), 0);
      const lastTileX = Math.min(Math.ceil((res.pos.x + width) / this.tilesize), this.width);
      const tileY = Math.floor((res.pos.y + pxOffsetY) / this.tilesize);

      let prevTileY = Math.floor((y + pxOffsetY) / this.tilesize);
      if (step > 0 || tileY === prevTileY || prevTileY < 0 || prevTileY >= this.height) {
        prevTileY = -1;
      }

      if (tileY >= 0 && tileY < this.height) {
        for (let tileX2 = firstTileX; tileX2 < lastTileX; tileX2++) {
          t = this.data[tileY][tileX2];
          if (t === 1) {
            res.collision.y = true;
            res.tile.y = t;
            res.pos.y = tileY * this.tilesize - pxOffsetY + tileOffsetY;
            break;
          }
        }
      }
    }
  }

  /**
   * Walks a ray from (x, y) along (dirX, dirY) one tile at a time (a grid DDA) and returns the first
   * solid tile it enters within maxDistance world units, or null. The direction need not be
   * normalised. The tile containing the start point is not tested, and tiles outside the grid count
   * as empty. Unlike trace(), which moves a box and slides along whatever it hits, this stops at the
   * first wall and reports which face of it the ray struck.
   */
  raycast(x: number, y: number, dirX: number, dirY: number, maxDistance: number): RaycastHit | null {
    const length = Math.sqrt(dirX * dirX + dirY * dirY);
    // A zero or NaN direction, or a non-finite start, makes no progress through the grid and could loop forever.
    if (!(length > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    const dx = dirX / length;
    const dy = dirY / length;
    const ts = this.tilesize;

    let tileX = Math.floor(x / ts);
    let tileY = Math.floor(y / ts);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    // Distance along the ray between successive vertical (x) and horizontal (y) grid lines...
    const deltaX = stepX ? ts / Math.abs(dx) : Infinity;
    const deltaY = stepY ? ts / Math.abs(dy) : Infinity;
    // ...and from the start point to the first of each.
    let nextX = stepX > 0 ? ((tileX + 1) * ts - x) / dx : stepX < 0 ? (x - tileX * ts) / -dx : Infinity;
    let nextY = stepY > 0 ? ((tileY + 1) * ts - y) / dy : stepY < 0 ? (y - tileY * ts) / -dy : Infinity;

    for (;;) {
      let distance: number;
      let face: TileFace;
      // Cross whichever grid line comes first. On a tie the ray passes exactly through a corner; taking
      // the y step first means two walls touching only at that corner still block the gap between them.
      if (nextX < nextY) {
        distance = nextX;
        nextX += deltaX;
        tileX += stepX;
        face = stepX > 0 ? 'left' : 'right';
      } else {
        distance = nextY;
        nextY += deltaY;
        tileY += stepY;
        face = stepY > 0 ? 'top' : 'bottom';
      }
      if (distance > maxDistance) return null;

      if (tileX < 0 || tileY < 0 || tileX >= this.width || tileY >= this.height) {
        // Outside the grid is all empty, so stop once the ray is heading away from it.
        if (
          (tileX < 0 && stepX <= 0) ||
          (tileX >= this.width && stepX >= 0) ||
          (tileY < 0 && stepY <= 0) ||
          (tileY >= this.height && stepY >= 0)
        ) {
          return null;
        }
        continue;
      }
      if (this.data[tileY][tileX] === 1) return { tileX, tileY, distance, face };
    }
  }

  /**
   * True when no solid tile lies between the two points. As with raycast(), the tile containing
   * (x0, y0) is not tested.
   */
  lineOfSight(x0: number, y0: number, x1: number, y1: number): boolean {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const hit = this.raycast(x0, y0, dx, dy, distance);
    // A wall that begins exactly at the target does not hide it: the target sits on the wall's surface.
    return !hit || hit.distance >= distance;
  }
}

export default CollisionMap;

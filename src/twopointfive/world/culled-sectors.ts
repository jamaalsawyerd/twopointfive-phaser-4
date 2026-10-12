/**
 * Sector-based culling: world is split into sectors; only sectors in view (camera angle + FOV) are drawn.
 * Entities register here and are drawn when their sector is visible. GameState.drawWorld() calls draw().
 */
import type { Tile } from './tile.ts';
import { TileMesh } from './tile.ts';
import type Renderer from '~/twopointfive/renderer/renderer.ts';
import type Map from './map.ts';
import type TPFEntity from '~/twopointfive/entity.ts';

interface Portal {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  to: Sector;
}

interface Sector {
  id: number;
  x: number;
  y: number;
  portals: Portal[];
  world: TileMesh;
  entities: Record<number, TPFEntity>;
}

interface ViewFrustum {
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function sortByZIndex(a: TPFEntity, b: TPFEntity): number {
  return a.zIndex - b.zIndex;
}

/** Builds sectors from floor + geometry maps; collectVisibleSectors uses camera pos/angle/fov. */
class CulledSectors {
  sectorSize: number;
  tilesize: number;
  sectors: Record<number, Record<number, Sector>>;
  numSectors: number;
  sectorsTraversed: number;
  _renderer: Renderer;

  constructor(fillMap: Map, geometryMaps: Map[], sectorSize: number, renderer: Renderer) {
    this.sectorSize = sectorSize || 4;
    this.tilesize = fillMap.tilesize;
    this.sectors = {};
    this.numSectors = 0;
    this.sectorsTraversed = 0;
    this._renderer = renderer;
    this.generateSectors(sectorSize, fillMap, geometryMaps);
  }

  draw(cx: number, cy: number, angle: number, fov: number): void {
    const visibleSectors = this.collectVisibleSectors(cx, cy, angle, fov);
    this.drawWorld(visibleSectors);
    this.drawEntities(visibleSectors);
  }

  drawWorld(visibleSectors: Record<number, Sector>): void {
    const renderer = this._renderer;
    for (const s in visibleSectors) {
      visibleSectors[s].world.updateAnimations();
      renderer.pushMesh(visibleSectors[s].world);
    }
  }

  drawEntities(visibleSectors: Record<number, Sector>): void {
    const renderer = this._renderer;
    const deferredDraw: TPFEntity[] = [];
    for (const s in visibleSectors) {
      const ents = visibleSectors[s].entities;
      for (const e in ents) {
        if (ents[e].zIndex) {
          deferredDraw.push(ents[e]);
        } else {
          ents[e].draw(renderer);
        }
      }
    }
    deferredDraw.sort(sortByZIndex);
    for (let i = 0; i < deferredDraw.length; i++) {
      deferredDraw[i].draw(renderer);
    }
  }

  collectVisibleSectors(cx: number, cy: number, angle: number, fov: number): Record<number, Sector> {
    this.sectorsTraversed = 0;
    const visibleSectors: Record<number, Sector> = {};
    const sx = (cx / (this.sectorSize * this.tilesize)) | 0;
    const sy = (cy / (this.sectorSize * this.tilesize)) | 0;
    if (!this.sectors[sy]?.[sx]) return visibleSectors;
    const sector = this.sectors[sy][sx];
    const fov2 = fov / 2;
    const viewFrustum: ViewFrustum = {
      cx,
      cy,
      x1: cx + Math.cos(angle - fov2),
      y1: cy + Math.sin(angle - fov2),
      x2: cx + Math.cos(angle + fov2),
      y2: cy + Math.sin(angle + fov2),
    };
    this.traverseSector(sector, viewFrustum, null, visibleSectors);
    return visibleSectors;
  }

  moveEntity(ent: TPFEntity): void {
    const tt = this.sectorSize * this.tilesize;
    const newsx = ((ent.pos.x + ent.size.x / 2) / tt) | 0;
    const newsy = ((ent.pos.y + ent.size.y / 2) / tt) | 0;
    if (ent.__sectorX === newsx && ent.__sectorY === newsy) return;
    if (ent.__sectorX !== null && ent.__sectorY !== null) {
      this.removeEntityFromSector(ent.__sectorX, ent.__sectorY, ent);
    }
    this.addEntityToSector(newsx, newsy, ent);
    ent.__sectorX = newsx;
    ent.__sectorY = newsy;
  }

  removeEntity(ent: TPFEntity): void {
    if (ent.__sectorX !== null && ent.__sectorY !== null) {
      this.removeEntityFromSector(ent.__sectorX, ent.__sectorY, ent);
    }
    ent.__sectorX = null;
    ent.__sectorY = null;
  }

  addEntityToSector(sx: number, sy: number, ent: TPFEntity): void {
    if (!this.sectors[sy]) return;
    const sector = this.sectors[sy][sx];
    if (!sector) return;
    sector.entities[ent.id] = ent;
  }

  removeEntityFromSector(sx: number, sy: number, ent: TPFEntity): void {
    if (!this.sectors[sy]) return;
    const sector = this.sectors[sy][sx];
    if (!sector) return;
    delete sector.entities[ent.id];
  }

  traverseSector(
    sector: Sector,
    frustum: ViewFrustum,
    from: Sector | null,
    visibleSectors: Record<number, Sector>,
  ): void {
    visibleSectors[sector.id] = sector;
    this.sectorsTraversed++;
    for (let i = 0; i < sector.portals.length; i++) {
      const portal = sector.portals[i];
      if (portal.to !== from) {
        const fp = this.frustumThroughPortal(portal, frustum);
        if (fp) this.traverseSector(portal.to, fp, sector, visibleSectors);
      }
    }
  }

  pointToSideOfRay(x: number, y: number, rsx: number, rsy: number, rex: number, rey: number): number {
    return (y - rsy) * (rex - rsx) - (x - rsx) * (rey - rsy);
  }

  frustumThroughPortal(portal: Portal, frustum: ViewFrustum): ViewFrustum | null {
    const side = this.pointToSideOfRay.bind(this);
    const p1f1 = side(portal.x1, portal.y1, frustum.cx, frustum.cy, frustum.x1, frustum.y1) > 0;
    const p1f2 = side(portal.x1, portal.y1, frustum.cx, frustum.cy, frustum.x2, frustum.y2) < 0;
    const p2f1 = side(portal.x2, portal.y2, frustum.cx, frustum.cy, frustum.x1, frustum.y1) > 0;
    const p2f2 = side(portal.x2, portal.y2, frustum.cx, frustum.cy, frustum.x2, frustum.y2) < 0;
    const ppx1 = frustum.cx;
    const ppy1 = frustum.cy;
    const ppx2 = frustum.cx + (portal.x1 - portal.x2);
    const ppy2 = frustum.cy + (portal.y1 - portal.y2);
    const perpp = side(portal.x1, portal.y1, ppx1, ppy1, ppx2, ppy2) > 0;
    const perpf = side(frustum.x1, frustum.y1, ppx1, ppy1, ppx2, ppy2) > 0;
    const front = perpf ? perpp : !perpp;
    if (!((p1f1 && p1f2) || (p2f1 && p2f2) || (front && (p1f1 || p2f1) && (p1f2 || p2f2)))) {
      return null;
    }
    let nfx1: number, nfy1: number, nfx2: number, nfy2: number;
    if (p1f1 && p1f2) {
      nfx1 = portal.x1;
      nfy1 = portal.y1;
    } else if (!p1f1 && (p1f2 || front)) {
      nfx1 = frustum.x1;
      nfy1 = frustum.y1;
    } else {
      nfx1 = frustum.x2;
      nfy1 = frustum.y2;
    }
    if (p2f1 && p2f2) {
      nfx2 = portal.x2;
      nfy2 = portal.y2;
    } else if (!p2f1 && (p2f2 || front)) {
      nfx2 = frustum.x1;
      nfy2 = frustum.y1;
    } else {
      nfx2 = frustum.x2;
      nfy2 = frustum.y2;
    }
    const narrowedFrustum = perpp
      ? { cx: frustum.cx, cy: frustum.cy, x1: nfx1, y1: nfy1, x2: nfx2, y2: nfy2 }
      : { cx: frustum.cx, cy: frustum.cy, x1: nfx2, y1: nfy2, x2: nfx1, y2: nfy1 };
    return narrowedFrustum;
  }

  generateSectors(sectorSize: number, fillMap: Map, geometryMaps: Map[]): void {
    const tilesize = fillMap.tilesize;
    for (let x = sectorSize; x < fillMap.width; x += sectorSize) {
      let currentLength = 0;
      let currentStart = 0;
      for (let y = 0; y < fillMap.height; y++) {
        const left = fillMap.data[y][x - 1];
        const right = fillMap.data[y][x];
        if ((y % sectorSize === 0 || !left || !right || y === fillMap.height - 1) && currentLength) {
          const sx = (x / sectorSize) | 0;
          const sy = ((y - 1) / sectorSize) | 0;
          const s1 = this.createSectorIfNeeded(sx - 1, sy, geometryMaps);
          const s2 = this.createSectorIfNeeded(sx, sy, geometryMaps);
          this.addPortal(x * tilesize, currentStart * tilesize, x * tilesize, y * tilesize, s1, s2);
          currentStart = y;
          currentLength = 0;
        }
        if (left && right) currentLength++;
        else currentStart = y + 1;
      }
    }
    for (let y = sectorSize; y < fillMap.height; y += sectorSize) {
      let currentLength = 0;
      let currentStart = 0;
      for (let x = 0; x < fillMap.width; x++) {
        const top = fillMap.data[y - 1][x];
        const bottom = fillMap.data[y][x];
        if ((x % sectorSize === 0 || !top || !bottom || x === fillMap.width - 1) && currentLength) {
          const sx = ((x - 1) / sectorSize) | 0;
          const sy = (y / sectorSize) | 0;
          const s1 = this.createSectorIfNeeded(sx, sy - 1, geometryMaps);
          const s2 = this.createSectorIfNeeded(sx, sy, geometryMaps);
          this.addPortal(currentStart * tilesize, y * tilesize, x * tilesize, y * tilesize, s1, s2);
          currentStart = x;
          currentLength = 0;
        }
        if (top && bottom) currentLength++;
        else currentStart = x + 1;
      }
    }
  }

  createSectorIfNeeded(x: number, y: number, maps: Map[]): Sector {
    if (!this.sectors[y]) this.sectors[y] = {};
    else if (this.sectors[y][x]) return this.sectors[y][x];
    const s = this.createSector(x, y, maps);
    this.sectors[y][x] = s;
    return s;
  }

  createSector(x: number, y: number, maps: Map[]): Sector {
    const tx = x * this.sectorSize;
    const ty = y * this.sectorSize;
    const tw = this.sectorSize;
    const th = this.sectorSize;
    let tiles: Tile[] = [];
    for (let i = 0; i < maps.length; i++) {
      tiles = tiles.concat(maps[i].getTilesInRect(tx, ty, tw, th));
    }
    const mesh = new TileMesh(tiles);
    return {
      id: this.numSectors++,
      x,
      y,
      portals: [],
      world: mesh,
      entities: {},
    };
  }

  addPortal(px1: number, py1: number, px2: number, py2: number, s1: Sector, s2: Sector): void {
    s1.portals.push({ x1: px1, y1: py1, x2: px2, y2: py2, to: s2 });
    s2.portals.push({ x1: px1, y1: py1, x2: px2, y2: py2, to: s1 });
  }
}

export default CulledSectors;

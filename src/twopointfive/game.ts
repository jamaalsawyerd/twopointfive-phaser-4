/**
 * Game state: level loading (maps, collision, light, entities), entity spawn/check, and draw.
 * Plugin and entities hold a reference to the GameState; context (camera, tick, collisionMap, etc.)
 * is built here and passed to entities. checkEntities() runs after each update for collision/callbacks.
 */
import CollisionMap from './collision-map.ts';
import TPFEntity from './entity.ts';
import WallMap from './world/wall-map.ts';
import Map from './world/map.ts';
import LightMap from './world/light-map.ts';
import CulledSectors from './world/culled-sectors.ts';
import type Renderer from './renderer/renderer.ts';
import type PerspectiveCamera from './renderer/perspective-camera.ts';
import type { TPFEntityDisplayAdapter } from './entity-display-adapter.ts';
import type { CollisionMapLike, LevelData, EntityContext } from './types.ts';
import type Animation from '~/game/tpf/animation.ts';

/** Injected into GameState and passed to entities; provides renderer, camera, tick, gravity, tilesets. */
export interface GameContext {
  renderer: Renderer | null;
  camera: PerspectiveCamera | null;
  entityClasses: Record<
    string,
    new (x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity
  >;
  backgroundAnims: Record<string, Record<number, Animation>>;
  displayAdapter?: TPFEntityDisplayAdapter | null;
  gravity: number;
  tick: number;
  getTileset?: (name: string) => import('./types.ts').ImageInfo | null;
  getLightMapPixels?: (name: string) => import('./world/light-map.ts').LightMapPixels | null;
  horizontalFov?: () => number;
}

/** Owns level data, entities, collision/light/maps; runs loadLevel, spawnEntity, checkEntities, draw. */
class GameState {
  context: GameContext;
  culledSectors: CulledSectors | null;
  sectorSize: number;
  clearColor: [number, number, number] | null;
  collisionMap: CollisionMap | CollisionMapLike;
  backgroundMaps: Map[];
  lightMap: LightMap | null;
  entities: TPFEntity[];
  namedEntities: Record<string, TPFEntity>;
  backgroundAnims: Record<string, Record<number, Animation>>;

  constructor(context: GameContext) {
    this.context = context || ({} as GameContext);
    this.culledSectors = null;
    this.sectorSize = 4;
    this.clearColor = null;
    this.collisionMap = CollisionMap.staticNoCollision;
    this.backgroundMaps = [];
    this.lightMap = null;
    this.entities = [];
    this.namedEntities = {};
    this.backgroundAnims = this.context.backgroundAnims || {};
  }

  clearLevel(): void {
    for (let i = 0; i < this.entities.length; i++) {
      const e = this.entities[i];
      if (e.remove) e.remove();
    }
    this.entities = [];
    this.namedEntities = {};
    this.culledSectors = null;
    this.collisionMap = CollisionMap.staticNoCollision;
    this.backgroundMaps = [];
    this.lightMap = null;
  }

  getMapByName(name: string): Map | null {
    for (let i = 0; i < this.backgroundMaps.length; i++) {
      if (this.backgroundMaps[i].name === name) return this.backgroundMaps[i];
    }
    return null;
  }

  loadLevel(data: LevelData): void {
    this.clearLevel();
    const layer = data.layer || [];
    for (let i = 0; i < layer.length; i++) {
      const ld = layer[i];
      if (ld.name === 'collision') {
        this.collisionMap = new CollisionMap(ld.tilesize, ld.data);
      } else if (ld.name === 'light') {
        const imagePixels = this.context.getLightMapPixels ? this.context.getLightMapPixels(ld.tilesetName) : null;
        this.lightMap = new LightMap(ld.tilesize, ld.data, imagePixels || { data: [] });
      } else if (ld.name === 'walls' || ld.name === 'floor' || ld.name === 'ceiling') {
        const anims = this.backgroundAnims[ld.tilesetName] || {};
        const tileset = this.context.getTileset ? this.context.getTileset(ld.tilesetName) : null;
        if (!tileset && this.context.getTileset) continue;
        const newMap =
          ld.name === 'walls'
            ? new WallMap(ld.tilesize, ld.data, tileset!, ld.name, anims)
            : new Map(ld.tilesize, ld.data, tileset!, ld.name, anims);
        newMap.name = ld.name;
        this.backgroundMaps.push(newMap);
      }
    }

    const floorMap = this.getMapByName('floor');
    const wallMap = this.getMapByName('walls') as WallMap | null;
    if (floorMap && wallMap) wallMap.eraseDisconnectedWalls(floorMap);

    if (this.lightMap) {
      for (let i = 0; i < this.backgroundMaps.length; i++) {
        this.backgroundMaps[i].applyLightMap(this.lightMap);
      }
    }

    const renderer = this.context.renderer;
    this.culledSectors = new CulledSectors(floorMap!, this.backgroundMaps, this.sectorSize, renderer!);

    const entities = data.entities || [];
    const entityClasses = this.context.entityClasses || {};
    for (let i = 0; i < entities.length; i++) {
      const ent = entities[i];
      const Type = entityClasses[ent.type];
      if (Type) {
        this.spawnEntity(Type, ent.x, ent.y, ent.settings);
      }
    }

    for (let i = 0; i < this.entities.length; i++) {
      this.entities[i].ready();
    }
  }

  spawnEntity(
    Type:
      | (new (x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity)
      | ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity),
    x: number,
    y: number,
    settings: Record<string, unknown>,
  ): TPFEntity {
    const ctx: EntityContext = {
      collisionMap: this.collisionMap,
      culledSectors: this.culledSectors,
      renderer: this.context.renderer,
      camera: this.context.camera,
      gravity: this.context.gravity,
      tick: this.context.tick,
      lightMap: this.lightMap,
      game: this,
      displayAdapter: this.context.displayAdapter,
    };
    let ent: TPFEntity;
    try {
      ent = new (Type as new (x: number, y: number, s: Record<string, unknown>, c: EntityContext) => TPFEntity)(
        x,
        y,
        settings,
        ctx,
      );
    } catch {
      ent = (Type as (x: number, y: number, s: Record<string, unknown>, c: EntityContext) => TPFEntity)(
        x,
        y,
        settings,
        ctx,
      );
    }
    ent.init(x, y, settings);
    this.entities.push(ent);
    if (settings?.name) this.namedEntities[settings.name as string] = ent;
    return ent;
  }

  /** Pairwise entity check: call check() when types match (bitwise), then resolve overlap when both collides. */
  checkEntities(): void {
    const COLLIDES = TPFEntity.COLLIDES;
    const ents = this.entities;
    const len = ents.length;
    const collisionMap = this.collisionMap;

    for (let i = 0; i < len; i++) {
      const a = ents[i];
      if (a._killed) continue;
      const aHasCheck = a.checkAgainst || a.type;
      const aHasCollide = a.collides;
      if (!aHasCheck && !aHasCollide) continue;

      for (let j = i + 1; j < len; j++) {
        const b = ents[j];
        if (b._killed) continue;

        const hasCheck = a.checkAgainst & b.type || b.checkAgainst & a.type;
        const hasCollide = aHasCollide && b.collides && a.collides + b.collides > COLLIDES.ACTIVE;
        if (!hasCheck && !hasCollide) continue;

        if (
          !(
            a.pos.x < b.pos.x + b.size.x &&
            a.pos.x + a.size.x > b.pos.x &&
            a.pos.y < b.pos.y + b.size.y &&
            a.pos.y + a.size.y > b.pos.y
          )
        ) {
          continue;
        }

        if (a.checkAgainst & b.type) a.check(b);
        if (b.checkAgainst & a.type) b.check(a);

        if (hasCollide) {
          GameState._solveCollision(a, b, collisionMap);
        }
      }
    }
  }

  static _solveCollision(a: TPFEntity, b: TPFEntity, collisionMap: CollisionMap | CollisionMapLike): void {
    const COLLIDES = TPFEntity.COLLIDES;

    let weak: TPFEntity | null = null;
    if (a.collides === COLLIDES.LITE || b.collides === COLLIDES.FIXED) {
      weak = a;
    } else if (b.collides === COLLIDES.LITE || a.collides === COLLIDES.FIXED) {
      weak = b;
    }

    if (a.last.x + a.size.x > b.last.x && a.last.x < b.last.x + b.size.x) {
      if (a.last.y < b.last.y) {
        GameState._separateY(a, b, weak, collisionMap);
      } else {
        GameState._separateY(b, a, weak, collisionMap);
      }
      a.collideWith(b, 'y');
      b.collideWith(a, 'y');
    } else if (a.last.y + a.size.y > b.last.y && a.last.y < b.last.y + b.size.y) {
      if (a.last.x < b.last.x) {
        GameState._separateX(a, b, weak, collisionMap);
      } else {
        GameState._separateX(b, a, weak, collisionMap);
      }
      a.collideWith(b, 'x');
      b.collideWith(a, 'x');
    }
  }

  static _separateX(
    left: TPFEntity,
    right: TPFEntity,
    weak: TPFEntity | null,
    collisionMap: CollisionMap | CollisionMapLike,
  ): void {
    const nudge = left.pos.x + left.size.x - right.pos.x;
    if (weak) {
      const strong = left === weak ? right : left;
      weak.vel.x = -weak.vel.x * weak.bounciness + strong.vel.x;
      const res = collisionMap.trace(
        weak.pos.x,
        weak.pos.y,
        weak === left ? -nudge : nudge,
        0,
        weak.size.x,
        weak.size.y,
      );
      weak.pos.x = res.pos.x;
    } else {
      const v2 = (left.vel.x - right.vel.x) / 2;
      left.vel.x = -v2;
      right.vel.x = v2;
      const resL = collisionMap.trace(left.pos.x, left.pos.y, -nudge / 2, 0, left.size.x, left.size.y);
      left.pos.x = Math.floor(resL.pos.x);
      const resR = collisionMap.trace(right.pos.x, right.pos.y, nudge / 2, 0, right.size.x, right.size.y);
      right.pos.x = Math.ceil(resR.pos.x);
    }
  }

  static _separateY(
    top: TPFEntity,
    bottom: TPFEntity,
    weak: TPFEntity | null,
    collisionMap: CollisionMap | CollisionMapLike,
  ): void {
    const nudge = top.pos.y + top.size.y - bottom.pos.y;
    if (weak) {
      const strong = top === weak ? bottom : top;
      weak.vel.y = -weak.vel.y * weak.bounciness + strong.vel.y;
      const res = collisionMap.trace(
        weak.pos.x,
        weak.pos.y,
        0,
        weak === top ? -nudge : nudge,
        weak.size.x,
        weak.size.y,
      );
      weak.pos.y = res.pos.y;
    } else {
      const v2 = (top.vel.y - bottom.vel.y) / 2;
      top.vel.y = -v2;
      bottom.vel.y = v2;
      const resT = collisionMap.trace(top.pos.x, top.pos.y, 0, -nudge / 2, top.size.x, top.size.y);
      top.pos.y = Math.floor(resT.pos.y);
      const resB = collisionMap.trace(bottom.pos.x, bottom.pos.y, 0, nudge / 2, bottom.size.x, bottom.size.y);
      bottom.pos.y = Math.ceil(resB.pos.y);
    }
  }

  drawWorld(camera?: PerspectiveCamera, renderer?: Renderer): void {
    const r = renderer || this.context.renderer;
    const cam = camera || this.context.camera;
    if (!this.culledSectors || !r || !cam) return;
    r.setCamera(cam);
    const cx = cam.position[0];
    const cy = cam.position[2];
    const cullAngle = -cam.rotation[1] - Math.PI / 2;
    const fovDeg =
      typeof this.context.horizontalFov === 'function' ? this.context.horizontalFov() : 75 * (cam.aspect || 1);
    const fovRad = fovDeg * (Math.PI / 180);
    this.culledSectors.draw(cx, cy, cullAngle, fovRad);
  }

  draw(renderer?: Renderer, drawWorld?: () => void): void {
    const r = renderer || this.context.renderer;
    if (!r) return;
    r.render(() => {
      if (this.clearColor) {
        const c = this.clearColor;
        r.setClearColor(c[0], c[1], c[2], 1);
      }
      r.clear(!!this.clearColor, true);
      if (drawWorld) drawWorld();
    });
  }
}

export default GameState;

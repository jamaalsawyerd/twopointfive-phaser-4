/**
 * Base 2.5D entity: physics (velocity, friction, gravity), collision trace, tile rendering,
 * and sector culling. Subclassed by game entities (player, enemies, pickups). Movement uses
 * context.tick (frame delta) so simulation is deterministic per frame.
 */
import { Tile } from './world/tile.ts';
import Animation from '~/game/tpf/animation.ts';
import type Renderer from './renderer/renderer.ts';
import type { Vec2, Vec3, AnimSheet, EntityContext, Color, TraceResult } from './types.ts';

/** Base entity class. TYPE = who to check against; COLLIDES = collision response (PASSIVE = pushed, ACTIVE = pushes). */
class TPFEntity {
  static _nextId = 1;

  static TYPE = {
    NONE: 0,
    A: 1, // Player
    B: 2, // Enemies / destructibles
  } as const;

  static COLLIDES = {
    NEVER: 0,
    LITE: 1,
    PASSIVE: 2,
    ACTIVE: 4,
    FIXED: 8,
  } as const;

  id: number;
  pos: Vec3;
  vel: Vec3;
  accel: Vec3;
  maxVel: Vec3;
  last: Vec2;
  size: Vec2;
  tile: Tile | null;
  scale: number;
  dynamicLight: boolean;
  rotateToView: boolean;
  gravityFactor: number;
  friction: Vec2;
  bounciness: number;
  minBounceVelocity: number;
  _killed: boolean;
  __tilePosX: number;
  __tilePosY: number;
  __sectorX: number | null;
  __sectorY: number | null;
  animSheet: AnimSheet | null;
  currentAnim: Animation | null;
  anims: Record<string, Animation>;
  type: number;
  checkAgainst: number;
  collides: number;
  health: number;
  context: EntityContext;

  constructor(x: number, y: number, _settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    this.id = TPFEntity._nextId++;
    this.pos = { x: x || 0, y: y || 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.accel = { x: 0, y: 0, z: 0 };
    this.maxVel = { x: 10000, y: 10000, z: 10000 };
    this.last = { x: this.pos.x, y: this.pos.y };
    this.size = { x: 32, y: 32 };
    this.tile = null;
    this.scale = 0.25;
    this.dynamicLight = true;
    this.rotateToView = true;
    this.gravityFactor = 1;
    this.friction = { x: 0, y: 0 };
    this.bounciness = 0;
    this.minBounceVelocity = 0;
    this._killed = false;
    this.__tilePosX = -1;
    this.__tilePosY = -1;
    this.__sectorX = null;
    this.__sectorY = null;
    this.animSheet = null;
    this.currentAnim = null;
    this.anims = {};

    this.type = TPFEntity.TYPE.NONE;
    this.checkAgainst = TPFEntity.TYPE.NONE;
    this.collides = TPFEntity.COLLIDES.NEVER;
    this.health = 10;

    this.context = (context || {}) as EntityContext;
  }

  addAnim(name: string, frameTime: number, sequence: number[], stop?: boolean): Animation {
    const a = new Animation(frameTime, sequence, stop);
    this.anims[name] = a;
    if (!this.currentAnim) {
      this.currentAnim = a;
    }
    return a;
  }

  /** Velocity update from accel or friction; uses context.tick (frame delta). */
  getNewVelocity(vel: number, accel: number, friction: number, maxVel: number): number {
    if (accel) {
      let v = vel + accel * (this.context.tick || 1 / 60);
      if (v > maxVel) v = maxVel;
      if (v < -maxVel) v = -maxVel;
      return v;
    } else if (friction) {
      const delta = friction * (this.context.tick || 1 / 60);
      if (vel - delta > 0) return vel - delta;
      else if (vel + delta < 0) return vel + delta;
      else return 0;
    }
    if (vel > maxVel) return maxVel;
    if (vel < -maxVel) return -maxVel;
    return vel;
  }

  init(_x: number, _y: number, settings: Record<string, unknown> | null): void {
    if (settings) Object.assign(this, settings);
    if (this.animSheet && this.context.renderer) {
      this.tile = new Tile(this.animSheet.image, 0, this.animSheet.width, this.animSheet.height, this.scale);
      this.context.displayAdapter?.createEntity(this);
      this.updateQuad();
    }
    if (this.context.culledSectors) this.context.culledSectors.moveEntity(this);
  }

  reset(x: number | null, y: number | null, settings?: Record<string, unknown>): void {
    if (x != null) this.pos.x = x;
    if (y != null) this.pos.y = y;
    if (settings) Object.assign(this, settings);
    if (this.context.culledSectors) this.context.culledSectors.moveEntity(this);
    this.updateQuad();
  }

  kill(): void {
    this._killed = true;
    this.remove();
  }

  remove(): void {
    if (this.context.culledSectors) this.context.culledSectors.removeEntity(this);
    this.context.displayAdapter?.removeEntity(this);
  }

  handleMovementTrace(res: TraceResult): void {
    const z = this.pos.z;
    if (res.collision.x) {
      if (this.bounciness > 0 && Math.abs(this.vel.x) > this.minBounceVelocity) {
        this.vel.x *= -this.bounciness;
      } else {
        this.vel.x = 0;
      }
    }
    if (res.collision.y) {
      if (this.bounciness > 0 && Math.abs(this.vel.y) > this.minBounceVelocity) {
        this.vel.y *= -this.bounciness;
      } else {
        this.vel.y = 0;
      }
    }
    this.pos.x = res.pos.x;
    this.pos.y = res.pos.y;
    this.pos.z = z;
  }

  updateQuad(): void {
    const ctx = this.context;
    const collisionMap = ctx.collisionMap;
    const camera = ctx.camera;
    const culledSectors = ctx.culledSectors;
    const lightMap = ctx.lightMap;

    if (this.tile && this.currentAnim) {
      this.tile.setTile(this.currentAnim.tile);
      const tpos = this.tile.quad.position;
      tpos[0] = this.pos.x + this.size.x / 2;
      tpos[2] = this.pos.y + this.size.y / 2;
      const ts = collisionMap && 'tilesize' in collisionMap ? collisionMap.tilesize : 64;
      tpos[1] = this.pos.z - ts / 2 + (this.animSheet!.height * this.scale) / 2;
      if (this.rotateToView && camera) {
        this.tile.quad.rotation[1] = camera.rotation[1];
      }
      this.tile.quad._dirty = true;
    }
    if (this.dynamicLight && lightMap) {
      const ntx = Math.floor((this.pos.x + this.size.x / 2) / lightMap.tilesize);
      const nty = Math.floor((this.pos.y + this.size.y / 2) / lightMap.tilesize);
      if (ntx !== this.__tilePosX || nty !== this.__tilePosY) {
        this.__tilePosX = ntx;
        this.__tilePosY = nty;
        this.setLight(lightMap.getLight(ntx, nty));
      }
    }
    if (this.tile && !this._killed && (this.pos.x !== this.last.x || this.pos.y !== this.last.y) && culledSectors) {
      culledSectors.moveEntity(this);
    }
    ctx.displayAdapter?.updateEntity(this);
  }

  canSee(other: TPFEntity): boolean {
    const collisionMap = this.context.collisionMap;
    if (!collisionMap || !('trace' in collisionMap)) return true;
    const sx = this.pos.x + this.size.x / 2;
    const sy = this.pos.y + this.size.y / 2;
    const res = collisionMap.trace(
      sx,
      sy,
      other.pos.x + other.size.x / 2 - sx,
      other.pos.y + other.size.y / 2 - sy,
      1,
      1,
    );
    return !res.collision.x && !res.collision.y;
  }

  /** Physics step: gravity, velocity from accel/friction, trace, then update quad and animation. */
  update(): void {
    const ctx = this.context;
    const collisionMap = ctx.collisionMap;
    const tick = ctx.tick || 1 / 60;
    const gravity = ctx.gravity != null ? ctx.gravity : 4;

    this.last.x = this.pos.x;
    this.last.y = this.pos.y;
    this.vel.z -= gravity * tick * this.gravityFactor;
    this.vel.x = this.getNewVelocity(this.vel.x, this.accel.x, this.friction.x, this.maxVel.x);
    this.vel.y = this.getNewVelocity(this.vel.y, this.accel.y, this.friction.y, this.maxVel.y);
    this.vel.z = this.getNewVelocity(this.vel.z, this.accel.z, 0, this.maxVel.z);

    const mx = this.vel.x * tick;
    const my = this.vel.y * tick;
    const res =
      collisionMap && 'trace' in collisionMap
        ? collisionMap.trace(this.pos.x, this.pos.y, mx, my, this.size.x, this.size.y)
        : {
            pos: { x: this.pos.x + mx, y: this.pos.y + my },
            collision: { x: false, y: false, slope: false },
            tile: { x: 0, y: 0 },
          };
    this.handleMovementTrace(res);

    this.pos.z += this.vel.z;
    if (this.pos.z < 0) {
      if (this.bounciness > 0 && Math.abs(this.vel.z) > this.minBounceVelocity) {
        this.vel.z *= -this.bounciness;
      } else {
        this.vel.z = 0;
      }
      this.pos.z = 0;
    }
    this.currentAnim?.update();
    this.updateQuad();
  }

  setLight(color: Color): void {
    if (this.tile) this.tile.quad.setColor(color);
    this.context.displayAdapter?.setEntityLight(this, color);
  }

  /**
   * Renders this entity with a material registered via scene.tpf.registerMaterial. The entity
   * stays in the depth-tested world pass, so it keeps wall occlusion and fog. Entities sharing
   * the same material object batch together; per-entity uniforms force a separate draw call.
   */
  setMaterial(key: string, uniforms?: Record<string, number | number[]>): void {
    if (this.tile) this.tile.quad.material = { key, uniforms };
  }

  /** Restores default rendering. */
  clearMaterial(): void {
    if (this.tile) this.tile.quad.material = null;
  }

  draw(renderer?: Renderer): void {
    if (this.context.displayAdapter?.drawEntity(this, renderer)) return;
    const r = renderer || this.context.renderer;
    if (this.tile && r) this.tile.draw(r);
  }

  check(_other: TPFEntity): void {}

  receiveDamage(amount: number, _from: TPFEntity): void {
    this.health -= amount;
    if (this.health <= 0) {
      this.kill();
    }
  }

  angleTo(other: TPFEntity): number {
    const dx = other.pos.x + other.size.x / 2 - (this.pos.x + this.size.x / 2);
    const dy = other.pos.y + other.size.y / 2 - (this.pos.y + this.size.y / 2);
    return Math.atan2(dy, dx);
  }

  distanceTo(other: TPFEntity): number {
    const dx = other.pos.x + other.size.x / 2 - (this.pos.x + this.size.x / 2);
    const dy = other.pos.y + other.size.y / 2 - (this.pos.y + this.size.y / 2);
    return Math.sqrt(dx * dx + dy * dy);
  }

  collideWith(_other: TPFEntity, _axis: string): void {}

  ready(): void {}
}

export default TPFEntity;

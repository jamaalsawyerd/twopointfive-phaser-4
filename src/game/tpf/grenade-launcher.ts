/**
 * Grenade launcher weapon and grenade/explosion/blast entities. Weapon spawns EntityGrenade on shoot();
 * grenade bounces, then spawns EntityGrenadeExplosion and EntityBlastRadius. MainScene wires factories and images in create().
 * EntityGrenadeDirectional is the 8-direction grenade; it drops to one angle while _scene.directionalSprites is false (the B key).
 */
import Weapon from './weapon.ts';
import type { WeaponOpts } from './weapon.ts';
import DirectionalSprite, { DEFAULT_DIRECTION_ROWS } from './directional-sprite.ts';
import type { DirectionRows } from './directional-sprite.ts';
import TPFEntity from '~/twopointfive/entity.ts';
import { wrapAngle, limit } from '~/twopointfive/util.ts';
import { Tile } from '~/twopointfive/world/tile.ts';
import type { ImageInfo, EntityContext, TraceResult } from '~/twopointfive/types.ts';

/** What a directional grenade needs from the scene: whether sprites use their 8 directions. */
interface SpriteScene {
  directionalSprites: boolean;
}

export interface GrenadeLauncherOpts extends WeaponOpts {
  EntityGrenade?: new (
    x: number,
    y: number,
    settings: Record<string, unknown>,
    context: EntityContext,
  ) => TPFEntity | ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity);
}

/** Grenade launcher: spawns EntityGrenade with angle; depleted() plays empty sound. */
class WeaponGrenadeLauncher extends Weapon {
  EntityGrenade: GrenadeLauncherOpts['EntityGrenade'] | null;

  constructor(opts?: GrenadeLauncherOpts) {
    opts = opts || {};
    const merged = Object.assign({}, opts);
    merged.tileWidth = merged.tileWidth || 180;
    merged.tileHeight = merged.tileHeight || 134;
    super(merged);

    this.offset = { x: 0, y: 128 };
    // The art is sized for a 720px-tall view. Scaling from the view's height keeps it the same size on
    // screen when a window narrower than 16:9 makes Scale.EXPAND pin the canvas width and grow its height.
    this.hudReferenceHeight = 720;
    this.maxAmmo = 80;
    this.cooldown = 0.5;

    // offset and hudReferenceHeight changed above, so re-anchor (this also applies the hudX/hudY view origin).
    this.updateHudAnchor();

    this.addAnim('idle', 100, [0]);
    this.addAnim('shoot', 0.1, [1, 0], true);

    this.EntityGrenade = opts.EntityGrenade || null;
  }

  depleted(): boolean {
    if (this.shootTimer.delta() > 0 && this.ammo <= 0) {
      this.shootTimer.set(this.cooldown);
      if (this.sounds.empty) this.sounds.empty.play();
      return true;
    }
    return false;
  }

  shoot(x: number, y: number, angle: number): void {
    if (this.gameState && this.EntityGrenade) {
      this.gameState.spawnEntity(
        this.EntityGrenade as unknown as new (
          x: number,
          y: number,
          s: Record<string, unknown>,
          c: EntityContext,
        ) => TPFEntity,
        x,
        y,
        { angle: angle },
      );
    }
    this.currentAnim = this.anims.shoot.rewind();
    if (this.sounds.shoot) this.sounds.shoot.play();
    this.flash(0.2);
  }
}

/**
 * EntityGrenade - projectile fired by grenade launcher.
 */
class EntityGrenade extends TPFEntity {
  speed: number;
  blastSettings: { radius: number; damage: number };
  explosionParticles: number;
  explosionRadius: number;
  angle: number;

  _bounceSound: { play(): void } | null;
  _explodeSound: { play(): void } | null;
  _grenadeImage: ImageInfo | null;
  _explosionImage: ImageInfo | null;
  EntityGrenadeExplosion:
    | ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity)
    | null;
  EntityBlastRadius:
    | (new (x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity)
    | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.checkAgainst = TPFEntity.TYPE.B;
    this.size = { x: 8, y: 8 };
    this.speed = 440;
    this.scale = 0.25;
    this.bounciness = 0.8;
    this.minBounceVelocity = 0.5;
    this.blastSettings = { radius: 100, damage: 100 };
    this.explosionParticles = 20;
    this.explosionRadius = 60;
    this.dynamicLight = true;
    this.angle = (settings && (settings.angle as number)) || 0;

    this._bounceSound = (settings && (settings.bounceSound as { play(): void })) || null;
    this._explodeSound = (settings && (settings.explodeSound as { play(): void })) || null;
    this._grenadeImage = (settings && (settings.grenadeImage as ImageInfo)) || null;
    this._explosionImage = (settings && (settings.explosionImage as ImageInfo)) || null;
    this.EntityGrenadeExplosion =
      (settings && (settings.EntityGrenadeExplosion as typeof this.EntityGrenadeExplosion)) || null;
    this.EntityBlastRadius = (settings && (settings.EntityBlastRadius as typeof this.EntityBlastRadius)) || null;

    this.pos.x = (x || 0) - this.size.x / 2;
    this.pos.y = (y || 0) - this.size.y / 2;

    if (this._grenadeImage) {
      this.animSheet = { image: this._grenadeImage, width: 32, height: 32 };
      this.tile = new Tile(this._grenadeImage, 0, 32, 32, this.scale);
    }
    this.addAnim('idle', 1, [0]);

    this.vel.x = -Math.sin(this.angle) * this.speed;
    this.vel.y = -Math.cos(this.angle) * this.speed;
    this.vel.z = 1.2;
    this.pos.z = 12;

    if (this.context.culledSectors) this.context.culledSectors.moveEntity(this);
  }

  update(): void {
    if (this.currentAnim && this.currentAnim.loopCount > 0) {
      this.kill();
      return;
    }

    const zvel = this.vel.z;
    super.update();

    if (zvel < 0 && this.vel.z > 0) {
      if (this._bounceSound) this._bounceSound.play();
    }
  }

  check(_other: TPFEntity): void {
    this.kill();
  }

  handleMovementTrace(res: TraceResult): void {
    if (res.collision.x || res.collision.y) {
      if (this._bounceSound) this._bounceSound.play();
    }
    super.handleMovementTrace(res);
  }

  kill(): void {
    const game = this.context.game;
    if (game) {
      for (let i = 0; i < this.explosionParticles; i++) {
        const ex = this.pos.x + Math.random() * this.explosionRadius * 2 - this.explosionRadius;
        const ey = this.pos.y + Math.random() * this.explosionRadius * 2 - this.explosionRadius;
        if (this.EntityGrenadeExplosion) {
          game.spawnEntity(
            this.EntityGrenadeExplosion as unknown as new (
              x: number,
              y: number,
              s: Record<string, unknown>,
              c: EntityContext,
            ) => TPFEntity,
            ex,
            ey,
            {
              explosionImage: this._explosionImage,
            },
          );
        }
      }

      if (this.EntityBlastRadius) {
        game.spawnEntity(
          this.EntityBlastRadius,
          this.pos.x,
          this.pos.y,
          this.blastSettings as unknown as Record<string, unknown>,
        );
      }
    }

    if (this._explodeSound) this._explodeSound.play();
    this._killed = true;
    this.remove();
  }
}

/**
 * Grenade drawn from an 8-direction sheet (media/grenade-directions.png). The glowing side of the ball is
 * its rear, so it starts out facing back along its launch: a grenade flying away shows row 0, the original
 * art. A wall it glances off sets it spinning about its upright axis, which the rows show as the ball
 * turning; the spin fades, and the ball keeps whatever way it ends up facing. While the scene's
 * directionalSprites is false it is the original grenade: it shows its front row, the one-angle sprite, and
 * doesn't spin.
 */
class EntityGrenadeDirectional extends EntityGrenade {
  /** Which sheet row holds each direction. A sheet laid out differently passes its own in settings, beside grenadeDirectionsImage. */
  directionRows: DirectionRows;
  /** Spin a wall hit adds per px/s the ball was sliding along the wall, in radians per second. */
  spinPerSpeed: number;
  /** Fastest spin, radians per second. Past about 3 turns a second the 8 rows start to strobe. */
  maxSpin: number;
  /** Seconds for the spin to halve. */
  spinHalfLife: number;
  _directions: DirectionalSprite | null;
  _scene: SpriteScene | null;
  /** The way the glowing side faces, in radians as TPFEntity.angleTo measures them. */
  _facing: number;
  /** How fast _facing turns, radians per second: wall hits add to it, and it fades. */
  _spin: number;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.directionRows = DEFAULT_DIRECTION_ROWS;
    this.spinPerSpeed = 0.04;
    this.maxSpin = 6 * Math.PI;
    this.spinHalfLife = 0.35;
    this._directions = null;
    this._scene = (settings && (settings.scene as SpriteScene)) || null;
    this._facing = Math.atan2(-this.vel.y, -this.vel.x);
    this._spin = 0;
    // Row 0 of the 8-direction sheet is the one-angle sprite, so it serves both modes. TPFEntity.init()
    // builds the tile from animSheet.
    const sheet = settings && (settings.grenadeDirectionsImage as ImageInfo);
    if (sheet) this.animSheet = { image: sheet, width: 32, height: 32 };
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    // TPFEntity.init() copies settings onto the entity, so a directionRows setting is in place by now.
    super.init(x, y, settings);
    if (this.animSheet) this._directions = new DirectionalSprite(this, this.directionRows);
    // TPFEntity.init() set the tile before there was a row to pick; set it again.
    if (this._directions) this.updateQuad();
  }

  update(): void {
    if (this._directional()) {
      const tick = this.context.tick || 1 / 60;
      this._facing = wrapAngle(this._facing + this._spin * tick);
      this._spin *= Math.pow(0.5, tick / this.spinHalfLife);
      if (Math.abs(this._spin) < 0.5) this._spin = 0;
    } else {
      // The one-angle grenade doesn't spin: drop any spin in progress, so switching back doesn't show a
      // ball that turned while it looked still.
      this._spin = 0;
    }
    super.update();
  }

  handleMovementTrace(res: TraceResult): void {
    // Friction where the ball touches the wall pushes against the way it slides along it, which spins it
    // about its upright axis; a head-on hit barely spins it. Read the velocity before super() bounces it.
    if (this._directional()) {
      let slide = 0;
      if (res.collision.x) slide -= Math.sign(this.vel.x) * this.vel.y;
      if (res.collision.y) slide += Math.sign(this.vel.y) * this.vel.x;
      if (slide) this._spin = limit(this._spin + slide * this.spinPerSpeed, -this.maxSpin, this.maxSpin);
    }
    super.handleMovementTrace(res);
  }

  updateQuad(): void {
    this._directions?.update(this, this._facing, this._directional());
    super.updateQuad();
  }

  /** On unless the scene has switched sprites to one angle; a grenade spawned without a scene stays directional. */
  _directional(): boolean {
    return !this._scene || this._scene.directionalSprites;
  }
}

/**
 * EntityGrenadeExplosion - visual explosion particle.
 */
class EntityGrenadeExplosion extends TPFEntity {
  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.size = { x: 0, y: 0 };
    this.scale = 1;
    this.gravityFactor = 0;
    this.dynamicLight = false;

    const explosionImage = (settings && (settings.explosionImage as ImageInfo)) || null;
    if (explosionImage) {
      this.animSheet = { image: explosionImage, width: 32, height: 32 };
      this.tile = new Tile(explosionImage, 0, 32, 32, this.scale);
    }

    const frameTime = Math.random() * 0.1 + 0.03;
    this.addAnim('idle', frameTime, [0, 1, 2, 3], true);

    this.pos.z = Math.random() * 20;

    if (this.context.culledSectors) this.context.culledSectors.moveEntity(this);
  }

  update(): void {
    super.update();
    if (this.currentAnim?.loopCount) {
      this.kill();
    }
  }
}

/**
 * EntityBlastRadius - invisible damage area, lives 2 frames.
 */
class EntityBlastRadius extends TPFEntity {
  radius: number;
  damage: number;
  frame: number;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    const radius = (settings && (settings.radius as number)) || 8;
    const damage = (settings && (settings.damage as number)) || 20;
    const px = (x || 0) - radius;
    const py = (y || 0) - radius;
    super(px, py, settings, context);
    this.checkAgainst = TPFEntity.TYPE.B;
    this.size = { x: radius * 2, y: radius * 2 };
    this.radius = radius;
    this.damage = damage;
    this.frame = 0;
    this.dynamicLight = false;
  }

  update(): void {
    if (this.frame === 2) {
      this.kill();
    }
    this.frame++;
  }

  check(other: TPFEntity): void {
    if (this.frame !== 1) return;

    const f = 1 - this.distanceTo(other) / this.radius;
    if (f > 0) {
      const dmg = Math.ceil(Math.sqrt(f) * this.damage);
      other.receiveDamage(dmg, this);
    }
  }

  draw(): void {
    // Invisible - no drawing
  }
}

export { WeaponGrenadeLauncher, EntityGrenade, EntityGrenadeDirectional, EntityGrenadeExplosion, EntityBlastRadius };

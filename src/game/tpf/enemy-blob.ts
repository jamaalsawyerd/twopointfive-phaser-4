/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * Blob enemy: spawner (idle/spawn anim), blob (chases player, damage on touch), 8-direction variants of both, and gib particles.
 * Spawner creates a blob via the factory MainScene passes in spawnBlob(), along with the scene and images; blob calls _scene.incrementKillCount() on death.
 * Both freeze while _scene.enemiesActive is false (the demo's P key): blobs stand still and do no damage, spawners stay idle.
 * The directional variants drop to one angle, and the blob to the original steering, while _scene.directionalSprites is false (the B key).
 */
import TPFEntity from '~/twopointfive/entity.ts';
import TPFTimer from '~/twopointfive/timer.ts';
import { wrapAngle, limit } from '~/twopointfive/util.ts';
import DirectionalSprite, { DEFAULT_DIRECTION_ROWS } from './directional-sprite.ts';
import type { DirectionRows } from './directional-sprite.ts';
import EntityParticle from './particle.ts';
import type { ImageInfo, EntityContext } from '~/twopointfive/types.ts';

/** What blobs and spawners need from the scene: the kill counter, whether enemies are switched on, and whether blobs use 8 directions. */
interface EnemyScene {
  incrementKillCount(): void;
  enemiesActive: boolean;
  directionalSprites: boolean;
}

class EntityEnemyBlobSpawner extends TPFEntity {
  angle: number;

  _blobSpawnImage: ImageInfo | null;
  _blobImage: ImageInfo | null;
  _blobGibImage: ImageInfo | null;
  _blobGibSound: { play(): void } | null;
  _player: TPFEntity | null;
  _scene: EnemyScene | null;
  EntityEnemyBlob:
    | ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity)
    | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.size = { x: 16, y: 16 };
    this.scale = 0.5;
    this.dynamicLight = true;
    this.angle = 0;

    this._blobSpawnImage = (settings && (settings.blobSpawnImage as ImageInfo)) || null;
    this._blobImage = (settings && (settings.blobImage as ImageInfo)) || null;
    this._blobGibImage = (settings && (settings.blobGibImage as ImageInfo)) || null;
    this._blobGibSound = (settings && (settings.blobGibSound as { play(): void })) || null;
    this._player = (settings && (settings.player as TPFEntity)) || null;
    this._scene = (settings && (settings.scene as EnemyScene)) || null;
    this.EntityEnemyBlob = (settings && (settings.EntityEnemyBlob as typeof this.EntityEnemyBlob)) || null;
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    if (this._blobSpawnImage) {
      this.animSheet = { image: this._blobSpawnImage, width: 64, height: 128 };
    }
    this.addAnim('idle', 1, [0]);
    this.addAnim(
      'spawn',
      0.05,
      [
        0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 14, 15, 16, 17, 18, 19,
        20, 21,
      ],
    );
    super.init(x, y, settings);
  }

  update(): void {
    const player = this._player;
    if (!player) {
      super.update();
      return;
    }

    // Enemies switched off: stay idle. A spawn in progress starts over later, because animations run on the
    // scene clock and a paused one would otherwise finish the moment enemies came back.
    if (this._scene && !this._scene.enemiesActive) {
      this.currentAnim = this.anims.idle;
      this.updateQuad();
      return;
    }

    if (this.currentAnim === this.anims.idle) {
      if (this._manhattanDistanceTo(player) < 512) {
        this.startSpawn(player);
      } else {
        // Idle and out of range: skip the physics step, but keep the billboard turned to the camera.
        this.updateQuad();
        return;
      }
    }

    super.update();

    if (this.currentAnim === this.anims.spawn && this.currentAnim.loopCount) {
      const game = this.context.game;
      if (game && this.EntityEnemyBlob) {
        game.spawnEntity(
          this.EntityEnemyBlob as unknown as new (
            x: number,
            y: number,
            s: Record<string, unknown>,
            c: EntityContext,
          ) => TPFEntity,
          this.pos.x,
          this.pos.y,
          this.blobSettings(),
        );
      }
      this.kill();
    }
  }

  /** Starts the drip-and-drop animation; the player has come within range. */
  startSpawn(_player: TPFEntity): void {
    this.currentAnim = this.anims.spawn.rewind();
  }

  /** Settings for the blob spawned at the end of the animation. */
  blobSettings(): Record<string, unknown> {
    return {};
  }

  _manhattanDistanceTo(other: TPFEntity): number {
    return Math.abs(other.pos.x - this.pos.x) + Math.abs(other.pos.y - this.pos.y);
  }
}

// ---------------------------------------------------------------------------
// EntityEnemyBlob
// ---------------------------------------------------------------------------

class EntityEnemyBlob extends TPFEntity {
  damage: number;
  angle: number;
  speed: number;
  hurtTimer: TPFTimer;

  _blobImage: ImageInfo | null;
  _blobGibImage: ImageInfo | null;
  _blobGibSound: { play(): void } | null;
  _player: TPFEntity | null;
  _scene: EnemyScene | null;
  EntityEnemyBlobGib:
    | ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => TPFEntity)
    | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.type = TPFEntity.TYPE.B;
    this.checkAgainst = TPFEntity.TYPE.A;
    this.collides = TPFEntity.COLLIDES.ACTIVE;

    this.size = { x: 16, y: 16 };
    this.friction = { x: 100, y: 100 };
    this.scale = 0.5;

    this.health = 10;
    this.damage = 10;
    this.dynamicLight = true;

    this.angle = 0;
    this.speed = 80;

    this.hurtTimer = new TPFTimer();

    this._blobImage = (settings && (settings.blobImage as ImageInfo)) || null;
    this._blobGibImage = (settings && (settings.blobGibImage as ImageInfo)) || null;
    this._blobGibSound = (settings && (settings.blobGibSound as { play(): void })) || null;
    this._player = (settings && (settings.player as TPFEntity)) || null;
    this._scene = (settings && (settings.scene as EnemyScene)) || null;
    this.EntityEnemyBlobGib = (settings && (settings.EntityEnemyBlobGib as typeof this.EntityEnemyBlobGib)) || null;
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    if (this._blobImage) {
      this.animSheet = { image: this._blobImage, width: 64, height: 64 };
    }
    this.addAnim('crawl', 0.04, [0, 1, 2, 3, 4, 5, 4, 3, 2, 1]);
    super.init(x, y, settings);
    if (this.currentAnim) this.currentAnim.gotoRandomFrame();
  }

  update(): void {
    // Enemies switched off: stand still, but keep animating and facing the camera.
    if (this._scene && !this._scene.enemiesActive) {
      this.vel.x = 0;
      this.vel.y = 0;
      super.update();
      return;
    }

    const player = this._player;
    if (!player || player._killed) {
      this.vel.x = -this.vel.x;
      this.vel.y = -this.vel.y;
      super.update();
      return;
    }

    this.steer(player);
    super.update();
  }

  /** Heads straight for the player. */
  steer(player: TPFEntity): void {
    this.angle = this.angleTo(player);
    this.vel.x = Math.cos(this.angle) * this.speed;
    this.vel.y = Math.sin(this.angle) * this.speed;
  }

  kill(): void {
    const game = this.context.game;
    if (game && this.EntityEnemyBlobGib) {
      const cx = this.pos.x + this.size.x / 2;
      const cy = this.pos.y + this.size.y / 2;
      for (let i = 0; i < 20; i++) {
        game.spawnEntity(
          this.EntityEnemyBlobGib as unknown as new (
            x: number,
            y: number,
            s: Record<string, unknown>,
            c: EntityContext,
          ) => TPFEntity,
          cx,
          cy,
          {},
        );
      }
    }
    if (this._blobGibSound) this._blobGibSound.play();

    this._scene?.incrementKillCount();

    super.kill();
  }

  check(other: TPFEntity): void {
    // Frozen blobs are harmless. They still block the player, since collision is resolved separately.
    if (this._scene && !this._scene.enemiesActive) return;
    if (this.hurtTimer.delta() < 0) return;

    this.hurtTimer.set(1);

    this.vel.x = -this.vel.x;
    this.vel.y = -this.vel.y;

    other.receiveDamage(this.damage, this);
  }
}

// ---------------------------------------------------------------------------
// EntityEnemyBlobDirectional
// ---------------------------------------------------------------------------

/**
 * Blob drawn from an 8-direction sheet (media/blob-directions.png), showing the row for the side the
 * camera sees. It turns toward the player at no more than turnRate instead of snapping, which is what
 * brings its sides and back into view. While the scene's directionalSprites is false it shows its front row,
 * the one-angle sprite, and steers like EntityEnemyBlob.
 */
class EntityEnemyBlobDirectional extends EntityEnemyBlob {
  /**
   * Radians per second. At the default speed, keep it above about 140°/s: any slower and the blob's
   * turning circle outgrows the player, so it can circle without ever touching.
   */
  turnRate: number;
  /** Which sheet row holds each direction. A sheet laid out differently passes its own in settings, beside blobDirectionsImage. */
  directionRows: DirectionRows;
  _directions: DirectionalSprite | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.turnRate = Math.PI;
    this.directionRows = DEFAULT_DIRECTION_ROWS;
    this._directions = null;
    // Row 0 of the 8-direction sheet is the one-angle sheet, so it serves both modes.
    this._blobImage = (settings && (settings.blobDirectionsImage as ImageInfo)) || this._blobImage;
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    // TPFEntity.init() copies settings onto the entity, so a directionRows setting is in place by now.
    super.init(x, y, settings);
    if (this.animSheet) this._directions = new DirectionalSprite(this, this.directionRows);
    // Keep a heading handed over in settings (a directional spawner passes the way it faced); otherwise start
    // out facing the player rather than east, so a new blob doesn't swing round on its first steps.
    if (this._player && !(settings && 'angle' in settings)) this.angle = this.angleTo(this._player);
    // TPFEntity.init() already set the tile, before there was a row to pick; set it again so the first
    // frame drawn is the right row, not the front.
    if (this._directions) this.updateQuad();
  }

  steer(player: TPFEntity): void {
    if (!this._directional()) {
      super.steer(player);
      return;
    }
    const maxTurn = this.turnRate * (this.context.tick || 1 / 60);
    this.angle = wrapAngle(this.angle + limit(wrapAngle(this.angleTo(player) - this.angle), -maxTurn, maxTurn));
    this.vel.x = Math.cos(this.angle) * this.speed;
    this.vel.y = Math.sin(this.angle) * this.speed;
  }

  updateQuad(): void {
    this._directions?.update(this, this.angle, this._directional());
    super.updateQuad();
  }

  /** On unless the scene has switched blobs to one angle; a blob spawned without a scene stays directional. */
  _directional(): boolean {
    return !this._scene || this._scene.directionalSprites;
  }
}

// ---------------------------------------------------------------------------
// EntityEnemyBlobSpawnerDirectional
// ---------------------------------------------------------------------------

/**
 * Spawner drawn from an 8-direction sheet (media/blob-spawn-directions.png). It doesn't move, so it takes a
 * heading when its animation starts, facing the player, and keeps it: walk round it mid-spawn and you see
 * its sides. The blob it spawns starts with that heading, so the view doesn't jump at the hand-over. While
 * the scene's directionalSprites is false it shows its front row, the one-angle sprite.
 */
class EntityEnemyBlobSpawnerDirectional extends EntityEnemyBlobSpawner {
  /** Which sheet row holds each direction. A sheet laid out differently passes its own in settings, beside blobSpawnDirectionsImage. */
  directionRows: DirectionRows;
  _directions: DirectionalSprite | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.directionRows = DEFAULT_DIRECTION_ROWS;
    this._directions = null;
    // Row 0 of the 8-direction sheet is the one-angle sheet, so it serves both modes.
    this._blobSpawnImage = (settings && (settings.blobSpawnDirectionsImage as ImageInfo)) || this._blobSpawnImage;
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    // TPFEntity.init() copies settings onto the entity, so a directionRows setting is in place by now.
    super.init(x, y, settings);
    if (this.animSheet) this._directions = new DirectionalSprite(this, this.directionRows);
    // TPFEntity.init() set the tile before there was a row to pick; set it again.
    if (this._directions) this.updateQuad();
  }

  startSpawn(player: TPFEntity): void {
    this.angle = this.angleTo(player);
    super.startSpawn(player);
  }

  blobSettings(): Record<string, unknown> {
    return { angle: this.angle };
  }

  updateQuad(): void {
    this._directions?.update(this, this.angle, !this._scene || this._scene.directionalSprites);
    super.updateQuad();
  }
}

// ---------------------------------------------------------------------------
// EntityEnemyBlobGib
// ---------------------------------------------------------------------------

class EntityEnemyBlobGib extends EntityParticle {
  _blobGibImage: ImageInfo | null;
  scale: 0.5;
  friction: { x: 10; y: 10 };
  animSheet: { image: ImageInfo; width: number; height: number } | null;
  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.scale = 0.5;
    this.initialVel = { x: 120, y: 120, z: 2.5 };
    this.friction = { x: 10, y: 10 };
    this.lifetime = 2;

    this._blobGibImage = (settings && (settings.blobGibImage as ImageInfo)) || null;
    this.animSheet = { image: this._blobGibImage!, width: 16, height: 16 };
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    this.addAnim('idle', 5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    super.init(x, y, settings);
  }
}

export {
  EntityEnemyBlobSpawner,
  EntityEnemyBlobSpawnerDirectional,
  EntityEnemyBlob,
  EntityEnemyBlobDirectional,
  EntityEnemyBlobGib,
};

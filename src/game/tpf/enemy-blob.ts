/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/**
 * Blob enemy: spawner (idle/spawn anim), blob (chases player, damage on touch), and gib particles.
 * Spawner creates EntityEnemyBlob via factory; blob calls _scene.incrementKillCount() on death. MainScene passes scene and images in spawnBlob().
 */
import TPFEntity from '~/twopointfive/entity.ts';
import TPFTimer from '~/twopointfive/timer.ts';
import EntityParticle from './particle.ts';
import type { ImageInfo, EntityContext } from '~/twopointfive/types.ts';

class EntityEnemyBlobSpawner extends TPFEntity {
  angle: number;

  _blobSpawnImage: ImageInfo | null;
  _blobImage: ImageInfo | null;
  _blobGibImage: ImageInfo | null;
  _blobGibSound: { play(): void } | null;
  _player: TPFEntity | null;
  _scene: { incrementKillCount(): void } | null;
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
    this._scene = (settings && (settings.scene as { incrementKillCount(): void })) || null;
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

    if (this.currentAnim === this.anims.idle) {
      if (this._manhattanDistanceTo(player) < 512) {
        this.currentAnim = this.anims.spawn.rewind();
      } else {
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
          {},
        );
      }
      this.kill();
    }
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
  _scene: { incrementKillCount(): void } | null;
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
    this._scene = (settings && (settings.scene as { incrementKillCount(): void })) || null;
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
    const player = this._player;
    if (!player || player._killed) {
      this.vel.x = -this.vel.x;
      this.vel.y = -this.vel.y;
      super.update();
      return;
    }

    this.angle = this.angleTo(player);
    this.vel.x = Math.cos(this.angle) * this.speed;
    this.vel.y = Math.sin(this.angle) * this.speed;

    super.update();
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
    if (this.hurtTimer.delta() < 0) return;

    this.hurtTimer.set(1);

    this.vel.x = -this.vel.x;
    this.vel.y = -this.vel.y;

    other.receiveDamage(this.damage, this);
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

export { EntityEnemyBlobSpawner, EntityEnemyBlob, EntityEnemyBlobGib };

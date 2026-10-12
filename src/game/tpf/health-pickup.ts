/**
 * Health pickup: bounces in z, check() calls player.giveHealth() and kills self. Spawned by MainScene spawnPowerup().
 */
import TPFEntity from '~/twopointfive/entity.ts';
import TPFTimer from '~/twopointfive/timer.ts';
import type { ImageInfo, EntityContext } from '~/twopointfive/types.ts';

/** checkAgainst TYPE.A; bounce uses bounceTimer (simulation time). */
class EntityHealthPickup extends TPFEntity {
  amount: number;
  _healthImage: ImageInfo | null;
  _pickupSound: { play(): void } | null;
  _player: TPFEntity | null;
  bounceTimer: TPFTimer | null;

  constructor(x: number, y: number, settings: Record<string, unknown> | null, context: Partial<EntityContext> | null) {
    super(x, y, settings, context);
    this.checkAgainst = TPFEntity.TYPE.A;
    this.size = { x: 16, y: 16 };
    this.scale = 0.5;
    this.amount = 25;
    this.gravityFactor = 0;
    this.dynamicLight = true;

    this._healthImage = (settings && (settings.healthImage as ImageInfo)) || null;
    this._pickupSound = (settings && (settings.pickupSound as { play(): void })) || null;
    this._player = (settings && (settings.player as TPFEntity)) || null;
    this.bounceTimer = null;
  }

  init(x: number, y: number, settings: Record<string, unknown> | null): void {
    if (this._healthImage) {
      this.animSheet = { image: this._healthImage, width: 32, height: 32 };
    }
    this.addAnim('idle', 10, [0]);
    this.bounceTimer = new TPFTimer();
    super.init(x, y, settings);
  }

  update(): void {
    if (this.bounceTimer) {
      this.pos.z = (Math.cos(this.bounceTimer.delta() * 3) + 1) * 3;
    }
    super.update();
  }

  check(other: TPFEntity): void {
    if ((other as unknown as { giveHealth?: (amount: number) => boolean }).giveHealth?.(this.amount)) {
      if (this._pickupSound) this._pickupSound.play();
      this.kill();
    }
  }
}

export default EntityHealthPickup;

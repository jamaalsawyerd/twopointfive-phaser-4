/**
 * Weapon base: HUD sprite (a Phaser Image), cooldown, ammo, trigger/shoot. Subclass implements
 * shoot(). onAmmoChange notifies the scene for proactive HUD. EntityPlayer holds currentWeapon
 * and calls trigger().
 */
import TPFTimer from '~/twopointfive/timer.ts';
import Animation from './animation.ts';
import type Phaser from 'phaser';
import type GameState from '~/twopointfive/game.ts';
import type { Color } from '~/twopointfive/types.ts';

export interface WeaponOpts {
  ammo?: number;
  tileWidth?: number;
  tileHeight?: number;
  hudWidth?: number;
  hudHeight?: number;
  /** Top-left of the view the weapon is anchored to; pass `getView().world` x/y when it is inset. */
  hudX?: number;
  hudY?: number;
  gameState?: GameState | null;
  sounds?: Record<string, { play(): void }>;
  onAmmoChange?: (ammo: number) => void;
  scene?: Phaser.Scene | null;
  textureKey?: string;
  depth?: number;
  [key: string]: unknown;
}

/** HUD image, ammo, cooldown (TPFTimer); trigger() decrements ammo and calls shoot() if not depleted. */
class Weapon {
  offset: { x: number; y: number };
  offsetAngle: number;
  projectileOffset: number;
  pos: { x: number; y: number };
  bobOffset: number;

  phaserImage: Phaser.GameObjects.Image | null;
  textureKey: string | null;
  scene: Phaser.Scene | null;
  ammo: number;
  maxAmmo: number;
  anims: Record<string, Animation>;
  currentAnim: Animation | null;

  cooldown: number;
  shootTimer: TPFTimer;

  currentQuadColor: Color;
  flashQuadColor: Color;
  unsetFlashTimer: TPFTimer | null;

  tileWidth: number;
  tileHeight: number;
  hudWidth: number;
  hudHeight: number;
  hudX: number;
  hudY: number;

  gameState: GameState | null;
  sounds: Record<string, { play(): void }>;
  onAmmoChange: ((ammo: number) => void) | undefined;

  constructor(opts?: WeaponOpts) {
    opts = opts || {};

    this.offset = { x: 0, y: 48 };
    this.offsetAngle = 0;
    this.projectileOffset = 0;
    this.pos = { x: 0, y: 0 };
    this.bobOffset = 0;

    this.phaserImage = null;
    this.textureKey = opts.textureKey || null;
    this.scene = opts.scene || null;
    this.ammo = opts.ammo || 0;
    this.maxAmmo = 100;
    this.anims = {};
    this.currentAnim = null;

    this.cooldown = 1;
    this.shootTimer = new TPFTimer();

    this.currentQuadColor = { r: 1, g: 1, b: 1 };
    this.flashQuadColor = { r: 1, g: 1, b: 1 };
    this.unsetFlashTimer = null;

    this.tileWidth = opts.tileWidth || 0;
    this.tileHeight = opts.tileHeight || 0;
    this.hudWidth = opts.hudWidth || 640;
    this.hudHeight = opts.hudHeight || 480;
    this.hudX = opts.hudX || 0;
    this.hudY = opts.hudY || 0;

    this.gameState = opts.gameState || null;
    this.sounds = (opts.sounds || {}) as Record<string, { play(): void }>;
    this.onAmmoChange = opts.onAmmoChange;

    if (this.scene && this.textureKey && this.tileWidth) {
      this.phaserImage = this.scene.add
        .image(0, 0, this.textureKey, 0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(opts.depth ?? 900);
    }
    this.updateHudAnchor();
  }

  addAnim(name: string, frameTime: number, sequence: number[], stop?: boolean): Animation {
    const a = new Animation(frameTime, sequence, stop);
    this.anims[name] = a;
    if (!this.currentAnim) {
      this.currentAnim = a;
      this.setHudFrame(a.tile);
    }
    return a;
  }

  setHudFrame(tile: number): void {
    if (this.phaserImage) {
      this.phaserImage.setFrame(tile);
    }
  }

  /** Re-anchors to a new view rectangle, e.g. from the plugin's `viewchange` event. */
  setHudRect(rect: { x: number; y: number; width: number; height: number }): void {
    this.hudX = rect.x;
    this.hudY = rect.y;
    this.hudWidth = rect.width;
    this.hudHeight = rect.height;
    this.updateHudAnchor();
  }

  /**
   * Recomputes the weapon's resting position: centred horizontally on the view it is anchored to
   * and sitting on its bottom edge, less `offset`. Subclasses that change `offset` or the tile size
   * after `super()` must call this again rather than repeating the arithmetic, or they will drop
   * the hudX/hudY origin and mis-place the weapon when the view is inset in the canvas.
   */
  updateHudAnchor(): void {
    this.pos.x = this.hudX + this.hudWidth / 2 - this.tileWidth / 2 - this.offset.x;
    this.pos.y = this.hudY + this.hudHeight - this.offset.y;
    this.updateHudPosition();
  }

  updateHudPosition(): void {
    if (this.phaserImage) this.phaserImage.setPosition(this.pos.x, this.pos.y + this.bobOffset);
  }

  trigger(x: number, y: number, angle: number): void {
    if (this.ammo > 0 && this.shootTimer.delta() > 0) {
      this.shootTimer.set(this.cooldown);
      this.ammo--;
      this.onAmmoChange?.(this.ammo);

      const offsetAngle = angle - Math.PI / 2;
      const sx = x - Math.sin(offsetAngle) * this.projectileOffset;
      const sy = y - Math.cos(offsetAngle) * this.projectileOffset;

      this.shoot(sx, sy, angle + this.offsetAngle);
    }
  }

  depleted(): boolean {
    return this.shootTimer.delta() > 0 && this.ammo <= 0;
  }

  giveAmmo(ammo: number): void {
    this.ammo = Math.min(this.maxAmmo, this.ammo + ammo);
    this.onAmmoChange?.(this.ammo);
  }

  shoot(_x: number, _y: number, _angle: number): void {
    // Override in subclass
  }

  setLight(color: Color): void {
    this.currentQuadColor = color;
    if (this.unsetFlashTimer && this.unsetFlashTimer.delta() <= 0) return;
    if (this.phaserImage) {
      const r = Math.max(0, Math.min(255, Math.round(color.r * 255)));
      const g = Math.max(0, Math.min(255, Math.round(color.g * 255)));
      const b = Math.max(0, Math.min(255, Math.round(color.b * 255)));
      this.phaserImage.setTint((r << 16) | (g << 8) | b);
    }
  }

  flash(duration: number): void {
    if (this.phaserImage) this.phaserImage.setTint(0xffffff);
    this.unsetFlashTimer = new TPFTimer(duration);
  }

  update(): void {
    if (this.currentAnim) {
      this.currentAnim.update();
      this.setHudFrame(this.currentAnim.tile);
    }

    this.updateHudPosition();

    if (this.unsetFlashTimer && this.unsetFlashTimer.delta() > 0) {
      this.setLight(this.currentQuadColor);
      this.unsetFlashTimer = null;
    }
  }
}

export default Weapon;

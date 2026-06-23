/**
 * Weapon base: HUD sprite, cooldown, ammo, trigger/shoot. Subclass implements shoot().
 * onAmmoChange notifies the scene for proactive HUD. EntityPlayer holds currentWeapon and calls trigger().
 */
import TPFTimer from '~/twopointfive/timer.ts';
import Animation from './animation.ts';
import { HudTile } from '~/twopointfive/world/tile.ts';
import type Phaser from 'phaser';
import type Renderer from '~/twopointfive/renderer/renderer.ts';
import type GameState from '~/twopointfive/game.ts';
import type { ImageInfo, Color } from '~/twopointfive/types.ts';

export interface WeaponOpts {
  ammo?: number;
  image?: ImageInfo | null;
  tileWidth?: number;
  tileHeight?: number;
  renderer?: Renderer | null;
  hudWidth?: number;
  hudHeight?: number;
  gameState?: GameState | null;
  sounds?: Record<string, { play(): void }>;
  ammoIconImage?: ImageInfo | null;
  onAmmoChange?: (ammo: number) => void;
  scene?: Phaser.Scene | null;
  textureKey?: string;
  depth?: number;
  [key: string]: unknown;
}

/** HUD tile, ammo, cooldown (TPFTimer); trigger() decrements ammo and calls shoot() if not depleted. */
class Weapon {
  offset: { x: number; y: number };
  offsetAngle: number;
  projectileOffset: number;
  pos: { x: number; y: number };
  bobOffset: number;

  tile: HudTile | null;
  phaserImage: Phaser.GameObjects.Image | null;
  textureKey: string | null;
  scene: Phaser.Scene | null;
  ammo: number;
  maxAmmo: number;
  anims: Record<string, Animation>;
  currentAnim: Animation | null;

  cooldown: number;
  shootTimer: TPFTimer;
  ammoIcon: HudTile | null;

  currentQuadColor: Color;
  flashQuadColor: Color;
  unsetFlashTimer: TPFTimer | null;

  image: ImageInfo | null;
  tileWidth: number;
  tileHeight: number;
  renderer: Renderer | null;
  hudWidth: number;
  hudHeight: number;

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

    this.tile = null;
    this.phaserImage = null;
    this.textureKey = opts.textureKey || null;
    this.scene = opts.scene || null;
    this.ammo = opts.ammo || 0;
    this.maxAmmo = 100;
    this.anims = {};
    this.currentAnim = null;

    this.cooldown = 1;
    this.shootTimer = new TPFTimer();
    this.ammoIcon = null;

    this.currentQuadColor = { r: 1, g: 1, b: 1 };
    this.flashQuadColor = { r: 1, g: 1, b: 1 };
    this.unsetFlashTimer = null;

    this.image = opts.image || null;
    this.tileWidth = opts.tileWidth || 0;
    this.tileHeight = opts.tileHeight || 0;
    this.renderer = opts.renderer || null;
    this.hudWidth = opts.hudWidth || 640;
    this.hudHeight = opts.hudHeight || 480;

    this.gameState = opts.gameState || null;
    this.sounds = (opts.sounds || {}) as Record<string, { play(): void }>;
    this.onAmmoChange = opts.onAmmoChange;

    if (this.image && this.tileWidth) {
      this.tile = new HudTile(this.image, 0, this.tileWidth, this.tileHeight);
    }
    if (this.scene && this.textureKey && this.tileWidth) {
      this.phaserImage = this.scene.add
        .image(0, 0, this.textureKey, 0)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(opts.depth ?? 900);
    }
    this.pos.x = this.hudWidth / 2 - this.tileWidth / 2 - this.offset.x;
    this.pos.y = this.hudHeight - this.offset.y;
    this.updateHudPosition();
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
    if (this.tile) this.tile.setTile(tile);
    if (this.phaserImage) {
      this.phaserImage.setFrame(tile);
    }
  }

  updateHudPosition(): void {
    if (this.tile) this.tile.setPosition(this.pos.x, this.pos.y + this.bobOffset);
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
    if (this.tile) this.tile.quad.setColor(color);
    if (this.phaserImage) {
      const r = Math.max(0, Math.min(255, Math.round(color.r * 255)));
      const g = Math.max(0, Math.min(255, Math.round(color.g * 255)));
      const b = Math.max(0, Math.min(255, Math.round(color.b * 255)));
      this.phaserImage.setTint((r << 16) | (g << 8) | b);
    }
  }

  flash(duration: number): void {
    if (this.tile) this.tile.quad.setColor(this.flashQuadColor);
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

  draw(renderer?: Renderer): void {
    if (this.phaserImage) return;
    const r = renderer || this.renderer;
    if (this.tile && r) {
      this.tile.draw(r);
    }
  }
}

export default Weapon;

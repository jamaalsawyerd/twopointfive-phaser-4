/**
 * HUD damage indicator: shows a blood splat that fades out. Uses Phaser tweens so the scene
 * update loop does not need to drive the fade. MainScene creates one and calls show() from showDamageIndicator().
 */
import type Phaser from 'phaser';

/** Options for the blood overlay (view size and fade duration). */
export interface HudBloodOptions {
  viewWidth?: number;
  viewHeight?: number;
  /** Top-left of the view; pass `getView().world` x/y when the 2.5D view is inset in the canvas. */
  viewX?: number;
  viewY?: number;
  fadeDurationMs?: number;
}

export class HudBlood {
  private _scene: Phaser.Scene;
  private _image: Phaser.GameObjects.Image;
  private _viewWidth: number;
  private _viewHeight: number;
  private _viewX: number;
  private _viewY: number;
  private _fadeDurationMs: number;

  constructor(scene: Phaser.Scene, options?: HudBloodOptions) {
    this._scene = scene;
    this._viewWidth = options?.viewWidth ?? 640;
    this._viewHeight = options?.viewHeight ?? 480;
    this._viewX = options?.viewX ?? 0;
    this._viewY = options?.viewY ?? 0;
    this._fadeDurationMs = options?.fadeDurationMs ?? 1000;
    this._image = scene.add.image(0, 0, 'hud-blood').setOrigin(0, 0).setScrollFactor(0).setDepth(999).setAlpha(0);
  }

  /** Re-anchors to a new view rectangle, e.g. from the plugin's `viewchange` event; `scale` sizes the splat. */
  setViewRect(rect: { x: number; y: number; width: number; height: number }, scale = 1): void {
    this._viewX = rect.x;
    this._viewY = rect.y;
    this._viewWidth = rect.width;
    this._viewHeight = rect.height;
    this._image.setScale(scale);
  }

  show(): void {
    const x = this._viewX + Math.random() * (this._viewWidth - this._image.displayWidth);
    const y = this._viewY + Math.random() * (this._viewHeight - this._image.displayHeight);
    this._image.setPosition(x, y);
    this._image.setAlpha(1);
    this._scene.tweens.killTweensOf(this._image);
    this._scene.tweens.add({
      targets: this._image,
      alpha: 0,
      duration: this._fadeDurationMs,
      ease: 'Linear',
    });
  }
}

import type Phaser from 'phaser';
import TPFTimer from './timer.ts';

class TwoPointFiveTimeController {
  scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  now(): number {
    return this.scene.time.now / 1000;
  }

  bind(): void {
    TPFTimer.setTimeSource(() => this.now());
  }

  unbind(): void {
    TPFTimer.setTimeSource(null);
  }
}

export default TwoPointFiveTimeController;

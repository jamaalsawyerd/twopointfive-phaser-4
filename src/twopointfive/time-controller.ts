import type Phaser from 'phaser';
import TPFTimer from './timer.ts';

/**
 * The clock behind TPFTimer: the sum of the plugin's simulation steps (each capped at `maxTick`), so
 * timers stand still while the scene is paused and keep pace with entity movement, like Impact's
 * `Timer.maxStep`. (Phaser's scene clock jumps ahead by the paused time on resume.)
 */
class TwoPointFiveTimeController {
  scene: Phaser.Scene;
  /** Seconds of simulated time since the run started. */
  time: number;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.time = 0;
  }

  /** Advances the clock by one simulation step; the plugin calls this before updating entities. */
  step(tick: number): void {
    this.time += tick;
  }

  now(): number {
    return this.time;
  }

  bind(): void {
    TPFTimer.setTimeSource(() => this.now());
  }

  unbind(): void {
    TPFTimer.setTimeSource(null);
  }
}

export default TwoPointFiveTimeController;

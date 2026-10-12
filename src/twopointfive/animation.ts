/**
 * Frame-based sprite animation: sequence of tile indices, advanced by real time (TPFTimer).
 * Used by entities and maps. Independent of ctx.tick so animation rate is wall-clock.
 */
import TPFTimer from './timer.ts';

/** Advances frame from timer.delta() / frameTime; tile is the current frame's index. */
class Animation {
  timer: TPFTimer;
  frameTime: number;
  sequence: number[];
  stop: boolean;
  frame: number;
  tile: number;
  loopCount: number;

  constructor(frameTime: number, sequence: number[], stop?: boolean) {
    this.timer = new TPFTimer();
    this.frameTime = frameTime;
    this.sequence = sequence;
    this.stop = !!stop;
    this.frame = 0;
    this.tile = this.sequence[0];
    this.loopCount = 0;
  }

  rewind(): this {
    this.timer.set(0);
    this.loopCount = 0;
    this.frame = 0;
    this.tile = this.sequence[0];
    return this;
  }

  gotoFrame(f: number): void {
    this.timer.set(this.frameTime * -f - 0.0001);
    this.update();
  }

  gotoRandomFrame(): void {
    this.gotoFrame(Math.floor(Math.random() * this.sequence.length));
  }

  update(): void {
    const frameTotal = Math.floor(this.timer.delta() / this.frameTime);
    this.loopCount = Math.floor(frameTotal / this.sequence.length);
    if (this.stop && this.loopCount > 0) {
      this.frame = this.sequence.length - 1;
    } else {
      this.frame = frameTotal % this.sequence.length;
    }
    this.tile = this.sequence[this.frame];
  }
}

export default Animation;

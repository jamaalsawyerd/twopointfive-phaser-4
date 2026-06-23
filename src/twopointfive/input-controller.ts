import Phaser from 'phaser';

interface InputKeyState {
  isDown: boolean;
}

export interface TPFInputActions {
  forward: InputKeyState;
  back: InputKeyState;
  left: InputKeyState;
  right: InputKeyState;
  stepleft: InputKeyState;
  stepright: InputKeyState;
  shoot: InputKeyState;
}

const inertKey: InputKeyState = { isDown: false };

class TwoPointFiveInputController {
  scene: Phaser.Scene;
  canvas: HTMLCanvasElement;
  actions: TPFInputActions;
  _mouseDeltaX: number;
  _mouseDown: boolean;
  _pointerLockJustAcquired: boolean;
  _onClick: () => void;
  _onPointerLockChange: () => void;
  _onMouseMove: (event: MouseEvent) => void;
  _onMouseDown: (event: MouseEvent) => void;
  _onMouseUp: (event: MouseEvent) => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.canvas = scene.sys.game.canvas;
    this.actions = this._createActions();
    this._mouseDeltaX = 0;
    this._mouseDown = false;
    this._pointerLockJustAcquired = false;
    this._onClick = this._handleClick.bind(this);
    this._onPointerLockChange = this._handlePointerLockChange.bind(this);
    this._onMouseMove = this._handleMouseMove.bind(this);
    this._onMouseDown = this._handleMouseDown.bind(this);
    this._onMouseUp = this._handleMouseUp.bind(this);
    this.canvas.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onPointerLockChange);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    this.canvas.addEventListener('mouseup', this._onMouseUp);
  }

  _createActions(): TPFInputActions {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) {
      return {
        forward: inertKey,
        back: inertKey,
        left: inertKey,
        right: inertKey,
        stepleft: inertKey,
        stepright: inertKey,
        shoot: inertKey,
      };
    }

    const KeyCodes = Phaser.Input.Keyboard.KeyCodes;
    return {
      forward: keyboard.addKey(KeyCodes.W),
      back: keyboard.addKey(KeyCodes.S),
      left: keyboard.addKey(KeyCodes.LEFT),
      right: keyboard.addKey(KeyCodes.RIGHT),
      stepleft: keyboard.addKey(KeyCodes.A),
      stepright: keyboard.addKey(KeyCodes.D),
      shoot: keyboard.addKey(KeyCodes.SPACE),
    };
  }

  consumeMouseDeltaX(): number {
    const delta = this._mouseDeltaX;
    this._mouseDeltaX = 0;
    return delta;
  }

  get mouseDown(): boolean {
    return this._mouseDown;
  }

  _handleClick(): void {
    void this.canvas.requestPointerLock();
  }

  _handlePointerLockChange(): void {
    if (document.pointerLockElement === this.canvas) {
      this._pointerLockJustAcquired = true;
    } else {
      this._mouseDown = false;
    }
  }

  _handleMouseMove(event: MouseEvent): void {
    if (document.pointerLockElement !== this.canvas) return;
    if (this._pointerLockJustAcquired) {
      this._pointerLockJustAcquired = false;
      return;
    }
    let mx = event.movementX || 0;
    if (mx > 150) mx = 150;
    if (mx < -150) mx = -150;
    this._mouseDeltaX += mx;
  }

  _handleMouseDown(event: MouseEvent): void {
    if (event.button === 0 && document.pointerLockElement === this.canvas) {
      this._mouseDown = true;
    }
  }

  _handleMouseUp(event: MouseEvent): void {
    if (event.button === 0) {
      this._mouseDown = false;
    }
  }

  destroy(): void {
    this.canvas.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onPointerLockChange);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    this.canvas.removeEventListener('mouseup', this._onMouseUp);
  }
}

export default TwoPointFiveInputController;

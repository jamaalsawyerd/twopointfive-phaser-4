import type GameState from './game.ts';
import type PerspectiveCamera from './renderer/perspective-camera.ts';
import type Renderer from './renderer/renderer.ts';

export interface TPFRenderFrameOptions {
  renderer: Renderer;
  gameState: GameState;
  camera: PerspectiveCamera;
}

export interface TPFRenderAdapter {
  renderFrame(options: TPFRenderFrameOptions): void;
  shutdown(): void;
}

export class LegacyWebGLRenderAdapter implements TPFRenderAdapter {
  renderFrame(options: TPFRenderFrameOptions): void {
    const { renderer, gameState, camera } = options;
    gameState.draw(renderer, () => {
      gameState.drawWorld(camera, renderer);
    });
  }

  shutdown(): void {}
}

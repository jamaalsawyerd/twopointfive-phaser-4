import type TPFEntity from './entity.ts';
import type Renderer from './renderer/renderer.ts';
import type { Color } from './types.ts';

export interface TPFEntityDisplayAdapter {
  createEntity(entity: TPFEntity): void;
  updateEntity(entity: TPFEntity): void;
  removeEntity(entity: TPFEntity): void;
  setEntityLight(entity: TPFEntity, color: Color): void;
  drawEntity(entity: TPFEntity, renderer?: Renderer): boolean;
  shutdown(): void;
}

/**
 * Default entity rendering: a no-op adapter. Entities draw themselves as WebGL billboard quads
 * inside the Extern pass (see TPFEntity.draw / CulledSectors.drawEntities), where they depth-test
 * against world geometry and pick up fog and per-vertex lighting. This is the only adapter the demo
 * uses; a Phaser `Image`-based adapter was tried but retired because Phaser 4 GameObjects do not
 * share the WebGL depth buffer, so sprites could not be occluded by walls (see AGENTS.md).
 */
export class LegacyEntityDisplayAdapter implements TPFEntityDisplayAdapter {
  createEntity(_entity: TPFEntity): void {}

  updateEntity(_entity: TPFEntity): void {}

  removeEntity(_entity: TPFEntity): void {}

  setEntityLight(_entity: TPFEntity, _color: Color): void {}

  drawEntity(_entity: TPFEntity, _renderer?: Renderer): boolean {
    return false;
  }

  shutdown(): void {}
}

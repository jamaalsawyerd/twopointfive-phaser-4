/**
 * Shared types for the 2.5D engine: vectors, colors, image/tile data, entity context,
 * collision results, and level JSON shapes. Consumed by entity, game, renderer, and plugin.
 */
import type CollisionMap from './collision-map.ts';
import type CulledSectors from './world/culled-sectors.ts';
import type Renderer from './renderer/renderer.ts';
import type PerspectiveCamera from './renderer/perspective-camera.ts';
import type LightMap from './world/light-map.ts';
import type GameState from './game.ts';
import type { TPFEntityDisplayAdapter } from './entity-display-adapter.ts';
import type TPFEntity from './entity.ts';

/** 2D vector / size */
export interface Vec2 {
  x: number;
  y: number;
}

/** 3D vector */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** RGB color (components 0-1) */
export interface Color {
  r: number;
  g: number;
  b: number;
}

/** RGBA color (components 0-1) */
export interface ColorA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** GL image info for tiles / sprites */
export interface ImageInfo {
  texture: WebGLTexture;
  width: number;
  height: number;
  textureWidth?: number;
  textureHeight?: number;
  seamsExpanded?: boolean;
}

/** Tileset info stored by the plugin */
export interface TilesetInfo {
  texture: WebGLTexture;
  width: number;
  height: number;
  textureWidth: number;
  textureHeight: number;
  seamsExpanded: boolean;
}

/** Result of CollisionMap.trace() */
export interface TraceResult {
  pos: Vec2;
  collision: { x: boolean; y: boolean; slope: boolean };
  tile: Vec2;
}

/** Collision-map-like interface (duck type for staticNoCollision) */
export interface CollisionMapLike {
  tilesize: number;
  trace(x: number, y: number, vx: number, vy: number, w: number, h: number): TraceResult;
}

/** Context passed to entities */
export interface EntityContext {
  collisionMap: CollisionMap | CollisionMapLike;
  culledSectors: CulledSectors | null;
  renderer: Renderer | null;
  camera: PerspectiveCamera | null;
  gravity: number;
  tick: number;
  lightMap: LightMap | null;
  game: GameState | null;
  displayAdapter?: TPFEntityDisplayAdapter | null;
}

/** AnimSheet descriptor */
export interface AnimSheet {
  image: ImageInfo;
  width: number;
  height: number;
}

/** Level JSON format */
export interface LayerData {
  name: string;
  tilesize: number;
  data: number[][];
  tilesetName: string;
}

export interface EntityData {
  type: string;
  x: number;
  y: number;
  settings: Record<string, unknown>;
}

export interface LevelData {
  layer: LayerData[];
  entities: EntityData[];
}

/** Entity factory type */
export type EntityFactory = (
  x: number,
  y: number,
  settings: Record<string, unknown>,
  context: EntityContext,
) => TPFEntity;

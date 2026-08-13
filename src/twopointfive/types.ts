/**
 * Shared types for the 2.5D engine: vectors, colors, image/tile data, entity context,
 * collision results, and level JSON shapes. Consumed by entity, game, renderer, and plugin.
 */
import type Phaser from 'phaser';
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

/** Phaser-managed GL texture wrapper used for all engine textures */
export type TPFTexture = Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper;

/** Phaser-managed GL program wrapper used for all engine shaders */
export type TPFProgram = Phaser.Renderer.WebGL.Wrappers.WebGLProgramWrapper;

/**
 * A material reference carried by a Quad: the key of a material registered with the TPFQuadBatch
 * render node, plus optional per-quad uniform overrides. Quads with the same material batch together.
 */
export interface TPFQuadMaterial {
  key: string;
  uniforms?: Record<string, number | number[]>;
}

/** GL image info for tiles / sprites */
export interface ImageInfo {
  texture: TPFTexture;
  width: number;
  height: number;
  textureWidth?: number;
  textureHeight?: number;
  seamsExpanded?: boolean;
}

/** Tileset info stored by the plugin */
export interface TilesetInfo {
  texture: TPFTexture;
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

/**
 * An aspect ratio, either as a number (`16 / 9`) or as a `"W:H"` / `"W/H"` string (`"16:9"`).
 * Strings are parsed once when the view is configured; malformed values warn and are ignored.
 */
export type TPFAspect = number | string;

/** Which axis the configured `fov` value describes. See TPFViewConfig#fovAxis. */
export type TPFFovAxis = 'vertical' | 'horizontal';

/**
 * Named shorthand for a common view setup. A preset expands into ordinary TPFViewConfig fields,
 * so any field you pass alongside it overrides the preset's value for that field.
 */
export type TPFViewPreset = 'fill';

/** A rectangle in canvas pixels, y-down from the top-left. */
export interface TPFRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * View configuration for the 2.5D camera and render target, passed to `scene.tpf.setView()`
 * or as plugin boot data (`data: { view: {...} }`). Every field is optional and updates merge
 * onto the current view, so `setView({ fov: 90 })` changes only the field of view.
 */
export interface TPFViewConfig {
  /** Named shorthand applied before the other fields in this same call. */
  preset?: TPFViewPreset;
  /**
   * Locks the 2.5D view to this aspect ratio (`16 / 9`, `'4:3'`) regardless of the canvas shape,
   * centering it and leaving bars on the two spare sides. The bars show the Phaser game's
   * `backgroundColor`. Default null, meaning the world fills the canvas.
   *
   * The HUD still covers the whole canvas; use `getView().world` to align HUD elements to the
   * 2.5D view instead. Because the rectangle is rounded to whole pixels, the resolved
   * `getView().aspect` can differ from the requested ratio by a fraction of a percent — the
   * projection uses the resolved value, so the image is never stretched.
   */
  aspect?: TPFAspect | null;
  /**
   * Renders the 2.5D world at this resolution and scales the result up into its on-screen
   * rectangle, leaving the HUD and any Phaser Game Objects crisp at canvas resolution. Pass a
   * number for the height in pixels (`240`, width follows the view's shape), or an explicit
   * `{ width, height }`. Default null, meaning the world renders at its on-screen size.
   *
   * Larger than the on-screen size is supersampling: `{ scale: 2, filter: 'linear' }` renders at
   * double resolution and downsamples, which is a cheap and effective anti-alias.
   */
  resolution?: number | { width: number; height: number } | null;
  /**
   * Renders the world at this fraction of its on-screen size — `0.5` for half resolution, `2` for
   * supersampling. Ignored when `resolution` is also set. Default null.
   */
  scale?: number | null;
  /**
   * How the rendered world is sampled when scaled to the screen. `'nearest'` (the default) keeps
   * hard pixel edges, which suits a low-resolution retro look; `'linear'` smooths, which is what
   * you want when supersampling. Only has an effect when the world renders off-screen.
   */
  filter?: 'nearest' | 'linear';
  /**
   * Vertical or horizontal field of view in degrees, depending on `fovAxis`. Default 75.
   * Applies immediately; no resize is required.
   */
  fov?: number;
  /**
   * Which axis `fov` describes. Default `'vertical'`, which matches classic FPS behaviour:
   * a wider viewport shows more to the left and right and the same amount vertically ("Hor+").
   * `'horizontal'` locks the horizontal view instead, so a wider viewport shows less vertically.
   */
  fovAxis?: TPFFovAxis;
  /**
   * Stops the horizontal view from widening past this aspect ratio. Below it the view is `fovAxis`
   * as configured; above it the horizontal field of view holds steady and the vertical shrinks.
   * Useful to keep ultrawide viewports from looking distorted. Default null (no limit).
   * Has no effect when `fovAxis` is `'horizontal'`, where the horizontal view is already fixed.
   */
  maxAspect?: TPFAspect | null;
  /** Near clip plane distance in world units. Default 1. */
  near?: number;
  /** Far clip plane distance in world units. Default 10000. */
  far?: number;
}

/**
 * The resolved, read-only result of the current TPFViewConfig, returned by `scene.tpf.getView()`
 * and emitted with the plugin's `viewchange` event. All sizes are in pixels and all angles in
 * degrees; nothing here needs to be recomputed by callers.
 */
export interface TPFResolvedView {
  /** The full drawing buffer the scene renders into. */
  canvas: { width: number; height: number };
  /**
   * The rectangle of the canvas the 2.5D world occupies. Align HUD elements to this rather than
   * to the canvas, so they stay correct if the world is later given its own aspect ratio.
   */
  world: TPFRect;
  /** The resolution the world is rendered at before being presented into `world`. */
  internal: { width: number; height: number };
  /** Aspect ratio of `world` (width / height). */
  aspect: number;
  /** Effective field of view in degrees after `fovAxis` and `maxAspect` are applied. */
  fov: { vertical: number; horizontal: number };
  /** The axis the configured `fov` describes. */
  fovAxis: TPFFovAxis;
  /** How the world is sampled when `internal` differs from `world`. */
  filter: 'nearest' | 'linear';
  /** True when the world renders off-screen because `internal` differs from `world`. */
  offscreen: boolean;
  /** Near clip plane distance in world units. */
  near: number;
  /** Far clip plane distance in world units. */
  far: number;
}

/** Entity factory type */
export type EntityFactory = (
  x: number,
  y: number,
  settings: Record<string, unknown>,
  context: EntityContext,
) => TPFEntity;

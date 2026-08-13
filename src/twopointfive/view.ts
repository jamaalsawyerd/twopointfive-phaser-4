/**
 * View resolution: turns a TPFViewConfig (what the user asked for) into a TPFResolvedView
 * (what the renderer and camera should actually do). Pure functions with no Phaser or GL
 * dependency, so the projection math can be exercised on its own.
 *
 * The only free parameter in a perspective projection is the vertical field of view: the aspect
 * passed to mat4.perspective must match the true viewport aspect or the image stretches. So every
 * fovAxis / maxAspect policy here reduces to "pick a vertical FOV for this aspect".
 */
import type { TPFAspect, TPFViewConfig, TPFResolvedView, TPFViewPreset, TPFRect } from './types.ts';
import { DEG_TO_RAD } from './util.ts';

/** Normalized view state: TPFViewConfig with every field resolved to a concrete value. */
export interface TPFViewState {
  fov: number;
  fovAxis: 'vertical' | 'horizontal';
  maxAspect: number | null;
  aspect: number | null;
  resolution: number | { width: number; height: number } | null;
  scale: number | null;
  filter: 'nearest' | 'linear';
  near: number;
  far: number;
}

/** Defaults chosen to match the engine's historical behaviour exactly. */
export const DEFAULT_VIEW_STATE: TPFViewState = {
  fov: 75,
  fovAxis: 'vertical',
  maxAspect: null,
  aspect: null,
  resolution: null,
  scale: null,
  filter: 'nearest',
  near: 1,
  far: 10000,
};

/** Named shorthands. A preset is a partial config applied before the same call's explicit fields. */
const PRESETS: Record<TPFViewPreset, TPFViewConfig> = {
  fill: {},
};

const warned = new Set<string>();

/** Warns once per distinct message, so a bad value in a per-frame call can't flood the console. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[TwoPointFive] ${message}`);
}

/** Test hook: clears the warn-once cache so repeated runs report repeated problems. */
export function resetViewWarnings(): void {
  warned.clear();
}

/**
 * Parses an aspect ratio. Accepts a positive number or a "W:H" / "W/H" string.
 * Returns null (with a warning) for anything else, meaning "unset".
 */
export function parseAspect(value: TPFAspect | null | undefined, field: string): number | null {
  if (value === null || typeof value === 'undefined') return null;
  if (typeof value === 'number') {
    if (!isFinite(value) || value <= 0) {
      warnOnce(`${field}: expected a positive ratio, got ${value}. Ignoring.`);
      return null;
    }
    return value;
  }
  const parts = value.split(/[:/]/);
  if (parts.length === 2) {
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (isFinite(w) && isFinite(h) && w > 0 && h > 0) return w / h;
  }
  warnOnce(`${field}: expected a ratio like "16:9" or a positive number, got "${value}". Ignoring.`);
  return null;
}

/**
 * Merges a TPFViewConfig onto an existing view state. A `preset` is expanded first, so explicit
 * fields in the same call win over the preset's values. Invalid values warn and keep the old value.
 */
export function mergeViewConfig(state: TPFViewState, config: TPFViewConfig): TPFViewState {
  let next: TPFViewState = { ...state };

  if (typeof config.preset !== 'undefined') {
    const preset = PRESETS[config.preset] as TPFViewConfig | undefined;
    if (!preset) {
      warnOnce(`view preset "${config.preset}" is not a known preset. Ignoring.`);
    } else {
      next = mergeViewConfig(next, preset);
    }
  }

  if (typeof config.fov !== 'undefined') {
    if (isFinite(config.fov) && config.fov > 0 && config.fov < 180) {
      next.fov = config.fov;
    } else {
      warnOnce(`fov: expected degrees between 0 and 180, got ${config.fov}. Keeping ${next.fov}.`);
    }
  }

  if (typeof config.fovAxis !== 'undefined') {
    if (config.fovAxis === 'vertical' || config.fovAxis === 'horizontal') {
      next.fovAxis = config.fovAxis;
    } else {
      warnOnce(`fovAxis: expected 'vertical' or 'horizontal', got "${config.fovAxis}". Keeping '${next.fovAxis}'.`);
    }
  }

  if (typeof config.maxAspect !== 'undefined') {
    next.maxAspect = parseAspect(config.maxAspect, 'maxAspect');
  }

  if (typeof config.aspect !== 'undefined') {
    next.aspect = parseAspect(config.aspect, 'aspect');
  }

  if (typeof config.resolution !== 'undefined') {
    const r = config.resolution;
    if (r === null) {
      next.resolution = null;
    } else if (typeof r === 'number') {
      if (isFinite(r) && r >= 1) {
        next.resolution = Math.floor(r);
      } else {
        warnOnce(`resolution: expected a height of at least 1 pixel, got ${r}. Ignoring.`);
      }
    } else if (isFinite(r.width) && isFinite(r.height) && r.width >= 1 && r.height >= 1) {
      next.resolution = { width: Math.floor(r.width), height: Math.floor(r.height) };
    } else {
      warnOnce(`resolution: expected a number or {width, height} of at least 1px, got ${JSON.stringify(r)}. Ignoring.`);
    }
  }

  if (typeof config.scale !== 'undefined') {
    if (config.scale === null) {
      next.scale = null;
    } else if (isFinite(config.scale) && config.scale > 0) {
      next.scale = config.scale;
    } else {
      warnOnce(`scale: expected a positive factor, got ${config.scale}. Ignoring.`);
    }
  }

  if (typeof config.filter !== 'undefined') {
    if (config.filter === 'nearest' || config.filter === 'linear') {
      next.filter = config.filter;
    } else {
      warnOnce(`filter: expected 'nearest' or 'linear', got "${config.filter}". Keeping '${next.filter}'.`);
    }
  }

  if (next.resolution !== null && next.scale !== null) {
    warnOnce('resolution and scale are both set; scale is ignored. Pass only one.');
  }

  if (typeof config.near !== 'undefined') {
    if (isFinite(config.near) && config.near > 0) {
      next.near = config.near;
    } else {
      warnOnce(`near: expected a positive distance, got ${config.near}. Keeping ${next.near}.`);
    }
  }

  if (typeof config.far !== 'undefined') {
    if (isFinite(config.far) && config.far > 0) {
      next.far = config.far;
    } else {
      warnOnce(`far: expected a positive distance, got ${config.far}. Keeping ${next.far}.`);
    }
  }

  if (next.far <= next.near) {
    warnOnce(`far (${next.far}) must be greater than near (${next.near}). Keeping the previous pair.`);
    next.near = state.near;
    next.far = state.far;
  }

  if (next.fovAxis === 'horizontal' && next.maxAspect !== null) {
    warnOnce("maxAspect has no effect while fovAxis is 'horizontal': the horizontal view is already fixed.");
  }

  return next;
}

/** Horizontal FOV (degrees) implied by a vertical FOV (degrees) at a given aspect. */
export function horizontalFovFor(verticalFovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((verticalFovDeg * DEG_TO_RAD) / 2) * aspect)) / DEG_TO_RAD;
}

/** Vertical FOV (degrees) implied by a horizontal FOV (degrees) at a given aspect. */
export function verticalFovFor(horizontalFovDeg: number, aspect: number): number {
  return (2 * Math.atan(Math.tan((horizontalFovDeg * DEG_TO_RAD) / 2) / aspect)) / DEG_TO_RAD;
}

/**
 * Picks the vertical FOV to hand to the projection, applying the fovAxis and maxAspect policies.
 *
 * - `vertical` (default): the configured value is used as-is, so a wider viewport widens the
 *   horizontal view and leaves the vertical alone.
 * - `horizontal`: the configured value is held as the horizontal view and the vertical derived.
 * - `maxAspect`: past that aspect the horizontal view stops growing, which means deriving the
 *   vertical from the horizontal FOV the view had at maxAspect.
 */
export function verticalFovForView(state: TPFViewState, aspect: number): number {
  if (state.fovAxis === 'horizontal') return verticalFovFor(state.fov, aspect);
  if (state.maxAspect !== null && aspect > state.maxAspect) {
    return verticalFovFor(horizontalFovFor(state.fov, state.maxAspect), aspect);
  }
  return state.fov;
}

/**
 * Centres a rectangle of the requested aspect ratio inside the canvas, leaving bars on whichever
 * pair of sides has room to spare. Sizes are whole pixels, so the fitted rectangle's true ratio can
 * differ very slightly from the request; callers must project with the fitted ratio, not the
 * requested one, or the image stretches.
 */
export function fitRect(canvasWidth: number, canvasHeight: number, aspect: number): TPFRect {
  const canvasAspect = canvasWidth / canvasHeight;
  if (canvasAspect > aspect) {
    // Canvas is wider than the target: bars on the left and right.
    const width = Math.max(1, Math.round(canvasHeight * aspect));
    return { x: Math.floor((canvasWidth - width) / 2), y: 0, width, height: canvasHeight };
  }
  // Canvas is taller than the target: bars on the top and bottom.
  const height = Math.max(1, Math.round(canvasWidth / aspect));
  return { x: 0, y: Math.floor((canvasHeight - height) / 2), width: canvasWidth, height };
}

/**
 * The resolution the world is rendered at before being scaled into `world`. `resolution` wins over
 * `scale`; with neither, the world renders at its on-screen size and no off-screen pass is needed.
 *
 * The internal size does not have to share the world's aspect ratio. The projection always uses the
 * world's ratio, so a mismatch changes how densely each axis is sampled (softer on one axis) rather
 * than distorting the geometry.
 */
export function internalSizeFor(state: TPFViewState, world: TPFRect): { width: number; height: number } {
  if (state.resolution !== null) {
    if (typeof state.resolution === 'number') {
      const height = Math.max(1, Math.floor(state.resolution));
      return { width: Math.max(1, Math.round(height * (world.width / world.height))), height };
    }
    return { width: state.resolution.width, height: state.resolution.height };
  }
  if (state.scale !== null) {
    return {
      width: Math.max(1, Math.round(world.width * state.scale)),
      height: Math.max(1, Math.round(world.height * state.scale)),
    };
  }
  return { width: world.width, height: world.height };
}

/**
 * Resolves the view state against a canvas size. With `aspect` set the world occupies a centred
 * rectangle of that ratio; otherwise it fills the canvas. With `resolution` or `scale` set the world
 * renders off-screen at that size and is scaled into its rectangle.
 */
export function resolveView(state: TPFViewState, canvasWidth: number, canvasHeight: number): TPFResolvedView {
  const width = Math.max(1, Math.floor(canvasWidth));
  const height = Math.max(1, Math.floor(canvasHeight));

  const world = state.aspect === null ? { x: 0, y: 0, width, height } : fitRect(width, height, state.aspect);

  // Project with the rectangle's real ratio rather than the requested one: they differ by up to a
  // pixel's worth of rounding, and using the request would stretch the image by that much.
  const aspect = world.width / world.height;
  const vertical = verticalFovForView(state, aspect);
  const internal = internalSizeFor(state, world);

  return {
    canvas: { width, height },
    world,
    internal,
    aspect,
    fov: { vertical, horizontal: horizontalFovFor(vertical, aspect) },
    fovAxis: state.fovAxis,
    filter: state.filter,
    offscreen: internal.width !== world.width || internal.height !== world.height,
    near: state.near,
    far: state.far,
  };
}

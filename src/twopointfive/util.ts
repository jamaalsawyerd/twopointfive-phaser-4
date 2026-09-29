/**
 * Small helpers used across the engine: angle conversion and wrapping, clamp, and prototype-based
 * inheritance (Impact-style). Extends Number.prototype with toRad().
 */
const DEG_TO_RAD: number = Math.PI / 180;

function toRad(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Wraps an angle in radians into [-PI, PI), e.g. to take the shorter way round between two headings. */
function wrapAngle(rad: number): number {
  return rad - 2 * Math.PI * Math.floor((rad + Math.PI) / (2 * Math.PI));
}

function limit(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/** Returns a constructor whose instances inherit from proto (Impact-style). */
function extend(proto: object): new () => object {
  function Ctor(this: object): void {}
  Ctor.prototype = proto;
  return Ctor as unknown as new () => object;
}

declare global {
  interface Number {
    toRad(): number;
  }
}

if (typeof Number.prototype.toRad === 'undefined') {
  Number.prototype.toRad = function (this: number): number {
    return this * DEG_TO_RAD;
  };
}

export { toRad, wrapAngle, limit, extend, DEG_TO_RAD };

/**
 * Directional billboards: picks the row of a sprite sheet that shows an entity from the camera's side,
 * and points the entity's animations at that row. Any entity with a directional sheet can use it.
 *
 * Each row holds one direction and repeats the same frame layout. Which row holds which direction is
 * declared with a DirectionRows map; DEFAULT_DIRECTION_ROWS is the layout of media/blob-directions.png.
 */
import type TPFEntity from '~/twopointfive/entity.ts';
import { toRad, wrapAngle } from '~/twopointfive/util.ts';
import type Animation from './animation.ts';

/**
 * Which way an entity faces, as the viewer sees it. `front` faces the camera, `right` is the entity's
 * right-facing profile (heading toward the viewer's right), and so on round through `back`.
 */
type Direction = 'front' | 'frontRight' | 'right' | 'backRight' | 'back' | 'backLeft' | 'left' | 'frontLeft';

/**
 * The sheet row that holds each direction. Leave out any direction the sheet has no row for and the
 * nearest one shows instead, so a 4-direction sheet declares just front, right, back and left.
 */
type DirectionRows = Partial<Record<Direction, number>>;

/** Each direction's angle from facing the camera, in degrees, positive toward the viewer's right. */
const DIRECTION_ANGLES: Record<Direction, number> = {
  front: 0,
  frontRight: 45,
  right: 90,
  backRight: 135,
  back: 180,
  backLeft: -135,
  left: -90,
  frontLeft: -45,
};

/** Front first, then turning to the viewer's right: the layout of media/blob-directions.png. */
const DEFAULT_DIRECTION_ROWS: DirectionRows = {
  front: 0,
  frontRight: 1,
  right: 2,
  backRight: 3,
  back: 4,
  backLeft: 5,
  left: 6,
  frontLeft: 7,
};

/** How far past the halfway point between two directions the view must move before it switches, so an entity on the boundary doesn't flicker. */
const HYSTERESIS = toRad(5);

const warned = new Set<string>();

/** Warns once per distinct message, since every entity sharing a bad layout would repeat it. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[DirectionalSprite] ${message}`);
}

class DirectionalSprite {
  /** The direction shown now, and the sheet row it comes from. */
  direction: Direction;
  row: number;
  /** The declared directions; _current indexes into it. */
  _entries: { direction: Direction; angle: number; row: number }[];
  _current: number;
  /** Each animation's frame list, once per entry. */
  _frames: Map<Animation, number[][]>;

  /**
   * Build it after the entity's init(), once its animSheet and animations exist. Declare animations with
   * the frame numbers of a single row. A layout naming rows the sheet doesn't have leaves the entity's
   * animations alone, and warns.
   */
  constructor(entity: TPFEntity, rows: DirectionRows = DEFAULT_DIRECTION_ROWS) {
    this._entries = [];
    for (const direction of Object.keys(DIRECTION_ANGLES) as Direction[]) {
      const row = rows[direction];
      if (row !== undefined) this._entries.push({ direction, angle: toRad(DIRECTION_ANGLES[direction]), row });
    }
    this._frames = new Map();
    this._current = 0;

    const sheet = entity.animSheet;
    const sheetRows = sheet ? Math.floor(sheet.image.height / sheet.height) : 0;
    const misfit = this._entries.find((e) => !Number.isInteger(e.row) || e.row < 0 || e.row >= sheetRows);
    if (!sheet || !this._entries.length || misfit) {
      warnOnce(
        misfit
          ? `row ${misfit.row} for "${misfit.direction}" is not in a sheet with ${sheetRows} row${sheetRows === 1 ? '' : 's'}`
          : 'needs an animSheet and at least one direction',
      );
      this._entries = [];
    } else {
      const framesPerRow = Math.floor(sheet.image.width / sheet.width);
      for (const name of Object.keys(entity.anims)) {
        const base = entity.anims[name].sequence;
        this._frames.set(
          entity.anims[name],
          this._entries.map((e) => base.map((tile) => (tile % framesPerRow) + e.row * framesPerRow)),
        );
      }
      this._current = this._nearest(0);
    }
    this.direction = this._entries.length ? this._entries[this._current].direction : 'front';
    this.row = this._entries.length ? this._entries[this._current].row : 0;
  }

  /**
   * Points the entity's current animation at the row that faces the camera. `heading` is the way the
   * entity faces, in radians as TPFEntity.angleTo measures them. With `enabled` false it shows the front.
   * Call it before TPFEntity.updateQuad(), which reads the animation's tile.
   */
  update(entity: TPFEntity, heading: number, enabled: boolean): void {
    if (!this._entries.length) return;
    this._current = enabled ? this._facingCamera(entity, heading) : this._nearest(0);
    const entry = this._entries[this._current];
    this.direction = entry.direction;
    this.row = entry.row;
    const anim = entity.currentAnim;
    const frames = anim ? this._frames.get(anim) : undefined;
    if (!anim || !frames || anim.sequence === frames[this._current]) return;
    // Swap the frame list, not the animation: its timer runs on, so the cycle neither restarts nor skips.
    anim.sequence = frames[this._current];
    anim.tile = anim.sequence[anim.frame];
  }

  _facingCamera(entity: TPFEntity, heading: number): number {
    const camera = entity.context.camera;
    if (!camera) return this._current;
    // The camera keeps the map's y in position[2].
    const dx = camera.position[0] - (entity.pos.x + entity.size.x / 2);
    const dy = camera.position[2] - (entity.pos.y + entity.size.y / 2);
    // 0 while the entity faces the camera, +90° once it has turned to face the viewer's right.
    const rel = Math.atan2(dy, dx) - heading;
    const best = this._nearest(rel);
    return this._offBy(rel, this._current) - this._offBy(rel, best) > 2 * HYSTERESIS ? best : this._current;
  }

  /** The entry whose direction is nearest `rel`. */
  _nearest(rel: number): number {
    let best = 0;
    for (let i = 1; i < this._entries.length; i++) {
      if (this._offBy(rel, i) < this._offBy(rel, best)) best = i;
    }
    return best;
  }

  _offBy(rel: number, i: number): number {
    return Math.abs(wrapAngle(rel - this._entries[i].angle));
  }
}

export default DirectionalSprite;
export { DEFAULT_DIRECTION_ROWS };
export type { Direction, DirectionRows };

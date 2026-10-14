import type { World } from '../World';
import { BitSet } from '../../core/BitSet';

/** Distance bands for {@link AnimationLODSystem}: an animator farther than `distances[k]` from the camera updates every `strides[k + 1]` frames. */
export interface AnimationLODConfig {
  /** Ascending camera distances (world units) where the update rate drops. Default [25, 60, 120]. */
  distances: number[];
  /** Update stride per band: `strides[0]` below the first distance, `strides[k]` past `distances[k - 1]`. Default [1, 2, 4, 8]. Length must be `distances.length + 1`. */
  strides: number[];
}

export const DEFAULT_ANIMATION_LOD: AnimationLODConfig = { distances: [25, 60, 120], strides: [1, 2, 4, 8] };

/**
 * Animation level of detail: lowers the update rate of animators and controllers the farther they are from the camera. A character 100
 * units away does not need a new pose every frame, and a skipped evaluation also skips the transform, skeleton, bounds and joint
 * upload work downstream. Strides are staggered per entity and a skipped frame's time accumulates, so playback speed stays exact; only
 * the pose steps (a stride of 8 at 60 fps is 7.5 poses per second). Distance is measured to the owner entity using last frame's world matrices.
 *
 * Run it before {@link AnimationSystem.update}; `Engine` does this when `EngineOptions.animationLOD` is set.
 */
export class AnimationLODSystem {
  config: AnimationLODConfig;
  /** Entities per stride bucket from the last update (index = band), for the HUD and tests. */
  readonly bandCounts: number[];

  /** Create the system for `world`; `config` is validated (ascending distances, one more stride than distances, each stride 1..255). */
  constructor(private world: World, config: AnimationLODConfig = DEFAULT_ANIMATION_LOD) {
    this.config = validate(config);
    this.bandCounts = new Array(this.config.strides.length).fill(0);
  }

  /** Replace the distance bands. */
  configure(config: AnimationLODConfig): void {
    this.config = validate(config);
    this.bandCounts.length = this.config.strides.length;
    this.bandCounts.fill(0);
  }

  /** Assign every animator's and controller's stride from its distance to the camera at (`cx`, `cy`, `cz`). */
  update(cx: number, cy: number, cz: number): void {
    const { distances, strides } = this.config, w = this.world, m = w.transforms.worldMatrices;
    this.bandCounts.fill(0);
    /** Pick the band of entity `i` and return its stride. */
    const strideOf = (i: number): number => {
      const o = i * 16, dx = m[o + 12] - cx, dy = m[o + 13] - cy, dz = m[o + 14] - cz, d2 = dx * dx + dy * dy + dz * dz;
      let band = 0;
      while (band < distances.length && d2 > distances[band] * distances[band]) band++;
      this.bandCounts[band]++;
      return strides[band];
    };
    BitSet.forEachAnd([w.animators.has, w.transforms.has], (i) => { w.animators.stride[i] = strideOf(i); });
    BitSet.forEachAnd([w.controllers.has, w.transforms.has], (i) => { w.controllers.stride[i] = strideOf(i); });
  }

  /** Restore every-frame updates (what happens when the feature is switched off). */
  reset(): void {
    const w = this.world;
    BitSet.forEachAnd([w.animators.has], (i) => { w.animators.stride[i] = 0; });
    BitSet.forEachAnd([w.controllers.has], (i) => { w.controllers.stride[i] = 0; });
    this.bandCounts.fill(0);
  }
}

/** Reject malformed bands (they would silently produce wrong strides) and return a defensive copy. */
function validate(c: AnimationLODConfig): AnimationLODConfig {
  if (c.strides.length !== c.distances.length + 1) throw new RangeError('AnimationLODConfig: strides must have one more entry than distances');
  for (let k = 1; k < c.distances.length; k++) if (!(c.distances[k] > c.distances[k - 1])) throw new RangeError('AnimationLODConfig: distances must be ascending');
  for (const s of c.strides) if (!Number.isInteger(s) || s < 1 || s > 255) throw new RangeError('AnimationLODConfig: each stride must be an integer in 1..255');
  return { distances: [...c.distances], strides: [...c.strides] };
}

import type { BoundsStore } from '../components/BoundsStore';
import type { TransformStore } from '../components/TransformStore';
import { AABB } from '../../math/AABB';
import { hypot3 } from '../../math/hypot';

const tmpIn = new Float32Array(6);
const tmpOut = new Float32Array(6);

/** Recomputes world AABB + sphere for entities whose world matrix just changed. */
export class BoundsSystem {
  boundsUpdated = 0;

  /** Create the system over the transform and bounds stores. */
  constructor(private transforms: TransformStore, private bounds: BoundsStore) {}

  /** `changed` = indices from TransformSystem.updated. */
  update(changed: number[]): void {
    const b = this.bounds, t = this.transforms;
    this.boundsUpdated = 0;
    for (let k = 0; k < changed.length; k++) {
      const i = changed[k];
      if (!b.has.has(i)) continue;
      for (let j = 0; j < 6; j++) tmpIn[j] = b.local[i * 6 + j];
      AABB.transform(tmpOut, tmpIn, t.worldMatrices, i * 16);
      const pad = b.padding[i];
      const o = i * 6;
      b.world[o] = tmpOut[0] - pad; b.world[o + 1] = tmpOut[1] - pad; b.world[o + 2] = tmpOut[2] - pad;
      b.world[o + 3] = tmpOut[3] + pad; b.world[o + 4] = tmpOut[4] + pad; b.world[o + 5] = tmpOut[5] + pad;
      const s = i * 4;
      b.sphere[s] = (b.world[o] + b.world[o + 3]) / 2;
      b.sphere[s + 1] = (b.world[o + 1] + b.world[o + 4]) / 2;
      b.sphere[s + 2] = (b.world[o + 2] + b.world[o + 5]) / 2;
      b.sphere[s + 3] = hypot3(b.world[o + 3] - b.world[o], b.world[o + 4] - b.world[o + 1], b.world[o + 5] - b.world[o + 2]) / 2;
      this.boundsUpdated++;
    }
  }
}

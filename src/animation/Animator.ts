import { AnimationClip } from './AnimationClip';
import { Pose, PoseLayout } from './Pose';
import type { GLTFAsset } from '../assets/AssetTypes';
import type { GLTFInstance } from '../assets/gltf/GLTFInstantiator';
import { entityIndex } from '../ecs/Entity';

export interface AdvanceResult { time: number; finished: boolean; }

/**
 * Advance playback time. Loop wraps (works for any speed sign); non-looping clamps at the ends and
 * reports `finished` when it reaches the end in the direction of play. Allocation-free (writes `out`).
 */
export function advanceTime(time: number, delta: number, duration: number, loop: boolean, out: AdvanceResult): AdvanceResult {
  let t = time + delta;
  out.finished = false;
  if (duration <= 0) { out.time = 0; out.finished = !loop; return out; }
  if (loop) {
    t %= duration;
    if (t < 0) t += duration;
  } else if (t >= duration) { t = duration; out.finished = delta > 0; }
  else if (t <= 0) { t = 0; out.finished = delta < 0; }
  out.time = t;
  return out;
}

/**
 * Static binding of a set of clips to the entities of one model instance. Shared by the animator(s)
 * that drive that instance. `nodeEntities[i]` = ENTITY INDEX of pose node i (or -1).
 */
export class AnimatedInstance {
  /** `layout` = node structure, `nodeEntities` = entity index per pose node (-1 = none), `clips` = available animations, `rest` = the bind / rest pose. */
  constructor(
    readonly layout: PoseLayout,
    readonly nodeEntities: Int32Array,
    readonly clips: AnimationClip[],
    readonly rest: Pose,
  ) {}

  /**
   * Bind an asset's animation clips to one instantiated model. Pass a previously created AnimatedInstance of the SAME
   * asset as `shared` to reuse its immutable clips/layout/rest pose (crowds: only the entity mapping differs).
   */
  static fromGLTF(asset: GLTFAsset, instance: GLTFInstance, shared?: AnimatedInstance): AnimatedInstance {
    const entities = Int32Array.from(instance.nodeEntities.map((e) => entityIndex(e)));
    if (shared) return new AnimatedInstance(shared.layout, entities, shared.clips, shared.rest);
    const layout = PoseLayout.fromAsset(asset);
    return new AnimatedInstance(layout, entities, asset.animations.map((a) => AnimationClip.fromData(a)), Pose.rest(asset, layout));
  }

  /** Index of the clip called `name`, or -1. */
  clipIndex(name: string): number { return this.clips.findIndex((c) => c.name === name); }
}

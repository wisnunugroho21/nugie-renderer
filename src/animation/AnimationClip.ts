import type { AnimationClipData, InterpolationMode, AnimationPath } from '../assets/AssetTypes';
import { sampleChannel } from './AnimationSampler';
import type { Pose, PoseLayout } from './Pose';

export class AnimationChannel {
  /** One animated property of one node: keyframe `times` and `values` (`stride` floats per key, 3x for cubic-spline tangents) with an interpolation mode. */
  constructor(
    readonly node: number,
    readonly path: AnimationPath,
    readonly interpolation: InterpolationMode,
    readonly times: Float32Array,
    readonly values: Float32Array,
    readonly stride: number,
  ) {}
}

/** Which properties of a node a clip animates (bit flags in AnimationClip.nodeMask). */
export const AnimatedPath = { Translation: 1, Rotation: 2, Scale: 4, Weights: 8 } as const;

/** Immutable animation data: channels targeting pose nodes. Sampling writes into a Pose. */
export class AnimationClip {
  readonly duration: number;
  /** Nodes with at least one channel (the only nodes sampling writes). */
  readonly animatedNodes: Int32Array;
  /** Parallel to animatedNodes: AnimatedPath bits actually animated for that node (only those are written to the ECS). */
  readonly nodeMask: Uint8Array;

  /** Build a clip from channels; `duration` defaults to the last keyframe time. Precomputes the animated node list and per-node path masks. */
  constructor(readonly name: string, readonly channels: AnimationChannel[], duration?: number) {
    this.duration = duration ?? channels.reduce((d, c) => Math.max(d, c.times.length ? c.times[c.times.length - 1] : 0), 0);
    this.animatedNodes = Int32Array.from(new Set(channels.map((c) => c.node)));
    this.nodeMask = new Uint8Array(this.animatedNodes.length);
    const bit = { translation: 1, rotation: 2, scale: 4, weights: 8 } as const;
    const slot = new Map<number, number>();
    this.animatedNodes.forEach((n, i) => slot.set(n, i));
    for (const c of channels) this.nodeMask[slot.get(c.node)!] |= bit[c.path];
  }

  /** Rebuild a clip from plain serialisable data. */
  static fromData(d: AnimationClipData): AnimationClip {
    return new AnimationClip(d.name, d.channels.map((c) => new AnimationChannel(c.node, c.path, c.interpolation, c.times, c.values, c.stride)), d.duration);
  }

  /** Sample all channels at `time` into `pose` (override semantics: only channel-targeted values change). */
  sample(time: number, pose: Pose, hints?: Int32Array): void {
    const layout: PoseLayout = pose.layout;
    for (let ci = 0; ci < this.channels.length; ci++) {
      const c = this.channels[ci];
      const hint = hints ? hints[ci] : 0;
      let k: number;
      switch (c.path) {
        case 'translation': k = sampleChannel(c.times, c.values, 3, c.interpolation, false, time, pose.t, c.node * 3, hint); break;
        case 'rotation': k = sampleChannel(c.times, c.values, 4, c.interpolation, true, time, pose.r, c.node * 4, hint); break;
        case 'scale': k = sampleChannel(c.times, c.values, 3, c.interpolation, false, time, pose.s, c.node * 3, hint); break;
        default: {
          const count = layout.morphCount[c.node];
          if (count === 0) continue;
          k = sampleChannel(c.times, c.values, Math.min(c.stride, count), c.interpolation, false, time, pose.w, layout.morphOffset[c.node], hint);
        }
      }
      if (hints) hints[ci] = k < 0 ? 0 : k;
    }
  }
}

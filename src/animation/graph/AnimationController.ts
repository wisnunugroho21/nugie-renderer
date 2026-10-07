import { Pose, PoseLayout } from '../Pose';
import { applyAdditive, blendPoses, makeAdditive, type PoseMask } from '../PoseOps';
import { applyRootMotionPolicy, type RootMotionSettings } from '../RootMotion';
import { AnimationParams } from './AnimationParams';
import { RootDelta, type MotionContext } from './Motion';
import type { StateMachine } from './StateMachine';
import type { PoseConstraint } from '../ik/IK';

export interface LayerDef {
  name: string;
  stateMachine: StateMachine;
  /** 0..1 (default 1). */
  weight?: number;
  /** 'override' blends toward the layer pose; 'additive' adds the layer's deviation from `additiveReference`. */
  mode?: 'override' | 'additive';
  /** Per-node weights (and optional per-node morph weights). Unmasked nodes keep the layers below. */
  mask?: PoseMask;
  /** Additive layers: the pose the additive clip was authored against (default: the rest pose). */
  additiveReference?: Pose;
}

class Layer {
  weight: number;
  readonly mode: 'override' | 'additive';
  readonly mask?: PoseMask;
  readonly reference?: Pose;
  readonly scratch: Pose;
  readonly delta: Pose | null;
  /** Create runtime state for one layer: its weight, blend mode, bone mask and scratch poses. */
  constructor(readonly def: LayerDef, layout: PoseLayout) {
    this.weight = def.weight ?? 1; this.mode = def.mode ?? 'override'; this.mask = def.mask; this.reference = def.additiveReference;
    this.scratch = new Pose(layout);
    this.delta = this.mode === 'additive' ? new Pose(layout) : null;
  }
}

/**
 * Evaluates a stack of state-machine layers into one pose:
 *   base layer -> (override | additive, masked, weighted) layers -> root-motion policy -> IK/procedural constraints.
 * Output: `pose` (local TRS + morph weights) and `rootDelta` (displacement to apply to the owning entity).
 * Everything is preallocated; update() does not allocate.
 */
export class AnimationController {
  readonly pose: Pose;
  /** Root displacement AFTER the policy (zero when root motion is disabled). */
  readonly rootDelta = new RootDelta();
  rootMotion: RootMotionSettings = { mode: 'disabled' };
  /** Procedural constraints (IK, look-at, ...) applied last, on the blended pose, before joint matrices are derived. */
  constraints: PoseConstraint[] = [];
  /** Nodes this controller can write (union of all motions, root, constraint targets). */
  animatedNodes: Int32Array;

  private layers: Layer[];
  private ctx: MotionContext;
  private rawDelta = new RootDelta();
  private layerDelta = new RootDelta();

  /** Build a controller from at least one layer (layer 0 is the base). `rootNode` (-1 = none) is the node whose motion is extracted as root motion. */
  constructor(readonly layout: PoseLayout, readonly rest: Pose, readonly params: AnimationParams, layers: LayerDef[], readonly rootNode = -1) {
    if (layers.length === 0) throw new Error('AnimationController needs at least one layer');
    this.pose = rest.clone();
    this.layers = layers.map((l) => new Layer(l, layout));
    this.ctx = { layout, rest, params, rootNode };
    this.animatedNodes = new Int32Array(0);
    this.refreshAnimatedNodes();
  }

  /** Recompute the node set (call after adding constraints). */
  refreshAnimatedNodes(): void {
    const set = new Set<number>();
    for (const l of this.layers) for (const s of l.def.stateMachine.states) s.motion.collectNodes(set);
    if (this.rootNode >= 0) set.add(this.rootNode);
    for (const c of this.constraints) c.collectNodes(set);
    this.animatedNodes = Int32Array.from(set);
  }

  /** Current blend weight of layer `index`. */
  layerWeight(index: number): number { return this.layers[index].weight; }
  /** Set layer `index`'s blend weight, clamped to [0, 1]. */
  setLayerWeight(index: number, w: number): void { this.layers[index].weight = Math.min(1, Math.max(0, w)); }
  /** Index of the layer called `name`, or -1. */
  layerIndex(name: string): number { return this.layers.findIndex((l) => l.def.name === name); }
  /** The state machine of layer `layer` (default: the base layer). */
  stateMachine(layer = 0): StateMachine { return this.layers[layer].def.stateMachine; }

  /** Advance all layers by `dt`: evaluate each state machine, blend / add upper layers over the base pose, apply the root-motion policy, then run the IK constraints. */
  update(dt: number): void {
    const L = this.layers, pose = this.pose;
    // base layer (root motion is taken from the base layer only)
    L[0].def.stateMachine.update(dt, this.ctx, pose, this.rawDelta);

    for (let i = 1; i < L.length; i++) {
      const l = L[i];
      l.def.stateMachine.update(dt, this.ctx, l.scratch, this.layerDelta);
      if (l.weight <= 0) continue;
      if (l.mode === 'override') blendPoses(pose, pose, l.scratch, l.weight, l.mask);
      else {
        makeAdditive(l.delta!, l.scratch, l.reference ?? this.rest);
        applyAdditive(pose, pose, l.delta!, l.weight, l.mask);
      }
    }

    applyRootMotionPolicy(this.rootMotion, this.rest, this.rootNode, pose, this.rawDelta, this.rootDelta);
    for (let i = 0; i < this.constraints.length; i++) this.constraints[i].apply(pose, dt);
  }
}

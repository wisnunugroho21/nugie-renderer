import type { World } from '../World';
import { AnimatorFlags } from '../components/AnimatorStore';
import { BitSet } from '../../core/BitSet';
import { advanceTime, type AdvanceResult } from '../../animation/Animator';
import { AnimatedPath } from '../../animation/AnimationClip';
import { Mat4 } from '../../math/Mat4';
import { Quat } from '../../math/Quat';

const rotated = new Float32Array(3);
const qOut = new Float32Array(4);
const inv = Mat4.create();

/**
 * Advances every playing animator / controller, evaluates it into a Pose and writes the result into the ECS
 * (transform TRS -> dirty flags, morph weights -> MorphStore, root motion -> the owning entity).
 *  - Animator   : a single clip (play / pause / stop / loop / speed).
 *  - Controller : state machines + blend trees + layers/masks + root motion + IK (see AnimationController).
 * Only properties that are actually animated AND changed are written, so idle nodes never dirty the hierarchy.
 */
export class AnimationSystem {
  activeAnimators = 0;
  activeControllers = 0;
  nodesWritten = 0;
  private tmp: AdvanceResult = { time: 0, finished: false };

  /** Create the system for `world` (it reads animators / controllers and writes transforms and morph weights). */
  constructor(private world: World) {}

  /** Advance every playing animator and controller by `dt` seconds and write the sampled pose into the ECS. */
  update(dt: number): void {
    const w = this.world, a = w.animators, tr = w.transforms, mo = w.morphs;
    this.activeAnimators = 0; this.activeControllers = 0; this.nodesWritten = 0;
    BitSet.forEachAnd([a.has], (i) => {
      const f = a.flags[i];
      if ((f & AnimatorFlags.Playing) === 0) return;
      const inst = a.instance[i]!, pose = a.pose[i]!;
      const clip = inst.clips[a.clip[i]];
      if (!clip) return;
      this.activeAnimators++;

      const r = advanceTime(a.time[i], dt * a.speed[i], clip.duration, (f & AnimatorFlags.Loop) !== 0, this.tmp);
      a.time[i] = r.time;
      if (r.finished) a.flags[i] = (f & ~AnimatorFlags.Playing) | AnimatorFlags.Finished;

      clip.sample(r.time, pose, a.hints[i]);

      const nodes = clip.animatedNodes, layout = inst.layout;
      for (let k = 0; k < nodes.length; k++) {
        const node = nodes[k], e = inst.nodeEntities[node];
        if (e < 0) continue;
        const t = node * 3, q = node * 4, mask = clip.nodeMask[k];
        // Only write what the clip animates: untouched properties must not dirty the transform (it would force
        // transform, skeleton and bounds recomputation for nothing).
        if (mask & AnimatedPath.Translation) tr.setPosition(e, pose.t[t], pose.t[t + 1], pose.t[t + 2]);
        if (mask & AnimatedPath.Rotation) tr.setRotation(e, pose.r[q], pose.r[q + 1], pose.r[q + 2], pose.r[q + 3]);
        if (mask & AnimatedPath.Scale) tr.setScale(e, pose.s[t], pose.s[t + 1], pose.s[t + 2]);
        if ((mask & AnimatedPath.Weights) && layout.morphCount[node] > 0 && mo.has.has(e)) mo.setWeights(e, pose.w, layout.morphOffset[node]);
        this.nodesWritten++;
      }
    });

    BitSet.forEachAnd([w.controllers.has], (i) => {
      if (w.controllers.enabled[i] === 0) return;
      const ctrl = w.controllers.controller[i]!, inst = w.controllers.instance[i]!;
      this.activeControllers++;
      ctrl.update(dt);

      const pose = ctrl.pose, layout = ctrl.layout, nodes = ctrl.animatedNodes;
      for (let k = 0; k < nodes.length; k++) {
        const node = nodes[k], e = inst.nodeEntities[node];
        if (e < 0) continue;
        const t = node * 3, q = node * 4;
        // write only when changed (exact float32 compare): a pose that did not change must not dirty anything
        if (tr.positionX[e] !== pose.t[t] || tr.positionY[e] !== pose.t[t + 1] || tr.positionZ[e] !== pose.t[t + 2]) tr.setPosition(e, pose.t[t], pose.t[t + 1], pose.t[t + 2]);
        if (tr.rotationX[e] !== pose.r[q] || tr.rotationY[e] !== pose.r[q + 1] || tr.rotationZ[e] !== pose.r[q + 2] || tr.rotationW[e] !== pose.r[q + 3]) {
          tr.setRotation(e, pose.r[q], pose.r[q + 1], pose.r[q + 2], pose.r[q + 3]);
        }
        if (tr.scaleX[e] !== pose.s[t] || tr.scaleY[e] !== pose.s[t + 1] || tr.scaleZ[e] !== pose.s[t + 2]) tr.setScale(e, pose.s[t], pose.s[t + 1], pose.s[t + 2]);
        if (layout.morphCount[node] > 0 && mo.has.has(e)) mo.setWeights(e, pose.w, layout.morphOffset[node]);
        this.nodesWritten++;
      }

      // Root motion: displace the OWNING entity in its own frame (position += rot * (scale * delta); rot = rot * delta).
      if (ctrl.rootMotion.mode !== 'disabled') this.applyRootDelta(i, ctrl.rootDelta.t, ctrl.rootDelta.r);
    });
  }

  /** Apply this frame's root-motion translation (rotated + scaled into the owner's frame) and rotation to entity `e`. */
  private applyRootDelta(e: number, dt3: Float32Array, dq: Float32Array): void {
    const tr = this.world.transforms;
    if (dt3[0] !== 0 || dt3[1] !== 0 || dt3[2] !== 0) {
      rotated[0] = dt3[0] * tr.scaleX[e]; rotated[1] = dt3[1] * tr.scaleY[e]; rotated[2] = dt3[2] * tr.scaleZ[e];
      qOut[0] = tr.rotationX[e]; qOut[1] = tr.rotationY[e]; qOut[2] = tr.rotationZ[e]; qOut[3] = tr.rotationW[e];
      Quat.rotateVec3(rotated, qOut, rotated);
      tr.setPosition(e, tr.positionX[e] + rotated[0], tr.positionY[e] + rotated[1], tr.positionZ[e] + rotated[2]);
    }
    if (dq[0] !== 0 || dq[1] !== 0 || dq[2] !== 0) {
      qOut[0] = tr.rotationX[e]; qOut[1] = tr.rotationY[e]; qOut[2] = tr.rotationZ[e]; qOut[3] = tr.rotationW[e];
      Quat.multiply(qOut, qOut, dq as unknown as Float32Array);
      Quat.normalize(qOut, qOut);
      tr.setRotation(e, qOut[0], qOut[1], qOut[2], qOut[3]);
    }
  }

  /**
   * Convert a WORLD-space point into the MODEL space of `owner` (the space IK targets are expressed in), using the
   * owner's world matrix from the last transform update. Returns false if the owner matrix is singular.
   */
  worldToModel(out: Float32Array | number[], owner: number, wx: number, wy: number, wz: number): boolean {
    const m = this.world.transforms.worldMatrices.subarray(owner * 16, owner * 16 + 16);
    if (!Mat4.invert(inv, m)) return false;
    Mat4.transformPoint(out as Float32Array, inv, wx, wy, wz);
    return true;
  }
}

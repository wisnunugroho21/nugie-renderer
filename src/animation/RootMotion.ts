import type { Pose } from './Pose';
import { RootDelta } from './graph/Motion';

export type RootMotionMode = 'disabled' | 'translation' | 'rotation' | 'both';

export interface RootMotionSettings {
  mode: RootMotionMode;
  /** Translation axes that are extracted and moved onto the entity (default: x and z, NOT y - keeps hip bob / jumps in the pose). */
  axes?: { x: boolean; y: boolean; z: boolean };
  /** 'yaw' extracts only rotation about +Y (default); 'full' extracts the whole rotation. */
  rotation?: 'yaw' | 'full';
}

const DEFAULT_AXES = { x: true, y: false, z: true };

/** Split q into twist about +Y and swing: q = swing * twist. Writes the twist into `twist`. */
export function twistY(twist: Float32Array, q: ArrayLike<number>, qo = 0): void {
  const y = q[qo + 1], w = q[qo + 3];
  const l = Math.hypot(y, w);
  if (l < 1e-8) { twist[0] = 0; twist[1] = 0; twist[2] = 0; twist[3] = 1; return; }
  twist[0] = 0; twist[1] = y / l; twist[2] = 0; twist[3] = w / l;
}

function mul(out: Float32Array, o: number, a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3], bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

const tw = new Float32Array(4), twConj = new Float32Array(4), swing = new Float32Array(4), restTw = new Float32Array(4);

/**
 * Apply the root-motion policy:
 *  - `out` receives the displacement that must be applied to the owning entity (filtered by mode/axes);
 *  - the pose's root bone is NEUTRALIZED on exactly the extracted components (set to the rest value) so the same
 *    displacement is never applied to both the entity and the skeleton.
 * With mode 'disabled', `out` is zero and the pose is untouched (the skeleton carries the motion).
 */
export function applyRootMotionPolicy(settings: RootMotionSettings, rest: Pose, rootNode: number, pose: Pose, delta: RootDelta, out: RootDelta): void {
  out.reset();
  if (settings.mode === 'disabled' || rootNode < 0) return;
  const t = rootNode * 3, q = rootNode * 4;

  if (settings.mode === 'translation' || settings.mode === 'both') {
    const ax = settings.axes ?? DEFAULT_AXES;
    if (ax.x) { out.t[0] = delta.t[0]; pose.t[t] = rest.t[t]; }
    if (ax.y) { out.t[1] = delta.t[1]; pose.t[t + 1] = rest.t[t + 1]; }
    if (ax.z) { out.t[2] = delta.t[2]; pose.t[t + 2] = rest.t[t + 2]; }
  }
  if (settings.mode === 'rotation' || settings.mode === 'both') {
    if ((settings.rotation ?? 'yaw') === 'full') {
      out.r.set(delta.r);
      pose.r[q] = rest.r[q]; pose.r[q + 1] = rest.r[q + 1]; pose.r[q + 2] = rest.r[q + 2]; pose.r[q + 3] = rest.r[q + 3];
    } else {
      twistY(tw, delta.r, 0);
      out.r.set(tw);
      // pose root = swing(pose) * twist(rest): drop the animated yaw, keep tilt/lean
      twistY(tw, pose.r, q);
      twConj[0] = -tw[0]; twConj[1] = -tw[1]; twConj[2] = -tw[2]; twConj[3] = tw[3];
      mul(swing, 0, pose.r, q, twConj, 0);
      twistY(restTw, rest.r, q);
      mul(pose.r, q, swing, 0, restTw, 0);
    }
  }
}

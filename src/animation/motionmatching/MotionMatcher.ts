import type { MotionDatabase } from './MotionDatabase';

/** What the gameplay layer wants, in the CHARACTER frame (forward = +Z, right = +X when viewed from behind... see docs). */
export interface DesiredMotion {
  /** Desired velocity on the ground plane (x = sideways, z = forward), metres/second. */
  vx: number; vz: number;
  /** Desired turn rate about +Y, radians/second. */
  yawRate: number;
}

export interface MatchResult { frame: number; cost: number; }

/**
 * Brute-force nearest-neighbour search over the pose database (squared distance in normalized, weighted feature
 * space) with early-out per frame. Brute force is the correctness baseline; an acceleration structure (KD-tree /
 * VP-tree / ANN) is only worth adding when profiling shows search time matters (see benchmarks).
 */
export class MotionMatcher {
  readonly query: Float32Array;
  /** Frames examined / early-outs in the last search (diagnostics). */
  examined = 0;

  /** Create a matcher over database `db` (allocates the query vector). */
  constructor(readonly db: MotionDatabase) { this.query = new Float32Array(db.dim); }

  /**
   * Fill `query` from the desired motion and the CURRENT pose's features (taken from the database frame that is
   * playing: its pose/velocity/contact dims are copied so the search favours continuing from where we are).
   */
  buildQuery(desired: DesiredMotion, currentFrame: number): Float32Array {
    const db = this.db, L = db.layout, q = this.query, D = db.dim;
    // start from the current frame's features (normalized space), then overwrite the controllable groups
    if (currentFrame >= 0) for (let d = 0; d < D; d++) q[d] = db.features[currentFrame * D + d];
    else q.fill(0);
    /** Normalise feature `d` with the database's mean and scale. */
    const norm = (d: number, raw: number) => (raw - db.mean[d]) * db.scale[d];
    q[L.velocity] = norm(L.velocity, desired.vx); q[L.velocity + 1] = norm(L.velocity + 1, 0); q[L.velocity + 2] = norm(L.velocity + 2, desired.vz);
    q[L.angularVelocity] = norm(L.angularVelocity, desired.yawRate);
    // predicted future trajectory: integrate the desired velocity while turning at yawRate (character frame)
    const times = db.trajectoryTimes;
    let px = 0, pz = 0, yaw = 0, t = 0;
    for (let i = 0; i < times.length; i++) {
      const target = times[i], steps = Math.max(1, Math.ceil((target - t) / 0.05)), h = (target - t) / steps;
      for (let s = 0; s < steps; s++) {
        const c = Math.cos(yaw), sn = Math.sin(yaw);
        px += (c * desired.vx + sn * desired.vz) * h; pz += (-sn * desired.vx + c * desired.vz) * h;
        yaw += desired.yawRate * h;
      }
      t = target;
      q[L.trajectoryPosition + i * 2] = norm(L.trajectoryPosition + i * 2, px);
      q[L.trajectoryPosition + i * 2 + 1] = norm(L.trajectoryPosition + i * 2 + 1, pz);
      q[L.trajectoryFacing + i * 2] = norm(L.trajectoryFacing + i * 2, Math.sin(yaw));
      q[L.trajectoryFacing + i * 2 + 1] = norm(L.trajectoryFacing + i * 2 + 1, Math.cos(yaw));
    }
    return q;
  }

  /** Cost (squared normalized distance) of a specific frame against the current query. */
  costOf(frame: number): number {
    const D = this.db.dim, f = this.db.features, q = this.query;
    let c = 0;
    for (let d = 0; d < D; d++) { const e = f[frame * D + d] - q[d]; c += e * e; }
    return c;
  }

  /**
   * Best selectable frame for the current query. Frames in [continueFrom + 1, continueFrom + continueSpan] of the
   * same clip get `continuationBias` subtracted from their cost (prefer to keep playing the current clip).
   */
  search(continueFrom = -1, continuationBias = 0, continueSpan = 6): MatchResult {
    const db = this.db, D = db.dim, f = db.features, q = this.query, valid = db.valid, F = db.frameCount;
    let best = -1, bestCost = Infinity, examined = 0;
    const cClip = continueFrom >= 0 ? db.clipOfFrame[continueFrom] : -1;
    for (let fr = 0; fr < F; fr++) {
      if (valid[fr] === 0) continue;
      const bias = cClip >= 0 && db.clipOfFrame[fr] === cClip && fr > continueFrom && fr <= continueFrom + continueSpan ? continuationBias : 0;
      const limit = bestCost + bias; // early-out threshold
      let c = 0, base = fr * D, d = 0;
      for (; d < D; d++) { const e = f[base + d] - q[d]; c += e * e; if ((d & 7) === 7 && c > limit) break; }
      examined++;
      if (d < D && c > limit) continue;
      c -= bias;
      if (c < bestCost) { bestCost = c; best = fr; }
    }
    this.examined = examined;
    return { frame: best, cost: bestCost };
  }
}

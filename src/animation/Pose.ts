import type { GLTFAsset } from '../assets/AssetTypes';

/** Parents-before-children ordering of a forest given parent indices (throws on cycles). */
function topologicalOrder(parent: ArrayLike<number>): Int32Array {
  const n = parent.length, order = new Int32Array(n), state = new Uint8Array(n); // 0 unvisited, 1 in current chain, 2 emitted
  let k = 0;
  for (let s = 0; s < n; s++) {
    if (state[s] !== 0) continue;
    const chain: number[] = [];
    let i = s;
    while (i !== -1 && state[i] === 0) { state[i] = 1; chain.push(i); i = parent[i]; }
    if (i !== -1 && state[i] === 1) throw new Error('Pose hierarchy contains a cycle');
    while (chain.length) { const j = chain.pop()!; state[j] = 2; order[k++] = j; } // topmost ancestor first
  }
  return order;
}

/** Shape of a pose: node count and where each node's morph weights live in the flat weight array. */
export class PoseLayout {
  readonly nodeCount: number;
  readonly morphOffset: Int32Array;
  readonly morphCount: Int32Array;
  readonly totalMorph: number;
  /** Parent node index per node (-1 = root). Needed by IK and model-space evaluation. */
  readonly parent: Int32Array;
  /** Node indices ordered so that every parent precedes its children. */
  readonly order: Int32Array;

  /** Describe `nodeCount` nodes with optional morph-target counts per node and parent indices (-1 = root); derives a parent-first node order and morph offsets. */
  constructor(nodeCount: number, morphCounts?: ArrayLike<number>, parent?: ArrayLike<number>) {
    this.nodeCount = nodeCount;
    this.parent = new Int32Array(nodeCount).fill(-1);
    if (parent) for (let i = 0; i < nodeCount; i++) this.parent[i] = parent[i];
    this.order = topologicalOrder(this.parent);
    this.morphOffset = new Int32Array(nodeCount);
    this.morphCount = new Int32Array(nodeCount);
    let total = 0;
    for (let i = 0; i < nodeCount; i++) {
      const c = morphCounts?.[i] ?? 0;
      this.morphOffset[i] = total; this.morphCount[i] = c; total += c;
    }
    this.totalMorph = total;
  }

  /** Build the layout from a glTF asset's node tree (morph counts come from each node's first primitive). */
  static fromAsset(asset: GLTFAsset): PoseLayout {
    return new PoseLayout(
      asset.nodes.length,
      asset.nodes.map((n) => (n.mesh >= 0 ? asset.meshes[n.mesh]?.primitives[0]?.morphTargets?.length ?? 0 : 0)),
      asset.nodes.map((n) => n.parent),
    );
  }
}

/**
 * Local-space pose in SoA form: per node translation(3), rotation(4, xyzw), scale(3) + flat morph weights.
 * Animation is blended in this TRS representation (never as matrices).
 */
export class Pose {
  readonly t: Float32Array;
  readonly r: Float32Array;
  readonly s: Float32Array;
  readonly w: Float32Array;

  /** Allocate translation / rotation / scale / morph-weight arrays for `layout`, initialised to the identity pose. */
  constructor(readonly layout: PoseLayout) {
    const n = layout.nodeCount;
    this.t = new Float32Array(n * 3);
    this.r = new Float32Array(n * 4);
    this.s = new Float32Array(n * 3);
    this.w = new Float32Array(layout.totalMorph);
    this.setIdentity();
  }

  /** Reset to zero translation, identity rotation, unit scale and zero morph weights. */
  setIdentity(): this {
    this.t.fill(0); this.s.fill(1); this.w.fill(0);
    for (let i = 0; i < this.layout.nodeCount; i++) { this.r[i * 4] = 0; this.r[i * 4 + 1] = 0; this.r[i * 4 + 2] = 0; this.r[i * 4 + 3] = 1; }
    return this;
  }

  /** Copy all channels from pose `o` (same layout). */
  copyFrom(o: Pose): this {
    this.t.set(o.t); this.r.set(o.r); this.s.set(o.s); this.w.set(o.w);
    return this;
  }

  /** A new pose with the same layout and values. */
  clone(): Pose { return new Pose(this.layout).copyFrom(this); }

  /** Rest pose from the glTF node TRS + default morph weights (node.weights, else mesh.weights, else 0). */
  static rest(asset: GLTFAsset, layout = PoseLayout.fromAsset(asset)): Pose {
    const p = new Pose(layout);
    asset.nodes.forEach((n, i) => {
      p.t.set(n.translation, i * 3); p.r.set(n.rotation, i * 4); p.s.set(n.scale, i * 3);
      const count = layout.morphCount[i];
      if (count > 0) {
        const src = n.weights ?? asset.meshes[n.mesh]?.defaultMorphWeights;
        if (src) for (let k = 0; k < count; k++) p.w[layout.morphOffset[i] + k] = src[k] ?? 0;
      }
    });
    return p;
  }
}

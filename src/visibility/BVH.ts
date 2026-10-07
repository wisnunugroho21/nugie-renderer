import type { Frustum } from '../math/Frustum';

/**
 * Flat-array BVH over static AABBs (object ids are caller-defined, e.g. RenderWorld slots).
 * Node layout (nodes allocated so siblings are adjacent):
 *   bounds[6*n..]   : minXYZ, maxXYZ
 *   first[n], count[n]
 *     internal: count == 0, first = index of left child (right child = first + 1)
 *     leaf    : count > 0,  first = start into `order`
 * Build: top-down median split on the longest centroid axis (quickselect), O(n log n).
 */
export class BVH {
  nodeCount = 0;
  bounds = new Float32Array(0);
  first = new Int32Array(0);
  count = new Int32Array(0);
  /** Object ids in leaf order. */
  order = new Uint32Array(0);
  /** Per-object AABBs, parallel to `order` (6 floats each), for exact leaf tests. */
  objBounds = new Float32Array(0);

  /** Metrics for the last cull(). */
  nodesVisited = 0;
  boxesTested = 0;
  private stack = new Int32Array(256);
  private maskStack = new Uint8Array(256);

  static build(ids: ArrayLike<number>, aabbs: ArrayLike<number>, aabbOffset: (id: number) => number, leafSize = 4): BVH {
    const bvh = new BVH();
    const n = ids.length;
    const maxNodes = Math.max(1, 2 * n);
    bvh.bounds = new Float32Array(maxNodes * 6);
    bvh.first = new Int32Array(maxNodes);
    bvh.count = new Int32Array(maxNodes);
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = ids[i];
    bvh.order = order;
    if (n === 0) { bvh.nodeCount = 0; return bvh; }

    // centroids cached per position in `order`
    const cen = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const o = aabbOffset(order[i]);
      cen[i * 3] = (aabbs[o] + aabbs[o + 3]) / 2; cen[i * 3 + 1] = (aabbs[o + 1] + aabbs[o + 4]) / 2; cen[i * 3 + 2] = (aabbs[o + 2] + aabbs[o + 5]) / 2;
    }
    let nodes = 1;
    // work stack of (node, start, end)
    const work: number[] = [0, 0, n];
    while (work.length) {
      const end = work.pop()!, start = work.pop()!, node = work.pop()!;
      // bounds of the range
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
      let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity;
      for (let i = start; i < end; i++) {
        const o = aabbOffset(order[i]);
        if (aabbs[o] < mnx) mnx = aabbs[o]; if (aabbs[o + 1] < mny) mny = aabbs[o + 1]; if (aabbs[o + 2] < mnz) mnz = aabbs[o + 2];
        if (aabbs[o + 3] > mxx) mxx = aabbs[o + 3]; if (aabbs[o + 4] > mxy) mxy = aabbs[o + 4]; if (aabbs[o + 5] > mxz) mxz = aabbs[o + 5];
        const cx = cen[i * 3], cy = cen[i * 3 + 1], cz = cen[i * 3 + 2];
        if (cx < cmnx) cmnx = cx; if (cy < cmny) cmny = cy; if (cz < cmnz) cmnz = cz;
        if (cx > cmxx) cmxx = cx; if (cy > cmxy) cmxy = cy; if (cz > cmxz) cmxz = cz;
      }
      bvh.bounds.set([mnx, mny, mnz, mxx, mxy, mxz], node * 6);
      const len = end - start;
      if (len <= leafSize) { bvh.first[node] = start; bvh.count[node] = len; continue; }
      const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz;
      const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
      if (Math.max(ex, ey, ez) === 0) { bvh.first[node] = start; bvh.count[node] = len; continue; } // coincident centroids
      const mid = (start + end) >> 1;
      quickselect(order, cen, axis, start, end - 1, mid);
      const left = nodes; nodes += 2;
      bvh.first[node] = left; bvh.count[node] = 0;
      work.push(left, start, mid, left + 1, mid, end);
    }
    bvh.nodeCount = nodes;
    bvh.objBounds = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) { const o = aabbOffset(order[i]); for (let k = 0; k < 6; k++) bvh.objBounds[i * 6 + k] = aabbs[o + k]; }
    return bvh;
  }

  /**
   * Collect ids of leaves intersecting the frustum into `out`; returns the count.
   * Uses plane-mask coherency: a node fully inside a plane skips that plane for its subtree, and a
   * node fully inside ALL planes emits its whole leaf range without testing children.
   */
  cull(frustum: Frustum, out: Uint32Array | number[], outOffset = 0): number {
    if (this.nodeCount === 0) return outOffset;
    const p = frustum.planes, b = this.bounds, first = this.first, cnt = this.count, order = this.order;
    let sp = 0, c = outOffset, visited = 0, tested = 0;
    const stack = this.stack, masks = this.maskStack;
    stack[0] = 0; masks[0] = 0; sp = 1; // mask bit set => plane already satisfied by ancestor
    while (sp > 0) {
      sp--;
      const node = stack[sp];
      let mask = masks[sp];
      visited++;
      tested++;
      const o = node * 6;
      let outside = false, inside = true;
      for (let pl = 0; pl < 6; pl++) {
        if (mask & (1 << pl)) continue;
        const i = pl * 4, nx = p[i], ny = p[i + 1], nz = p[i + 2], d = p[i + 3];
        // positive vertex (max n·x) and negative vertex (min n·x)
        const px = nx >= 0 ? b[o + 3] : b[o], py = ny >= 0 ? b[o + 4] : b[o + 1], pz = nz >= 0 ? b[o + 5] : b[o + 2];
        if (nx * px + ny * py + nz * pz + d < 0) { outside = true; break; }
        const qx = nx >= 0 ? b[o] : b[o + 3], qy = ny >= 0 ? b[o + 1] : b[o + 4], qz = nz >= 0 ? b[o + 2] : b[o + 5];
        if (nx * qx + ny * qy + nz * qz + d >= 0) mask |= 1 << pl; else inside = false;
      }
      if (outside) continue;
      if (inside || mask === 63) {
        // whole subtree is inside: emit all leaves under this node
        c = this.emitSubtree(node, out, c);
        continue;
      }
      if (cnt[node] > 0) {
        // Leaf straddling the frustum: exact per-object AABB test against the still-unsatisfied planes.
        const s = first[node], e = s + cnt[node], ob = this.objBounds;
        for (let k = s; k < e; k++) {
          const q = k * 6;
          let ok = true;
          for (let pl = 0; pl < 6; pl++) {
            if (mask & (1 << pl)) continue;
            const i = pl * 4, nx = p[i], ny = p[i + 1], nz = p[i + 2];
            const px = nx >= 0 ? ob[q + 3] : ob[q], py = ny >= 0 ? ob[q + 4] : ob[q + 1], pz = nz >= 0 ? ob[q + 5] : ob[q + 2];
            if (nx * px + ny * py + nz * pz + p[i + 3] < 0) { ok = false; break; }
          }
          if (ok) out[c++] = order[k];
        }
      } else {
        if (sp + 2 > stack.length) this.growStack();
        stack[sp] = first[node] + 1; masks[sp] = mask; sp++;
        stack[sp] = first[node]; masks[sp] = mask; sp++;
      }
    }
    this.nodesVisited = visited;
    this.boxesTested = tested;
    return c;
  }

  private emitSubtree(root: number, out: Uint32Array | number[], c: number): number {
    // Leaves under `root` occupy a contiguous range of `order`; find it by descending the extremes.
    let lo = root; while (this.count[lo] === 0) lo = this.first[lo];
    let hi = root; while (this.count[hi] === 0) hi = this.first[hi] + 1;
    const s = this.first[lo], e = this.first[hi] + this.count[hi];
    for (let k = s; k < e; k++) out[c++] = this.order[k];
    return c;
  }

  private growStack(): void {
    const s = new Int32Array(this.stack.length * 2); s.set(this.stack); this.stack = s;
    const m = new Uint8Array(this.maskStack.length * 2); m.set(this.maskStack); this.maskStack = m;
  }

  /** Max depth (for tests/diagnostics). */
  depth(): number {
    if (this.nodeCount === 0) return 0;
    let best = 0; const st: number[] = [0, 1];
    while (st.length) { const d = st.pop()!, n = st.pop()!; best = Math.max(best, d); if (this.count[n] === 0) st.push(this.first[n], d + 1, this.first[n] + 1, d + 1); }
    return best;
  }
}

/** Partition `order[lo..hi]` so that position k holds the element it would in sorted-by-centroid[axis] order. */
function quickselect(order: Uint32Array, cen: Float32Array, axis: number, lo: number, hi: number, k: number): void {
  const key = (i: number) => cen[i * 3 + axis];
  const swap = (i: number, j: number) => {
    const t = order[i]; order[i] = order[j]; order[j] = t;
    for (let a = 0; a < 3; a++) { const c = cen[i * 3 + a]; cen[i * 3 + a] = cen[j * 3 + a]; cen[j * 3 + a] = c; }
  };
  while (lo < hi) {
    const pivot = key((lo + hi) >> 1);
    let i = lo, j = hi;
    while (i <= j) {
      while (key(i) < pivot) i++;
      while (key(j) > pivot) j--;
      if (i <= j) { swap(i, j); i++; j--; }
    }
    if (k <= j) hi = j; else if (k >= i) lo = i; else return;
  }
}

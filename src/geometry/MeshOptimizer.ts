/**
 * Offline-quality mesh processing, all pure TypeScript on typed arrays:
 *  - optimizeVertexCache: Tom Forsyth's linear-speed triangle reordering (post-transform cache).
 *  - optimizeVertexFetch: renumber vertices in first-use order (memory locality of the vertex fetch).
 *  - averageCacheMissRatio: ACMR of an index list for a FIFO cache (the usual quality metric).
 *  - simplify: quadric-error edge collapse (Garland-Heckbert) with boundary preservation and flip rejection.
 *  - buildMeshlets: greedy clusters (<= maxVertices / maxTriangles) with bounding sphere and normal cone.
 */

// ------------------------------------------------------------------------------------------- vertex cache

/** Average cache miss ratio (transformed vertices per triangle) for a FIFO post-transform cache. */
export function averageCacheMissRatio(indices: ArrayLike<number>, cacheSize = 16): number {
  const cache: number[] = [];
  let misses = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (cache.indexOf(v) < 0) {
      misses++;
      cache.push(v);
      if (cache.length > cacheSize) cache.shift();
    }
  }
  return indices.length ? misses / (indices.length / 3) : 0;
}

const CACHE_SIZE = 32;
const CACHE_DECAY = 1.5;
const LAST_TRI_SCORE = 0.75;
const VALENCE_BOOST_SCALE = 2.0;
const VALENCE_BOOST_POWER = 0.5;

/** Forsyth score of a vertex: high while it sits near the front of the post-transform cache and while few triangles still need it. */
function vertexScore(cachePos: number, liveTris: number): number {
  if (liveTris === 0) return -1;
  let score = 0;
  if (cachePos >= 0) {
    if (cachePos < 3) score = LAST_TRI_SCORE;
    else score = Math.pow(1 - (cachePos - 3) / (CACHE_SIZE - 3), CACHE_DECAY);
  }
  return score + VALENCE_BOOST_SCALE * Math.pow(liveTris, -VALENCE_BOOST_POWER);
}

/** Reorders triangles for post-transform cache efficiency. Returns a new index array (same triangles, same winding). */
export function optimizeVertexCache(indices: Uint32Array, vertexCount: number): Uint32Array {
  const triCount = indices.length / 3;
  const live = new Uint32Array(vertexCount);
  for (let i = 0; i < indices.length; i++) live[indices[i]]++;
  const start = new Uint32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) start[v + 1] = start[v] + live[v];
  const adj = new Uint32Array(indices.length), fill = new Uint32Array(vertexCount);
  for (let t = 0; t < triCount; t++) for (let k = 0; k < 3; k++) { const v = indices[t * 3 + k]; adj[start[v] + fill[v]++] = t; }

  const cachePos = new Int32Array(vertexCount).fill(-1);
  const score = new Float64Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) score[v] = vertexScore(-1, live[v]);
  const triScore = new Float64Array(triCount), done = new Uint8Array(triCount);
  for (let t = 0; t < triCount; t++) triScore[t] = score[indices[t * 3]] + score[indices[t * 3 + 1]] + score[indices[t * 3 + 2]];

  const out = new Uint32Array(indices.length);
  let outN = 0, cache: number[] = [], scan = 0;
  /** Fallback when the cache holds no candidate: the best-scoring remaining triangle (scanning from the first unfinished one). */
  const bestOverall = (): number => {
    let best = -1, bs = -Infinity;
    while (scan < triCount && done[scan]) scan++;
    for (let t = scan; t < triCount; t++) if (!done[t] && triScore[t] > bs) { bs = triScore[t]; best = t; }
    return best;
  };
  let tri = bestOverall();
  while (tri >= 0) {
    done[tri] = 1;
    const verts = [indices[tri * 3], indices[tri * 3 + 1], indices[tri * 3 + 2]];
    for (const v of verts) { out[outN++] = v; live[v]--; }
    // new cache order: this triangle's vertices first, then the previous cache
    const newCache = [verts[0], verts[1], verts[2]];
    for (const v of cache) if (v !== verts[0] && v !== verts[1] && v !== verts[2]) newCache.push(v);
    for (const v of cache) cachePos[v] = -1;
    for (let i = 0; i < newCache.length; i++) cachePos[newCache[i]] = i < CACHE_SIZE ? i : -1;
    cache = newCache.slice(0, CACHE_SIZE + 3);
    // re-score every vertex that is (or was) in the cache, then the triangles that use them
    let candidate = -1, cs = -Infinity;
    for (const v of newCache) {
      score[v] = vertexScore(cachePos[v], live[v]);
    }
    for (const v of newCache) {
      for (let k = start[v]; k < start[v + 1]; k++) {
        const t = adj[k];
        if (done[t]) continue;
        const s = score[indices[t * 3]] + score[indices[t * 3 + 1]] + score[indices[t * 3 + 2]];
        triScore[t] = s;
        if (s > cs) { cs = s; candidate = t; }
      }
    }
    cache = newCache.slice(0, CACHE_SIZE);
    tri = candidate >= 0 ? candidate : bestOverall();
  }
  return out;
}

/**
 * Renumbers vertices in order of first use by `indices` (in place on the index list) and returns the remap
 * (`remap[old] = new`, -1 for unused vertices) and the new vertex count. Apply it with `remapVertices`.
 */
export function optimizeVertexFetch(indices: Uint32Array, vertexCount: number): { remap: Int32Array; vertexCount: number } {
  const remap = new Int32Array(vertexCount).fill(-1);
  let next = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] < 0) remap[v] = next++;
    indices[i] = remap[v];
  }
  return { remap, vertexCount: next };
}

/** Copy `stride` floats per vertex into a new array following `remap` (unused vertices are dropped). */
export function remapVertices(data: Float32Array, stride: number, remap: Int32Array, newCount: number): Float32Array {
  const out = new Float32Array(newCount * stride);
  for (let v = 0; v < remap.length; v++) {
    const n = remap[v];
    if (n >= 0) out.set(data.subarray(v * stride, v * stride + stride), n * stride);
  }
  return out;
}

// ----------------------------------------------------------------------------------------- simplification

export interface SimplifyResult { indices: Uint32Array; /** Largest quadric error of any collapse performed (squared distance units). */ error: number; }

/**
 * Quadric edge-collapse simplification. `positions` = xyz per vertex (vertices keep their identity: the result is an index list
 * into the ORIGINAL vertex array with collapsed vertices moved, so attributes can be carried over unchanged for the survivors).
 * Stops at `targetIndexCount` or when no safe collapse remains. Boundary edges are protected with penalty quadrics.
 * NOTE: `positions` is modified in place (surviving vertices are moved to their optimal position).
 */
export function simplify(positions: Float32Array, indices: Uint32Array, targetIndexCount: number, boundaryWeight = 50): SimplifyResult {
  const nv = positions.length / 3, nt = indices.length / 3;
  const tris = Uint32Array.from(indices);
  const alive = new Uint8Array(nt).fill(1);
  // per-vertex quadric (10 coefficients of the symmetric 4x4)
  const Q = new Float64Array(nv * 10);
  /** Add the weighted plane quadric (a, b, c, d) to vertex `v`. */
  const addPlane = (v: number, a: number, b: number, c: number, d: number, w: number): void => {
    const o = v * 10;
    Q[o] += w * a * a; Q[o + 1] += w * a * b; Q[o + 2] += w * a * c; Q[o + 3] += w * a * d;
    Q[o + 4] += w * b * b; Q[o + 5] += w * b * c; Q[o + 6] += w * b * d;
    Q[o + 7] += w * c * c; Q[o + 8] += w * c * d; Q[o + 9] += w * d * d;
  };
  /** Coordinate `k` of vertex `v`'s position. */
  const P = (v: number, k: number) => positions[v * 3 + k];
  /** Unit normal and plane offset (nx, ny, nz, d) of triangle `t`. */
  const triNormal = (t: number): [number, number, number, number] => {
    const a = tris[t * 3], b = tris[t * 3 + 1], c = tris[t * 3 + 2];
    const ux = P(b, 0) - P(a, 0), uy = P(b, 1) - P(a, 1), uz = P(b, 2) - P(a, 2), vx = P(c, 0) - P(a, 0), vy = P(c, 1) - P(a, 1), vz = P(c, 2) - P(a, 2);
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, len = Math.hypot(nx, ny, nz);
    return [nx, ny, nz, len];
  };
  const vertTris: Set<number>[] = Array.from({ length: nv }, () => new Set<number>());
  for (let t = 0; t < nt; t++) {
    const [nx, ny, nz, len] = triNormal(t);
    for (let k = 0; k < 3; k++) vertTris[tris[t * 3 + k]].add(t);
    if (len < 1e-20) continue;
    const a = nx / len, b = ny / len, c = nz / len, a0 = tris[t * 3], d = -(a * P(a0, 0) + b * P(a0, 1) + c * P(a0, 2));
    for (let k = 0; k < 3; k++) addPlane(tris[t * 3 + k], a, b, c, d, len * 0.5);
  }
  // boundary protection: edges used by exactly one triangle get a plane through the edge perpendicular to the face
  const edgeCount = new Map<number, number>();
  /** Order-independent key of the edge between vertices a and b. */
  const ekey = (a: number, b: number) => (a < b ? a * nv + b : b * nv + a);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) { const key = ekey(tris[t * 3 + k], tris[t * 3 + (k + 1) % 3]); edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1); }
  for (let t = 0; t < nt; t++) {
    const [nx, ny, nz, len] = triNormal(t);
    if (len < 1e-20) continue;
    for (let k = 0; k < 3; k++) {
      const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3];
      if (edgeCount.get(ekey(a, b)) !== 1) continue;
      const ex = P(b, 0) - P(a, 0), ey = P(b, 1) - P(a, 1), ez = P(b, 2) - P(a, 2);
      let px = ey * nz - ez * ny, py = ez * nx - ex * nz, pz = ex * ny - ey * nx;
      const pl = Math.hypot(px, py, pz);
      if (pl < 1e-20) continue;
      px /= pl; py /= pl; pz /= pl;
      const d = -(px * P(a, 0) + py * P(a, 1) + pz * P(a, 2)), w = boundaryWeight * Math.hypot(ex, ey, ez);
      addPlane(a, px, py, pz, d, w); addPlane(b, px, py, pz, d, w);
    }
  }
  /** Quadric error of placing a vertex at (x, y, z) given the quadric stored at offset `o`. */
  const evalQ = (q: ArrayLike<number>, o: number, x: number, y: number, z: number): number =>
    q[o] * x * x + 2 * q[o + 1] * x * y + 2 * q[o + 2] * x * z + 2 * q[o + 3] * x +
    q[o + 4] * y * y + 2 * q[o + 5] * y * z + 2 * q[o + 6] * y +
    q[o + 7] * z * z + 2 * q[o + 8] * z + q[o + 9];
  const tmp = new Float64Array(10);
  /** cost and target position of collapsing (a, b): best of a, b and the midpoint (robust, no matrix solve). */
  const collapseCost = (a: number, b: number): { cost: number; x: number; y: number; z: number } => {
    for (let i = 0; i < 10; i++) tmp[i] = Q[a * 10 + i] + Q[b * 10 + i];
    const cands: [number, number, number][] = [[P(a, 0), P(a, 1), P(a, 2)], [P(b, 0), P(b, 1), P(b, 2)],
      [(P(a, 0) + P(b, 0)) / 2, (P(a, 1) + P(b, 1)) / 2, (P(a, 2) + P(b, 2)) / 2]];
    let best = Infinity, bx = 0, by = 0, bz = 0;
    for (const [x, y, z] of cands) { const c = evalQ(tmp, 0, x, y, z); if (c < best) { best = c; bx = x; by = y; bz = z; } }
    return { cost: Math.max(best, 0), x: bx, y: by, z: bz };
  };

  // priority queue of edges with lazy invalidation
  interface Edge { a: number; b: number; cost: number; x: number; y: number; z: number; va: number; vb: number }
  const heap: Edge[] = [];
  /** Restore the min-heap property by sifting entry `i` up. */
  const up = (i: number) => { while (i > 0) { const p = (i - 1) >> 1; if (heap[p].cost <= heap[i].cost) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  /** Restore the min-heap property by sifting entry `i` down. */
  const down = (i: number) => { for (;;) { let m = i; const l = 2 * i + 1, r = l + 1; if (l < heap.length && heap[l].cost < heap[m].cost) m = l; if (r < heap.length && heap[r].cost < heap[m].cost) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  /** Insert an edge candidate into the cost-ordered heap. */
  const push = (e: Edge) => { heap.push(e); up(heap.length - 1); };
  /** Remove and return the cheapest edge candidate. */
  const pop = (): Edge => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; down(0); } return top; };
  const version = new Uint32Array(nv);
  const redirect = new Int32Array(nv).map((_, i) => i);   // collapsed vertex -> survivor
  const pushEdge = (a: number, b: number): void => { const c = collapseCost(a, b); push({ a, b, cost: c.cost, x: c.x, y: c.y, z: c.z, va: version[a], vb: version[b] }); };
  const seen = new Set<number>();
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const a = tris[t * 3 + k], b = tris[t * 3 + (k + 1) % 3], key = ekey(a, b);
    if (!seen.has(key) && a !== b) { seen.add(key); pushEdge(a, b); }
  }

  let liveTris = nt, maxError = 0;
  const target = Math.floor(targetIndexCount / 3);
  while (liveTris > target && heap.length) {
    const e = pop();
    if (redirect[e.a] !== e.a || redirect[e.b] !== e.b || version[e.a] !== e.va || version[e.b] !== e.vb) continue;
    const { a, b } = e;
    // reject if any surviving triangle around either vertex would flip or degenerate
    const nx = e.x, ny = e.y, nz = e.z;
    let ok = true;
    /** Reject the collapse if it would flip (or nearly degenerate) any surviving triangle around vertex `v`. */
    const check = (v: number): void => {
      for (const t of vertTris[v]) {
        if (!alive[t]) continue;
        const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
        if ((i0 === a || i1 === a || i2 === a) && (i0 === b || i1 === b || i2 === b)) continue;   // removed by the collapse
        const before = triNormal(t);
        const old = [P(v, 0), P(v, 1), P(v, 2)];
        positions[v * 3] = nx; positions[v * 3 + 1] = ny; positions[v * 3 + 2] = nz;
        const after = triNormal(t);
        positions[v * 3] = old[0]; positions[v * 3 + 1] = old[1]; positions[v * 3 + 2] = old[2];
        if (after[3] < 1e-12 || before[3] < 1e-20) { if (after[3] < 1e-12) ok = false; continue; }
        const dot = (before[0] * after[0] + before[1] * after[1] + before[2] * after[2]) / (before[3] * after[3]);
        if (dot < 0.2) ok = false;
        if (!ok) return;
      }
    };
    check(a); if (ok) check(b);
    if (!ok) continue;
    // perform: b merges into a at the optimal position
    positions[a * 3] = nx; positions[a * 3 + 1] = ny; positions[a * 3 + 2] = nz;
    for (let i = 0; i < 10; i++) Q[a * 10 + i] += Q[b * 10 + i];
    redirect[b] = a; version[a]++; version[b]++;
    maxError = Math.max(maxError, e.cost);
    for (const t of vertTris[b]) {
      if (!alive[t]) continue;
      for (let k = 0; k < 3; k++) if (tris[t * 3 + k] === b) tris[t * 3 + k] = a;
      const i0 = tris[t * 3], i1 = tris[t * 3 + 1], i2 = tris[t * 3 + 2];
      if (i0 === i1 || i1 === i2 || i0 === i2) { alive[t] = 0; liveTris--; for (let k = 0; k < 3; k++) vertTris[[i0, i1, i2][k]].delete(t); }
      else vertTris[a].add(t);
    }
    vertTris[b].clear();
    // refresh the edges around the surviving vertex
    const neigh = new Set<number>();
    for (const t of vertTris[a]) for (let k = 0; k < 3; k++) { const v = tris[t * 3 + k]; if (v !== a) neigh.add(v); }
    for (const v of neigh) pushEdge(a, v);
  }
  const out: number[] = [];
  for (let t = 0; t < nt; t++) if (alive[t]) out.push(tris[t * 3], tris[t * 3 + 1], tris[t * 3 + 2]);
  return { indices: Uint32Array.from(out), error: maxError };
}

// -------------------------------------------------------------------------------------------- meshlets

export interface MeshletSet {
  /** Per meshlet: offset/count into `vertices` and `triangles` (triangles are local indices, 3 bytes per triangle). */
  vertexOffset: Uint32Array; vertexCount: Uint32Array; triangleOffset: Uint32Array; triangleCount: Uint32Array;
  vertices: Uint32Array;
  triangles: Uint8Array;
  /** Bounding sphere (x, y, z, r) per meshlet. */
  spheres: Float32Array;
  /** Normal cone per meshlet: axis xyz and cutoff = sin(spread) in w (a meshlet is back-facing when dot(axis, dirToMeshlet) > cutoff + r / dist; cutoff 1 = never). */
  cones: Float32Array;
  count: number;
}

/** Greedy meshlet builder: grows each cluster from the triangle that shares the most vertices with it. */
export function buildMeshlets(positions: Float32Array, indices: Uint32Array, maxVertices = 64, maxTriangles = 124): MeshletSet {
  const nt = indices.length / 3, nv = positions.length / 3;
  const vertTris: number[][] = Array.from({ length: nv }, () => []);
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) vertTris[indices[t * 3 + k]].push(t);
  const used = new Uint8Array(nt);
  const vOff: number[] = [], vCnt: number[] = [], tOff: number[] = [], tCnt: number[] = [], verts: number[] = [], tri: number[] = [];
  const spheres: number[] = [], cones: number[] = [];
  let remaining = nt, seedScan = 0;
  while (remaining > 0) {
    while (used[seedScan]) seedScan++;
    const local = new Map<number, number>(), lv: number[] = [], lt: number[] = [];
    let candidates: number[] = [seedScan];
    while (lt.length < maxTriangles) {
      // pick the candidate with the most vertices already in the meshlet (fewest new vertices)
      let best = -1, bestNew = 4;
      for (const t of candidates) {
        if (used[t]) continue;
        let nw = 0;
        for (let k = 0; k < 3; k++) if (!local.has(indices[t * 3 + k])) nw++;
        if (lv.length + nw > maxVertices) continue;
        if (nw < bestNew) { bestNew = nw; best = t; if (nw === 0) break; }
      }
      if (best < 0) break;
      used[best] = 1; remaining--;
      lt.push(best);
      for (let k = 0; k < 3; k++) {
        const v = indices[best * 3 + k];
        if (!local.has(v)) { local.set(v, lv.length); lv.push(v); for (const nb of vertTris[v]) if (!used[nb]) candidates.push(nb); }
      }
      if (candidates.length > 512) candidates = candidates.filter((t) => !used[t]);
    }
    vOff.push(verts.length); vCnt.push(lv.length); tOff.push(tri.length / 3); tCnt.push(lt.length);
    for (const v of lv) verts.push(v);
    for (const t of lt) for (let k = 0; k < 3; k++) tri.push(local.get(indices[t * 3 + k])!);
    // bounds: centroid-centred sphere (simple, conservative) and normal cone
    let cx = 0, cy = 0, cz = 0;
    for (const v of lv) { cx += positions[v * 3]; cy += positions[v * 3 + 1]; cz += positions[v * 3 + 2]; }
    cx /= lv.length; cy /= lv.length; cz /= lv.length;
    let r = 0;
    for (const v of lv) r = Math.max(r, Math.hypot(positions[v * 3] - cx, positions[v * 3 + 1] - cy, positions[v * 3 + 2] - cz));
    spheres.push(cx, cy, cz, r);
    let ax = 0, ay = 0, az = 0;
    const normals: number[][] = [];
    for (const t of lt) {
      const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
      const ux = positions[b * 3] - positions[a * 3], uy = positions[b * 3 + 1] - positions[a * 3 + 1], uz = positions[b * 3 + 2] - positions[a * 3 + 2];
      const vx = positions[c * 3] - positions[a * 3], vy = positions[c * 3 + 1] - positions[a * 3 + 1], vz = positions[c * 3 + 2] - positions[a * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      normals.push([nx, ny, nz]); ax += nx; ay += ny; az += nz;
    }
    const al = Math.hypot(ax, ay, az);
    if (al < 1e-6) cones.push(0, 0, 1, 1);   // normals cancel: never cone-cull (cutoff 1)
    else {
      ax /= al; ay /= al; az /= al;
      let minDot = 1;
      for (const n of normals) minDot = Math.min(minDot, n[0] * ax + n[1] * ay + n[2] * az);
      cones.push(ax, ay, az, minDot > 0 ? Math.sqrt(1 - minDot * minDot) : 1);   // cutoff = sin(spread); >= 1 disables culling
    }
  }
  return {
    vertexOffset: Uint32Array.from(vOff), vertexCount: Uint32Array.from(vCnt), triangleOffset: Uint32Array.from(tOff), triangleCount: Uint32Array.from(tCnt),
    vertices: Uint32Array.from(verts), triangles: Uint8Array.from(tri), spheres: Float32Array.from(spheres), cones: Float32Array.from(cones), count: vOff.length,
  };
}

/**
 * Conservative cone test: true when every triangle of the meshlet faces away from `eye`: with the cone axis a and spread
 * (all normals within `spread` of a) the meshlet is invisible when dot(v, a) > sin(spread) + r / dist, v = eye -> centre.
 */
export function coneBackfacing(set: MeshletSet, i: number, eye: ArrayLike<number>): boolean {
  const s = set.spheres, c = set.cones, o = i * 4;
  const cutoff = c[o + 3];   // sin(spread); >= 1 means "never cull"
  if (cutoff >= 1) return false;
  const dx = s[o] - eye[0], dy = s[o + 1] - eye[1], dz = s[o + 2] - eye[2], dist = Math.hypot(dx, dy, dz);
  if (dist <= s[o + 3]) return false;
  const d = (dx * c[o] + dy * c[o + 1] + dz * c[o + 2]) / dist;
  return d > cutoff + s[o + 3] / dist;
}

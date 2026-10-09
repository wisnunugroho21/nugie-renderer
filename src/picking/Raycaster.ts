import { Mat4 } from '../math/Mat4';
import { BitSet } from '../core/BitSet';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import type { World } from '../ecs/World';
import type { MeshManager } from '../rendering/MeshManager';

/** A ray in world space. `direction` need not be normalised, but hit distances are measured in units of its length. */
export interface Ray {
  origin: readonly [number, number, number];
  direction: readonly [number, number, number];
}

/** One ray / entity intersection. */
export interface RayHit {
  /** Entity INDEX of the object that was hit. */
  entity: number;
  /** Distance from the ray origin (in units of `ray.direction`'s length; world units for a normalised direction). */
  distance: number;
  /** World-space hit position. */
  point: [number, number, number];
  /** World-space unit normal of the triangle that was hit (the face normal, not interpolated). `[0,0,0]` for a bounds-only hit. */
  normal: [number, number, number];
  /** Index of the triangle within the mesh, or -1 when the hit is against the world AABB (no usable CPU geometry). */
  triangle: number;
}

/** Options for {@link raycastWorld}. */
export interface RaycastOptions {
  /** Ignore hits farther than this (default: unlimited). */
  maxDistance?: number;
  /** Return false to skip an entity (by entity index), e.g. to ignore the player or non-selectable objects. */
  filter?: (entity: number) => boolean;
  /** Skip entities flagged `RenderFlags.Hidden` (default true). */
  skipHidden?: boolean;
  /** Ignore triangles that face away from the ray (default false: both sides are hit). */
  cullBackfaces?: boolean;
  /** Test triangles when the mesh has CPU geometry (default true); false tests only the world AABB, which is much cheaper. */
  precise?: boolean;
}

const EPS = 1e-9;

/** Ray through the normalised-device-coordinate point (`nx`, `ny` in [-1, 1], +y up) for a camera with the given inverse view-projection. */
export function rayFromNDC(invViewProjection: ArrayLike<number>, nx: number, ny: number): Ray {
  const m = invViewProjection;
  const unproject = (z: number): [number, number, number] => {
    const x = m[0] * nx + m[4] * ny + m[8] * z + m[12];
    const y = m[1] * nx + m[5] * ny + m[9] * z + m[13];
    const zz = m[2] * nx + m[6] * ny + m[10] * z + m[14];
    const w = m[3] * nx + m[7] * ny + m[11] * z + m[15];
    return [x / w, y / w, zz / w];
  };
  const a = unproject(0), b = unproject(1);        // clip depth runs 0 (near) .. 1 (far)
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const l = Math.hypot(dx, dy, dz) || 1;
  return { origin: a, direction: [dx / l, dy / l, dz / l] };
}

/** Slab test of a ray against an AABB stored as [minXYZ, maxXYZ] at offset `o`. Returns the entry distance (0 if the origin is inside) or -1. */
export function rayAABB(ray: Ray, b: ArrayLike<number>, o: number, maxT: number): number {
  let t0 = 0, t1 = maxT;
  for (let k = 0; k < 3; k++) {
    const org = ray.origin[k], d = ray.direction[k];
    const lo = b[o + k], hi = b[o + 3 + k];
    if (Math.abs(d) < EPS) { if (org < lo || org > hi) return -1; continue; }
    const inv = 1 / d;
    let a = (lo - org) * inv, c = (hi - org) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    if (a > t0) t0 = a;
    if (c < t1) t1 = c;
    if (t0 > t1) return -1;
  }
  return t0;
}

/** CPU triangle soup of a mesh: tightly packed positions (xyz per vertex) and triangle indices. */
export interface CpuGeometry { positions: Float32Array; indices: Uint32Array; }

/** Result of {@link rayMesh}. */
export interface MeshHit { distance: number; triangle: number; normal: [number, number, number]; }

/**
 * Ray vs the triangles of `geo` placed by the world matrix whose INVERSE is `invWorld`. The ray is moved into the mesh's local space
 * (without renormalising, so `distance` stays in world ray units, also under scaling). Returns the nearest hit closer than `maxT`.
 */
export function rayMesh(geo: CpuGeometry, invWorld: ArrayLike<number>, ray: Ray, maxT: number, cullBackfaces: boolean): MeshHit | null {
  const m = invWorld;
  const [ox, oy, oz] = ray.origin, [dx, dy, dz] = ray.direction;
  const lox = m[0] * ox + m[4] * oy + m[8] * oz + m[12], loy = m[1] * ox + m[5] * oy + m[9] * oz + m[13], loz = m[2] * ox + m[6] * oy + m[10] * oz + m[14];
  const ldx = m[0] * dx + m[4] * dy + m[8] * dz, ldy = m[1] * dx + m[5] * dy + m[9] * dz, ldz = m[2] * dx + m[6] * dy + m[10] * dz;
  const p = geo.positions, idx = geo.indices;
  let best = maxT, bestTri = -1;
  for (let t = 0, n = idx.length / 3; t < n; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
    // Moller-Trumbore. det > 0 <=> the ray travels against the CCW face normal, i.e. it hits the front face  Done in local space, so mirrored scales keep outward faces as front faces.
    const px = ldy * e2z - ldz * e2y, py = ldz * e2x - ldx * e2z, pz = ldx * e2y - ldy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (cullBackfaces ? det < EPS : Math.abs(det) < EPS) continue;
    const inv = 1 / det;
    const tx = lox - p[a], ty = loy - p[a + 1], tz = loz - p[a + 2];
    const u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) continue;
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    const v = (ldx * qx + ldy * qy + ldz * qz) * inv;
    if (v < 0 || u + v > 1) continue;
    const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (dist >= 0 && dist < best) { best = dist; bestTri = t; }
  }
  if (bestTri < 0) return null;
  // Face normal in local space, then to world space with the inverse-transpose (= transpose of invWorld's 3x3).
  const a = idx[bestTri * 3] * 3, b = idx[bestTri * 3 + 1] * 3, c = idx[bestTri * 3 + 2] * 3;
  const e1x = p[b] - p[a], e1y = p[b + 1] - p[a + 1], e1z = p[b + 2] - p[a + 2];
  const e2x = p[c] - p[a], e2y = p[c + 1] - p[a + 1], e2z = p[c + 2] - p[a + 2];
  const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
  const wx = m[0] * nx + m[1] * ny + m[2] * nz, wy = m[4] * nx + m[5] * ny + m[6] * nz, wz = m[8] * nx + m[9] * ny + m[10] * nz;
  const l = Math.hypot(wx, wy, wz) || 1;
  return { distance: best, triangle: bestTri, normal: [wx / l, wy / l, wz / l] };
}

const INV = Mat4.create();

/**
 * Cast `ray` against every mesh-renderer entity of `world` and return the hits nearest-first (`closestOnly` keeps just the nearest,
 * which is cheaper). Broad phase: the cached world AABB (so call this after `Engine.frame` has updated bounds). Narrow phase: the
 * mesh's triangles, when the mesh kept CPU geometry (see `MeshManager.keepCpuGeometry`) and is not skinned / morphed; otherwise the
 * AABB hit itself is reported (`triangle = -1`).
 */
export function raycastWorld(world: World, meshes: MeshManager, ray: Ray, opts: RaycastOptions = {}, closestOnly = false): RayHit[] {
  const mr = world.meshRenderers, bounds = world.bounds, tr = world.transforms;
  const skipHidden = opts.skipHidden ?? true, precise = opts.precise ?? true, cull = opts.cullBackfaces ?? false;
  let limit = opts.maxDistance ?? Infinity;
  const hits: RayHit[] = [];
  const wm = tr.worldMatrices;
  BitSet.forEachAnd([mr.has, bounds.has, tr.has], (e) => {
    if (skipHidden && (mr.flags[e] & RenderFlags.Hidden)) return;
    if (opts.filter && !opts.filter(e)) return;
    // Padded AABB (animated bounds grow by `padding`).
    const w = bounds.world, pad = bounds.padding[e], o = e * 6;
    const box = [w[o] - pad, w[o + 1] - pad, w[o + 2] - pad, w[o + 3] + pad, w[o + 4] + pad, w[o + 5] + pad];
    const entry = rayAABB(ray, box, 0, limit);
    if (entry < 0) return;

    const rec = meshes.get(mr.meshId[e]);
    const geo = precise && rec && rec.deformMask === 0 ? meshes.cpuGeometry(rec.id) : undefined;
    let dist = entry, tri = -1, normal: [number, number, number] = [0, 0, 0];
    if (geo) {
      const m = wm.subarray(e * 16, e * 16 + 16);
      if (!Mat4.invert(INV, m)) return;
      const h = rayMesh(geo, INV, ray, limit, cull);
      if (!h) return;
      dist = h.distance; tri = h.triangle; normal = h.normal;
    }
    hits.push({
      entity: e, distance: dist, triangle: tri, normal,
      point: [ray.origin[0] + ray.direction[0] * dist, ray.origin[1] + ray.direction[1] * dist, ray.origin[2] + ray.direction[2] * dist],
    });
    if (closestOnly && dist < limit) limit = dist;
  });
  hits.sort((a, b) => a.distance - b.distance);
  return closestOnly ? hits.slice(0, 1) : hits;
}

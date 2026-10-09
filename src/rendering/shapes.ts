import type { MeshData } from './primitives';
import { sub, add, mul, dot, cross, len, norm, type Tuple3 } from '../math/Tuple3';
import { STANDARD_VERTEX_FLOATS as F } from './VertexLayouts';

/**
 * Procedural meshes in the engine's standard vertex layout (position, normal, uv, tangent). Conventions match the basic primitives:
 * unit-ish size centred on the origin, outward normals, counter-clockwise front faces, uv (0, 0) at the top-left of an image, tangent
 * along +u (see `primitives.ts`). Closed shapes are watertight; `createCircle`, `createRing`, `createShape` and the plane / quad lie
 * flat. All sizes are options with sensible defaults, so `createCylinder()` is a unit-diameter, unit-height cylinder.
 */

type V3 = Tuple3;
/** Any unit vector perpendicular to `n`. */
const perpendicular = (n: V3): V3 => norm(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));

/** Tangent handedness: the bitangent `cross(n, t) * w` must point towards decreasing v (towards the image top). */
function handedness(n: V3, t: V3, dPdv: V3): number { return dot(cross(n, t), dPdv) <= 0 ? 1 : -1; }

/** Growable vertex / index accumulator. */
class Builder {
  readonly v: number[] = [];
  readonly i: number[] = [];
  get count(): number { return this.v.length / F; }
  vertex(p: V3, n: V3, u: number, v: number, t: V3, w = 1): number {
    this.v.push(p[0], p[1], p[2], n[0], n[1], n[2], u, v, t[0], t[1], t[2], w);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void { this.i.push(a, b, c); }
  /** Make every triangle's winding agree with its vertex normals (counter-clockwise seen from the normal side). */
  build(): MeshData {
    const v = this.v, idx = this.i;
    for (let k = 0; k < idx.length; k += 3) {
      const p = (j: number): V3 => [v[idx[k + j] * F], v[idx[k + j] * F + 1], v[idx[k + j] * F + 2]];
      const n = (j: number): V3 => [v[idx[k + j] * F + 3], v[idx[k + j] * F + 4], v[idx[k + j] * F + 5]];
      const fn = cross(sub(p(1), p(0)), sub(p(2), p(0)));
      if (len(fn) < 1e-14) continue;
      if (dot(fn, add(add(n(0), n(1)), n(2))) < 0) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
    }
    return { vertices: Float32Array.from(v), indices: Uint32Array.from(idx) };
  }
}

/** A row of a surface of revolution: radius, height, and the outward normal in the (radius, height) plane. */
interface Ring { r: number; y: number; nr: number; ny: number; }

/** Surface of revolution about +Y through `rings` (v follows the profile arc length from the first ring), `segments` around. */
function revolve(b: Builder, rings: Ring[], segments: number): void {
  const arc: number[] = [0];
  for (let k = 1; k < rings.length; k++) arc.push(arc[k - 1] + Math.hypot(rings[k].r - rings[k - 1].r, rings[k].y - rings[k - 1].y));
  const total = arc[arc.length - 1] || 1;
  const base = b.count;
  for (let k = 0; k < rings.length; k++) {
    const ring = rings[k];
    const next = rings[Math.min(k + 1, rings.length - 1)], prev = rings[Math.max(k - 1, 0)];
    for (let s = 0; s <= segments; s++) {
      const th = (s / segments) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
      const n: V3 = [ring.nr * c, ring.ny, ring.nr * sn];
      const t: V3 = [-sn, 0, c];
      const dPdv: V3 = [(next.r - prev.r) * c, next.y - prev.y, (next.r - prev.r) * sn];
      b.vertex([ring.r * c, ring.y, ring.r * sn], norm(n), s / segments, arc[k] / total, t, handedness(norm(n), t, dPdv));
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let s = 0; s < segments; s++) {
      const a = base + k * (segments + 1) + s, c = a + segments + 1;
      b.tri(a, a + 1, c); b.tri(a + 1, c + 1, c);
    }
  }
}

/** A flat disc cap at height `y` facing `ny` (+1 / -1) with a centre vertex. */
function cap(b: Builder, radius: number, y: number, ny: number, segments: number): void {
  const centre = b.vertex([0, y, 0], [0, ny, 0], 0.5, 0.5, [1, 0, 0], 1);
  const first = b.count;
  for (let s = 0; s <= segments; s++) {
    const th = (s / segments) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
    b.vertex([radius * c, y, radius * sn], [0, ny, 0], 0.5 + 0.5 * c, 0.5 + 0.5 * sn, [1, 0, 0], 1);
  }
  for (let s = 0; s < segments; s++) b.tri(centre, first + s, first + s + 1);
}

// ---- cylinder family -------------------------------------------------------------------------------------------------------------

export interface CylinderOptions {
  radiusTop?: number; radiusBottom?: number; height?: number; radialSegments?: number; heightSegments?: number; openEnded?: boolean;
}

/** Cylinder (or truncated cone) along Y, centred on the origin. Defaults: radius 0.5, height 1. */
export function createCylinder(o: CylinderOptions = {}): MeshData {
  const rt = o.radiusTop ?? 0.5, rb = o.radiusBottom ?? 0.5, h = o.height ?? 1;
  const seg = Math.max(3, Math.round(o.radialSegments ?? 32)), hs = Math.max(1, Math.round(o.heightSegments ?? 1));
  const slope = h > 0 ? (rb - rt) / h : 0;                  // side normal tilts outwards as the radius grows downwards
  const sl = Math.hypot(1, slope);
  const rings: Ring[] = [];
  for (let k = 0; k <= hs; k++) {
    const f = k / hs;
    rings.push({ r: rt + (rb - rt) * f, y: h / 2 - h * f, nr: 1 / sl, ny: slope / sl });
  }
  const b = new Builder();
  revolve(b, rings, seg);
  if (!(o.openEnded ?? false)) {
    if (rt > 0) cap(b, rt, h / 2, 1, seg);
    if (rb > 0) cap(b, rb, -h / 2, -1, seg);
  }
  return b.build();
}

/** Cone along Y with its apex up. Defaults: radius 0.5, height 1. */
export function createCone(o: { radius?: number; height?: number; radialSegments?: number; heightSegments?: number; openEnded?: boolean } = {}): MeshData {
  return createCylinder({ radiusTop: 0, radiusBottom: o.radius ?? 0.5, height: o.height ?? 1, radialSegments: o.radialSegments, heightSegments: o.heightSegments, openEnded: o.openEnded });
}

export interface CapsuleOptions { radius?: number; length?: number; capSegments?: number; radialSegments?: number; }

/** Capsule along Y: a cylinder of `length` capped by two hemispheres of `radius` (total height = length + 2 * radius). Defaults: radius 0.25, length 0.5. */
export function createCapsule(o: CapsuleOptions = {}): MeshData {
  const r = o.radius ?? 0.25, half = (o.length ?? 0.5) / 2;
  const caps = Math.max(2, Math.round(o.capSegments ?? 8)), seg = Math.max(3, Math.round(o.radialSegments ?? 24));
  const rings: Ring[] = [];
  for (let k = 0; k <= caps; k++) { const p = (k / caps) * Math.PI / 2; rings.push({ r: r * Math.sin(p), y: half + r * Math.cos(p), nr: Math.sin(p), ny: Math.cos(p) }); }
  for (let k = 0; k <= caps; k++) { const p = Math.PI / 2 + (k / caps) * Math.PI / 2; rings.push({ r: r * Math.sin(p), y: -half + r * Math.cos(p), nr: Math.sin(p), ny: Math.cos(p) }); }
  const b = new Builder();
  revolve(b, rings, seg);
  return b.build();
}

/**
 * Lathe: revolve a 2D profile of (radius, y) points about Y. Normals follow the profile (smoothed at shared points); list the points
 * bottom to top for outward normals, or set `flipNormals`. Open at both ends (add caps by including (0, y) end points).
 */
export function createLathe(points: ReadonlyArray<readonly [number, number]>, o: { segments?: number; flipNormals?: boolean } = {}): MeshData {
  if (points.length < 2) throw new Error('createLathe: at least two profile points are required');
  const seg = Math.max(3, Math.round(o.segments ?? 24)), sgn = o.flipNormals ? -1 : 1;
  const segNormal = (a: readonly [number, number], c: readonly [number, number]): [number, number] => {
    const dr = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dr, dy) || 1;
    return [sgn * dy / l, -sgn * dr / l];
  };
  const rings: Ring[] = points.map((p, k) => {
    const n0 = k > 0 ? segNormal(points[k - 1], p) : null, n1 = k < points.length - 1 ? segNormal(p, points[k + 1]) : null;
    const nr = (n0 ? n0[0] : 0) + (n1 ? n1[0] : 0), ny = (n0 ? n0[1] : 0) + (n1 ? n1[1] : 0), l = Math.hypot(nr, ny) || 1;
    return { r: p[0], y: p[1], nr: nr / l, ny: ny / l };
  });
  const b = new Builder();
  revolve(b, rings, seg);
  return b.build();
}

// ---- parametric surfaces ----------------------------------------------------------------------------------------------------------

/** Regular (nu + 1) x (nv + 1) grid over [0, 1]^2 of a surface with analytic positions / normals and derivative-based tangents. */
function grid(b: Builder, nu: number, nv: number, pos: (u: number, v: number) => V3, normal?: (u: number, v: number) => V3): void {
  const e = 1e-4, base = b.count;
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      const u0 = Math.max(0, u - e), u1 = Math.min(1, u + e), v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
      const dPdu = mul(sub(pos(u1, v), pos(u0, v)), 1 / (u1 - u0)), dPdv = mul(sub(pos(u, v1), pos(u, v0)), 1 / (v1 - v0));
      const n = normal ? norm(normal(u, v)) : norm(cross(dPdu, dPdv));
      const t = len(dPdu) > 1e-9 ? norm(dPdu) : perpendicular(n);
      b.vertex(pos(u, v), n, u, v, t, handedness(n, t, dPdv));
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, c = a + nu + 1;
      b.tri(a, a + 1, c); b.tri(a + 1, c + 1, c);
    }
  }
}

/** Torus in the XZ plane around Y. Defaults: ring radius 0.4, tube radius 0.1. */
export function createTorus(o: { radius?: number; tube?: number; radialSegments?: number; tubularSegments?: number } = {}): MeshData {
  const R = o.radius ?? 0.4, r = o.tube ?? 0.1;
  const b = new Builder();
  const th = (u: number) => u * Math.PI * 2, ph = (v: number) => v * Math.PI * 2;
  grid(b, Math.max(3, Math.round(o.tubularSegments ?? 48)), Math.max(3, Math.round(o.radialSegments ?? 24)),
    (u, v) => [(R + r * Math.cos(ph(v))) * Math.cos(th(u)), r * Math.sin(ph(v)), (R + r * Math.cos(ph(v))) * Math.sin(th(u))],
    (u, v) => [Math.cos(ph(v)) * Math.cos(th(u)), Math.sin(ph(v)), Math.cos(ph(v)) * Math.sin(th(u))]);
  return b.build();
}

/** A frame along a path: position and two unit vectors spanning the plane of the tube cross-section. */
interface Frame { p: V3; n: V3; b: V3; }

/** Sweep a circle of `radius` along `frames` (the first and last frames coincide for a closed path). */
function sweep(b: Builder, frames: Frame[], radius: number, radial: number): void {
  const base = b.count, last = frames.length - 1;
  for (let k = 0; k <= last; k++) {
    const f = frames[k], g = frames[Math.min(k + 1, last)], h = frames[Math.max(k - 1, 0)];
    const t = norm(sub(g.p, h.p));
    for (let j = 0; j <= radial; j++) {
      const phi = (j / radial) * Math.PI * 2, c = Math.cos(phi), s = Math.sin(phi);
      const dir: V3 = [f.n[0] * c + f.b[0] * s, f.n[1] * c + f.b[1] * s, f.n[2] * c + f.b[2] * s];
      const dPdv: V3 = mul([f.b[0] * c - f.n[0] * s, f.b[1] * c - f.n[1] * s, f.b[2] * c - f.n[2] * s], radius);
      b.vertex(add(f.p, mul(dir, radius)), dir, k / last, j / radial, t, handedness(dir, t, dPdv));
    }
  }
  for (let k = 0; k < last; k++) {
    for (let j = 0; j < radial; j++) {
      const a = base + k * (radial + 1) + j, c = a + radial + 1;
      b.tri(a, a + 1, c); b.tri(a + 1, c + 1, c);
    }
  }
}

/** (p, q) torus knot. Defaults: the classic (2, 3) knot of overall radius ~0.5. */
export function createTorusKnot(o: { radius?: number; tube?: number; tubularSegments?: number; radialSegments?: number; p?: number; q?: number } = {}): MeshData {
  const radius = o.radius ?? 0.35, tube = o.tube ?? 0.08, p = o.p ?? 2, q = o.q ?? 3;
  const segs = Math.max(8, Math.round(o.tubularSegments ?? 128)), radial = Math.max(3, Math.round(o.radialSegments ?? 16));
  const point = (u: number): V3 => {
    const a = u * Math.PI * 2 * p, cs = Math.cos((q / p) * a);
    return [radius * (2 + cs) * 0.5 * Math.cos(a), radius * (2 + cs) * 0.5 * Math.sin(a), radius * Math.sin((q / p) * a) * 0.5];
  };
  const frames: Frame[] = [];
  for (let k = 0; k <= segs; k++) {
    const u = k / segs, P = point(u), P2 = point(u + 0.5 / segs);
    const T = sub(P2, P);
    const bin = norm(cross(T, add(P2, P))), nor = norm(cross(bin, T));
    frames.push({ p: P, n: nor, b: bin });
  }
  frames[segs] = { ...frames[0] };                          // seamless close
  const bd = new Builder();
  sweep(bd, frames, tube, radial);
  return bd.build();
}

/** Catmull-Rom spline through `points` (`samples` per span), e.g. to smooth the path given to {@link createTube}. */
export function sampleCatmullRom(points: ReadonlyArray<readonly [number, number, number]>, samples = 8, closed = false): V3[] {
  const n = points.length, out: V3[] = [];
  if (n < 2) return points.map((p) => [p[0], p[1], p[2]] as V3);
  const at = (i: number): V3 => { const p = closed ? points[((i % n) + n) % n] : points[Math.max(0, Math.min(n - 1, i))]; return [p[0], p[1], p[2]]; };
  const spans = closed ? n : n - 1;
  for (let s = 0; s < spans; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let k = 0; k < samples; k++) {
      const t = k / samples, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)) as V3);
    }
  }
  if (!closed) out.push(at(n - 1));
  return out;
}

/** Tube of `radius` along a polyline (use {@link sampleCatmullRom} for smooth curves). Frames are parallel-transported, so it never twists. */
export function createTube(path: ReadonlyArray<readonly [number, number, number]>, o: { radius?: number; radialSegments?: number; closed?: boolean } = {}): MeshData {
  const pts: V3[] = path.map((p) => [p[0], p[1], p[2]] as V3);
  if (pts.length < 2) throw new Error('createTube: the path needs at least two points');
  const closed = o.closed ?? false;
  const radius = o.radius ?? 0.1, radial = Math.max(3, Math.round(o.radialSegments ?? 8));
  if (closed && len(sub(pts[0], pts[pts.length - 1])) > 1e-9) pts.push([...pts[0]] as V3);
  const m = pts.length;
  // closed paths wrap around (the last point repeats the first), open ones use one-sided differences at the ends
  const tangent = (k: number): V3 => closed
    ? norm(sub(pts[(k + 1) % (m - 1)], pts[(k + m - 2) % (m - 1)]))
    : norm(sub(pts[Math.min(k + 1, m - 1)], pts[Math.max(k - 1, 0)]));
  const frames: Frame[] = [];
  let t = tangent(0), n = perpendicular(t);
  for (let k = 0; k < m; k++) {
    const tk = tangent(k);
    if (k > 0) {                                            // rotate the previous normal by the change of direction
      const axis = cross(t, tk), al = len(axis);
      if (al > 1e-9) {
        const ax = mul(axis, 1 / al), ang = Math.asin(Math.min(1, al)) * (dot(t, tk) < 0 ? -1 : 1);
        const c = Math.cos(ang), s = Math.sin(ang);
        n = add(add(mul(n, c), mul(cross(ax, n), s)), mul(ax, dot(ax, n) * (1 - c)));
      }
      n = norm(sub(n, mul(tk, dot(n, tk))));
      t = tk;
    }
    frames.push({ p: pts[k], n, b: norm(cross(tk, n)) });
  }
  if (closed && m > 2) {
    // parallel transport around a loop returns rotated about the tangent: spread that twist over the frames so the ends meet
    const t0 = tangent(0), a = frames[m - 1].n, c = frames[0].n;
    const twist = Math.atan2(dot(cross(a, c), t0), dot(a, c));
    for (let k = 1; k < m; k++) {
      const tk = tangent(k), ang = twist * (k / (m - 1)), cs = Math.cos(ang), sn = Math.sin(ang);
      const nk = frames[k].n;
      const rot = norm(add(mul(nk, cs), mul(cross(tk, nk), sn)));
      frames[k] = { p: frames[k].p, n: rot, b: norm(cross(tk, rot)) };
    }
    frames[m - 1] = { ...frames[0], p: frames[m - 1].p };
  }
  const b = new Builder();
  sweep(b, frames, radius, radial);
  return b.build();
}

// ---- flat shapes ------------------------------------------------------------------------------------------------------------------

/** Unit quad in the XY plane facing +Z (the shape of a sprite or a screen). */
export function createQuad(): MeshData {
  const b = new Builder();
  const pts: [number, number, number, number][] = [[-0.5, -0.5, 0, 1], [0.5, -0.5, 1, 1], [0.5, 0.5, 1, 0], [-0.5, 0.5, 0, 0]];
  for (const p of pts) b.vertex([p[0], p[1], 0], [0, 0, 1], p[2], p[3], [1, 0, 0], 1);
  b.tri(0, 1, 2); b.tri(0, 2, 3);
  return b.build();
}

/** Unit plane in the XZ plane facing +Y, subdivided into `widthSegments` x `depthSegments` quads. */
export function createPlaneGrid(widthSegments = 10, depthSegments = 10): MeshData {
  const b = new Builder();
  grid(b, Math.max(1, Math.round(widthSegments)), Math.max(1, Math.round(depthSegments)),
    (u, v) => [u - 0.5, 0, v - 0.5], () => [0, 1, 0]);
  return b.build();
}

/** Flat disc in the XZ plane facing +Y. Default radius 0.5. */
export function createCircle(o: { radius?: number; segments?: number } = {}): MeshData {
  const b = new Builder();
  cap(b, o.radius ?? 0.5, 0, 1, Math.max(3, Math.round(o.segments ?? 32)));
  return b.build();
}

/** Flat annulus in the XZ plane facing +Y. Defaults: inner 0.25, outer 0.5. */
export function createRing(o: { innerRadius?: number; outerRadius?: number; thetaSegments?: number; phiSegments?: number } = {}): MeshData {
  const ri = o.innerRadius ?? 0.25, ro = o.outerRadius ?? 0.5;
  const b = new Builder();
  grid(b, Math.max(3, Math.round(o.thetaSegments ?? 32)), Math.max(1, Math.round(o.phiSegments ?? 1)),
    (u, v) => { const r = ri + (ro - ri) * v, th = u * Math.PI * 2; return [r * Math.cos(th), 0, r * Math.sin(th)]; }, () => [0, 1, 0]);
  return b.build();
}

/** Signed area of a polygon (positive = counter-clockwise). */
export function polygonArea(pts: ReadonlyArray<readonly [number, number]>): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

/**
 * Triangulate a simple polygon (no holes, either winding) by ear clipping. Returns triangle indices into `pts`, counter-clockwise
 * for a counter-clockwise polygon (and clockwise for a clockwise one, i.e. matching the input winding).
 */
export function triangulatePolygon(pts: ReadonlyArray<readonly [number, number]>): number[] {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = polygonArea(pts) > 0;
  const idx = Array.from({ length: n }, (_, i) => i);
  if (!ccw) idx.reverse();
  const cross2 = (a: number, b: number, c: number) => (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
  const inside = (p: number, a: number, b: number, c: number) => cross2(a, b, p) >= -1e-12 && cross2(b, c, p) >= -1e-12 && cross2(c, a, p) >= -1e-12;
  const out: number[] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const a = idx[(k + idx.length - 1) % idx.length], b = idx[k], c = idx[(k + 1) % idx.length];
      if (cross2(a, b, c) <= 1e-12) continue;               // reflex or degenerate corner
      let ear = true;
      for (const p of idx) if (p !== a && p !== b && p !== c && inside(p, a, b, c)) { ear = false; break; }
      if (!ear) continue;
      out.push(a, b, c);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;                                    // self-intersecting input: stop rather than loop forever
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  if (!ccw) for (let i = 0; i < out.length; i += 3) { const t = out[i + 1]; out[i + 1] = out[i + 2]; out[i + 2] = t; }
  return out;
}

/** Flat filled polygon in the XY plane facing +Z (no holes); uv covers the polygon's bounding box. */
export function createShape(points: ReadonlyArray<readonly [number, number]>): MeshData {
  const tris = triangulatePolygon(points);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const b = new Builder();
  for (const p of points) b.vertex([p[0], p[1], 0], [0, 0, 1], (p[0] - minX) / w, 1 - (p[1] - minY) / h, [1, 0, 0], 1);
  for (let i = 0; i < tris.length; i += 3) b.tri(tris[i], tris[i + 1], tris[i + 2]);
  return b.build();
}

/** Prism: extrude a simple polygon (XY plane, no holes) along Z by `depth`, centred on z = 0, with flat side walls and planar-uv caps. */
export function createExtrude(points: ReadonlyArray<readonly [number, number]>, o: { depth?: number } = {}): MeshData {
  const depth = o.depth ?? 1, hz = depth / 2;
  const ccw = polygonArea(points) > 0;
  const poly = ccw ? points : [...points].reverse();
  const n = poly.length;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const w = maxX - minX || 1, h = maxY - minY || 1;
  const tris = triangulatePolygon(poly);
  const b = new Builder();
  // caps
  for (const [z, nz] of [[hz, 1], [-hz, -1]] as const) {
    const base = b.count;
    for (const p of poly) b.vertex([p[0], p[1], z], [0, 0, nz], (p[0] - minX) / w, 1 - (p[1] - minY) / h, [1, 0, 0], 1);
    for (let i = 0; i < tris.length; i += 3) b.tri(base + tris[i], base + tris[i + 1], base + tris[i + 2]);
  }
  // side walls: one flat quad per edge; u runs along the perimeter, v along the depth
  let perimeter = 0;
  for (let i = 0; i < n; i++) perimeter += Math.hypot(poly[(i + 1) % n][0] - poly[i][0], poly[(i + 1) % n][1] - poly[i][1]);
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    const el = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
    const nrm: V3 = [(q[1] - p[1]) / el, -(q[0] - p[0]) / el, 0];     // outward for a counter-clockwise polygon
    const t: V3 = [(q[0] - p[0]) / el, (q[1] - p[1]) / el, 0];
    const u0 = run / perimeter, u1 = (run + el) / perimeter;
    run += el;
    const a = b.vertex([p[0], p[1], hz], nrm, u0, 0, t, 1), c = b.vertex([q[0], q[1], hz], nrm, u1, 0, t, 1);
    const d = b.vertex([q[0], q[1], -hz], nrm, u1, 1, t, 1), e = b.vertex([p[0], p[1], -hz], nrm, u0, 1, t, 1);
    b.tri(a, e, d); b.tri(a, d, c);
  }
  return b.build();
}

// ---- polyhedra -------------------------------------------------------------------------------------------------------------------

const PHI = (1 + Math.sqrt(5)) / 2;

/** Build a polyhedron on a sphere: subdivide every face `detail` times, then project to `radius`. Flat shaded at detail 0, smooth otherwise. */
function polyhedron(verts: number[][], faces: number[][], radius: number, detail: number): MeshData {
  const unit = verts.map((v) => norm(v as V3));
  const b = new Builder();
  const sphereUV = (p: V3): [number, number] => [Math.atan2(p[2], p[0]) / (Math.PI * 2) + 0.5, Math.acos(Math.max(-1, Math.min(1, p[1]))) / Math.PI];
  const emit = (a: V3, c: V3, d: V3): void => {
    const pa = norm(a), pc = norm(c), pd = norm(d);
    const flat = detail === 0;
    const fn = norm(cross(sub(pc, pa), sub(pd, pa)));
    const uvs = [pa, pc, pd].map(sphereUV);
    const ctr = norm(add(add(pa, pc), pd));
    // fix the u seam: if a triangle straddles it, lift the low-u vertices by one
    const us = uvs.map((q) => q[0]);
    if (Math.max(...us) - Math.min(...us) > 0.5) for (const q of uvs) if (q[0] < 0.5) q[0] += 1;
    const i = [pa, pc, pd].map((p, k) => {
      const n = flat ? (dot(fn, ctr) >= 0 ? fn : mul(fn, -1)) : p;
      const t = norm(cross([0, 1, 0], p), [1, 0, 0]);
      // poles: use the uv-derived azimuth direction instead of a degenerate cross product
      return b.vertex(mul(p, radius), n, uvs[k][0], uvs[k][1], t, 1);
    });
    b.tri(i[0], i[1], i[2]);
  };
  for (const f of faces) {
    const [a, c, d] = f.map((k) => unit[k]);
    const n = detail + 1;
    const lerp3 = (p: V3, q: V3, s: number): V3 => add(mul(p, 1 - s), mul(q, s));
    const point = (i: number, j: number): V3 => {         // barycentric lattice point (i along a->c, j along a->d)
      const top = lerp3(a, d, j / n), side = lerp3(c, d, j / n);
      return i + j === 0 ? a : lerp3(top, side, i / Math.max(n - j, 1));
    };
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n - j; i++) {
        emit(point(i, j), point(i + 1, j), point(i, j + 1));
        if (i < n - j - 1) emit(point(i + 1, j), point(i + 1, j + 1), point(i, j + 1));
      }
    }
  }
  return b.build();
}

/** Regular tetrahedron inscribed in a sphere of `radius` (default 0.5). `detail` > 0 subdivides towards a sphere. */
export function createTetrahedron(radius = 0.5, detail = 0): MeshData {
  return polyhedron([[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]], [[2, 1, 0], [0, 3, 2], [1, 3, 0], [2, 3, 1]], radius, detail);
}
/** Regular octahedron. */
export function createOctahedron(radius = 0.5, detail = 0): MeshData {
  return polyhedron([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
    [[0, 2, 4], [0, 4, 3], [0, 3, 5], [0, 5, 2], [1, 2, 5], [1, 5, 3], [1, 3, 4], [1, 4, 2]], radius, detail);
}
/** Regular icosahedron. */
export function createIcosahedron(radius = 0.5, detail = 0): MeshData {
  const t = PHI;
  return polyhedron([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]],
    [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]], radius, detail);
}
/** Regular dodecahedron (each pentagon split into three triangles). */
export function createDodecahedron(radius = 0.5, detail = 0): MeshData {
  const t = PHI, r = 1 / t;
  return polyhedron([[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
    [0, -r, -t], [0, -r, t], [0, r, -t], [0, r, t], [-r, -t, 0], [-r, t, 0], [r, -t, 0], [r, t, 0], [-t, 0, -r], [-t, 0, r], [t, 0, -r], [t, 0, r]],
  [[3, 11, 7], [3, 7, 15], [3, 15, 13], [7, 19, 17], [7, 17, 6], [7, 6, 15], [17, 4, 8], [17, 8, 10], [17, 10, 6], [8, 0, 16], [8, 16, 2], [8, 2, 10],
    [0, 12, 1], [0, 1, 18], [0, 18, 16], [6, 10, 2], [6, 2, 13], [6, 13, 15], [2, 16, 18], [2, 18, 3], [2, 3, 13], [18, 1, 9], [18, 9, 11], [18, 11, 3],
    [4, 14, 12], [4, 12, 0], [4, 0, 8], [11, 9, 5], [11, 5, 19], [11, 19, 7], [19, 5, 14], [19, 14, 4], [19, 4, 17], [1, 12, 14], [1, 14, 5], [1, 5, 9]], radius, detail);
}

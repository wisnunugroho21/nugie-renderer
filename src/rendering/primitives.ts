import { STANDARD_VERTEX_FLOATS } from './VertexLayouts';

export interface MeshData {
  /** Standard layout: position(3) normal(3) uv(2) tangent(4). */
  vertices: Float32Array;
  indices: Uint32Array;
}

/**
 * Tangent convention (matches glTF): tangent points along +U, bitangent = cross(normal, tangent) * w points toward
 * image-UP (decreasing V), so normal-map green (+Y) = up in the image.
 */

/** Unit cube centered at origin (extent [-0.5, 0.5]), CCW front faces, outward normals. */
export function createCube(): MeshData {
  const faces = [
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
    { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  ];
  const vertices = new Float32Array(24 * STANDARD_VERTEX_FLOATS);
  const indices = new Uint32Array(36);
  let vi = 0, ii = 0;
  faces.forEach((f, fi) => {
    const base = fi * 4;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) vertices[vi++] = (f.n[k] + f.u[k] * su + f.v[k] * sv) * 0.5;
      vertices[vi++] = f.n[0]; vertices[vi++] = f.n[1]; vertices[vi++] = f.n[2];
      vertices[vi++] = (su + 1) / 2; vertices[vi++] = (1 - sv) / 2;
      vertices[vi++] = f.u[0]; vertices[vi++] = f.u[1]; vertices[vi++] = f.u[2]; vertices[vi++] = 1;
    }
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], ii);
    ii += 6;
  });
  return { vertices, indices };
}

/** Unit-size plane in XZ facing +Y, extent [-0.5, 0.5]. */
export function createPlane(): MeshData {
  const v = new Float32Array(4 * STANDARD_VERTEX_FLOATS);
  const pts = [[-0.5, -0.5, 0, 1], [0.5, -0.5, 1, 1], [0.5, 0.5, 1, 0], [-0.5, 0.5, 0, 0]]; // x, z, u, v
  pts.forEach((p, i) => v.set([p[0], 0, p[1], 0, 1, 0, p[2], p[3], 1, 0, 0, -1], i * STANDARD_VERTEX_FLOATS));
  // +Y facing, CCW viewed from above: (-,-)->(-,+)->(+,+)->(+,-) in (x,z) is CCW from +Y.
  return { vertices: v, indices: new Uint32Array([0, 3, 2, 0, 2, 1]) };
}

/** UV sphere of radius 0.5. */
export function createUVSphere(segments = 32, rings = 16): MeshData {
  const vertices = new Float32Array((segments + 1) * (rings + 1) * STANDARD_VERTEX_FLOATS);
  const indices = new Uint32Array(segments * rings * 6);
  let vi = 0, ii = 0;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(theta);
      vertices.set([nx * 0.5, ny * 0.5, nz * 0.5, nx, ny, nz, s / segments, r / rings, -Math.sin(theta), 0, Math.cos(theta), -1],
        vi); vi += STANDARD_VERTEX_FLOATS;
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s, b = a + segments + 1;
      indices.set([a, a + 1, b, a + 1, b + 1, b], ii); ii += 6;
    }
  }
  return { vertices, indices };
}

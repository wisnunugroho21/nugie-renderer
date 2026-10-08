import { GLBBuilder } from '../assets/gltf/GLBBuilder';
import { Quat } from '../math/Quat';

export interface TentacleOptions {
  radial?: number;       // vertices around the tube
  rings?: number;        // rings along the tube (height 2)
  morphTargets?: number; // number of morph targets (0 = none)
  skinned?: boolean;     // 3-joint chain with linear weight blending (JOINTS_0/WEIGHTS_0)
}

/**
 * A procedural 3-joint "tentacle" tube, generated as an in-memory GLB so the whole glTF -> skin/morph -> GPU path
 * is exercised without external assets. Clips: 'wave' (bend joints), 'breathe' (morph weights), 'both'.
 * Morph target 0 = radial bulge, 1 = twist, k>=2 = sinusoidal radial ripples of increasing frequency.
 */
export function buildTentacleGLB(opts: TentacleOptions = {}): Uint8Array {
  const radial = opts.radial ?? 16, rings = opts.rings ?? 24, T = opts.morphTargets ?? 2, skinned = opts.skinned ?? true;
  const height = 2, radius = 0.22;
  const nv = (radial + 1) * (rings + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), tan = new Float32Array(nv * 4);
  const joints = new Uint8Array(nv * 4), weights = new Float32Array(nv * 4);
  const deltas = Array.from({ length: T }, () => ({ p: new Float32Array(nv * 3), n: new Float32Array(nv * 3) }));
  let v = 0;
  for (let r = 0; r <= rings; r++) {
    const y = (r / rings) * height;
    for (let s = 0; s <= radial; s++, v++) {
      const a = (s / radial) * Math.PI * 2, cx = Math.cos(a), sz = Math.sin(a);
      pos.set([cx * radius, y, sz * radius], v * 3); nor.set([cx, 0, sz], v * 3); uv.set([s / radial, 1 - r / rings], v * 2);
      tan.set([-sz, 0, cx, -1], v * 4);
      if (y <= 1) { joints.set([0, 1, 0, 0], v * 4); weights.set([1 - y, y, 0, 0], v * 4); }
      else { joints.set([1, 2, 0, 0], v * 4); weights.set([2 - y, y - 1, 0, 0], v * 4); }
      for (let k = 0; k < T; k++) {
        if (k === 0) { const bump = Math.sin((y / height) * Math.PI) * 0.35; deltas[k].p.set([cx * bump, 0, sz * bump], v * 3); }
        else if (k === 1) {
          const ang = (y / height) * 1.2;
          deltas[k].p.set([cx * radius * (Math.cos(ang) - 1) - sz * radius * Math.sin(ang), 0, cx * radius * Math.sin(ang) + sz * radius * (Math.cos(ang) - 1)], v * 3);
        } else { const rip = Math.sin(y * (2 + k) * Math.PI) * 0.08; deltas[k].p.set([cx * rip, 0, sz * rip], v * 3); }
      }
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rings; r++) for (let s = 0; s < radial; s++) {
    const a = r * (radial + 1) + s, b = a + radial + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const b = new GLBBuilder();
  const attributes: Record<string, number> = { POSITION: b.accessor(pos, 'VEC3', { minmax: true }), NORMAL: b.accessor(nor, 'VEC3'), TEXCOORD_0: b.accessor(uv, 'VEC2'), TANGENT: b.accessor(tan, 'VEC4') };
  if (skinned) { attributes.JOINTS_0 = b.accessor(joints, 'VEC4'); attributes.WEIGHTS_0 = b.accessor(weights, 'VEC4'); }
  const prim: Record<string, unknown> = { attributes, indices: b.accessor(Uint32Array.from(idx), 'SCALAR'), material: 0 };
  if (T > 0) prim.targets = deltas.map((d) => ({ POSITION: b.accessor(d.p, 'VEC3'), NORMAL: b.accessor(d.n, 'VEC3') }));
  b.material({ name: 'skin', pbrMetallicRoughness: { baseColorFactor: [0.25, 0.8, 0.45, 1], metallicFactor: 0.0, roughnessFactor: 0.45 } });
  const mesh = b.mesh({ primitives: [prim], weights: T > 0 ? new Array(T).fill(0) : undefined });

  const j2 = b.node({ name: 'j2', translation: [0, 1, 0] });
  const j1 = b.node({ name: 'j1', translation: [0, 1, 0], children: [j2] });
  const j0 = b.node({ name: 'j0', children: [j1] });
  const meshNode = b.node({ name: 'tentacle', mesh, ...(skinned ? { skin: 0 } : {}) });
  if (skinned) {
    const ibm = new Float32Array(48);
    for (let j = 0; j < 3; j++) { ibm[j * 16] = ibm[j * 16 + 5] = ibm[j * 16 + 10] = ibm[j * 16 + 15] = 1; ibm[j * 16 + 13] = -j; }
    b.json.skins = [{ joints: [j0, j1, j2], inverseBindMatrices: b.accessor(ibm, 'MAT4'), skeleton: j0 }];
    b.addToScene(j0, meshNode);
  } else b.addToScene(meshNode);

  // ---- animations
  const tIn = b.accessor(new Float32Array([0, 0.5, 1, 1.5, 2]), 'SCALAR');
  /** Pack per-key Z rotations (radians) into quaternion values. */
  const rotZ = (angles: number[]) => { const o = new Float32Array(angles.length * 4); angles.forEach((a, i) => o.set(Quat.fromAxisAngle(Quat.create(), 0, 0, 1, a), i * 4)); return o; };
  const animations: unknown[] = [];
  const waveSamplers: unknown[] = [], waveChannels: unknown[] = [];
  if (skinned) {
    const rot1 = b.accessor(rotZ([0, 0.9, 0, -0.9, 0]), 'VEC4'), rot2 = b.accessor(rotZ([0, 1.1, 0, -1.1, 0]), 'VEC4');
    waveSamplers.push({ input: tIn, output: rot1 }, { input: tIn, output: rot2 });
    waveChannels.push({ sampler: 0, target: { node: j1, path: 'rotation' } }, { sampler: 1, target: { node: j2, path: 'rotation' } });
    animations.push({ name: 'wave', samplers: waveSamplers, channels: waveChannels });
  }
  if (T > 0) {
    const wIn = b.accessor(new Float32Array([0, 1, 2]), 'SCALAR');
    const out = new Float32Array(3 * T); out[T] = 1; if (T > 1) out[T + 1] = 1;   // key 1: first two targets fully on
    const wOut = b.accessor(out, 'SCALAR');
    animations.push({ name: 'breathe', samplers: [{ input: wIn, output: wOut }], channels: [{ sampler: 0, target: { node: meshNode, path: 'weights' } }] });
    if (skinned) {
      const n = waveSamplers.length;
      animations.push({
        name: 'both', samplers: [...waveSamplers, { input: wIn, output: wOut }],
        channels: [...waveChannels, { sampler: n, target: { node: meshNode, path: 'weights' } }],
      });
    }
  }
  if (animations.length) b.json.animations = animations;
  return b.glb();
}

/**
 * CPU reference implementation of the WGSL `deformVertex()` (common.wgsl). Used by tests and the GPU parity
 * self-test to prove the shader implements the documented order:  base vertex -> morph targets -> skinning.
 * (Never used for rendering: deformation always happens on the GPU.)
 */
export interface RefVertex { position: number[]; normal: number[]; tangent: number[]; }

export interface RefMorph { position?: Float32Array; normal?: Float32Array; tangent?: Float32Array; }

function norm(v: number[]): number[] { const l = Math.hypot(v[0], v[1], v[2]); return l > 0 ? [v[0] / l, v[1] / l, v[2] / l] : v; }

/** m: column-major 4x4 at offset `o` of `mats`; transforms a point (w=1) or direction (w=0). */
function xform(mats: Float32Array, o: number, v: number[], w: number): number[] {
  return [
    mats[o] * v[0] + mats[o + 4] * v[1] + mats[o + 8] * v[2] + mats[o + 12] * w,
    mats[o + 1] * v[0] + mats[o + 5] * v[1] + mats[o + 9] * v[2] + mats[o + 13] * w,
    mats[o + 2] * v[0] + mats[o + 6] * v[1] + mats[o + 10] * v[2] + mats[o + 14] * w,
  ];
}

export function deformVertexRef(
  vertex: number, base: RefVertex,
  morph: { targets: RefMorph[]; weights: ArrayLike<number> } | null,
  skin: { joints: Uint16Array; weights: Float32Array; matrices: Float32Array; jointOffset: number } | null,
): RefVertex {
  let p = base.position.slice(), n = base.normal.slice(), t = base.tangent.slice();
  if (morph) {
    morph.targets.forEach((tg, k) => {
      const w = morph.weights[k];
      if (w === 0) return;
      for (let c = 0; c < 3; c++) {
        p[c] += (tg.position?.[vertex * 3 + c] ?? 0) * w;
        n[c] += (tg.normal?.[vertex * 3 + c] ?? 0) * w;
        t[c] += (tg.tangent?.[vertex * 3 + c] ?? 0) * w;
      }
    });
    n = norm(n);
    if (t[0] || t[1] || t[2]) t = norm(t);
  }
  if (skin) {
    const acc = (v: number[], w: number) => {
      const out = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const wk = skin.weights[vertex * 4 + k];
        if (wk === 0) continue;
        const r = xform(skin.matrices, (skin.jointOffset + skin.joints[vertex * 4 + k]) * 16, v, w);
        for (let c = 0; c < 3; c++) out[c] += r[c] * wk;
      }
      return out;
    };
    p = acc(p, 1);
    n = norm(acc(n, 0));
    if (t[0] || t[1] || t[2]) t = norm(acc(t, 0));
  }
  return { position: p, normal: n, tangent: t };
}

/**
 * Offline fit of Linearly Transformed Cosines (Heitz et al. 2016) to the engine's GGX specular BRDF
 * (D_GGX * height-correlated Smith visibility, Fresnel excluded). Writes src/rendering/lighting/ltcTable.ts.
 *
 *   npx tsx tools/fitLTC.ts
 *
 * Table axes: x = perceptual roughness (0..1), y = sqrt(1 - NoV). Each entry stores the INVERSE matrix parameters
 * (ia, ib, ic) of  M^-1 = [[ia, 0, ib], [0, ic, 0], [0, 0, 1]]  in the shading frame (T1 toward V, T2, N).
 */
import { writeFileSync } from 'node:fs';

const SIZE = 32, NS = Number(process.env.LTC_NS ?? 384);

// ---- BRDF ------------------------------------------------------------------------------------------------------
function brdfCos(NoV: number, sinV: number, w: number[], alpha: number): number {
  const NoL = w[2];
  if (NoL <= 0) return 0;
  const H = [sinV + w[0], w[1], NoV + w[2]], hl = Math.hypot(H[0], H[1], H[2]);
  const NoH = H[2] / hl, a2 = alpha * alpha, d = NoH * NoH * (a2 - 1) + 1, D = a2 / (Math.PI * d * d);
  const gv = NoL * Math.sqrt(NoV * NoV * (1 - a2) + a2), gl = NoV * Math.sqrt(NoL * NoL * (1 - a2) + a2);
  return D * (0.5 / Math.max(gv + gl, 1e-9)) * NoL;
}

function hammersley(i: number, n: number): [number, number] {
  let b = i >>> 0;
  b = ((b << 16) | (b >>> 16)) >>> 0; b = (((b & 0x55555555) << 1) | ((b & 0xaaaaaaaa) >>> 1)) >>> 0;
  b = (((b & 0x33333333) << 2) | ((b & 0xcccccccc) >>> 2)) >>> 0; b = (((b & 0x0f0f0f0f) << 4) | ((b & 0xf0f0f0f0) >>> 4)) >>> 0;
  b = (((b & 0x00ff00ff) << 8) | ((b & 0xff00ff00) >>> 8)) >>> 0;
  return [i / n, b * 2.3283064365386963e-10];
}

interface Samples {
  brdfDirs: number[][]; brdfPdf: Float64Array; brdfVal: Float64Array; cosDirs: number[][];
  /** Normalised target density f*cos / norm and the BRDF-sampling pdf at an arbitrary direction. */
  target(w: number[]): number; pdfOf(w: number[]): number;
}

/** Per-(NoV, alpha) data: BRDF-importance-sampled directions (with the normalised target density) and cosine samples. */
function prepare(NoV: number, alpha: number): Samples {
  const sinV = Math.sqrt(Math.max(1 - NoV * NoV, 0)), V = [sinV, 0, NoV];
  const dirs: number[][] = [], pdf: number[] = [], val: number[] = [];
  let norm = 0;
  const big = 4096, a2 = alpha * alpha;
  for (let i = 0; i < big; i++) {   // normalisation of f*cos by GGX half-vector importance sampling
    const [u1, u2] = hammersley(i, big), phi = 2 * Math.PI * u1, cosT = Math.sqrt((1 - u2) / (1 + (a2 - 1) * u2)), sinT = Math.sqrt(1 - cosT * cosT);
    const H = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT], VoH = V[0] * H[0] + V[2] * H[2];
    if (VoH <= 0) continue;
    const L = [2 * VoH * H[0] - V[0], 2 * VoH * H[1], 2 * VoH * H[2] - V[2]];
    if (L[2] <= 0) continue;
    const d = cosT * cosT * (a2 - 1) + 1, D = a2 / (Math.PI * d * d), p = D * cosT / (4 * VoH);
    norm += brdfCos(NoV, sinV, L, alpha) / p;
  }
  norm /= big;
  for (let i = 0; i < NS; i++) {
    const [u1, u2] = hammersley(i, NS), phi = 2 * Math.PI * u1, cosT = Math.sqrt((1 - u2) / (1 + (a2 - 1) * u2)), sinT = Math.sqrt(1 - cosT * cosT);
    const H = [sinT * Math.cos(phi), sinT * Math.sin(phi), cosT], VoH = V[0] * H[0] + V[2] * H[2];
    if (VoH <= 0) continue;
    const L = [2 * VoH * H[0] - V[0], 2 * VoH * H[1], 2 * VoH * H[2] - V[2]];
    if (L[2] <= 0) continue;
    const d = cosT * cosT * (a2 - 1) + 1, D = a2 / (Math.PI * d * d);
    dirs.push(L); pdf.push(D * cosT / (4 * VoH)); val.push(brdfCos(NoV, sinV, L, alpha) / norm);
  }
  const cos: number[][] = [];
  for (let i = 0; i < NS; i++) { const [u1, u2] = hammersley(i, NS), r = Math.sqrt(u1), phi = 2 * Math.PI * u2; cos.push([r * Math.cos(phi), r * Math.sin(phi), Math.sqrt(Math.max(1 - u1, 0))]); }
  return {
    brdfDirs: dirs, brdfPdf: Float64Array.from(pdf), brdfVal: Float64Array.from(val), cosDirs: cos,
    target: (w) => brdfCos(NoV, sinV, w, alpha) / norm,
    pdfOf: (w) => {
      const H = [sinV + w[0], w[1], NoV + w[2]], hl = Math.hypot(H[0], H[1], H[2]), NoH = H[2] / hl, VoH = (sinV * H[0] + NoV * H[2]) / hl;
      if (w[2] <= 0 || VoH <= 0) return 0;
      const d = NoH * NoH * (a2 - 1) + 1;
      return a2 / (Math.PI * d * d) * NoH / (4 * VoH);
    },
  };
}

// ---- LTC -------------------------------------------------------------------------------------------------------
// M = [[a, 0, b], [0, c, 0], [0, 0, 1]];  D_ltc(w) = cos+(w_o)/pi * |det M^-1| / |M^-1 w|^3 with w_o = M^-1 w / |M^-1 w|
function ltcPdf(a: number, b: number, c: number, w: number[]): number {
  const x = (w[0] - b * w[2]) / a, y = w[1] / c, z = w[2], l2 = x * x + y * y + z * z, l = Math.sqrt(l2);
  return Math.max(z / l, 0) / Math.PI * (1 / (a * c)) / (l2 * l);
}

function error(s: Samples, p: number[]): number {
  const a = Math.exp(p[0]), c = Math.exp(p[1]), b = p[2];
  let e = 0;
  for (let i = 0; i < s.brdfDirs.length; i++) {
    const w = s.brdfDirs[i], pl = ltcPdf(a, b, c, w), d = Math.sqrt(pl) - Math.sqrt(s.brdfVal[i]);
    e += d * d / (s.brdfPdf[i] + pl);
  }
  for (const wo of s.cosDirs) {
    const w = [a * wo[0] + b * wo[2], c * wo[1], wo[2]], l = Math.hypot(w[0], w[1], w[2]);
    const dir = [w[0] / l, w[1] / l, w[2] / l], pl = ltcPdf(a, b, c, dir);
    // the BRDF density at an arbitrary direction is evaluated through brdfVal's source function
    const d = Math.sqrt(pl) - Math.sqrt(s.target(dir));
    e += d * d / (pl + s.pdfOf(dir));
  }
  return e / NS;
}

function nelderMead(f: (p: number[]) => number, x0: number[], step: number, iters: number): number[] {
  const n = x0.length;
  let pts = [x0, ...x0.map((_, i) => x0.map((v, j) => (i === j ? v + step : v)))].map((p) => ({ p, v: f(p) }));
  for (let it = 0; it < iters; it++) {
    pts.sort((u, v) => u.v - v.v);
    const best = pts[0], worst = pts[n];
    const cen = x0.map((_, j) => pts.slice(0, n).reduce((s, q) => s + q.p[j], 0) / n);
    const at = (t: number) => cen.map((v, j) => v + t * (worst.p[j] - v));
    const r = at(-1), fr = f(r);
    if (fr < best.v) { const e = at(-2), fe = f(e); pts[n] = fe < fr ? { p: e, v: fe } : { p: r, v: fr }; }
    else if (fr < pts[n - 1].v) pts[n] = { p: r, v: fr };
    else {
      const c = at(fr < worst.v ? -0.5 : 0.5), fc = f(c);
      if (fc < Math.min(fr, worst.v)) pts[n] = { p: c, v: fc };
      else pts = pts.map((q, i) => (i === 0 ? q : { p: q.p.map((v, j) => best.p[j] + 0.5 * (v - best.p[j])), v: NaN })).map((q) => (Number.isNaN(q.v) ? { p: q.p, v: f(q.p) } : q));
    }
    if (Math.abs(pts[n].v - pts[0].v) < 1e-9 * (Math.abs(pts[0].v) + 1e-12)) break;
  }
  pts.sort((u, v) => u.v - v.v);
  return pts[0].p;
}

const table = new Float64Array(SIZE * SIZE * 3);
let prevRow: number[] = [0, 0, 0];
const t0 = Date.now();
let worstErr = 0;
for (let j = 0; j < SIZE; j++) {
  const v = j / (SIZE - 1), NoV = Math.max(1 - v * v, 1e-3);
  let prev = j === 0 ? [0, 0, 0] : prevRow;
  for (let i = SIZE - 1; i >= 0; i--) {
    const rough = Math.max(i / (SIZE - 1), 0.04), alpha = rough * rough;
    const s = prepare(NoV, alpha);
    const f = (p: number[]) => error(s, p);
    let best = nelderMead(f, prev, 0.2, 200);
    best = nelderMead(f, best, 0.05, 200);
    // relative L2 error of the fitted density against the target (same MIS estimator, normalised by the target's own energy)
    let denom = 0;
    for (let k = 0; k < s.brdfDirs.length; k++) denom += s.brdfVal[k] * s.brdfVal[k] / s.brdfPdf[k];
    const rel = f(best) / Math.max(denom / NS, 1e-30);
    worstErr = Math.max(worstErr, rel);
    if (process.env.LTC_VERBOSE && (i % 8 === 0) && (j % 8 === 0)) console.log(`
j=${j} i=${i} rel err ${rel.toFixed(4)}`);
    prev = best;
    if (i === SIZE - 1) prevRow = best;
    const a = Math.exp(best[0]), c = Math.exp(best[1]), b = best[2];
    const o = (j * SIZE + i) * 3;
    table[o] = 1 / a; table[o + 1] = -b / a; table[o + 2] = 1 / c;
  }
  process.stdout.write(`row ${j + 1}/${SIZE} (${((Date.now() - t0) / 1000).toFixed(0)}s)\r`);
}
const num = (x: number) => Number(x.toPrecision(6));
writeFileSync(new URL('../src/rendering/lighting/ltcTable.ts', import.meta.url), `// GENERATED by tools/fitLTC.ts - do not edit.
// LTC inverse-matrix parameters (ia, ib, ic) for the GGX specular BRDF; x = perceptual roughness, y = sqrt(1 - NoV).
export const LTC_SIZE = ${SIZE};
export const LTC_TABLE: readonly number[] = [${Array.from(table, num).join(',')}];
`);
console.log(`\nwrote table, worst fit error ${worstErr.toExponential(2)}`);

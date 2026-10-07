import { LTC_SIZE, LTC_TABLE } from '../src/rendering/lighting/ltcTable';
const unit = (a: number[]) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
const rough = Number(process.argv[2] ?? 0.3);
const N = [0, 1, 0], V = unit([0.5, 0.7, 0.5]), NoV = V[1];
const fx = rough * (LTC_SIZE - 1), fy = Math.sqrt(1 - NoV) * (LTC_SIZE - 1);
const x0 = Math.min(Math.floor(fx), LTC_SIZE - 2), y0 = Math.min(Math.floor(fy), LTC_SIZE - 2), tx = fx - x0, ty = fy - y0;
const g = (x: number, y: number, k: number) => LTC_TABLE[(y * LTC_SIZE + x) * 3 + k];
const t = [0, 1, 2].map((k) => (g(x0, y0, k) * (1 - tx) + g(x0 + 1, y0, k) * tx) * (1 - ty) + (g(x0, y0 + 1, k) * (1 - tx) + g(x0 + 1, y0 + 1, k) * tx) * ty);
console.log('ltc params', t, 'neighbour', [0, 1, 2].map((k) => g(x0, y0, k)), [0, 1, 2].map((k) => g(x0 + 1, y0, k)));
// local frame: T1 toward V's horizontal part, T2, N
const T1 = unit([V[0], 0, V[2]]), T2 = [N[1] * T1[2] - N[2] * T1[1], N[2] * T1[0] - N[0] * T1[2], N[0] * T1[1] - N[1] * T1[0]];
const sinV = Math.sqrt(1 - NoV * NoV), alpha = rough * rough, a2 = alpha * alpha;
const pos = [0, 3, 0], hw = 1, hh = 1, n = 200;
let ltcSum = 0, brdfSum = 0;
const ia = t[0], ib = t[1], ic = t[2];
for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
  const q = [pos[0] + ((i + 0.5) / n * 2 - 1) * hw, 3, pos[2] + ((j + 0.5) / n * 2 - 1) * hh];
  const d2 = q[0] * q[0] + q[1] * q[1] + q[2] * q[2], d = Math.sqrt(d2), w = q.map((c) => c / d);
  const cosL = w[1] /* light faces down: -(-w)... */, dA = 4 * hw * hh / (n * n), dOmega = cosL * dA / d2;
  const wl = [w[0] * T1[0] + w[1] * T1[1] + w[2] * T1[2], w[0] * T2[0] + w[1] * T2[1] + w[2] * T2[2], w[1]];
  // ltc density
  const x = ia * wl[0] + ib * wl[2], y = ic * wl[1], z = wl[2], l2 = x * x + y * y + z * z, l = Math.sqrt(l2);
  ltcSum += Math.max(z / l, 0) / Math.PI * (ia * ic) / (l2 * l) * dOmega;
  // brdf*cos normalised numerically below
  const H = [sinV + wl[0], wl[1], NoV + wl[2]], hl = Math.hypot(H[0], H[1], H[2]), NoH = H[2] / hl, NoL = wl[2];
  const dd = NoH * NoH * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd);
  const gv = NoL * Math.sqrt(NoV * NoV * (1 - a2) + a2), gl = NoV * Math.sqrt(NoL * NoL * (1 - a2) + a2);
  brdfSum += D * 0.5 / Math.max(gv + gl, 1e-9) * NoL * dOmega;
}
// hemisphere integral of brdf*cos (norm)
let norm = 0, ltcNorm = 0; const m = 600;
for (let i = 0; i < m; i++) for (let j = 0; j < 2 * m; j++) {
  const th = (i + 0.5) / m * Math.PI / 2, ph = (j + 0.5) / (2 * m) * 2 * Math.PI, wl = [Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), Math.cos(th)];
  const dO = Math.sin(th) * (Math.PI / 2 / m) * (2 * Math.PI / (2 * m));
  const H = [sinV + wl[0], wl[1], NoV + wl[2]], hl = Math.hypot(H[0], H[1], H[2]), NoH = H[2] / hl, NoL = wl[2];
  const dd = NoH * NoH * (a2 - 1) + 1, D = a2 / (Math.PI * dd * dd);
  const gv = NoL * Math.sqrt(NoV * NoV * (1 - a2) + a2), gl = NoV * Math.sqrt(NoL * NoL * (1 - a2) + a2);
  norm += D * 0.5 / Math.max(gv + gl, 1e-9) * NoL * dO;
  const x = ia * wl[0] + ib * wl[2], y = ic * wl[1], z = wl[2], l2 = x * x + y * y + z * z, l = Math.sqrt(l2);
  ltcNorm += Math.max(z / l, 0) / Math.PI * (ia * ic) / (l2 * l) * dO;
}
console.log({ norm, ltcNorm, brdfFraction: brdfSum / norm, ltcFraction: ltcSum });

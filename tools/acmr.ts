import { averageCacheMissRatio, optimizeVertexCache } from '../src/geometry/MeshOptimizer';
const n = 100, idx: number[] = [];
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const a = y * (n + 1) + x, b = a + 1, c = a + n + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
const tri = Uint32Array.from(idx), order = Array.from({ length: tri.length / 3 }, (_, i) => i);
let s = 1; for (let i = order.length - 1; i > 0; i--) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; const j = s % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
const shuffled = new Uint32Array(tri.length); order.forEach((t, i) => shuffled.set(tri.subarray(t * 3, t * 3 + 3), i * 3));
const t0 = performance.now(); const opt = optimizeVertexCache(shuffled, (n + 1) * (n + 1)); const ms = performance.now() - t0;
console.log('shuffled', averageCacheMissRatio(shuffled).toFixed(2), 'in-order', averageCacheMissRatio(tri).toFixed(2), 'optimised', averageCacheMissRatio(opt).toFixed(2), `(${ms.toFixed(0)} ms for ${tri.length / 3} tris)`);

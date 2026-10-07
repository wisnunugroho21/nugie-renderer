import { generateLODChain } from '../src/geometry/LODGenerator';
import { createUVSphere } from '../src/rendering/primitives';
const m = createUVSphere(160, 80);
const t0 = performance.now();
const chain = generateLODChain(m, [0.12, 0.02]);
console.log(`generateLODChain(${m.indices.length / 3} tris): ${(performance.now() - t0).toFixed(0)} ms -> ${chain.map((c) => c.triangles).join(', ')} triangles`);

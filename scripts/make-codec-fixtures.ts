// Regenerates the compressed-asset fixtures in tests/fixtures (dev dependencies only: ktx2-encoder, draco3d, meshoptimizer).
//   npx tsx scripts/make-codec-fixtures.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { encodeToKTX2 } from 'ktx2-encoder';
import { buildDracoGLB, buildMeshoptGLB } from '../tests/helpers/codecFixtures';

const out = (name: string) => new URL(`../tests/fixtures/${name}`, import.meta.url);

/** 64 x 32 RGBA test pattern: red ramp in x, green ramp in y, blue checker, alpha ramp in x (tests/codecs-ktx2.test.ts decodes the same one). */
function pattern(w: number, h: number) {
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    data[o] = Math.round(255 * x / (w - 1)); data[o + 1] = Math.round(255 * y / (h - 1));
    data[o + 2] = ((x >> 3) + (y >> 3)) & 1 ? 220 : 40; data[o + 3] = 255 - Math.round(127 * x / (w - 1));
  }
  return { data, width: w, height: h };
}

for (const [name, isUASTC] of [['uastc', true], ['etc1s', false]] as const) {
  const bytes = await encodeToKTX2(new Uint8Array([0]), { isUASTC, generateMipmap: true, imageDecoder: async () => pattern(64, 32), isSetKTX2SRGBTransferFunc: true, enableDebug: false });
  writeFileSync(out(`pattern-${name}.ktx2`), bytes);
  console.log(`pattern-${name}.ktx2`, bytes.byteLength, 'bytes');
}

// compressed glTF: Draco geometry + UASTC texture, meshopt geometry + ETC1S texture (both KHR_texture_basisu)
const uastc = new Uint8Array(readFileSync(out('pattern-uastc.ktx2'))), etc1s = new Uint8Array(readFileSync(out('pattern-etc1s.ktx2')));
const draco = await buildDracoGLB(undefined, uastc), meshopt = await buildMeshoptGLB(etc1s);
writeFileSync(out('sphere-draco-uastc.glb'), draco.glb);
writeFileSync(out('sphere-meshopt-etc1s.glb'), meshopt.glb);
console.log('sphere-draco-uastc.glb', draco.glb.byteLength, 'bytes;', 'sphere-meshopt-etc1s.glb', meshopt.glb.byteLength, 'bytes');

/**
 * CPU cost of the frame graph machinery alone, without a GPU: declaring a frame (imports, includes, render nodes), computing its structure key and running the reused plan
 * against a fake encoder. The nodes are clear nodes (they need no shaders), so the numbers are the graph's own overhead per frame: what the frame costs on top of the passes' real work.
 *
 *   npm run bench:frame
 */
import { FrameGraph, type FrameBuilder } from '../src/rendering/graph/FrameGraph';
import { technique } from '../src/rendering/graph/TechniqueBuilder';
import type { TechniqueHost } from '../src/rendering/graph/TechniqueInstance';
import type { Technique } from '../src/rendering/graph/TechniqueTypes';

(globalThis as Record<string, unknown>).GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
(globalThis as Record<string, unknown>).GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };

const buffer = (): GPUBuffer => ({ size: 1024, usage: 0xffff }) as unknown as GPUBuffer;
const texture = (format = 'rgba16float'): GPUTexture => ({ width: 800, height: 450, depthOrArrayLayers: 1, format, dimension: '2d', mipLevelCount: 1, sampleCount: 1, usage: 0xff, createView: () => ({}) }) as unknown as GPUTexture;
const encoder = { clearBuffer() {}, beginRenderPass: () => ({ end() {} }) } as unknown as GPUCommandEncoder;

/** A pass shaped like a particle pool or the light clusters: `buffers` imported buffers, `variables` variables, a few clear nodes. */
function pass(name: string, buffers: number, variables: number): Technique {
  const t = technique(name);
  for (let i = 0; i < variables; i++) t.uint(`v${i}`, i);
  const handles = Array.from({ length: buffers }, (_, i) => t.importedBuffer(`b${i}`, 'u32'));
  handles.slice(0, 4).forEach((h, i) => t.clear(`k${i}`, h));
  return t.build();
}

const POOLS = Array.from({ length: 5 }, (_, i) => pass(`pool${i}`, 9, 10));
const SHARED = [pass('clusters', 4, 14), pass('fog', 1, 12), pass('post', 6, 40), pass('cull', 9, 20)];
const imports = (t: Technique, owned: Record<string, GPUBuffer>) => Object.fromEntries((t.resources ?? []).map((r) => [r.name, r.kind === 'buffer' ? (owned[`${t.name}.${r.name}`] ??= buffer()) : texture()]));

const owned: Record<string, GPUBuffer> = {};
const color = texture(), depth = texture('depth32float');
const frame = new FrameGraph({} as TechniqueHost);

/** One frame's declaration: the same shape as a scene with particles, clusters, fog, culling and the post chain. */
function declare(g: FrameBuilder): void {
  for (const t of [...POOLS, ...SHARED]) g.include(t.name, t, { imports: imports(t, owned), variables: { v0: 1, v1: 2 }, publish: [`${t.name}/b0`] });
  const c = g.importTexture('sceneColor', color), d = g.importTexture('depth', depth);
  g.renderPass('main', { colorTargets: [c], depthTarget: { resource: d }, record: () => {}, segments: [{ name: 'scene', record: () => {} }, { name: 'feature', record: () => {} }], after: [...g.published] });
}

function time(label: string, iterations: number, work: () => void): void {
  for (let i = 0; i < iterations / 10; i++) work();
  const runs: number[] = [];
  for (let r = 0; r < 7; r++) {
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) work();
    runs.push(((performance.now() - t0) / iterations) * 1000);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} ${runs[0].toFixed(1).padStart(8)} us (best)  ${runs[3].toFixed(1).padStart(8)} us (median)`);
}

const nodes = (() => { const g = frame.begin(); declare(g); return g.hostNodes().length; })();
console.log(`frame of ${nodes} top-level nodes (${POOLS.length} pools + ${SHARED.length} shared passes + main)`);
time('declare (begin + includes + main node)', 2000, () => { declare(frame.begin()); });
const built = frame.begin(); declare(built);
time('structureKey', 5000, () => { built.structureKey(); });
frame.run(built, encoder);   // first run compiles
time('declare + run, plan reused', 2000, () => { const g = frame.begin(); declare(g); frame.run(g, encoder); });

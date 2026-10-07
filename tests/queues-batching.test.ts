import { beforeAll, describe, expect, it } from 'vitest';
import { RadixSorter, floatKey } from '../src/rendering/RenderSorter';
import { RenderQueueBuilder, RenderQueues, countSwitches } from '../src/rendering/RenderQueue';
import { BatchList, INSTANCE_WORDS, buildBatches } from '../src/rendering/BatchBuilder';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { TransformBuffer } from '../src/rendering/TransformBuffer';
import { GPUResources } from '../src/gpu/GPUResources';
import type { Material, RenderQueue } from '../src/rendering/materials/Material';
import type { MeshRecord } from '../src/rendering/MeshManager';

beforeAll(() => {
  (globalThis as any).GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128 };
});

/** Fake mesh records: ids 0..63; ids >= 32 are 'skinned' (deformMask 1). */
const meshes = Array.from({ length: 64 }, (_, i) => ({
  id: i, baseVertex: i * 10, vertexCount: 3, skinBase: i * 3, morphBase: i * 6, morphTargetCount: i === 5 ? 2 : 0, deformMask: i >= 32 ? 1 : 0, indexCount: 3, firstIndex: 0,
}) as unknown as MeshRecord);

function rng(seed: number) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

describe('RadixSorter', () => {
  it('matches a reference sort (stable) for large random 64-bit keys', () => {
    const n = 5000, r = rng(1);
    const hi = new Uint32Array(n), lo = new Uint32Array(n);
    for (let i = 0; i < n; i++) { hi[i] = Math.floor(r() * 50); lo[i] = Math.floor(r() * 4294967296); }
    const got = Array.from(new RadixSorter().sort(n, hi, lo));
    const ref = Array.from({ length: n }, (_, i) => i).sort((a, b) => (hi[a] - hi[b]) || (lo[a] - lo[b]) || (a - b));
    expect(got).toEqual(ref);
  });
  it('is stable for equal keys', () => {
    const n = 1000;
    const hi = new Uint32Array(n), lo = new Uint32Array(n);
    for (let i = 0; i < n; i++) lo[i] = i % 3;
    const out = new RadixSorter().sort(n, hi, lo);
    for (let i = 1; i < n; i++) {
      if (lo[out[i]] === lo[out[i - 1]]) expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
  });
  it('small inputs use the comparator path correctly', () => {
    const hi = new Uint32Array([2, 1, 1]), lo = new Uint32Array([0, 5, 3]);
    expect(Array.from(new RadixSorter().sort(3, hi, lo))).toEqual([2, 1, 0]);
  });
  it('handles all-equal keys (all passes skipped)', () => {
    const n = 500;
    expect(Array.from(new RadixSorter().sort(n, new Uint32Array(n), new Uint32Array(n)))).toEqual(Array.from({ length: n }, (_, i) => i));
  });
  it('floatKey is monotonic for non-negative floats', () => {
    const v = [0, 0.001, 0.5, 1, 1.5, 100, 1e6];
    for (let i = 1; i < v.length; i++) expect(floatKey(v[i])).toBeGreaterThan(floatKey(v[i - 1]));
    expect(floatKey(-5)).toBe(floatKey(0));
  });
});

// --- helpers to fabricate a RenderWorld + materials ---------------------------------------------
function mat(id: number, queue: RenderQueue, pipelineSortId: number): Material {
  return { id, queue, pipelineSortId } as Material;
}
function world(objs: { mesh: number; material: number; pos?: [number, number, number] }[]): RenderWorld {
  const rw = new RenderWorld();
  rw.ensureCapacity(objs.length);
  rw.count = objs.length;
  objs.forEach((o, i) => {
    rw.entityIndex[i] = 1000 + i; rw.meshId[i] = o.mesh; rw.materialId[i] = o.material;
    const p = o.pos ?? [0, 0, 0];
    rw.boundsSphere.set([p[0], p[1], p[2], 1], i * 4);
  });
  return rw;
}
const cam = { position: [0, 0, 0], far: 100 };

describe('RenderQueueBuilder', () => {
  const materials = [mat(0, 'opaque', 0), mat(1, 'opaque', 0), mat(2, 'opaque', 1), mat(3, 'alphaMask', 2), mat(4, 'transparent', 3)];

  it('partitions into opaque / alpha-mask / transparent', () => {
    const rw = world([{ mesh: 0, material: 0 }, { mesh: 0, material: 3 }, { mesh: 0, material: 4 }, { mesh: 0, material: 1 }]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    expect([q.opaque.count, q.alphaMask.count, q.transparent.count]).toEqual([2, 1, 1]);
    expect(q.alphaMask.slots[0]).toBe(1);
    expect(q.transparent.slots[0]).toBe(2);
  });

  it('opaque sorts by pipeline, then material, then mesh', () => {
    const rw = world([
      { mesh: 1, material: 2 }, { mesh: 2, material: 0 }, { mesh: 1, material: 1 }, { mesh: 1, material: 0 },
      { mesh: 2, material: 2 }, { mesh: 1, material: 0 },
    ]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    const seq = Array.from(q.opaque.slots.subarray(0, q.opaque.count)).map((s) => [materials[rw.materialId[s]].pipelineSortId, rw.materialId[s], rw.meshId[s]]);
    const sortedRef = [...seq].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    expect(seq).toEqual(sortedRef);
  });

  it('opaque within a (material, mesh) group is front-to-back', () => {
    const rw = world([{ mesh: 0, material: 0, pos: [0, 0, -30] }, { mesh: 0, material: 0, pos: [0, 0, -5] }, { mesh: 0, material: 0, pos: [0, 0, -15] }]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    expect(Array.from(q.opaque.slots.subarray(0, 3))).toEqual([1, 2, 0]);
  });

  it('transparent is back-to-front regardless of material/mesh', () => {
    const rw = world([
      { mesh: 0, material: 4, pos: [0, 0, -5] }, { mesh: 3, material: 4, pos: [0, 0, -50] }, { mesh: 1, material: 4, pos: [0, 0, -20] },
    ]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    expect(Array.from(q.transparent.slots.subarray(0, 3))).toEqual([1, 2, 0]);
  });

  it("'none' keeps RenderWorld order", () => {
    const rw = world([{ mesh: 2, material: 2 }, { mesh: 1, material: 0 }, { mesh: 0, material: 1 }]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'none', q);
    expect(Array.from(q.opaque.slots.subarray(0, 3))).toEqual([0, 1, 2]);
  });

  it('respects a visible subset', () => {
    const rw = world([{ mesh: 0, material: 0 }, { mesh: 0, material: 0 }, { mesh: 0, material: 0 }]);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, new Uint32Array([2, 0]), 2, materials, meshes, cam, 'sorted', q);
    expect(q.opaque.count).toBe(2);
    expect(new Set(Array.from(q.opaque.slots.subarray(0, 2)))).toEqual(new Set([0, 2]));
  });

  it('sorting reduces switches versus unsorted order (3 metrics)', () => {
    const r = rng(7);
    const objs = Array.from({ length: 600 }, () => ({ mesh: Math.floor(r() * 4), material: Math.floor(r() * 3) }));
    const rw = world(objs);
    const b = new RenderQueueBuilder();
    const unsorted = new RenderQueues(), sorted = new RenderQueues();
    b.build(rw, null, rw.count, materials, meshes, cam, 'none', unsorted);
    b.build(rw, null, rw.count, materials, meshes, cam, 'sorted', sorted);
    const u = countSwitches(unsorted.opaque, rw, materials, meshes), s = countSwitches(sorted.opaque, rw, materials, meshes);
    expect(s.pipeline).toBeLessThan(u.pipeline);
    expect(s.material).toBeLessThan(u.material);
    expect(s.mesh).toBeLessThan(u.mesh);
    expect(s.pipeline).toBe(2);  // pipeline sort ids {0,1}
    expect(s.material).toBe(3);  // 3 distinct materials
  });
});

describe('buildBatches', () => {
  const materials = [mat(0, 'opaque', 0), mat(1, 'opaque', 0), mat(2, 'transparent', 1)];
  function run(objs: { mesh: number; material: number }[], mode: 'instanced' | 'individual', sort: 'sorted' | 'none' = 'sorted') {
    const rw = world(objs);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, sort, q);
    const out = new Uint32Array(objs.length * INSTANCE_WORDS);
    const batches = new BatchList();
    const n = buildBatches(q.ordered, rw, meshes, out, 10, mode, batches);
    return { rw, q, out, batches, n };
  }

  it('merges equal (material, mesh) runs into single instanced draws', () => {
    const objs = [
      ...Array.from({ length: 100 }, () => ({ mesh: 0, material: 0 })),
      ...Array.from({ length: 50 }, () => ({ mesh: 1, material: 0 })),
      ...Array.from({ length: 25 }, () => ({ mesh: 0, material: 1 })),
    ];
    const { batches, n } = run(objs, 'instanced');
    expect(n).toBe(175);
    expect(batches.count).toBe(3);
    const counts = Array.from(batches.instanceCount.subarray(0, 3)).sort((a, b) => a - b);
    expect(counts).toEqual([25, 50, 100]);
  });

  it('batches tile the instance array contiguously, offset by instanceBase', () => {
    const objs = [{ mesh: 0, material: 0 }, { mesh: 1, material: 0 }, { mesh: 0, material: 0 }, { mesh: 2, material: 2 }];
    const { batches, n } = run(objs, 'instanced');
    let expected = 10;
    for (let i = 0; i < batches.count; i++) { expect(batches.firstInstance[i]).toBe(expected); expected += batches.instanceCount[i]; }
    expect(expected).toBe(10 + n);
  });

  it("'individual' emits one batch per object", () => {
    const { batches, n } = run(Array.from({ length: 40 }, () => ({ mesh: 0, material: 0 })), 'individual');
    expect(batches.count).toBe(40);
    expect(n).toBe(40);
  });

  it('writes instance records (transform slot, material, object id)', () => {
    const { out, q, rw } = run([{ mesh: 0, material: 1 }, { mesh: 0, material: 0 }], 'instanced');
    for (let i = 0; i < 2; i++) {
      const slot = q.opaque.slots[i];
      expect(out[i * INSTANCE_WORDS]).toBe(slot);
      expect(out[i * INSTANCE_WORDS + 1]).toBe(rw.materialId[slot]);
      expect(out[i * INSTANCE_WORDS + 6]).toBe(rw.entityIndex[slot]);
    }
  });

  it('a batch never spans queues', () => {
    const { batches } = run([{ mesh: 0, material: 0 }, { mesh: 0, material: 2 }], 'instanced');
    expect(batches.count).toBe(2);
    expect(Array.from(batches.queue.subarray(0, 2))).toEqual([0, 2]);
  });

  it('10,000 identical objects collapse to one draw', () => {
    const { batches } = run(Array.from({ length: 10000 }, () => ({ mesh: 0, material: 0 })), 'instanced');
    expect(batches.count).toBe(1);
    expect(batches.instanceCount[0]).toBe(10000);
  });
});

describe('TransformBuffer sparse upload', () => {
  function setup(n: number) {
    const writes: { offset: number; size: number }[] = [];
    const device = {
      queue: { writeBuffer: (_b: any, offset: number, _d: any, _o: number, size: number) => writes.push({ offset, size }) },
      createBuffer: (d: any) => ({ size: d.size, destroy() {} }),
    } as unknown as GPUDevice;
    const res = new GPUResources(device);
    const tb = new TransformBuffer(device, res.buffers, 1024, 2);
    const rw = new RenderWorld(); rw.ensureCapacity(n); rw.count = n;
    return { tb, rw, writes };
  }
  it('uploads only changed slots, coalescing adjacent ones', () => {
    const { tb, rw, writes } = setup(1000);
    rw.changedSlots = [10, 11, 12, 500];
    tb.sync(rw);
    expect(writes).toEqual([{ offset: 10 * 64, size: 3 * 64 }, { offset: 500 * 64, size: 64 }]);
    expect(tb.lastUploadBytes).toBe(4 * 64);
    expect(tb.lastUploadRanges).toBe(2);
  });
  it('merges ranges separated by small gaps', () => {
    const { tb, rw, writes } = setup(1000);
    rw.changedSlots = [10, 12]; // gap of 1 <= mergeGap(2)
    tb.sync(rw);
    expect(writes.length).toBe(1);
    expect(writes[0].size).toBe(3 * 64);
  });
  it('unsorted / duplicate slots are handled', () => {
    const { tb, rw, writes } = setup(1000);
    rw.changedSlots = [500, 10, 500, 11, 10];
    tb.sync(rw);
    expect(writes.length).toBe(2);
  });
  it('falls back to one full write when many slots changed', () => {
    const { tb, rw, writes } = setup(100);
    rw.changedSlots = Array.from({ length: 60 }, (_, i) => i * 1);
    tb.sync(rw);
    expect(writes).toEqual([{ offset: 0, size: 100 * 64 }]);
  });
  it('no changes => no uploads', () => {
    const { tb, rw, writes } = setup(100);
    rw.changedSlots = [];
    tb.sync(rw);
    expect(writes.length).toBe(0);
  });
  it('growth reallocates, bumps generation and re-uploads everything', () => {
    const { tb, rw, writes } = setup(1500);
    const g = tb.generation;
    rw.changedSlots = [3];
    tb.sync(rw);
    expect(tb.generation).toBe(g + 1);
    expect(writes).toEqual([{ offset: 0, size: 1500 * 64 }]);
  });
});

describe('deform variants (skinned / morphed meshes)', () => {
  const materials = [mat(0, 'opaque', 0), mat(1, 'opaque', 0)];

  it('sort groups objects by (pipeline x deform variant): static and skinned meshes never interleave', () => {
    const objs = Array.from({ length: 400 }, (_, i) => ({ mesh: i % 2 === 0 ? 3 : 40 + (i % 3), material: i % 2 }));
    const rw = world(objs);
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    const variant = (slot: number) => materials[rw.materialId[slot]].pipelineSortId * 4 + meshes[rw.meshId[slot]].deformMask;
    const seq = Array.from(q.opaque.slots.subarray(0, q.opaque.count)).map(variant);
    let changes = 0;
    for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) changes++;
    expect(changes).toBe(new Set(seq).size - 1); // each variant forms ONE contiguous run
  });

  it('instance records carry skin/morph offsets, mesh bases and deform flags', () => {
    const rw = world([{ mesh: 5, material: 0 }, { mesh: 41, material: 0 }]);
    rw.jointOffset[1] = 100; rw.jointCount[1] = 17;
    rw.morphOffset[0] = 8; rw.morphCount[0] = 2;
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'none', q);
    const out = new Uint32Array(2 * INSTANCE_WORDS), batches = new BatchList();
    buildBatches(q.ordered, rw, meshes, out, 0, 'individual', batches);
    const rec = (i: number) => Array.from(out.subarray(i * INSTANCE_WORDS, (i + 1) * INSTANCE_WORDS));
    // [transform, material, jointOffset, jointCount, morphOffset, morphCount, objectId, vertexBase, vertexCount, skinBase, morphBase, flags]
    expect(rec(0)).toEqual([0, 0, 0, 0, 8, 2, 1000, 50, 3, 15, 30, 0]);
    expect(rec(1)).toEqual([1, 0, 100, 17, 0, 0, 1001, 410, 3, 123, 246, 1]);
  });

  it('skinned instances with different joint ranges still share one instanced draw', () => {
    const rw = world(Array.from({ length: 50 }, () => ({ mesh: 40, material: 0 })));
    for (let i = 0; i < 50; i++) { rw.jointOffset[i] = 1 + i * 20; rw.jointCount[i] = 20; }
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'sorted', q);
    const out = new Uint32Array(50 * INSTANCE_WORDS), batches = new BatchList();
    buildBatches(q.ordered, rw, meshes, out, 0, 'instanced', batches);
    expect(batches.count).toBe(1);
    expect(new Set(Array.from({ length: 50 }, (_, i) => out[i * INSTANCE_WORDS + 2])).size).toBe(50);
  });

  it('morph target count is clamped to what the mesh actually has', () => {
    const rw = world([{ mesh: 5, material: 0 }]);
    rw.morphOffset[0] = 0; rw.morphCount[0] = 10; // entity claims 10 weights, mesh only has 2 targets
    const q = new RenderQueues();
    new RenderQueueBuilder().build(rw, null, rw.count, materials, meshes, cam, 'none', q);
    const out = new Uint32Array(INSTANCE_WORDS);
    buildBatches(q.ordered, rw, meshes, out, 0, 'individual', new BatchList());
    expect(out[5]).toBe(2);
  });
});

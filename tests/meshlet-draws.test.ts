import { describe, expect, it } from 'vitest';
import { MeshletDraws, type MeshletCullerLike, type MeshletFrame } from '../src/rendering/MeshletDraws';
import { BatchList } from '../src/rendering/BatchBuilder';
import { RenderWorld } from '../src/rendering/RenderWorld';
import type { MeshManager, MeshRecord } from '../src/rendering/MeshManager';
import type { Material } from '../src/rendering/materials/Material';
import type { MeshletSet } from '../src/geometry/MeshOptimizer';
import { Mat4 } from '../src/math/Mat4';

/** A culler stand-in that records what it was asked to encode. */
function fakeCuller(meshletCount = 10, totalIndices = 300) {
  const calls: { model: number[]; baseVertex?: number; firstInstance?: number; planes: ArrayLike<number> }[] = [];
  const c = {
    indexBuffer: {} as GPUBuffer, argsBuffer: {} as GPUBuffer, meshletCount, totalIndices, destroyed: false, calls,
    encode: (_enc: GPUCommandEncoder, p: { model: ArrayLike<number>; planes: ArrayLike<number>; baseVertex?: number; firstInstance?: number }) => {
      calls.push({ model: Array.from(p.model), baseVertex: p.baseVertex, firstInstance: p.firstInstance, planes: p.planes });
    },
    destroy: () => { c.destroyed = true; },
  };
  return c;
}

const material = (cullMode: GPUCullMode) => ({ state: { cullMode } }) as Material;
const record = (id: number, deformMask = 0) => ({ id, baseVertex: 100 * id, deformMask }) as MeshRecord;

/** A frame of `meshIds.length` objects, one batch each (individual batching), mesh `meshIds[i]`, material `mats[i]`. */
function frame(meshIds: number[], mats: number[], o: { instanceCount?: number[]; queue?: number[]; late?: number[]; gpuCull?: boolean; base?: number } = {}) {
  const n = meshIds.length, rw = new RenderWorld();
  rw.ensureCapacity(n); rw.count = n; rw.hasCamera = true;
  for (let i = 0; i < n; i++) {
    const m = Mat4.compose(Mat4.create(), i, 0, 0, 0, 0, 0, 1, 1, 1, 1);
    rw.transforms.set(m, i * 16);
  }
  const batches = new BatchList();
  const base = o.base ?? 0;
  // slots in reverse order so the record -> object lookup is exercised
  const slots = Uint32Array.from(meshIds.map((_, i) => n - 1 - i));
  for (let i = 0; i < n; i++) {
    const s = slots[i];
    batches.push(mats[s], meshIds[s], base + i, o.instanceCount?.[i] ?? 1, o.queue?.[i] ?? 0);
    batches.late[i] = o.late?.[i] ?? 0;
  }
  const f: MeshletFrame = {
    rw, batches, lists: [{ slots, count: n }, { slots: new Uint32Array(0), count: 0 }, { slots: new Uint32Array(0), count: 0 }],
    instanceBase: base, materials: [material('back'), material('none'), material('front')],
    meshes: { get: (id: number) => record(id, id === 3 ? 1 : 0), cpuGeometry: () => undefined } as unknown as MeshManager,
    gpuCull: o.gpuCull ?? false,
  };
  return { f, rw, slots };
}

function setup() {
  const made: ReturnType<typeof fakeCuller>[] = [];
  const meshes = { cpuGeometry: () => undefined } as unknown as MeshManager;
  const draws = new MeshletDraws(null, meshes, () => { const c = fakeCuller(); made.push(c); return c as MeshletCullerLike; });
  const set = { count: 0 } as MeshletSet;
  return { draws, made, set };
}

describe('MeshletDraws (meshlet culling in the draw path)', () => {
  it('routes single-instance back-face-culled static batches of enabled meshes through their culler', () => {
    const { draws, made, set } = setup();
    draws.enable(0, set);
    const { f, rw, slots } = frame([0, 1], [0, 0]);
    draws.plan(f);
    expect(draws.drawCount).toBe(1);
    const bi = slots[0] === 0 ? 0 : 1;   // batch of the object with mesh 0
    expect(draws.cullerFor(bi)).toBe(made[0]);
    expect(draws.cullerFor(1 - bi)).toBeNull();
    draws.encode({} as GPUCommandEncoder, rw);
    expect(made[0].calls).toHaveLength(1);
    expect(made[0].calls[0].model[12]).toBe(0);           // object 0 sits at x = 0
    expect(made[0].calls[0].baseVertex).toBe(0);
    expect(made[0].calls[0].firstInstance).toBe(bi);
    expect(made[0].calls[0].planes).toBe(rw.camera.frustum.planes);
  });

  it('finds the object of each batch through the queues and passes its transform and instance', () => {
    const { draws, made, set } = setup();
    draws.enable(1, set);
    const { f, rw } = frame([0, 1, 2], [0, 0, 0], { base: 40 });
    draws.plan(f);
    expect(draws.drawCount).toBe(1);
    draws.encode({} as GPUCommandEncoder, rw);
    const call = made[0].calls[0];
    expect(call.model[12]).toBe(1);   // object 1's translation
    expect(call.baseVertex).toBe(100);
    expect(call.firstInstance).toBe(41);   // slots are reversed: object 1 is the second record
  });

  it('skips batches the cull would be wrong for', () => {
    const { draws, set } = setup();
    for (const m of [0, 3]) draws.enable(m, set);
    const cases: [string, Parameters<typeof frame>][] = [
      ['instanced batch', [[0], [0], { instanceCount: [2] }]],
      ['double-sided material', [[0], [1]]],
      ['front-face culling', [[0], [2]]],
      ['transparent queue', [[0], [0], { queue: [2] }]],
      ['late (transmissive) batch', [[0], [0], { late: [1] }]],
      ['deformed mesh', [[3], [0]]],
      ['GPU instance culling on', [[0], [0], { gpuCull: true }]],
    ];
    for (const [name, args] of cases) {
      draws.plan(frame(...args).f);
      expect(draws.drawCount, name).toBe(0);
    }
    const mirrored = frame([0], [0]);
    mirrored.rw.transforms[0] = -1;
    draws.plan(mirrored.f);
    expect(draws.drawCount, 'mirrored transform').toBe(0);
    const noCamera = frame([0], [0]);
    noCamera.rw.hasCamera = false;
    draws.plan(noCamera.f);
    expect(draws.drawCount, 'no camera').toBe(0);
  });

  it('gives a culler to one batch per frame and obeys the master switch', () => {
    const { draws, set } = setup();
    draws.enable(0, set);
    const { f } = frame([0, 0, 0], [0, 0, 0]);
    draws.plan(f);
    expect(draws.drawCount).toBe(1);
    expect(draws.meshletCount).toBe(10);
    expect(draws.inputTriangles).toBe(100);
    draws.enabled = false;
    draws.plan(f);
    expect(draws.drawCount).toBe(0);
    for (let i = 0; i < 3; i++) expect(draws.cullerFor(i)).toBeNull();
  });

  it('replaces and releases cullers', () => {
    const { draws, made, set } = setup();
    draws.enable(0, set);
    draws.enable(0, set);
    expect(made[0].destroyed).toBe(true);
    expect(draws.has(0)).toBe(true);
    expect(draws.disable(0)).toBe(true);
    expect(made[1].destroyed).toBe(true);
    expect(draws.disable(0)).toBe(false);
    expect(draws.has(0)).toBe(false);
  });

  it('needs CPU geometry (or a MeshletSet) to build meshlets', () => {
    const { draws } = setup();
    expect(() => draws.enable(5)).toThrow(/no CPU geometry/);
  });
});

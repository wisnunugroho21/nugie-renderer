import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Arena, ArenaCapacityError } from '../src/gpu/Arena';
import { BufferManager } from '../src/gpu/BufferManager';
import { GPUStats } from '../src/gpu/GPUStats';

beforeAll(() => {
  (globalThis as any).GPUBufferUsage = { COPY_DST: 8, COPY_SRC: 4, VERTEX: 32, INDEX: 16, UNIFORM: 64, STORAGE: 128 };
});

function setup(limits?: { maxBufferSize: number; maxStorageBufferBindingSize: number }) {
  const created: number[] = [];
  const device = {
    limits,
    queue: { writeBuffer() {}, submit() {} },
    createBuffer: (d: any) => { created.push(d.size); return { size: d.size, destroy() {} }; },
    createCommandEncoder: () => ({ copyBufferToBuffer() {}, finish: () => ({}) }),
  } as unknown as GPUDevice;
  return { device, buffers: new BufferManager(device, new GPUStats()), created };
}

describe('Arena size guard', () => {
  it('has no limit when the device reports none (fake devices, older runtimes)', () => {
    const { device, buffers } = setup();
    const a = new Arena(device, buffers, 'free', GPUBufferUsage.STORAGE, 16, 4);
    expect(a.maxBytes).toBe(Infinity);
    expect(a.alloc(1000)).toBe(0);
  });

  it('storage arenas are limited by the binding size, other arenas only by maxBufferSize', () => {
    const { device, buffers } = setup({ maxBufferSize: 1000, maxStorageBufferBindingSize: 400 });
    expect(new Arena(device, buffers, 's', GPUBufferUsage.STORAGE, 4, 4).maxBytes).toBe(400);
    expect(new Arena(device, buffers, 'v', GPUBufferUsage.VERTEX, 4, 4).maxBytes).toBe(1000);
  });

  it('throws a descriptive error instead of growing past the limit, and stays usable', () => {
    const { device, buffers } = setup({ maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 1600 });
    const a = new Arena(device, buffers, 'deform', GPUBufferUsage.STORAGE, 16, 8);   // 128 B now, max 100 elements
    expect(a.alloc(60)).toBe(0);
    expect(() => a.alloc(41)).toThrow(ArenaCapacityError);   // 60 + 41 = 101 elements > 100
    expect(() => a.alloc(41)).toThrow(/deform/);
    expect(a.used).toBe(60);            // failed allocation did not consume space
    expect(a.alloc(40)).toBe(60);       // exactly the limit still works
    expect(a.used).toBe(100);
  });

  it('never doubles beyond the limit and warns once when above 80%', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { device, buffers, created } = setup({ maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 16 * 100 });
    const a = new Arena(device, buffers, 'x', GPUBufferUsage.STORAGE, 16, 8);
    a.alloc(50);                         // doubles 8 -> 64 (fits)
    a.alloc(40);                         // 90 elements: needs 128 but capped at 100; > 80% -> warn
    expect(a.capacityElements).toBe(100);
    expect(Math.max(...created)).toBeLessThanOrEqual(1600);
    a.alloc(5);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});

describe('MeshManager reserves room in every arena first', () => {
  it('a mesh that does not fit the deform arena leaves vertices / indices / records untouched', async () => {
    const { MeshManager } = await import('../src/rendering/MeshManager');
    const { createCube } = await import('../src/rendering/primitives');
    const { device, buffers } = setup({ maxBufferSize: 1 << 30, maxStorageBufferBindingSize: 16 * 2048 });   // deform arena: 2048 elements max
    const mm = new MeshManager(device, buffers);
    const cube = createCube(), vcount = cube.vertices.length / 12;
    const okId = mm.create('ok', cube);
    const v0 = (mm as any).vertices.used, i0 = (mm as any).indices.used, d0 = mm.deform.used;
    const target = { position: new Float32Array(vcount * 3).fill(0.1) };
    // position-only deltas take 1 element per vertex per target: 24 vertices x 100 targets x 1 = 2400 > 2048
    expect(() => mm.create('too-big', cube, { morphTargets: Array.from({ length: 100 }, () => target) as any })).toThrow(ArenaCapacityError);
    expect((mm as any).vertices.used).toBe(v0);
    expect((mm as any).indices.used).toBe(i0);
    expect(mm.deform.used).toBe(d0);
    expect(mm.count).toBe(1);
    // the manager keeps working afterwards
    const id2 = mm.create('small', cube, { morphTargets: [target] as any });
    expect(id2).toBe(okId + 1);
    expect(mm.get(id2).morphTargetCount).toBe(1);
  });
  it('morph deltas use only as many elements per vertex as the mesh has attributes', async () => {
    const { MeshManager } = await import('../src/rendering/MeshManager');
    const { createCube } = await import('../src/rendering/primitives');
    const { device, buffers } = setup();
    const mm = new MeshManager(device, buffers);
    const cube = createCube(), vcount = cube.vertices.length / 12;
    const vec = (v: number) => new Float32Array(vcount * 3).fill(v);
    const cases: [string, any[], number][] = [
      ['position only', [{ position: vec(0.1) }, { position: vec(0.2) }], 1],
      ['position + normal', [{ position: vec(0.1), normal: vec(0.5) }], 2],
      ['tangent without normal', [{ position: vec(0.1), tangent: vec(0.3) }], 3],
      ['mixed targets take the widest', [{ position: vec(0.1) }, { position: vec(0.1), normal: vec(0.5) }], 2],
    ];
    for (const [name, targets, stride] of cases) {
      const before = mm.deform.used, id = mm.create(name, cube, { morphTargets: targets });
      expect(mm.get(id).morphStride).toBe(stride);
      expect(mm.deform.used - before).toBe(targets.length * vcount * stride);
      // the stored deltas sit at (target * vcount + vertex) * stride: the first target's position delta of vertex 0 is element 0
      expect(mm.get(id).morphTargetCount).toBe(targets.length);
    }
    expect(mm.get(mm.create('plain', cube)).morphStride).toBe(0);
  });
  it('bad skin data is rejected before anything is allocated', async () => {
    const { MeshManager } = await import('../src/rendering/MeshManager');
    const { createCube } = await import('../src/rendering/primitives');
    const { device, buffers } = setup();
    const mm = new MeshManager(device, buffers);
    const v0 = (mm as any).vertices.used;
    expect(() => mm.create('bad', createCube(), { joints0: new Uint16Array(4), weights0: new Float32Array(4) })).toThrow(/skin data/);
    expect((mm as any).vertices.used).toBe(v0);
  });
});

it('clamps initial arena capacity to the device limit and rejects invalid allocations atomically', () => {
  const { device, buffers, created } = setup({ maxBufferSize: 1000, maxStorageBufferBindingSize: 400 });
  const arena = new Arena(device, buffers, 'small', GPUBufferUsage.STORAGE, 16, 1000);
  expect(arena.capacityElements).toBe(25);
  expect(created).toEqual([400]);
  for (const count of [-1, 1.5, NaN, Infinity]) expect(() => arena.alloc(count)).toThrow(RangeError);
  expect(arena.used).toBe(0);
  expect(arena.alloc(1)).toBe(0);
});

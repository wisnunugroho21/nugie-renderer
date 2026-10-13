import { describe, expect, it } from 'vitest';
import { AllocationPool, type Allocation } from '../src/rendering/graph/AllocationPool';
import { TechniqueInstance } from '../src/rendering/graph/TechniqueInstance';
import { makeFakeGPU } from './helpers/fakeGPU';
import type { GPUContext } from '../src/gpu/GPUContext';
import type { Technique } from '../src/rendering/graph/TechniqueTypes';

const buffer = (size: number) => ({ size, usage: 0xff, destroy() {} }) as unknown as GPUBuffer;

describe('AllocationPool', () => {
  it('hands out the allocation under a key while it fits, and destroys it when the last holder releases it', () => {
    const destroyed: Allocation[] = [];
    const pool = new AllocationPool((a) => destroyed.push(a));
    const a = pool.acquire('k', () => true, () => buffer(16));
    expect(pool.acquire('k', () => true, () => buffer(16))).toBe(a);       // a second holder
    pool.release(a);
    expect(destroyed).toEqual([]);
    pool.release(a);
    expect(destroyed).toEqual([a]);
    expect(pool.size).toBe(0);
    expect(pool.acquire('k', () => true, () => buffer(16))).not.toBe(a);   // the key no longer names the destroyed one
  });

  it('replaces an allocation that does not fit, keeping the old one alive for its holders', () => {
    const destroyed: Allocation[] = [];
    const pool = new AllocationPool((a) => destroyed.push(a));
    const small = pool.acquire('k', () => true, () => buffer(16));
    const big = pool.acquire('k', (x) => (x as GPUBuffer).size >= 64, () => buffer(64));
    expect(big).not.toBe(small);
    expect(pool.acquire('k', () => true, () => buffer(16))).toBe(big);     // the key now names the new one
    pool.release(small);
    expect(destroyed).toEqual([small]);
  });
});

describe('instances sharing an allocation pool', () => {
  const technique = (name: string): Technique => ({
    name,
    resources: [{ kind: 'buffer', name: 'tmp', element: 'u32', count: 16 }, { kind: 'buffer', name: 'out', element: 'u32', count: 16, visibility: 'imported' }],
    nodes: [{ type: 'copy', name: 'fill', source: 'out', dest: 'tmp' }, { type: 'copy', name: 'back', source: 'tmp', dest: 'out' }],
  });

  it('share the memory of slots with the same description, which outlives either instance alone', () => {
    const fake = makeFakeGPU();
    (globalThis as Record<string, unknown>).GPUBufferUsage = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
    const gpu = { device: fake.device, queue: fake.device.queue, resources: fake.res } as unknown as GPUContext;
    const destroyed: Allocation[] = [];
    const pool = new AllocationPool((a) => destroyed.push(a));
    const imports = { out: { size: 64, usage: 0xffff, destroy() {} } as unknown as GPUBuffer };
    const a = TechniqueInstance.create(gpu, technique('a'), { imports, allocations: pool });
    const b = TechniqueInstance.create(gpu, technique('b'), { imports, allocations: pool });
    expect(b.resource('tmp')).toBe(a.resource('tmp'));
    a.dispose();
    expect(destroyed).toEqual([]);
    b.dispose();
    expect(destroyed).toHaveLength(1);
  });

  it('a failed create gives back what it took from the pool', () => {
    const fake = makeFakeGPU();
    (globalThis as Record<string, unknown>).GPUBufferUsage = { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 };
    const gpu = { device: fake.device, queue: fake.device.queue, resources: fake.res } as unknown as GPUContext;
    const pool = new AllocationPool(() => {});
    const unusable = { out: { size: 64, usage: 0, destroy() {} } as unknown as GPUBuffer };   // lacks the copy usages: rejected after the slots were allocated
    expect(() => TechniqueInstance.create(gpu, technique('a'), { imports: unusable, allocations: pool })).toThrow(/usage/);
    expect(pool.size).toBe(0);
  });
});

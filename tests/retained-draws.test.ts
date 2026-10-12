import { describe, it, expect } from 'vitest';
import { Renderer } from '../src/rendering/Renderer';
import { ViewState } from '../src/rendering/RenderDrawState';
import { RendererStats } from '../src/profiling/RendererStats';
import { DynamicBufferAllocator } from '../src/gpu/DynamicBufferAllocator';
import { TransformBuffer } from '../src/rendering/TransformBuffer';
import { RenderWorld } from '../src/rendering/RenderWorld';
import { World } from '../src/ecs/World';
import { TransformSystem } from '../src/ecs/systems/TransformSystem';
import { RenderExtractor } from '../src/rendering/RenderExtractor';
import { entityIndex } from '../src/ecs/Entity';
import type { Material } from '../src/rendering/materials/Material';
import type { MeshRecord } from '../src/rendering/MeshManager';
import { makeFakeGPU } from './helpers/fakeGPU';

function setup() {
  const { device, res, writes } = makeFakeGPU();
  const allocator = new DynamicBufferAllocator(device, res.buffers, { label: 'instances', usage: GPUBufferUsage.STORAGE, capacity: 768, alignment: 768 });
  const transforms = new TransformBuffer(device, res.buffers);
  const rw = new RenderWorld(); rw.ensureCapacity(2); rw.count = 2; rw.drawVersion = rw.transformVersion = 0;
  rw.entityIndex.set([1, 2]); rw.changedSlots.push(0, 1);
  const material = { id: 0, queue: 'opaque', pipelineSortId: 0, features: 0, failed: false } as Material;
  const mesh = { id: 0, baseVertex: 0, vertexCount: 3, indexCount: 3, firstIndex: 0, deformMask: 0, skinBase: 0, morphBase: 0, morphStride: 0, morphTargetCount: 0 } as MeshRecord;
  const view = new ViewState({ colorFormat: 'bgra8unorm', depthFormat: 'depth24plus', sampleCount: 1 });
  const stats = new RendererStats(); let feature = () => {};
  // Exercise the actual Renderer.render/buildBatches integration, replacing only GPU pass recording and unrelated feature uploads.
  const renderer = Object.assign(Object.create(Renderer.prototype), {
    gpu: { device, queue: device.queue, canvas: { width: 1, height: 1 } },
    stats, mainView: view, cacheDraws: true, batching: 'instanced', gpuCulling: 'off', instanceAlloc: allocator, transformBuffer: transforms,
    meshes: { records: [mesh] }, materials: { materials: [material] },
    depthTexture: { width: 1, height: 1, sampleCount: 1 }, syncFramebuffer() {},
    transmission: { maxMip: 0 }, post: { enabled: false, ensureTargets() {} }, frameUniform: { setTransmission() {} },
    uploadFrameData() { transforms.sync(rw); }, offscreen: { renderDue() {}, declarePasses() {} },
    features: { buildInstances() { feature(); }, prepare() {}, endFrame() {} },
    featureFrame: {}, sceneResources: { bindGroup: {} }, profiler: { beginFrame() {}, resolve() {} }, recordPasses() {},
  }) as Renderer;
  return { rw, view, renderer, stats, allocator, transforms, material, mesh, writes, setFeature: (fn: () => void) => { feature = fn; } };
}

describe('retained renderer preparation', () => {
  it('warms all GPU ring slots, then skips instance/transform uploads while keeping batch records and counters', () => {
    const s = setup(); for (let i = 0; i < 7; i++) s.renderer.render(s.rw);
    expect(s.stats.drawPreparationReused).toBe(true);
    expect(s.allocator.bytesUploadedThisFrame).toBe(0);
    expect(s.transforms.lastUploadBytes).toBe(0);
    expect(s.view.draw.batches.count).toBe(1);
    expect(s.view.draw.batches.instanceCount[0]).toBe(2);
    expect(s.stats.meshSwitches).toBe(1);
    expect(s.writes.filter(w => w.label === 'TransformBuffer')).toHaveLength(1);
  });

  it('invalidates changed camera, queue/material state, mesh layout, metadata, and direct snapshot edits', () => {
    const s = setup(); const warm = () => { for (let i = 0; i < 5; i++) s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(true); };
    warm(); s.rw.camera.position[0] = 2; s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false);
    warm(); s.material.queue = 'transparent'; s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false); expect(s.view.draw.queues.transparent.count).toBe(2);
    warm(); s.mesh.skinBase = 9; s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false); expect(s.view.draw.frame.instData[9]).toBe(9);
    warm(); s.rw.jointOffset[0] = 5; s.rw.drawVersion++; s.renderer.render(s.rw); expect(s.view.draw.frame.instData[2]).toBe(5);
    warm(); s.rw.transforms[12] = 7; s.rw.invalidate(); s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false); expect(s.transforms.lastUploadBytes).toBe(128);
  });

  it('uploads a retained prefix again after feature allocations replace the GPU buffer, then only uploads the dynamic tail', () => {
    const s = setup(); for (let i = 0; i < 7; i++) s.renderer.render(s.rw);
    const gen = s.allocator.generation;
    s.setFeature(() => { s.allocator.write(new Uint32Array(2000).fill(42)); });
    s.renderer.render(s.rw);
    expect(s.allocator.generation).not.toBe(gen);
    expect(s.allocator.bytesUploadedThisFrame).toBeGreaterThan(8000);
    expect(s.allocator.uint32[6]).toBe(1); // retained object identity in the prefix
    for (let i = 0; i < 4; i++) s.renderer.render(s.rw);
    expect(s.allocator.bytesUploadedThisFrame).toBe(8672); // 768-aligned tail begins after 96 retained bytes
  });

  it('falls back for LOD, visibility lists, unversioned worlds, and continuously changing snapshots', () => {
    const s = setup(); for (let i = 0; i < 6; i++) { s.rw.transformVersion++; s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false); }
    for (let i = 0; i < 5; i++) s.renderer.render(s.rw);
    s.rw.hasLOD = true; s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false);
    s.rw.hasLOD = false;
    s.renderer.render(s.rw, undefined, 0, { count: 1, slots: new Uint32Array([1]), tested: 2, rejected: 1, cullMs: 0 } as never);
    expect(s.stats.drawPreparationReused).toBe(false); expect(s.view.draw.frame.total).toBe(1);
    s.rw.invalidate(); s.renderer.render(s.rw); expect(s.stats.drawPreparationReused).toBe(false);
  });
});

describe('extraction revision ownership', () => {
  it('keeps unchanged snapshots stable, but detects material, transform, add/remove and morph layout changes', () => {
    const w = new World(), ts = new TransformSystem(w.transforms), ex = new RenderExtractor(w, ts), rw = new RenderWorld();
    const e = entityIndex(w.create()); w.transforms.add(e); w.meshRenderers.add(e, 0, 0);
    ts.update(); ex.extract(rw, 1); const d = rw.drawVersion, t = rw.transformVersion;
    ts.update(); ex.extract(rw, 1); expect(rw.drawVersion).toBe(d); expect(rw.transformVersion).toBe(t);
    w.meshRenderers.materialId[e] = 2; ex.extract(rw, 1); expect(rw.drawVersion).toBe(d + 1);
    w.transforms.setPosition(e, 3, 0, 0); ts.update(); ex.extract(rw, 1); expect(rw.transformVersion).toBe(t + 1);
    w.meshRenderers.remove(e); ex.extract(rw, 1); expect(rw.count).toBe(0); expect(rw.drawVersion).toBe(d + 2);
  });

  it('fully initializes a buffer from an already-extracted snapshot and does not suppress a failed upload retry', () => {
    const { device, res, writes } = makeFakeGPU(); const tb = new TransformBuffer(device, res.buffers);
    const rw = new RenderWorld(); rw.ensureCapacity(1); rw.count = 1; rw.transformVersion = 0;
    tb.sync(rw); expect(writes[0].bytes).toBe(64); tb.sync(rw); expect(writes).toHaveLength(1);
    const original = device.queue.writeBuffer;
    device.queue.writeBuffer = () => { throw new Error('upload failed'); };
    rw.transformVersion++; rw.changedSlots.push(0); expect(() => tb.sync(rw)).toThrow('upload failed');
    device.queue.writeBuffer = original; tb.sync(rw); expect(writes).toHaveLength(2);
    const other = new RenderWorld(); other.ensureCapacity(1); other.count = 1; other.transformVersion = rw.transformVersion;
    tb.sync(other); expect(writes).toHaveLength(3);
  });
});

describe('retained vertex resources', () => {
  it('packs general cofactor normals, retries failed writes, and uploads once per revision', () => {
    const s = setup();
    Object.assign(s.material, { kind: 'pbr', shaderId: 'pbr', vertexEntry: 'vs_main', fragmentEntry: 'fs_main' });
    // Reflection/nonuniform scale and a shear: neither can use a simple rotation normal matrix.
    s.rw.transforms.set([-2,0,0,0, 0,3,0,0, 0,0,4,0, 1,2,3,1]);
    s.rw.transforms.set([1,0,0,0, 1,2,0,0, 0,1,3,0, 0,0,0,1], 16);
    for (let i = 0; i < 5; i++) s.renderer.render(s.rw);
    const { device, res } = makeFakeGPU();
    let bytes: Float32Array | undefined, writes = 0;
    device.queue.writeBuffer = () => { throw new Error('retry'); };
    const gpu = { device, queue: device.queue, resources: res } as never;
    const cache = s.view.draw.retained;
    expect(cache.supportsPacked()).toBe(true);
    expect(() => cache.packedBuffer(gpu)).toThrow('retry');
    device.queue.writeBuffer = (_buffer, _offset, data) => { writes++; bytes = new Float32Array((data as Float32Array).slice()); };
    const buffer = cache.packedBuffer(gpu); expect(cache.packedBuffer(gpu)).toBe(buffer); expect(writes).toBe(1);
    expect(Array.from(bytes!.slice(16, 25))).toEqual([12,0,0, 0,-8,0, 0,0,-6]);
    expect(Array.from(bytes!.slice(42, 51))).toEqual([6,-3,1, 0,3,-1, 0,0,2]);
    expect(cache.packedUploadBytes).toBe(208);
    s.material.features = 1; expect(cache.supportsPacked()).toBe(false);
    s.material.features = 0; s.mesh.deformMask = 1; expect(cache.supportsPacked()).toBe(false);
    cache.invalidate(); expect(() => cache.packedBuffer(gpu)).toThrow('No retained world');
  });
});

describe('exact uniform normal eligibility', () => {
  it('uses ordinary cofactor normals for shear, reflection, and even a small nonuniform scale', () => {
    const s = setup();
    const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
    s.rw.transforms.set(identity); s.rw.transforms.set(identity, 16);
    const settle = () => { for (let i = 0; i < 4; i++) s.renderer.render(s.rw); };
    settle(); expect(s.view.draw.retained.uniformNormals).toBe(true);
    s.rw.transforms[4] = 0.1; s.rw.transformVersion++; settle(); expect(s.view.draw.retained.uniformNormals).toBe(false);
    s.rw.transforms.set(identity); s.rw.transforms[0] = -1; s.rw.transformVersion++; settle(); expect(s.view.draw.retained.uniformNormals).toBe(false);
    s.rw.transforms.set(identity); s.rw.transforms[5] = 1 + 2 ** -23; s.rw.transformVersion++; settle(); expect(s.view.draw.retained.uniformNormals).toBe(false);
  });
});

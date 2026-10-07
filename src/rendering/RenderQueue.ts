import type { RenderWorld } from './RenderWorld';
import type { Material, RenderQueue } from './materials/Material';
import { RadixSorter, floatKey } from './RenderSorter';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import type { MeshRecord } from './MeshManager';

export type SortMode = 'none' | 'sorted';

/** Sorted object slots for one queue. `slots` is only valid for [0, count). */
export interface QueueList { slots: Uint32Array; count: number; }

export class RenderQueues {
  opaque: QueueList = { slots: new Uint32Array(0), count: 0 };
  alphaMask: QueueList = { slots: new Uint32Array(0), count: 0 };
  transparent: QueueList = { slots: new Uint32Array(0), count: 0 };

  /** Lists in draw order: opaque, alpha-mask, then transparent (back-to-front). */
  get ordered(): QueueList[] { return [this.opaque, this.alphaMask, this.transparent]; }
}

/** Switch counters over a sorted list (pipeline / material / mesh changes between consecutive objects). */
export interface SwitchCounts { pipeline: number; material: number; mesh: number; }

/**
 * Builds the three render queues from the visible set.
 *   Opaque / AlphaMask : sort by pipeline -> material -> mesh -> depth bucket (front-to-back)
 *   Transparent        : back-to-front by distance to the camera
 * With sort 'none', objects keep their RenderWorld order (the unsorted baseline).
 */
export class RenderQueueBuilder {
  private sorter = new RadixSorter();
  private hi = new Uint32Array(0);
  private lo = new Uint32Array(0);
  private lists: [Uint32Array, Uint32Array, Uint32Array] = [new Uint32Array(0), new Uint32Array(0), new Uint32Array(0)];
  private counts = [0, 0, 0];

  build(
    rw: RenderWorld, visible: Uint32Array | null, visibleCount: number, materials: ArrayLike<Material>,
    meshes: ArrayLike<MeshRecord>, camera: { position: ArrayLike<number>; far: number }, sort: SortMode, out: RenderQueues,
  ): void {
    this.ensure(visibleCount);
    this.counts[0] = this.counts[1] = this.counts[2] = 0;
    const cx = camera.position[0], cy = camera.position[1], cz = camera.position[2];
    const invFar = 65535 / Math.max(camera.far, 1e-3);
    const sph = rw.boundsSphere;

    // 1. Partition by queue; compute sort keys in per-queue scratch space.
    const keyHi = this.hi, keyLo = this.lo;
    const qSlots = this.lists, qCount = this.counts;
    const qOffset = [0, visibleCount, visibleCount * 2]; // each queue gets its own key range
    for (let n = 0; n < visibleCount; n++) {
      const slot = visible ? visible[n] : n;
      if ((rw.flags[slot] & RenderFlags.Hidden) !== 0) continue;
      const mat = materials[rw.materialId[slot]];
      const q = mat.queue === 'opaque' ? 0 : mat.queue === 'alphaMask' ? 1 : 2;
      const k = qCount[q]++;
      qSlots[q][k] = slot;
      const kk = qOffset[q] + k;
      if (sort === 'none') { keyHi[kk] = 0; keyLo[kk] = 0; continue; }
      const dx = sph[slot * 4] - cx, dy = sph[slot * 4 + 1] - cy, dz = sph[slot * 4 + 2] - cz;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (q === 2) {
        keyHi[kk] = 0;
        keyLo[kk] = (0xffffffff - floatKey(dist)) >>> 0; // back-to-front
      } else {
        const bucket = Math.min(65535, (dist * invFar) | 0);
        // pipeline identity = material state x mesh deform variant (static/skinned/morphed/both)
        const pipe = (mat.pipelineSortId * 4 + meshes[rw.meshId[slot]].deformMask) & 0xffff;
        keyHi[kk] = ((pipe << 16) | (mat.id & 0xffff)) >>> 0;
        keyLo[kk] = (((rw.meshId[slot] & 0xffff) << 16) | bucket) >>> 0;
      }
    }

    // 2. Sort each queue.
    const queues: QueueList[] = [out.opaque, out.alphaMask, out.transparent];
    for (let q = 0; q < 3; q++) {
      const n = qCount[q];
      const dst = queues[q];
      if (dst.slots.length < n) dst.slots = new Uint32Array(Math.max(n, dst.slots.length * 2, 64));
      dst.count = n;
      if (n === 0) continue;
      if (sort === 'none') { dst.slots.set(qSlots[q].subarray(0, n)); continue; }
      const hi = keyHi.subarray(qOffset[q], qOffset[q] + n);
      const lo = keyLo.subarray(qOffset[q], qOffset[q] + n);
      const order = this.sorter.sort(n, hi, lo);
      const src = qSlots[q];
      for (let i = 0; i < n; i++) dst.slots[i] = src[order[i]];
    }
  }

  private ensure(n: number): void {
    if (this.hi.length < n * 3) { this.hi = new Uint32Array(n * 3 * 2); this.lo = new Uint32Array(n * 3 * 2); }
    for (let q = 0; q < 3; q++) if (this.lists[q].length < n) this.lists[q] = new Uint32Array(Math.max(n, this.lists[q].length * 2, 64));
  }
}

export function countSwitches(list: QueueList, rw: RenderWorld, materials: ArrayLike<Material>, meshes: ArrayLike<MeshRecord>): SwitchCounts {
  const c: SwitchCounts = { pipeline: 0, material: 0, mesh: 0 };
  let pp = -1, pm = -1, pmesh = -1;
  for (let i = 0; i < list.count; i++) {
    const slot = list.slots[i];
    const m = rw.materialId[slot], mesh = rw.meshId[slot];
    const p = materials[m].pipelineSortId * 4 + meshes[mesh].deformMask;
    if (p !== pp) c.pipeline++;
    if (m !== pm) c.material++;
    if (mesh !== pmesh || m !== pm) c.mesh++;
    pp = p; pm = m; pmesh = mesh;
  }
  return c;
}

export type { RenderQueue };

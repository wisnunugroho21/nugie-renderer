import type { RenderObject } from './RenderObject';
import { Camera } from './Camera';
import { LightData } from './lighting/LightData';

/**
 * Morph state mirrored from the ECS into the render world: for every morph state, its ACTIVE targets as
 * (targetIndex, weightBits) u32 pairs at word offset 2 * ecsWeightOffset (see MorphPacking.ts), plus the ranges
 * that changed this frame (sparse GPU upload).
 */
export class MorphData {
  pool = new Uint32Array(512);
  /** Flat (wordOffset, wordCount) pairs changed by the last extraction. */
  changedRanges: number[] = [];
  activeStates = 0;
  activeTargets = 0;

  ensure(words: number): void {
    if (words <= this.pool.length) return;
    let c = this.pool.length;
    while (c < words) c *= 2;
    const p = new Uint32Array(c); p.set(this.pool); this.pool = p;
  }
}

/**
 * Renderer-owned snapshot of the scene, in dense SoA arrays. The renderer reads ONLY this,
 * never the ECS. Object `i` lives at dense slot `i`; `transformIndex`/`boundsIndex` are that slot
 * into `transforms` (16 floats) / `boundsSphere` (4 floats) / `boundsAABB` (6 floats).
 */
export class RenderWorld {
  count = 0;
  capacity = 0;

  entityIndex = new Int32Array(0);
  meshId = new Int32Array(0);
  materialId = new Int32Array(0);
  flags = new Uint32Array(0);
  skinInstanceId = new Int32Array(0);
  morphStateId = new Int32Array(0);
  /** First joint matrix / joint count in the shared joint pool (count 0 = not skinned). */
  jointOffset = new Int32Array(0);
  jointCount = new Int32Array(0);
  /** First weight / target count in the shared morph weight pool (count 0 = no morph state). */
  morphOffset = new Int32Array(0);
  morphCount = new Int32Array(0);
  /** LOD group of the object (-1 = none). The LODSystem overrides `meshId` for grouped objects each frame. */
  lodGroup = new Int32Array(0);
  transforms = new Float32Array(0);
  boundsSphere = new Float32Array(0);
  boundsAABB = new Float32Array(0);

  readonly morph = new MorphData();
  /** All lights of the scene (directional first), mirrored from the ECS each frame. */
  readonly lights = new LightData();
  readonly camera = new Camera();
  hasCamera = false;

  /** Bumped whenever the object set changes (add/remove): lets caches rebuild. */
  structureVersion = 0;
  /** Slots whose transform was refreshed by the last extraction (sparse GPU upload). */
  changedSlots: number[] = [];

  ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    let c = Math.max(64, this.capacity);
    while (c < n) c *= 2;
    const g = <T extends Float32Array | Int32Array | Uint32Array>(a: T, per: number): T => {
      const o = new (a.constructor as new (n: number) => T)(c * per); o.set(a); return o;
    };
    this.entityIndex = g(this.entityIndex, 1); this.meshId = g(this.meshId, 1); this.materialId = g(this.materialId, 1);
    this.flags = g(this.flags, 1); this.skinInstanceId = g(this.skinInstanceId, 1); this.morphStateId = g(this.morphStateId, 1);
    this.jointOffset = g(this.jointOffset, 1); this.jointCount = g(this.jointCount, 1);
    this.morphOffset = g(this.morphOffset, 1); this.morphCount = g(this.morphCount, 1);
    const old = this.lodGroup; this.lodGroup = g(this.lodGroup, 1); this.lodGroup.fill(-1, old.length);
    this.transforms = g(this.transforms, 16); this.boundsSphere = g(this.boundsSphere, 4); this.boundsAABB = g(this.boundsAABB, 6);
    this.capacity = c;
  }

  get(i: number): RenderObject {
    return {
      entityId: this.entityIndex[i], meshId: this.meshId[i], materialId: this.materialId[i],
      transformIndex: i, boundsIndex: i, skinInstanceId: this.skinInstanceId[i], morphStateId: this.morphStateId[i],
      flags: this.flags[i],
    };
  }

  /** Move slot `from` into slot `to` (swap-remove support). */
  moveSlot(from: number, to: number): void {
    this.entityIndex[to] = this.entityIndex[from]; this.meshId[to] = this.meshId[from]; this.materialId[to] = this.materialId[from];
    this.flags[to] = this.flags[from]; this.skinInstanceId[to] = this.skinInstanceId[from]; this.morphStateId[to] = this.morphStateId[from];
    this.jointOffset[to] = this.jointOffset[from]; this.jointCount[to] = this.jointCount[from];
    this.morphOffset[to] = this.morphOffset[from]; this.morphCount[to] = this.morphCount[from]; this.lodGroup[to] = this.lodGroup[from];
    this.transforms.copyWithin(to * 16, from * 16, from * 16 + 16);
    this.boundsSphere.copyWithin(to * 4, from * 4, from * 4 + 4);
    this.boundsAABB.copyWithin(to * 6, from * 6, from * 6 + 6);
  }
}

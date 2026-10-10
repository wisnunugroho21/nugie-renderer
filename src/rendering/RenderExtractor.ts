import type { World } from '../ecs/World';
import type { TransformSystem } from '../ecs/systems/TransformSystem';
import { BitSet } from '../core/BitSet';
import { RenderFlags } from '../ecs/components/MeshRendererStore';
import type { RenderWorld } from './RenderWorld';
import { packActiveMorphWeights } from './MorphPacking';
import { LightType } from '../ecs/components/LightStore';
import { SHADOW_REQUEST } from './lighting/LightData';
import { hypot3 } from '../math/hypot';

/**
 * ECS -> RenderWorld. Maintains a persistent entity->slot map so only objects whose transform
 * changed this frame have their matrix/bounds copied; membership changes use swap-remove.
 * Hidden objects are excluded.
 */
export class RenderExtractor {
  private slotOf = new Int32Array(0);
  /** Metrics for the last extract(). */
  added = 0;
  removed = 0;
  matricesCopied = 0;

  /** Create an extractor reading `world`; `transformSystem.updated` says which matrices changed. */
  constructor(private world: World, private transformSystem: TransformSystem) {}

  /** Entity index owning slot (for picking/debug). */
  slotForEntity(index: number): number { return index < this.slotOf.length ? this.slotOf[index] : -1; }

  /** Synchronise `rw` with the ECS: add / remove renderables (swap-remove), refresh morph and skin state, copy changed matrices and bounds, extract lights and select the camera (`activeCamera`, or the first camera entity). */
  extract(rw: RenderWorld, aspect: number, activeCamera = -1): void {
    const w = this.world;
    const t = w.transforms, mr = w.meshRenderers;
    this.added = 0; this.removed = 0; this.matricesCopied = 0;
    rw.changedSlots.length = 0;

    if (this.slotOf.length < t.has.words.length * 32) {
      const s = new Int32Array(Math.max(t.has.words.length * 32, this.slotOf.length * 2)).fill(-1);
      s.set(this.slotOf);
      this.slotOf = s;
    }
    const slotOf = this.slotOf;
    /** An entity is drawn when it has a transform and a mesh renderer and is not hidden. */
    const eligible = (i: number) => t.has.has(i) && mr.has.has(i) && (mr.flags[i] & RenderFlags.Hidden) === 0;

    // 1. Removals (swap-remove, walk backwards so swapped-in slots are re-checked correctly).
    for (let s = rw.count - 1; s >= 0; s--) {
      const e = rw.entityIndex[s];
      if (eligible(e)) continue;
      const last = rw.count - 1;
      slotOf[e] = -1;
      if (s !== last) { rw.moveSlot(last, s); slotOf[rw.entityIndex[s]] = s; rw.changedSlots.push(s); } // moved data must be re-uploaded
      rw.count--;
      this.removed++;
    }

    // 2. Additions.
    const addedStart = rw.count;
    BitSet.forEachAnd([t.has, mr.has], (e) => {
      if ((mr.flags[e] & RenderFlags.Hidden) !== 0 || slotOf[e] !== -1) return;
      rw.ensureCapacity(rw.count + 1);
      const s = rw.count++;
      slotOf[e] = s;
      rw.entityIndex[s] = e;
      this.copyTransform(rw, s, e);
      this.added++;
    });

    // 3a. Morph states: compact ONLY the changed ones to (targetIndex, weight) pairs in the render-world pool.
    const skins = w.skins, morphs = w.morphs, lods = w.lods;
    const mw = rw.morph;
    mw.changedRanges.length = 0;
    mw.ensure(morphs.poolUsed * 2);
    for (const e of morphs.changed) {
      const off = morphs.weightOffset[e], cnt = morphs.targetCount[e];
      if (off < 0 || cnt <= 0) continue;
      const active = packActiveMorphWeights(morphs.weights, off, cnt, mw.pool, off * 2);
      morphs.activeCount[e] = active;
      if (active > 0) mw.changedRanges.push(off * 2, active * 2);
    }
    morphs.consumeChanged();

    // 3b. Per-frame light-weight fields (incl. skeleton joint range / morph pair range).
    let states = 0, targets = 0;
    let staticMembershipChanged = false;
    for (let s = 0; s < rw.count; s++) {
      const e = rw.entityIndex[s];
      if (((rw.flags[s] ^ mr.flags[e]) & RenderFlags.Static) !== 0) staticMembershipChanged = true;
      rw.meshId[s] = mr.meshId[e]; rw.materialId[s] = mr.materialId[e]; rw.flags[s] = mr.flags[e];
      rw.lodGroup[s] = lods.has.has(e) ? lods.group[e] : -1;
      const so = mr.skinOwner[e], inst = so >= 0 ? skins.get(so) : undefined;
      if (inst) { rw.skinInstanceId[s] = inst.id; rw.jointOffset[s] = inst.jointOffset; rw.jointCount[s] = inst.jointCount; }
      else { rw.skinInstanceId[s] = -1; rw.jointOffset[s] = 0; rw.jointCount[s] = 0; }
      const mo = mr.morphOwner[e];
      if (mo >= 0 && morphs.has.has(mo)) {
        rw.morphStateId[s] = mo; rw.morphOffset[s] = morphs.weightOffset[mo] * 2; rw.morphCount[s] = morphs.activeCount[mo];
        states++; targets += rw.morphCount[s];
      } else { rw.morphStateId[s] = -1; rw.morphOffset[s] = 0; rw.morphCount[s] = 0; }
    }
    mw.activeStates = states; mw.activeTargets = targets;

    // 4. Matrices/bounds only for transforms that changed.
    const updated = this.transformSystem.updated;
    for (let k = 0; k < updated.length; k++) {
      const e = updated[k];
      const s = e < slotOf.length ? slotOf[e] : -1;
      // Newly-added slots (>= addedStart) were already copied above.
      if (s === -1 || s >= addedStart || rw.entityIndex[s] !== e) continue;
      this.copyTransform(rw, s, e);
    }

    // 4b. Lights: world position + local -Z direction from each light entity's world matrix.
    const lightData = rw.lights, ls = w.lights, wm = t.worldMatrices;
    lightData.clear();
    BitSet.forEachAnd([ls.has, t.has], (e) => {
      const m = e * 16;
      const type = ls.type[e] as LightType;
      lightData.add({
        type, position: [wm[m + 12], wm[m + 13], wm[m + 14]], direction: norm3(-wm[m + 8], -wm[m + 9], -wm[m + 10]),
        color: [ls.color[e * 3], ls.color[e * 3 + 1], ls.color[e * 3 + 2]], intensity: ls.intensity[e], range: ls.range[e],
        innerCone: ls.innerCone[e], outerCone: ls.outerCone[e], shadowSlot: ls.castShadow[e] ? SHADOW_REQUEST : -1,
        ...(type === LightType.Area ? {
          right: norm3(wm[m], wm[m + 1], wm[m + 2]), up: norm3(wm[m + 4], wm[m + 5], wm[m + 6]),
          halfWidth: 0.5 * ls.width[e] * hypot3(wm[m], wm[m + 1], wm[m + 2]), halfHeight: 0.5 * ls.height[e] * hypot3(wm[m + 4], wm[m + 5], wm[m + 6]),
          twoSided: ls.twoSided[e] !== 0,
        } : {}),
      });
    });
    lightData.finalize();

    // 5. Camera.
    rw.hasCamera = false;
    const cams = w.cameras;
    let camIdx = activeCamera;
    if (camIdx < 0) BitSet.forEachAnd([cams.has, t.has], (i) => { if (camIdx < 0) camIdx = i; });
    if (camIdx >= 0 && cams.has.has(camIdx) && t.has.has(camIdx)) {
      rw.hasCamera = rw.camera.setFromWorldMatrix(t.worldMatrices, camIdx * 16, cams.fovY[camIdx], aspect, cams.near[camIdx], cams.far[camIdx]);
    }
    rw.structureVersion += this.added + this.removed > 0 || staticMembershipChanged ? 1 : 0;
  }

  /** Copy entity `e`'s world matrix and bounds into slot `s` (objects without bounds get an infinite sphere so they are never culled) and flag the slot for upload. */
  private copyTransform(rw: RenderWorld, s: number, e: number): void {
    const t = this.world.transforms, b = this.world.bounds;
    const src = t.worldMatrices;
    const dst = rw.transforms;
    for (let k = 0; k < 16; k++) dst[s * 16 + k] = src[e * 16 + k];
    if (b.has.has(e)) {
      for (let k = 0; k < 6; k++) rw.boundsAABB[s * 6 + k] = b.world[e * 6 + k];
      for (let k = 0; k < 4; k++) rw.boundsSphere[s * 4 + k] = b.sphere[e * 4 + k];
    } else {
      // No bounds component: infinite sphere => never culled.
      rw.boundsSphere[s * 4] = 0; rw.boundsSphere[s * 4 + 1] = 0; rw.boundsSphere[s * 4 + 2] = 0; rw.boundsSphere[s * 4 + 3] = Infinity;
      rw.boundsAABB.set([-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity], s * 6);
    }
    rw.changedSlots.push(s);
    this.matricesCopied++;
  }
}

/** Normalise a 3-vector (zero vectors are returned unscaled). */
function norm3(x: number, y: number, z: number): [number, number, number] {
  const l = hypot3(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

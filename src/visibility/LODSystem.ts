import type { RenderWorld } from '../rendering/RenderWorld';
import type { MeshRecord } from '../rendering/MeshManager';
import type { VisibleSet } from './VisibilitySystem';

export interface LODLevel {
  meshId: number;
  /**
   * The level is used while the object's projected size (fraction of the screen HEIGHT covered by its bounding sphere
   * diameter) is >= this value. Levels must be sorted by DESCENDING minScreenSize (level 0 = most detailed).
   */
  minScreenSize: number;
}

export interface LODGroupDef {
  name?: string;
  levels: LODLevel[];
  /** Below the last level's minScreenSize the object is culled entirely (default true). With false, the last level is kept
   *  (use a camera-facing impostor mesh as the last level for "tiny -> impostor"). */
  cullBelowLast?: boolean;
}

/** Registry of LOD groups. Validation guarantees every level can be drawn with the same pipeline/skeleton. */
export class LODLibrary {
  readonly groups: Required<LODGroupDef>[] = [];

  constructor(private meshes: { get(id: number): MeshRecord }) {}

  create(def: LODGroupDef): number {
    if (def.levels.length === 0) throw new Error('A LOD group needs at least one level');
    for (let i = 1; i < def.levels.length; i++) {
      if (!(def.levels[i].minScreenSize < def.levels[i - 1].minScreenSize)) throw new Error('LOD levels must have strictly decreasing minScreenSize');
    }
    const base = this.meshes.get(def.levels[0].meshId);
    for (const l of def.levels) {
      const m = this.meshes.get(l.meshId);
      // all levels share one RenderWorld object (one skeleton / morph state), so their deformation capabilities must match
      if (m.deformMask !== base.deformMask) throw new Error(`LOD level mesh '${m.name}' has a different deformation capability (skin/morph) than level 0`);
      if (m.morphTargetCount !== base.morphTargetCount) throw new Error(`LOD level mesh '${m.name}' has a different morph target count than level 0`);
    }
    this.groups.push({ name: def.name ?? `lod${this.groups.length}`, levels: def.levels.map((l) => ({ ...l })), cullBelowLast: def.cullBelowLast ?? true });
    return this.groups.length - 1;
  }
}

/** Fraction of the screen height covered by a bounding sphere of `radius` at distance `dist` (vertical fov in radians). */
export function projectedSize(radius: number, dist: number, fovY: number): number {
  if (dist <= radius) return Infinity; // camera inside the bounds: always the finest level
  return radius / (dist * Math.tan(fovY / 2));
}

/**
 * Pick the LOD level with hysteresis. `current` is the previously chosen level (-1 = none yet), `n` = number of levels.
 * Returns a level in [0, n-1], or `n` meaning "culled". Moving to a COARSER level requires the size to drop `hysteresis`
 * (fraction) below the threshold; moving to a FINER level requires it to exceed the threshold by the same margin, so an object
 * hovering around a threshold does not flicker between levels.
 */
export function selectLevel(levels: LODLevel[], cullBelowLast: boolean, size: number, current: number, hysteresis: number): number {
  const n = levels.length, maxLevel = cullBelowLast ? n : n - 1;
  if (current < 0) { // no history: plain threshold test
    for (let i = 0; i < n; i++) if (size >= levels[i].minScreenSize) return i;
    return maxLevel;
  }
  let c = Math.min(current, maxLevel);
  // coarser
  while (c < maxLevel && size < levels[c].minScreenSize * (1 - hysteresis)) c++;
  // finer
  while (c > 0 && size >= levels[c - 1].minScreenSize * (1 + hysteresis)) c--;
  return c;
}

/**
 * CPU LOD selection, run AFTER culling. For every visible object that belongs to a LOD group it overrides the mesh used for
 * rendering (RenderWorld.meshId) and drops objects that fall below the cull size from the visible list. Tracks the level
 * distribution. (GPU-driven LOD arrives with Phase 39; this is the reference implementation to validate it against.)
 */
export class LODSystem {
  hysteresis = 0.1;
  /** Global multiplier on projected size (>1 = keep detail longer, <1 = switch earlier). */
  lodBias = 1;
  /** Objects per level in the last select() (index = level), plus the culled count. */
  readonly counts = new Uint32Array(16);
  culled = 0;
  evaluated = 0;
  ms = 0;

  private out = new Uint32Array(0);
  /** Hysteresis state: current level per ENTITY index (survives slot swaps in the RenderWorld). */
  private levelOf = new Int8Array(0);

  constructor(private library: LODLibrary) {}

  select(rw: RenderWorld, visible: VisibleSet, fovY: number, camPos: ArrayLike<number>): VisibleSet {
    const t0 = performance.now();
    this.counts.fill(0); this.culled = 0; this.evaluated = 0;
    const n = visible.count, slots = visible.slots;
    if (this.out.length < n) this.out = new Uint32Array(Math.max(n, this.out.length * 2, 256));
    const out = this.out, sph = rw.boundsSphere, groups = this.library.groups;
    const tanHalf = Math.tan(fovY / 2) || 1;
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const slot = slots ? slots[i] : i;
      const g = rw.lodGroup[slot];
      if (g < 0) { out[kept++] = slot; continue; }
      const group = groups[g];
      const o = slot * 4;
      const dist = Math.hypot(sph[o] - camPos[0], sph[o + 1] - camPos[1], sph[o + 2] - camPos[2]);
      const r = sph[o + 3];
      const size = (dist <= r ? Infinity : r / (dist * tanHalf)) * this.lodBias;

      const e = rw.entityIndex[slot];
      if (e >= this.levelOf.length) { const l = new Int8Array(Math.max(e + 1, this.levelOf.length * 2, 256)).fill(-1); l.set(this.levelOf); this.levelOf = l; }
      const level = selectLevel(group.levels, group.cullBelowLast, size, this.levelOf[e], this.hysteresis);
      this.levelOf[e] = level;
      this.evaluated++;
      if (level >= group.levels.length) { this.culled++; continue; }   // below the cull size: not drawn
      rw.meshId[slot] = group.levels[level].meshId;
      this.counts[Math.min(level, 15)]++;
      out[kept++] = slot;
    }
    this.ms = performance.now() - t0;
    return { slots: out, count: kept, tested: visible.tested, rejected: visible.rejected, cullMs: visible.cullMs };
  }

  /** Forget hysteresis state for an entity (e.g. after teleporting it). */
  resetEntity(e: number): void { if (e < this.levelOf.length) this.levelOf[e] = -1; }
}

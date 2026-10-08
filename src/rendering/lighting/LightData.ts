import { LightType } from '../../ecs/components/LightStore';

/** Floats per light in the GPU buffer (mirrors `struct Light` in common_types.wgsl: 6 x vec4). */
export const LIGHT_FLOATS = 24;
export const LIGHT_BYTES = LIGHT_FLOATS * 4;

/** Light type ids as seen by the shaders. */
/** Marker in the shadow-slot field meaning "this light requests a shadow map". */
export const SHADOW_REQUEST = -2;

export const GPU_LIGHT_TYPE = { directional: 0, point: 1, spot: 2, ambient: 3, area: 4 } as const;

export interface LightInput {
  type: LightType;
  /** World-space position and the direction the light POINTS (its local -Z axis), per glTF KHR_lights_punctual. */
  position: ArrayLike<number>;
  direction: ArrayLike<number>;
  color: ArrayLike<number>;
  intensity: number;
  range: number;
  innerCone: number;
  outerCone: number;
  /** Area lights: unit axes and half extents. */
  right?: ArrayLike<number>;
  up?: ArrayLike<number>;
  halfWidth?: number;
  halfHeight?: number;
  twoSided?: boolean;
  /** Shadow slot: -1 = no shadow, SHADOW_REQUEST = wants one (assigned a real layer by the ShadowSystem). */
  shadowSlot?: number;
  /** Ambient lights: ground color (sky color = `color`). */
  groundColor?: ArrayLike<number>;
}

/** Mutable, growable list of lights as they will be uploaded (directional lights first, ambient folded into two colors). */
export class LightData {
  count = 0;
  data = new Float32Array(LIGHT_FLOATS * 64);
  ambientSky = new Float32Array(3);
  ambientGround = new Float32Array(3);
  /** Index of the first non-directional light (directional lights are "global" and always evaluated). */
  directionalCount = 0;
  /** Lights [0, globalCount) are evaluated for every pixel (directional, area, unlimited range); the rest are ranged. */
  globalCount = 0;
  /** Bumped when contents changed since the previous frame (cheap upload gating). */
  version = 0;

  private last = new Float32Array(0);
  private lastCount = -1;
  private lastAmbient = new Float32Array(6);

  /** Remove all lights and ambient terms (the capacity is kept). */
  clear(): void { this.count = 0; this.directionalCount = 0; this.globalCount = 0; this.ambientSky.fill(0); this.ambientGround.fill(0); }

  /** Append a light. Ambient lights are summed into the hemisphere colors instead of occupying a slot. */
  add(l: LightInput): void {
    if (l.type === LightType.Ambient) {
      const g = l.groundColor ?? l.color, k = l.intensity;
      for (let c = 0; c < 3; c++) { this.ambientSky[c] += l.color[c] * k; this.ambientGround[c] += g[c] * k; }
      return;
    }
    if (this.count * LIGHT_FLOATS >= this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    const o = this.count++ * LIGHT_FLOATS, f = this.data;
    f[o] = l.position[0]; f[o + 1] = l.position[1]; f[o + 2] = l.position[2]; f[o + 3] = l.type === LightType.Directional ? 0 : l.range;
    f[o + 4] = l.color[0]; f[o + 5] = l.color[1]; f[o + 6] = l.color[2]; f[o + 7] = l.intensity;
    f[o + 8] = l.direction[0]; f[o + 9] = l.direction[1]; f[o + 10] = l.direction[2]; f[o + 11] = l.type === LightType.Area ? GPU_LIGHT_TYPE.area : l.type;
    const cosOuter = Math.cos(l.outerCone), cosInner = Math.cos(l.innerCone);
    f[o + 12] = cosOuter; f[o + 13] = 1 / Math.max(cosInner - cosOuter, 1e-4); f[o + 14] = l.shadowSlot ?? -1; f[o + 15] = l.twoSided ? 1 : 0;
    const r = l.right ?? [1, 0, 0], u = l.up ?? [0, 1, 0];
    f[o + 16] = r[0]; f[o + 17] = r[1]; f[o + 18] = r[2]; f[o + 19] = l.halfWidth ?? 0;
    f[o + 20] = u[0]; f[o + 21] = u[1]; f[o + 22] = u[2]; f[o + 23] = l.halfHeight ?? 0;
  }

  /**
   * Reorder into three groups (stable inside each): directional | other "global" lights (area lights and unlimited-range
   * point/spot lights - they affect every pixel) | ranged point/spot lights. The first `globalCount` lights are evaluated by
   * every fragment; only the ranged tail is assigned to clusters. Call after adding all lights.
   */
  finalize(): void {
    const n = this.count, f = this.data;
    const groups: number[][] = [[], [], []];
    let sorted = true, prev = 0;
    for (let i = 0; i < n; i++) {
      const o = i * LIGHT_FLOATS, type = f[o + 11];
      const g = type === GPU_LIGHT_TYPE.directional ? 0 : (type === GPU_LIGHT_TYPE.area || f[o + 3] <= 0) ? 1 : 2;
      groups[g].push(i);
      if (g < prev) sorted = false;
      prev = g;
    }
    if (!sorted) {
      const tmp = new Float32Array(n * LIGHT_FLOATS);
      [...groups[0], ...groups[1], ...groups[2]].forEach((src, dst) => tmp.set(f.subarray(src * LIGHT_FLOATS, (src + 1) * LIGHT_FLOATS), dst * LIGHT_FLOATS));
      f.set(tmp);
    }
    this.directionalCount = groups[0].length;
    this.globalCount = groups[0].length + groups[1].length;
    // change detection (so unchanged frames upload nothing)
    let changed = n !== this.lastCount;
    if (!changed) { for (let i = 0; i < n * LIGHT_FLOATS; i++) if (f[i] !== this.last[i]) { changed = true; break; } }
    if (!changed) for (let c = 0; c < 3; c++) if (this.ambientSky[c] !== this.lastAmbient[c] || this.ambientGround[c] !== this.lastAmbient[3 + c]) changed = true;
    if (changed) {
      if (this.last.length < n * LIGHT_FLOATS) this.last = new Float32Array(this.data.length);
      this.last.set(f.subarray(0, n * LIGHT_FLOATS)); this.lastCount = n;
      this.lastAmbient.set(this.ambientSky, 0); this.lastAmbient.set(this.ambientGround, 3);
      this.version++;
    }
  }
}

import { ComponentStore, growF32, growU8 } from '../ComponentStore';

export const enum LightType { Directional = 0, Point = 1, Spot = 2, Ambient = 3, Area = 4 }

/** Light parameters; position/direction come from the entity's transform. */
export class LightStore extends ComponentStore {
  type = new Uint8Array(0);
  /** rgb per entity. */
  color = new Float32Array(0);
  intensity = new Float32Array(0);
  range = new Float32Array(0);
  innerCone = new Float32Array(0);
  outerCone = new Float32Array(0);
  /** Area lights: full width / height in local units (scaled by the transform) and emission side. */
  width = new Float32Array(0);
  height = new Float32Array(0);
  twoSided = new Uint8Array(0);
  /** 1 = request a shadow map (directional: cascaded; spot: one map). Point lights do not cast shadows yet. */
  castShadow = new Uint8Array(0);

  protected grow(n: number): void {
    this.type = growU8(this.type, n); this.color = growF32(this.color, n, 3);
    this.intensity = growF32(this.intensity, n); this.range = growF32(this.range, n);
    this.innerCone = growF32(this.innerCone, n); this.outerCone = growF32(this.outerCone, n);
    this.width = growF32(this.width, n); this.height = growF32(this.height, n); this.twoSided = growU8(this.twoSided, n); this.castShadow = growU8(this.castShadow, n);
  }
  protected reset(i: number): void { this.type[i] = 0; this.intensity[i] = 0; this.range[i] = 0; this.width[i] = 0; this.height[i] = 0; this.twoSided[i] = 0; this.castShadow[i] = 0; }

  add(i: number, type: LightType, r = 1, g = 1, b = 1, intensity = 1, range = 10): void {
    this.ensureCapacity(i + 1);
    this.has.set(i);
    this.type[i] = type;
    this.color[i * 3] = r; this.color[i * 3 + 1] = g; this.color[i * 3 + 2] = b;
    this.intensity[i] = intensity; this.range[i] = range;
    this.innerCone[i] = 0; this.outerCone[i] = Math.PI / 4;
    this.width[i] = 1; this.height[i] = 1; this.twoSided[i] = 0; this.castShadow[i] = 0;
  }

  /** Rectangular area light (emits toward local -Z; width along local X, height along local Y). */
  addArea(i: number, width: number, height: number, r = 1, g = 1, b = 1, intensity = 1, twoSided = false): void {
    this.add(i, LightType.Area, r, g, b, intensity, 0);
    this.width[i] = width; this.height[i] = height; this.twoSided[i] = twoSided ? 1 : 0;
  }
}

import { LightData } from './LightData';
import { hypot3 } from '../../math/hypot';

/** Simple scene lighting for apps that define no lights of their own: one sun and a hemisphere ambient term. */
export interface SceneSettings {
  /** Direction TOWARD the sun (does not need to be normalized). */
  sunDirection: [number, number, number];
  sunColor: [number, number, number];
  ambientSky: [number, number, number];
  ambientGround: [number, number, number];
}

export const DEFAULT_SCENE: SceneSettings = {
  sunDirection: [0.4, 0.8, 0.5], sunColor: [3, 2.9, 2.7], ambientSky: [0.25, 0.3, 0.4], ambientGround: [0.08, 0.07, 0.06],
};

/**
 * Turns `SceneSettings` into a light set (one directional sun plus a hemisphere ambient light). The set is rebuilt only when the
 * settings change, so the light-upload gate stays quiet from frame to frame.
 */
export class LegacySceneLights {
  private lights = new LightData();
  private key = '';

  /** The light set equal to `scene` (cached until `scene` changes). */
  get(scene: SceneSettings): LightData {
    const key = JSON.stringify(scene);
    if (key === this.key) return this.lights;
    this.key = key;
    const L = this.lights, sl = hypot3(scene.sunDirection[0], scene.sunDirection[1], scene.sunDirection[2]) || 1;
    L.clear();
    L.add({ type: 0, position: [0, 0, 0], direction: [-scene.sunDirection[0] / sl, -scene.sunDirection[1] / sl, -scene.sunDirection[2] / sl], color: scene.sunColor, intensity: 1, range: 0, innerCone: 0, outerCone: 0 });
    L.add({ type: 3, position: [0, 0, 0], direction: [0, -1, 0], color: scene.ambientSky, intensity: 1, range: 0, innerCone: 0, outerCone: 0, groundColor: scene.ambientGround });
    L.finalize();
    return L;
  }
}

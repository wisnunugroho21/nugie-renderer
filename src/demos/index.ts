import type { Demo } from './Demo';
import { materialsDemo } from './materialsDemo';
import { gltfDemo } from './gltfDemo';
import { characterDemo } from './characterDemo';
import { particlesDemo } from './particlesDemo';
import { lodDemo } from './lodDemo';
import { lightsDemo } from './lightsDemo';
import { occlusionDemo } from './occlusionDemo';
import { streamingDemo } from './streamingDemo';

/** Demo registry: the `?scene=<name>` URL parameter selects an entry. Add new demos here. */
export const DEMOS: Record<string, Demo> = {
  materials: materialsDemo, gltf: gltfDemo, character: characterDemo, particles: particlesDemo,
  lod: lodDemo, lights: lightsDemo, occlusion: occlusionDemo, streaming: streamingDemo,
};

/** Demo used when `?scene=` is missing or unknown. */
export const DEFAULT_DEMO = 'materials';

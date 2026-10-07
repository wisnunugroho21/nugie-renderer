import type { Application } from '../app/Application';
import type { GPUContext } from '../gpu/GPUContext';
import type { Renderer } from '../rendering/Renderer';
import type { RenderWorld } from '../rendering/RenderWorld';
import type { World } from '../ecs/World';
import type { TransformSystem } from '../ecs/systems/TransformSystem';
import type { BoundsSystem } from '../ecs/systems/BoundsSystem';
import type { AnimationSystem } from '../ecs/systems/AnimationSystem';
import type { SkeletonSystem } from '../ecs/systems/SkeletonSystem';
import type { ParticleEmitterSystem } from '../ecs/systems/ParticleEmitterSystem';
import type { RibbonEmitterSystem } from '../ecs/systems/RibbonEmitterSystem';
import type { RenderExtractor } from '../rendering/RenderExtractor';
import type { VisibilitySystem } from '../visibility/VisibilitySystem';
import type { TextureLoader } from '../assets/TextureLoader';
import type { OrbitController } from '../app/OrbitController';
import type { SceneSettings } from '../rendering/Renderer';

export interface DemoContext {
  app: Application;
  gpu: GPUContext;
  renderer: Renderer;
  world: World;
  ts: TransformSystem;
  bs: BoundsSystem;
  animation: AnimationSystem;
  skeletons: SkeletonSystem;
  particleEmitters: ParticleEmitterSystem;
  ribbonEmitters: RibbonEmitterSystem;
  extractor: RenderExtractor;
  rw: RenderWorld;
  visibility: VisibilitySystem;
  textures: TextureLoader;
  orbit: OrbitController;
  params: URLSearchParams;
  /** Index of the active camera entity. */
  camera: number;
  scene: SceneSettings;
}

/** A demo sets up its scene and returns a per-frame update callback. */
export type Demo = (ctx: DemoContext) => ((t: number, dt: number) => void) | void;

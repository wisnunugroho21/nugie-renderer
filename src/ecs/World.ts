import { BitSet } from '../core/BitSet';
import { EntityManager, entityIndex, type Entity } from './Entity';
import type { ComponentStore } from './ComponentStore';
import { TransformStore } from './components/TransformStore';
import { MeshRendererStore } from './components/MeshRendererStore';
import { BoundsStore } from './components/BoundsStore';
import { CameraStore } from './components/CameraStore';
import { LightStore } from './components/LightStore';
import { AnimatorStore } from './components/AnimatorStore';
import { MorphStore } from './components/MorphStore';
import { SkinStore } from './components/SkinStore';
import { ControllerStore } from './components/ControllerStore';
import { ParticleEmitterStore } from './components/ParticleEmitterStore';
import { RibbonEmitterStore } from './components/RibbonEmitterStore';
import { LODStore } from './components/LODStore';

/** Owns entities and all component stores. Gameplay writes here; the renderer never reads it directly. */
export class World {
  readonly entities = new EntityManager();
  /** Alive entity indices (for queries that need only liveness). */
  readonly alive = new BitSet();

  readonly transforms = new TransformStore();
  readonly meshRenderers = new MeshRendererStore();
  readonly bounds = new BoundsStore();
  readonly cameras = new CameraStore();
  readonly lights = new LightStore();
  readonly animators = new AnimatorStore();
  readonly morphs = new MorphStore();
  readonly skins = new SkinStore();
  readonly controllers = new ControllerStore();
  readonly particleEmitters = new ParticleEmitterStore();
  readonly ribbonEmitters = new RibbonEmitterStore();
  readonly lods = new LODStore();

  private stores: ComponentStore[] = [
    this.transforms, this.meshRenderers, this.bounds, this.cameras, this.lights, this.animators, this.morphs, this.skins, this.controllers, this.particleEmitters, this.ribbonEmitters, this.lods,
  ];

  /** Register an additional store (animator, skin, morph, ... added by later phases). */
  registerStore<T extends ComponentStore>(store: T): T {
    this.stores.push(store);
    store.ensureCapacity(this.entities.capacity);
    return store;
  }

  /** Create an entity. Add components through the stores, using `entityIndex(entity)` as the key. */
  create(): Entity {
    const e = this.entities.create();
    const i = entityIndex(e);
    this.alive.set(i);
    for (const s of this.stores) s.ensureCapacity(i + 1);
    return e;
  }

  /** Destroy an entity and remove all its components. Returns false if the handle is stale. */
  destroy(e: Entity): boolean {
    if (!this.entities.isAlive(e)) return false;
    const i = entityIndex(e);
    for (const s of this.stores) s.remove(i);
    this.alive.clear(i);
    return this.entities.destroy(e);
  }

  /** True if the entity handle is still valid. */
  isAlive(e: Entity): boolean { return this.entities.isAlive(e); }
}

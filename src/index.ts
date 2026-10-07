/**
 * Public API of the renderer. A game normally needs only this module:
 *
 * ```ts
 * import { Engine, createCube, LightType } from './index';
 * const engine = await Engine.create(canvas);
 * ```
 *
 * Everything not listed here is still importable from its own file (see the folder overview in README.md).
 */

// --- application / engine ---------------------------------------------------------------------------------------------
export { Engine, type EngineOptions, type EngineTimings, type SpawnObjectOptions, type SpawnLightOptions, type LocalBounds, type EngineSystem, type SystemPhase } from './app/Engine';
export { Application } from './app/Application';
export { OrbitController } from './app/OrbitController';
export { formatHud } from './app/Hud';

// --- ECS --------------------------------------------------------------------------------------------------------------
export { World } from './ecs/World';
export { ComponentStore, growF32, growI32, growU8, growU32 } from './ecs/ComponentStore';
export { Query } from './ecs/Query';
export { BitSet } from './core/BitSet';
export { entityIndex, entityGeneration, NULL_ENTITY, type Entity } from './ecs/Entity';
export { LightType } from './ecs/components/LightStore';
export { RenderFlags } from './ecs/components/MeshRendererStore';

// --- rendering --------------------------------------------------------------------------------------------------------
export { Renderer, DEFAULT_SCENE, type SceneSettings, type BatchingMode } from './rendering/Renderer';
export { createCube, createPlane, createUVSphere, type MeshData } from './rendering/primitives';
export type { PBRMaterialDesc, CustomMaterialDesc, TextureRef, AlphaMode } from './rendering/materials/Material';
export type { FogSettings } from './rendering/lighting/VolumetricFog';
export type { ShadowConfig } from './rendering/shadows/ShadowSystem';
export type { Environment } from './rendering/lighting/IBL';
export { VisibilitySystem, type CullMode } from './visibility/VisibilitySystem';
export { LODLibrary, type LODGroupDef } from './visibility/LODSystem';
export { generateLODChain } from './geometry/LODGenerator';

// --- assets -----------------------------------------------------------------------------------------------------------
export { loadGLTF } from './assets/gltf/GLTFLoader';
export { instantiateGLTF, type GLTFInstance, type InstantiateContext } from './assets/gltf/GLTFInstantiator';
export { TextureLoader } from './assets/TextureLoader';
export { TextureStreamer } from './streaming/TextureStreamer';

// --- animation --------------------------------------------------------------------------------------------------------
export { AnimatedInstance } from './animation/Animator';
export { Animator } from './animation/AnimatorHandle';
export { AnimationController, type LayerDef } from './animation/graph/AnimationController';
export { AnimationParams } from './animation/graph/AnimationParams';
export { StateMachine, type StateDef, type TransitionDef } from './animation/graph/StateMachine';
export { ClipMotion, BlendTree1D } from './animation/graph/Motion';
export { TwoBoneIK } from './animation/ik/TwoBoneIK';
export { FABRIK } from './animation/ik/FABRIK';
export { LookAt } from './animation/ik/LookAt';

// --- particles --------------------------------------------------------------------------------------------------------
export type { EmitterConfig } from './particles/EmitterConfig';
export type { ParticlePoolConfig, ParticlePool, ParticleSystem } from './particles/ParticleSystem';
export { RibbonSystem, beamPoints, type RibbonSystemConfig, type RibbonConfig } from './particles/RibbonSystem';

// --- math -------------------------------------------------------------------------------------------------------------
export { Vec3 } from './math/Vec3';
export { Quat } from './math/Quat';
export { Mat4 } from './math/Mat4';

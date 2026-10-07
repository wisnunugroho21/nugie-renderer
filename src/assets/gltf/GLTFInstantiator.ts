import type { World } from '../../ecs/World';
import { entityIndex, type Entity } from '../../ecs/Entity';
import type { MeshManager } from '../../rendering/MeshManager';
import type { MaterialManager } from '../../rendering/materials/MaterialManager';
import { TextureSlot } from '../../rendering/materials/Material';
import { RenderFlags } from '../../ecs/components/MeshRendererStore';
import type { GLTFAsset } from '../AssetTypes';
import { GLTF_DEFAULT_MATERIAL } from './GLTFMaterialLoader';
import { TextureLoader, withAnisotropy } from '../TextureLoader';
import { SkeletonAsset, SkeletonInstance } from '../../animation/Skeleton';
import { DeformMask } from '../../rendering/MeshManager';

export interface InstantiateContext {
  world: World;
  meshes: MeshManager;
  materials: MaterialManager;
  /** Optional: when present, textures stream in asynchronously (materials start with default textures). */
  textures?: TextureLoader;
  /**
   * Animated-bounds policy (Phase 25): bind-pose bounds are NOT valid once a mesh deforms, so skinned meshes get their
   * local bounds expanded by `skinBoundsPadding` x their largest extent (default 0.5) and morphed meshes by the
   * largest possible morph displacement. Conservative on purpose: never CPU-transform vertices for bounds.
   */
  skinBoundsPadding?: number;
}

export interface GLTFInstance {
  root: Entity;
  /** Entity per glTF node (index-aligned with asset.nodes). */
  nodeEntities: Entity[];
  /** All entities carrying a MeshRenderer (one per primitive). */
  meshEntities: Entity[];
  cameraEntities: Entity[];
  /** Skeleton instances created for skinned nodes (index-aligned with the skinned nodes in node order). */
  skeletons: SkeletonInstance[];
  /** Engine mesh ids per [meshIndex][primitiveIndex]; material ids per asset material (+ default last). */
  meshIds: number[][];
  materialIds: number[];
  /** Resolves when all textures finished uploading (rejects if one failed). Rendering never waits on it. */
  ready: Promise<void>;
}

interface GPUAssetCache { meshIds: number[][]; materialIds: number[]; defaultMaterial: number; skeletons: SkeletonAsset[]; }
/** GPU-side objects are created once per (asset, renderer) and shared by all instances. */
const gpuCache = new WeakMap<GLTFAsset, WeakMap<object, GPUAssetCache>>();
let assetCounter = 0;
const assetIds = new WeakMap<GLTFAsset, string>();

function uploadAsset(asset: GLTFAsset, ctx: InstantiateContext): { cache: GPUAssetCache; fresh: boolean } {
  let perRenderer = gpuCache.get(asset);
  if (!perRenderer) { perRenderer = new WeakMap(); gpuCache.set(asset, perRenderer); }
  const hit = perRenderer.get(ctx.meshes);
  if (hit) return { cache: hit, fresh: false };

  const meshIds = asset.meshes.map((m) => m.primitives.map((p, pi) =>
    ctx.meshes.create(`${m.name}/${pi}`, p.mesh, { joints0: p.joints0, weights0: p.weights0, morphTargets: p.morphTargets })));
  const materialIds = asset.materials.map((m) => ctx.materials.createPBR(m.desc));
  const defaultMaterial = ctx.materials.createPBR(GLTF_DEFAULT_MATERIAL.desc);
  const skeletons = asset.skins.map((s) => SkeletonAsset.fromSkin(s, asset));
  const cache = { meshIds, materialIds, defaultMaterial, skeletons };
  perRenderer.set(ctx.meshes, cache);
  return { cache, fresh: true };
}

/** Create entities for a glTF scene and (once per asset) upload its meshes/materials. */
export function instantiateGLTF(asset: GLTFAsset, ctx: InstantiateContext, sceneIndex = asset.defaultScene): GLTFInstance {
  const { world } = ctx;
  const { cache, fresh } = uploadAsset(asset, ctx);
  const t = world.transforms;

  const root = world.create();
  t.add(entityIndex(root));

  const nodeEntities: Entity[] = asset.nodes.map(() => world.create());
  const meshEntities: Entity[] = [], cameraEntities: Entity[] = [];
  const skeletons: SkeletonInstance[] = [];
  const skinPad = ctx.skinBoundsPadding ?? 0.5;

  asset.nodes.forEach((n, i) => {
    const e = nodeEntities[i], idx = entityIndex(e);
    t.add(idx, n.translation[0], n.translation[1], n.translation[2]);
    t.setRotation(idx, n.rotation[0], n.rotation[1], n.rotation[2], n.rotation[3]);
    t.setScale(idx, n.scale[0], n.scale[1], n.scale[2]);
  });
  asset.nodes.forEach((n, i) => { if (n.parent >= 0) t.setParent(entityIndex(nodeEntities[i]), entityIndex(nodeEntities[n.parent])); });
  for (const sn of asset.scenes[sceneIndex]?.nodes ?? []) t.setParent(entityIndex(nodeEntities[sn]), entityIndex(root));

  asset.nodes.forEach((n, i) => {
    const nodeIdx = entityIndex(nodeEntities[i]);
    if (n.mesh >= 0) {
      const mesh = asset.meshes[n.mesh];
      // One skeleton instance per skinned mesh node, shared by all of its primitives.
      let skeleton: SkeletonInstance | undefined;
      if (n.skin >= 0 && mesh.primitives.some((p) => p.joints0)) {
        const sk = cache.skeletons[n.skin];
        skeleton = new SkeletonInstance(sk, nodeIdx, Int32Array.from(sk.jointNodes, (jn) => entityIndex(nodeEntities[jn])));
        world.skins.add(nodeIdx, skeleton);
        skeletons.push(skeleton);
      }
      mesh.primitives.forEach((prim, pi) => {
        // One primitive => the node entity itself; several => a child entity per primitive.
        let targetEntity = nodeEntities[i];
        if (mesh.primitives.length > 1) {
          targetEntity = world.create();
          t.add(entityIndex(targetEntity));
          t.setParent(entityIndex(targetEntity), nodeIdx);
        }
        const target = entityIndex(targetEntity);
        const meshId = cache.meshIds[n.mesh][pi];
        const matId = prim.materialIndex >= 0 ? cache.materialIds[prim.materialIndex] : cache.defaultMaterial;
        world.meshRenderers.add(target, meshId, matId, RenderFlags.CastShadow | RenderFlags.ReceiveShadow);
        const morphCount = prim.morphTargets?.length ?? 0;
        if (morphCount > 0) {
          // Morph state lives on the NODE entity (shared by all of its primitives).
          if (!world.morphs.has.has(nodeIdx)) world.morphs.add(nodeIdx, morphCount, n.weights ?? mesh.defaultMorphWeights ?? undefined);
          world.meshRenderers.morphOwner[target] = nodeIdx;
        }
        const rec = ctx.meshes.get(meshId);
        if (skeleton && (rec.deformMask & DeformMask.Skin)) world.meshRenderers.skinOwner[target] = nodeIdx;
        // Conservative animated bounds (see InstantiateContext.skinBoundsPadding).
        const b = rec.bounds;
        let pad = rec.morphMaxDisplacement;
        if (rec.deformMask & DeformMask.Skin) pad += skinPad * Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        world.bounds.add(target, b[0] - pad, b[1] - pad, b[2] - pad, b[3] + pad, b[4] + pad, b[5] + pad);
        meshEntities.push(targetEntity);
      });
    }
    if (n.camera >= 0) {
      const c = asset.cameras[n.camera];
      world.cameras.add(nodeIdx, c.yfov || Math.PI / 4, c.znear, c.zfar || 1000);
      cameraEntities.push(nodeEntities[i]);
    }
  });

  return {
    root, nodeEntities, meshEntities, cameraEntities, skeletons, meshIds: cache.meshIds, materialIds: cache.materialIds,
    ready: fresh ? streamTextures(asset, ctx, cache) : Promise.resolve(),
  };
}

/** Kick off async texture loads and patch materials as each texture becomes ready. */
function streamTextures(asset: GLTFAsset, ctx: InstantiateContext, cache: GPUAssetCache): Promise<void> {
  const loader = ctx.textures;
  if (!loader || asset.textures.length === 0) return Promise.resolve();
  let assetId = assetIds.get(asset);
  if (!assetId) { assetId = `gltf${assetCounter++}`; assetIds.set(asset, assetId); }

  const slotOf = { baseColor: TextureSlot.BaseColor, metalRough: TextureSlot.MetalRough, normal: TextureSlot.Normal, occlusion: TextureSlot.Occlusion, emissive: TextureSlot.Emissive } as const;
  const jobs: Promise<void>[] = [];
  asset.materials.forEach((m, mi) => {
    for (const key of Object.keys(slotOf) as (keyof typeof slotOf)[]) {
      const useIdx = m.textures[key];
      if (useIdx === undefined) continue;
      const use = asset.textures[useIdx];
      jobs.push(loader.load(`${assetId}:img${use.image}`, asset.images[use.image], use.srgb).then((ref) => {
        const id = cache.materialIds[mi];
        ctx.materials.setTexture(id, slotOf[key], ref);
        ctx.materials.get(id).samplerDesc = withAnisotropy(use.sampler);
      }));
    }
  });
  return Promise.all(jobs).then(() => undefined);
}


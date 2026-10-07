import type { GLTFAsset, SkinAsset } from '../assets/AssetTypes';

/**
 * STATIC skeleton data shared by every instance of a skin: joint structure + inverse bind matrices.
 * (Dynamic per-instance data lives in SkeletonInstance.)
 */
export class SkeletonAsset {
  readonly jointCount: number;

  constructor(
    readonly name: string,
    /** Node index (in the source asset) of each joint. */
    readonly jointNodes: Int32Array,
    /** 16 floats per joint, column-major, glTF inverse bind matrices. */
    readonly inverseBind: Float32Array,
    /** Parent joint index within this skeleton, or -1 if the parent is not a joint. */
    readonly parent: Int32Array,
  ) {
    this.jointCount = jointNodes.length;
    if (inverseBind.length !== this.jointCount * 16) throw new Error('inverseBind must hold 16 floats per joint');
  }

  static fromSkin(skin: SkinAsset, asset: GLTFAsset): SkeletonAsset {
    const jointNodes = Int32Array.from(skin.joints);
    const indexOf = new Map<number, number>();
    skin.joints.forEach((n, i) => indexOf.set(n, i));
    const parent = new Int32Array(jointNodes.length).fill(-1);
    skin.joints.forEach((n, i) => {
      let p = asset.nodes[n].parent;
      while (p >= 0 && !indexOf.has(p)) p = asset.nodes[p].parent; // skip non-joint ancestors
      parent[i] = p >= 0 ? indexOf.get(p)! : -1;
    });
    return new SkeletonAsset(skin.name, jointNodes, skin.inverseBindMatrices, parent);
  }
}

/** DYNAMIC per-instance skeleton state: which entities are the joints and where the matrices live on the GPU. */
export class SkeletonInstance {
  /** Assigned by SkinStore. */
  id = -1;
  /** First matrix in the shared JointMatrixBuffer (in matrices). */
  jointOffset = -1;
  /** Needs its joint matrices recomputed. */
  dirty = true;

  constructor(
    readonly skeleton: SkeletonAsset,
    /** Entity INDEX of the skinned mesh node: its world matrix is the model space the matrices are relative to. */
    readonly owner: number,
    /** Entity INDEX per joint. */
    readonly jointEntities: Int32Array,
  ) {
    if (jointEntities.length !== skeleton.jointCount) throw new Error('jointEntities must match the skeleton joint count');
  }

  get jointCount(): number { return this.skeleton.jointCount; }
}

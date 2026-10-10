import type { World } from './World';
import { entityIndex } from './Entity';
import { Mat4 } from '../math/Mat4';
import { RenderFlags } from './components/MeshRendererStore';

/**
 * Object grouping on top of the transform hierarchy: a group is an entity that only carries a transform; its children inherit it.
 * Everything here works on entity INDICES (what `spawnObject` / `createGroup` return). World matrices are recomputed by the
 * TransformSystem each frame, so anything that reads `worldMatrices` (keepWorld, worldPosition) needs `engine.frame` or
 * `transformSystem.update()` to have run since the last change.
 */

export interface GroupOptions {
  position?: readonly [number, number, number];
  /** Quaternion [x, y, z, w]. */
  rotation?: readonly [number, number, number, number];
  /** Uniform (number) or per-axis scale. */
  scale?: number | readonly [number, number, number];
  /** Parent entity index (-1 / undefined = scene root). */
  parent?: number;
  name?: string;
}

/** Create an empty group (an entity with just a transform). Returns its entity index. */
export function createGroup(world: World, o: GroupOptions = {}): number {
  const e = entityIndex(world.create());
  const p = o.position ?? [0, 0, 0];
  world.transforms.add(e, p[0], p[1], p[2]);
  if (o.rotation) world.transforms.setRotation(e, o.rotation[0], o.rotation[1], o.rotation[2], o.rotation[3]);
  if (o.scale !== undefined) {
    const s = typeof o.scale === 'number' ? [o.scale, o.scale, o.scale] as const : o.scale;
    world.transforms.setScale(e, s[0], s[1], s[2]);
  }
  if (o.parent !== undefined && o.parent >= 0) world.transforms.setParent(e, o.parent);
  if (o.name !== undefined) world.names.set(e, o.name);
  return e;
}

/** Direct children of `i` (most recently attached first). */
export function childrenOf(world: World, i: number): number[] {
  const t = world.transforms, out: number[] = [];
  if (!t.has.has(i)) return out;
  for (let c = t.firstChild[i]; c !== -1; c = t.nextSibling[c]) out.push(c);
  return out;
}

/** Visit every descendant of `root` (children, grandchildren, ...; `root` itself is not visited), parents before children. */
export function forEachDescendant(world: World, root: number, fn: (index: number) => void): void {
  const t = world.transforms, stack: number[] = [];
  if (!t.has.has(root)) return;
  for (let c = t.firstChild[root]; c !== -1; c = t.nextSibling[c]) stack.push(c);
  while (stack.length > 0) {
    const i = stack.pop()!;
    fn(i);
    for (let c = t.firstChild[i]; c !== -1; c = t.nextSibling[c]) stack.push(c);
  }
}

/** All descendants of `root` (not `root`), parents before children. */
export function descendantsOf(world: World, root: number): number[] {
  const out: number[] = [];
  forEachDescendant(world, root, (i) => out.push(i));
  return out;
}

/** The root of `i`'s tree (`i` itself when it has no parent), or -1 for a missing transform. */
export function rootOf(world: World, i: number): number {
  const t = world.transforms;
  if (!t.has.has(i)) return -1;
  while (t.parent[i] !== -1) i = t.parent[i];
  return i;
}

const TMP = new Float32Array(16), INV = new Float32Array(16), LOC = new Float32Array(16);
const P = new Float32Array(3), Q = new Float32Array(4), S = new Float32Array(3);

/**
 * Move `child` under `parent` (-1 = scene root). With `keepWorld` the child keeps its current world transform (its local transform
 * is recomputed against the new parent); otherwise it keeps its local values and jumps with the new parent.
 * Rejects cycles (a group cannot be put inside its own descendant).
 */
export function setParent(world: World, child: number, parent: number, keepWorld = false): void {
  const t = world.transforms;
  if (keepWorld) {
    const w = t.worldMatrices;
    for (let k = 0; k < 16; k++) LOC[k] = w[child * 16 + k];
    if (parent >= 0) {
      for (let k = 0; k < 16; k++) TMP[k] = w[parent * 16 + k];
      if (!Mat4.invert(INV, TMP)) throw new Error('Cannot preserve world transform under a singular parent');
      Mat4.multiply(LOC, INV, LOC);
    }
    t.setParent(child, parent);
    Mat4.decompose(LOC, P, Q, S);
    t.setPosition(child, P[0], P[1], P[2]);
    t.setRotation(child, Q[0], Q[1], Q[2], Q[3]);
    t.setScale(child, S[0], S[1], S[2]);
  } else {
    t.setParent(child, parent);
  }
}

/**
 * Show or hide `root` and everything below it (sets / clears `RenderFlags.Hidden` on every mesh renderer in the tree; lights, emitters
 * and cameras are not affected).
 */
export function setVisible(world: World, root: number, visible: boolean): void {
  if (!world.transforms.has.has(root)) return;
  const mr = world.meshRenderers;
  const apply = (i: number): void => {
    if (!mr.has.has(i)) return;
    mr.flags[i] = visible ? (mr.flags[i] & ~RenderFlags.Hidden) : (mr.flags[i] | RenderFlags.Hidden);
  };
  apply(root);
  forEachDescendant(world, root, apply);
}

/** Destroy `root` and every entity below it. Returns how many entities were destroyed. */
export function destroyTree(world: World, root: number): number {
  const all = descendantsOf(world, root);
  all.push(root);
  let n = 0;
  for (let k = all.length - 1; k >= 0; k--) {          // children first: nothing is orphaned and re-linked
    const h = world.entities.handleOf(all[k]);
    if (h >= 0 && world.destroy(h)) n++;
  }
  return n;
}

/** World-space position of entity `i` (from the last transform update). */
export function worldPosition(world: World, i: number, out: ArrayLike<number> & { [k: number]: number } = [0, 0, 0]): typeof out {
  if (!world.transforms.has.has(i)) throw new Error('Transform does not exist');
  const w = world.transforms.worldMatrices;
  out[0] = w[i * 16 + 12]; out[1] = w[i * 16 + 13]; out[2] = w[i * 16 + 14];
  return out;
}

/** First entity named `name` (anywhere, or inside the tree of `root`), or -1. Like three.js `getObjectByName`. */
export function findByName(world: World, name: string, root = -1): number {
  if (root < 0) return world.names.find(name);
  if (world.names.get(root) === name) return root;
  let found = -1;
  forEachDescendant(world, root, (i) => { if (found < 0 && world.names.get(i) === name) found = i; });
  return found;
}

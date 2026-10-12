import { estimateTextureBytes } from '../../gpu/TextureManager';
import { dependenciesOf, liveNodes, orderNodes, orderCost, type AnalysisNode, type NodeAccess, type OrderStrategy } from './Analysis';
import { flatten, type FlatGraph, type FlatNode, type FlatVariable, type VariableValue } from './Flatten';
import {
  TechniqueError, type BindingDecl, type BufferDecl, type Diagnostic, type NodeCondition, type SizeDim, type TextureDecl, type TextureDimension, type Technique, type TechniqueRegistry,
} from './TechniqueTypes';

export interface CompileOptions {
  registry?: TechniqueRegistry;
  /** Override variable defaults of the top-level technique. */
  values?: Record<string, VariableValue>;
  /** `declaration` keeps the author's order among independent nodes; `transitions` reorders them to cut barriers. Default `declaration`. */
  order?: OrderStrategy;
  /** Share memory between transient resources whose lifetimes do not overlap. Default true. */
  alias?: boolean;
}

/** How a resource is used by the live nodes (decides the GPU usage flags it is created with). */
export type ResourceUse = 'sampled' | 'storage' | 'render' | 'vertex' | 'index' | 'copy-src' | 'copy-dst' | 'indirect';

export interface ResolvedTexture { kind: 'texture'; dimension: TextureDimension; format: GPUTextureFormat; size: [number, number, number]; mips: number; samples: number; }
export interface ResolvedBuffer { kind: 'buffer'; element: string; stride: number; count: number; }
export type Resolved = ResolvedTexture | ResolvedBuffer;

export interface ResourcePlan {
  name: string;
  decl: TextureDecl | BufferDecl;
  visibility: 'imported' | 'internal' | 'exported';
  lifetime: 'transient' | 'persistent';
  /** Size and format; for imported resources only what the declaration states (checked against the real resource when it is attached). */
  resolved: Resolved | null;
  /** Execution positions of the first and last live node that touches it (-1 when none does). */
  first: number;
  last: number;
  uses: Set<ResourceUse>;
  /** Index of the physical allocation it lives in (several transient resources may share one); -1 for imported resources. */
  slot: number;
  bytes: number;
}

/** One physical allocation, possibly shared by several transient resources over time. */
export interface Slot {
  index: number;
  /** Unique name of the allocation (stable across recompiles while the description is unchanged, so contents can be kept). */
  key: string;
  /** What the allocation looks like (resources with equal signatures and disjoint lifetimes can share it). */
  signature: string;
  resources: string[];
  uses: Set<ResourceUse>;
  bytes: number;
}

export interface CompiledStep {
  /** Position in execution order. */
  index: number;
  node: FlatNode;
  accesses: NodeAccess[];
}

export interface CompiledTechnique {
  name: string;
  steps: CompiledStep[];
  resources: Map<string, ResourcePlan>;
  slots: Slot[];
  variables: Map<string, FlatVariable>;
  /** Variables whose change needs a recompile: they size resources, count loops, decide conditions. */
  structural: Set<string>;
  /** Nodes dropped because nothing consumes their outputs. */
  culled: string[];
  /** Nodes switched off by a condition that is false right now. */
  disabled: string[];
  /** Declared resources no live node touches. */
  unused: string[];
  diagnostics: Diagnostic[];
  stats: { nodes: number; live: number; transitions: number; declaredTransitions: number; kindSwitches: number; bytes: number; bytesAliased: number; slots: number };
}

const SCALAR_BYTES: Record<string, number> = { f32: 4, i32: 4, u32: 4, f16: 2 };
/** Storage-texture formats WebGPU allows without extra features, and the subset that also allows read-write. */
const STORAGE_FORMATS = new Set<string>([
  'rgba8unorm', 'rgba8snorm', 'rgba8uint', 'rgba8sint', 'rgba16uint', 'rgba16sint', 'rgba16float', 'r32uint', 'r32sint', 'r32float',
  'rg32uint', 'rg32sint', 'rg32float', 'rgba32uint', 'rgba32sint', 'rgba32float',
]);
const READ_WRITE_FORMATS = new Set<string>(['r32uint', 'r32sint', 'r32float']);
/** Bytes of each vertex attribute format. */
const VERTEX_FORMAT_BYTES: Record<string, number> = {
  uint8x2: 2, uint8x4: 4, sint8x2: 2, sint8x4: 4, unorm8x2: 2, unorm8x4: 4, snorm8x2: 2, snorm8x4: 4,
  uint16x2: 4, uint16x4: 8, sint16x2: 4, sint16x4: 8, unorm16x2: 4, unorm16x4: 8, snorm16x2: 4, snorm16x4: 8, float16x2: 4, float16x4: 8,
  float32: 4, float32x2: 8, float32x3: 12, float32x4: 16, uint32: 4, uint32x2: 8, uint32x3: 12, uint32x4: 16, sint32: 4, sint32x2: 8, sint32x3: 12, sint32x4: 16,
  'unorm10-10-10-2': 4, 'unorm8x4-bgra': 4,
};
const isDepthFormat = (f: string) => f.startsWith('depth') || f === 'stencil8';

/** Bytes of one element of a WGSL scalar / vector / matrix type as it is laid out in a storage array, or undefined for other types. */
export function wgslElementBytes(type: string): number | undefined {
  const t = type.replace(/\s+/g, '');
  if (t in SCALAR_BYTES) return SCALAR_BYTES[t];
  const vec = /^vec([234])<(f32|i32|u32|f16)>$/.exec(t);
  if (vec) { const n = Number(vec[1]), b = SCALAR_BYTES[vec[2]]; return (n === 3 ? 4 : n) * b; }
  const mat = /^mat([234])x([234])<(f32|f16)>$/.exec(t);
  if (mat) { const rows = Number(mat[2]), b = SCALAR_BYTES[mat[3]]; return Number(mat[1]) * (rows === 3 ? 4 : rows) * b; }
  return undefined;
}

/** Evaluate `value` of a flat variable as a single number. */
function scalar(variables: Map<string, FlatVariable>, name: string, ctx: string): number {
  const v = variables.get(name)?.value;
  if (v === undefined) throw new TechniqueError(`${ctx}: unknown variable '${name}'`);
  if (Array.isArray(v)) throw new TechniqueError(`${ctx}: float4 variable '${name}' cannot be used as a size or count`);
  return v;
}

/** Evaluate a size entry; the result is rounded down. */
export function evalDim(dim: SizeDim, variables: Map<string, FlatVariable>, ctx: string): number {
  if (typeof dim === 'number') return Math.floor(dim);
  return Math.floor(scalar(variables, dim.variable, ctx) * (dim.scale ?? 1) + (dim.offset ?? 0));
}

/** Whether a node's condition list holds for the current variable values. */
export function conditionsHold(conditions: NodeCondition[], variables: Map<string, FlatVariable>): boolean {
  return conditions.every((c) => {
    const v = scalar(variables, c.variable, 'condition');
    switch (c.op) { case 'eq': return v === c.value; case 'ne': return v !== c.value; case 'lt': return v < c.value; case 'le': return v <= c.value; case 'gt': return v > c.value; case 'ge': return v >= c.value; }
  });
}

/** Resolve the size / format of every declared resource (following `like`) for the current variable values. */
function resolveResources(graph: FlatGraph): Map<string, Resolved | null> {
  const out = new Map<string, Resolved | null>();
  const active = new Set<string>();
  const resolve = (name: string): Resolved | null => {
    if (out.has(name)) return out.get(name)!;
    const res = graph.resources.get(name)!;
    const decl = res.decl, ctx = `resource '${name}'`;
    if (active.has(name)) throw new TechniqueError(`${ctx}: 'like' chain forms a cycle`);
    active.add(name);
    try {
      let like: Resolved | null | undefined;
      if (decl.like !== undefined) {
        if (!graph.resources.has(decl.like)) throw new TechniqueError(`${ctx}: 'like' names unknown resource '${decl.like}'`);
        like = resolve(decl.like);
        if (!like || like.kind !== decl.kind) throw new TechniqueError(`${ctx}: 'like' resource '${decl.like}' ${like ? `is a ${like.kind}, not a ${decl.kind}` : 'has no known size (imported resources must declare size to be used as a size source)'}`);
      }
      let r: Resolved | null;
      if (decl.kind === 'texture') {
        const base = like as ResolvedTexture | undefined;
        const dims = decl.size?.map((d) => evalDim(d, graph.variables, ctx));
        if (dims?.some((v) => !Number.isInteger(v) || v < 1)) throw new TechniqueError(`${ctx}: size ${dims.join('x')} is not valid (every extent must be at least 1)`);
        const scale = decl.scale ?? 1;
        const size: [number, number, number] = [
          dims?.[0] ?? (base ? Math.max(1, Math.floor(base.size[0] * scale)) : 0),
          dims?.[1] ?? (base ? Math.max(1, Math.floor(base.size[1] * scale)) : 1),
          dims?.[2] ?? base?.size[2] ?? 1,
        ];
        const format = decl.format ?? base?.format;
        const dimension = decl.dimension ?? base?.dimension ?? '2d';
        if (dimension === 'cube') size[2] = 6;
        if (size[0] < 1 || !format) {
          // an imported texture may leave size / format to the host (they are checked when it is attached); anything else must be complete
          if (decl.visibility !== 'imported') throw new TechniqueError(`${ctx}: ${!format ? 'a texture needs a format (or \'like\' a texture that has one)' : 'a texture needs a size (or \'like\' a texture that has one)'}`);
          r = null;
        } else {
          if (size.some((v) => !Number.isInteger(v) || v < 1)) throw new TechniqueError(`${ctx}: size ${size.join('x')} is not valid (every extent must be at least 1)`);
          const samples = decl.samples ?? 1;
          if (samples !== 1 && samples !== 4) throw new TechniqueError(`${ctx}: samples must be 1 or 4 (WebGPU), not ${samples}`);
          if (samples > 1 && (dimension !== '2d' || size[2] !== 1)) throw new TechniqueError(`${ctx}: a multisampled texture must be a plain 2d texture`);
          // a multisampled texture has exactly one mip; borrowing a mipped size source must not give it more
          const mips = samples > 1 ? 1 : decl.mips === 'full' ? Math.floor(Math.log2(Math.max(size[0], size[1]))) + 1 : decl.mips ?? base?.mips ?? 1;
          if (samples > 1 && decl.mips !== undefined && decl.mips !== 1) throw new TechniqueError(`${ctx}: a multisampled texture has one mip level`);
          r = { kind: 'texture', dimension, format, size, mips, samples };
        }
      } else {
        const base = like as ResolvedBuffer | undefined;
        const element = decl.element ?? base?.element ?? 'u32';
        const stride = decl.stride ?? wgslElementBytes(element) ?? base?.stride;
        if (stride === undefined) throw new TechniqueError(`${ctx}: element type '${element}' needs a 'stride' (bytes per element)`);
        const count = decl.count !== undefined ? evalDim(decl.count, graph.variables, ctx) : base?.count;
        if (count === undefined) r = decl.visibility === 'imported' ? null : (() => { throw new TechniqueError(`${ctx}: a buffer needs a 'count' (or 'like' a buffer that has one)`); })();
        else {
          if (!Number.isInteger(count) || count < 1) throw new TechniqueError(`${ctx}: count ${count} must be at least 1`);
          r = { kind: 'buffer', element, stride, count };
        }
      }
      out.set(name, r);
      return r;
    } finally { active.delete(name); }
  };
  for (const name of graph.resources.keys()) resolve(name);
  return out;
}

/** Bytes of a resolved resource. */
export function resolvedBytes(r: Resolved | null): number {
  if (!r) return 0;
  if (r.kind === 'buffer') return r.stride * r.count;
  return estimateTextureBytes(r.size[0], r.size[1], r.size[2], r.format, r.mips, r.dimension === '3d' ? '3d' : '2d') * r.samples;
}

/** Textures only: width / height of mip 0 (for dispatch-by-resource and render-target consistency checks). */
export function textureSize(r: Resolved | null): [number, number, number] | null { return r && r.kind === 'texture' ? r.size : null; }

/** How a binding touches its resource. */
function bindingAccess(b: BindingDecl, kind: 'texture' | 'buffer'): NodeAccess {
  const access: NodeAccess = { resource: b.resource, read: b.access !== 'write', write: b.access !== 'read', usage: b.access === 'read' ? (kind === 'texture' ? 'sampled' : 'sampled') : 'storage' };
  if (kind === 'texture' && (b.mip !== undefined || b.mipCount !== undefined)) access.mips = [b.mip ?? 0, b.mipCount ?? 1];
  return access;
}

/** Two sub-ranges of a texture's mip chain that do not overlap (both must be given). */
function disjointMips(a: [number, number] | undefined, b: [number, number] | undefined): boolean {
  return a !== undefined && b !== undefined && (a[0] + a[1] <= b[0] || b[0] + b[1] <= a[0]);
}

/** The accesses of a flat node (what the dependency analysis and lifetimes use), with validation of how it uses its resources. */
function accessesOf(node: FlatNode, graph: FlatGraph, resolved: Map<string, Resolved | null>): NodeAccess[] {
  const ctx = `node '${node.path}'`;
  const decl = (name: string) => graph.resources.get(name)!.decl;
  const out: NodeAccess[] = [];
  /** Merge accesses of one resource: two reads are fine, any write combined with another use of the same resource in one node is a usage conflict. */
  const add = (a: NodeAccess) => {
    // bindings of disjoint mip ranges of one texture (a pyramid build reads level i-1 and writes level i) are separate accesses
    const same = out.find((o) => o.resource === a.resource && !disjointMips(o.mips, a.mips));
    if (!same) { out.push(a); return; }
    if (a.write || same.write || a.usage !== same.usage) throw new TechniqueError(`${ctx}: resource '${a.resource}' is bound more than once with conflicting usage (${same.usage} and ${a.usage})`);
  };
  const groups = (n: { group?: number; hostGroups?: { group: number; layout: string }[] }) => {
    const own = n.group ?? 0, seen = new Set<number>([own]);
    if (!Number.isInteger(own) || own < 0 || own > 3) throw new TechniqueError(`${ctx}: group ${own} must be from 0 to 3`);
    for (const h of n.hostGroups ?? []) {
      if (!Number.isInteger(h.group) || h.group < 0 || h.group > 3) throw new TechniqueError(`${ctx}: host group ${h.group} must be from 0 to 3`);
      if (seen.has(h.group)) throw new TechniqueError(`${ctx}: @group(${h.group}) is used twice (the generated bindings are at group ${own})`);
      seen.add(h.group);
      if (!h.layout) throw new TechniqueError(`${ctx}: host group ${h.group} needs a layout name`);
    }
  };
  const bindings = (list: BindingDecl[]) => {
    const names = new Set<string>();
    for (const b of list) {
      const kind = decl(b.resource).kind;
      const wgsl = b.name ?? b.resource;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(wgsl)) throw new TechniqueError(`${ctx}: '${wgsl}' is not a valid WGSL identifier (set 'name' on the binding of '${b.resource}')`);
      if (names.has(wgsl)) throw new TechniqueError(`${ctx}: shader variable '${wgsl}' is bound twice`);
      names.add(wgsl);
      if (b.sampler && (kind !== 'texture' || b.access !== 'read')) throw new TechniqueError(`${ctx}: only sampled (read) textures can have a sampler ('${b.resource}')`);
      if (b.sampler && ((resolved.get(b.resource) as ResolvedTexture | null)?.samples ?? 1) > 1) throw new TechniqueError(`${ctx}: multisampled texture '${b.resource}' cannot be filtered; read it with textureLoad (no sampler)`);
      if (b.mip !== undefined || b.mipCount !== undefined) {
        const r = resolved.get(b.resource) as ResolvedTexture | null, first = b.mip ?? 0, count = b.mipCount ?? 1;
        if (kind !== 'texture') throw new TechniqueError(`${ctx}: mip / mipCount only apply to textures ('${b.resource}')`);
        if (!Number.isInteger(first) || first < 0 || !Number.isInteger(count) || count < 1) throw new TechniqueError(`${ctx}: '${b.resource}': mip ${first} / mipCount ${count} must be a level >= 0 and a count >= 1`);
        if (r && first + count > r.mips) throw new TechniqueError(`${ctx}: '${b.resource}' has ${r.mips} mip level(s); mip ${first} + mipCount ${count} is out of range`);
        if (b.access !== 'read' && count !== 1) throw new TechniqueError(`${ctx}: a storage view of '${b.resource}' covers one mip level (mipCount ${count})`);
      }
      if (kind === 'texture' && b.access !== 'read') {
        const r = resolved.get(b.resource) as ResolvedTexture | null;
        if (r && r.samples > 1) throw new TechniqueError(`${ctx}: '${b.resource}' is multisampled and cannot be a storage texture`);
        const format = (decl(b.resource) as TextureDecl).format ?? r?.format;
        if (format && !STORAGE_FORMATS.has(format)) throw new TechniqueError(`${ctx}: ${format} cannot be bound for ${b.access} (storage textures: ${[...STORAGE_FORMATS].join(', ')})`);
        if (format && b.access === 'readwrite' && !READ_WRITE_FORMATS.has(format)) throw new TechniqueError(`${ctx}: ${format} supports 'write' but not 'readwrite' (only r32float / r32uint / r32sint do)`);
      }
      add(bindingAccess(b, kind));
    }
  };
  switch (node.type) {
    case 'compute':
      groups(node);
      bindings(node.bindings);
      if ('like' in node.dispatch) {
        if (!textureSize(resolved.get(node.dispatch.like) ?? null)) throw new TechniqueError(`${ctx}: dispatch 'like' needs a texture with a known size ('${node.dispatch.like}')`);
      } else if ('indirect' in node.dispatch) {
        if (decl(node.dispatch.indirect).kind !== 'buffer') throw new TechniqueError(`${ctx}: indirect dispatch needs a buffer ('${node.dispatch.indirect}')`);
        add({ resource: node.dispatch.indirect, read: true, write: false, usage: 'indirect' });
      } else if (node.dispatch.threads.length < 1 || node.dispatch.threads.length > 3) throw new TechniqueError(`${ctx}: dispatch needs one to three thread extents`);
      break;
    case 'draw': {
      groups(node);
      if (!node.colorTargets.length && !node.depthTarget) throw new TechniqueError(`${ctx}: a draw needs at least one color or depth target`);
      let target: [number, number, number] | null = null;
      let samples: number | null = null;
      /** Every attachment of a pass has the same size and sample count. */
      const attach = (name: string, r: ResolvedTexture | null) => {
        if (!r) return;
        if (target && (target[0] !== r.size[0] || target[1] !== r.size[1])) throw new TechniqueError(`${ctx}: targets differ in size (${target[0]}x${target[1]} and ${r.size[0]}x${r.size[1]})`);
        target = r.size;
        if (samples !== null && samples !== r.samples) throw new TechniqueError(`${ctx}: targets differ in sample count (${samples} and ${r.samples}; '${name}' has ${r.samples})`);
        samples = r.samples;
      };
      for (const t of node.colorTargets) {
        const d = decl(t.resource);
        if (d.kind !== 'texture') throw new TechniqueError(`${ctx}: color target '${t.resource}' must be a texture`);
        const r = resolved.get(t.resource) as ResolvedTexture | null;
        if (r && (isDepthFormat(r.format))) throw new TechniqueError(`${ctx}: '${t.resource}' is a depth format and cannot be a color target`);
        attach(t.resource, r);
        if (t.resolve !== undefined) {
          const rd = decl(t.resolve);
          if (rd.kind !== 'texture') throw new TechniqueError(`${ctx}: resolve target '${t.resolve}' must be a texture`);
          if (t.resolve === t.resource) throw new TechniqueError(`${ctx}: '${t.resource}' cannot resolve into itself`);
          const rr = resolved.get(t.resolve) as ResolvedTexture | null;
          if (r && r.samples < 2) throw new TechniqueError(`${ctx}: '${t.resource}' resolves into '${t.resolve}' but is not multisampled (set samples: 4)`);
          if (rr && rr.samples !== 1) throw new TechniqueError(`${ctx}: resolve target '${t.resolve}' must be single-sample`);
          if (r && rr && (r.format !== rr.format || r.size[0] !== rr.size[0] || r.size[1] !== rr.size[1])) throw new TechniqueError(`${ctx}: resolve target '${t.resolve}' (${rr.format} ${rr.size[0]}x${rr.size[1]}) must match '${t.resource}' (${r.format} ${r.size[0]}x${r.size[1]})`);
          add({ resource: t.resolve, read: false, write: true, usage: 'color' });
        } else if (r && r.samples > 1 && t.storeOp === 'discard') {
          throw new TechniqueError(`${ctx}: '${t.resource}' is multisampled and discarded without a resolve target; its result would be lost`);
        }
        // a target names its mip level, so it can sit beside a binding of another mip of the same texture (a mip chain built by draws)
        add({ resource: t.resource, read: t.loadOp === 'load' || (t.blend ?? 'none') !== 'none', write: true, usage: 'color', ...(t.mip !== undefined ? { mips: [t.mip, 1] as [number, number] } : {}) });
      }
      if (node.depthTarget) {
        const r = resolved.get(node.depthTarget.resource) as ResolvedTexture | null;
        if (decl(node.depthTarget.resource).kind !== 'texture' || (r && !isDepthFormat(r.format))) throw new TechniqueError(`${ctx}: depth target '${node.depthTarget.resource}' must be a texture with a depth format`);
        attach(node.depthTarget.resource, r);
        add({ resource: node.depthTarget.resource, read: true, write: node.depthTarget.write !== false, usage: 'depth' });
      }
      const locations = new Set<number>();
      let perVertex: string | undefined;
      for (const [i, v] of (node.vertexBuffers ?? []).entries()) {
        const at = `vertexBuffers[${i}] ('${v.resource}')`;
        if (decl(v.resource).kind !== 'buffer') throw new TechniqueError(`${ctx}: ${at} must be a buffer`);
        const rb = resolved.get(v.resource) as ResolvedBuffer | null;
        const stride = v.arrayStride ?? rb?.stride;
        if (!v.attributes.length) throw new TechniqueError(`${ctx}: ${at} needs at least one attribute`);
        if (stride !== undefined && (!Number.isInteger(stride) || stride < 4 || stride % 4)) throw new TechniqueError(`${ctx}: ${at}: arrayStride ${stride} must be a multiple of 4`);
        if (v.offset !== undefined && (!Number.isInteger(v.offset) || v.offset < 0 || v.offset % 4)) throw new TechniqueError(`${ctx}: ${at}: offset ${v.offset} must be a multiple of 4`);
        for (const a of v.attributes) {
          const size = VERTEX_FORMAT_BYTES[a.format];
          if (size === undefined) throw new TechniqueError(`${ctx}: ${at}: unknown vertex format '${a.format}'`);
          if (!Number.isInteger(a.location) || a.location < 0 || a.location > 15) throw new TechniqueError(`${ctx}: ${at}: attribute location ${a.location} must be from 0 to 15`);
          if (locations.has(a.location)) throw new TechniqueError(`${ctx}: ${at}: @location(${a.location}) is used by two attributes`);
          locations.add(a.location);
          if (!Number.isInteger(a.offset) || a.offset < 0 || a.offset % Math.min(4, size)) throw new TechniqueError(`${ctx}: ${at}: attribute offset ${a.offset} is not aligned for ${a.format}`);
          if (stride !== undefined && a.offset + size > stride) throw new TechniqueError(`${ctx}: ${at}: ${a.format} at offset ${a.offset} does not fit in a ${stride}-byte element`);
        }
        if ((v.stepMode ?? 'vertex') === 'vertex') perVertex ??= v.resource;
        add({ resource: v.resource, read: true, write: false, usage: 'vertex' });
      }
      if (node.indexBuffer) {
        const ib = node.indexBuffer, at = `indexBuffer ('${ib.resource}')`;
        if (decl(ib.resource).kind !== 'buffer') throw new TechniqueError(`${ctx}: ${at} must be a buffer`);
        if (ib.format !== undefined && ib.format !== 'uint16' && ib.format !== 'uint32') throw new TechniqueError(`${ctx}: ${at}: format must be uint16 or uint32`);
        const size = ib.format === 'uint16' ? 2 : 4;
        if (ib.offset !== undefined && (!Number.isInteger(ib.offset) || ib.offset < 0 || ib.offset % size)) throw new TechniqueError(`${ctx}: ${at}: offset ${ib.offset} must be a multiple of ${size}`);
        add({ resource: ib.resource, read: true, write: false, usage: 'index' });
      } else if (node.indexCount !== undefined) throw new TechniqueError(`${ctx}: indexCount needs an indexBuffer`);
      if (node.baseVertex !== undefined && !node.indexBuffer) throw new TechniqueError(`${ctx}: baseVertex needs an indexBuffer`);
      if (node.indirect) {
        const at = `indirect ('${node.indirect.resource}')`;
        if (decl(node.indirect.resource).kind !== 'buffer') throw new TechniqueError(`${ctx}: ${at} must be a buffer`);
        const off = node.indirect.offset;
        if (off !== undefined && (!Number.isInteger(off) || off < 0 || off % 4)) throw new TechniqueError(`${ctx}: ${at}: offset ${off} must be a multiple of 4`);
        for (const k of ['vertexCount', 'indexCount', 'instanceCount', 'baseVertex'] as const) if (node[k] !== undefined) throw new TechniqueError(`${ctx}: ${k} is set but the draw is indirect (the arguments come from '${node.indirect.resource}')`);
        add({ resource: node.indirect.resource, read: true, write: false, usage: 'indirect' });
      } else if (node.vertexCount === undefined && !perVertex && !node.indexBuffer) throw new TechniqueError(`${ctx}: set vertexCount (a draw without an index buffer or a per-vertex vertex buffer cannot tell how many vertices to draw)`);
      bindings(node.bindings);
      break;
    }
    case 'copy': {
      const s = decl(node.source), d = decl(node.dest);
      if (s.kind !== d.kind) throw new TechniqueError(`${ctx}: cannot copy a ${s.kind} to a ${d.kind}`);
      const rs = resolved.get(node.source), rd = resolved.get(node.dest);
      if (rs && rd) {
        if (rs.kind === 'texture' && rd.kind === 'texture') {
          if (rs.format !== rd.format || rs.size.some((v, i) => v !== rd.size[i])) throw new TechniqueError(`${ctx}: copy needs textures of the same format and size (${rs.format} ${rs.size.join('x')} -> ${rd.format} ${rd.size.join('x')})`);
        } else if (resolvedBytes(rs) !== resolvedBytes(rd)) throw new TechniqueError(`${ctx}: copy needs buffers of the same size (${resolvedBytes(rs)} -> ${resolvedBytes(rd)} bytes)`);
      }
      if (node.source === node.dest) throw new TechniqueError(`${ctx}: a copy cannot read and write the same resource`);
      out.push({ resource: node.source, read: true, write: false, usage: 'copy-src' }, { resource: node.dest, read: false, write: true, usage: 'copy-dst' });
      break;
    }
    case 'callback':
      for (const r of node.reads ?? []) out.push({ resource: r, read: true, write: (node.writes ?? []).includes(r), usage: 'callback' });
      for (const r of node.writes ?? []) if (!(node.reads ?? []).includes(r)) out.push({ resource: r, read: false, write: true, usage: 'callback' });
      break;
  }
  return out;
}

const nodeKind = (node: FlatNode) => (node.type === 'compute' ? 'compute' : node.type === 'draw' ? 'render' : node.type === 'copy' ? 'copy' : 'callback') as 'compute' | 'render' | 'copy' | 'callback';

/** GPU uses implied by a node access on a resource of `kind`. */
function usesOf(access: NodeAccess): ResourceUse[] {
  switch (access.usage) {
    case 'sampled': return ['sampled'];
    case 'storage': return ['storage'];
    case 'color': case 'depth': return ['render'];
    case 'vertex': return ['vertex'];
    case 'index': return ['index'];
    case 'copy-src': return ['copy-src'];
    case 'copy-dst': return ['copy-dst'];
    case 'indirect': return ['indirect'];
    case 'callback': return ['sampled', 'render', 'copy-src', 'copy-dst'];
  }
}

/**
 * Compile a technique: flatten sub-graphs, resolve sizes from the variables, validate every node, derive dependencies from the declared
 * accesses, cull work nobody needs, order the rest, then plan resource lifetimes and share memory between transient resources.
 * Throws a {@link TechniqueError} for an invalid technique; softer problems are returned as `diagnostics`.
 */
export function compileTechnique(technique: Technique, options: CompileOptions = {}): CompiledTechnique {
  const graph = flatten(technique, { registry: options.registry, values: options.values });
  return compileFlat(graph, options);
}

/** Compile an already flattened graph. */
export function compileFlat(graph: FlatGraph, options: CompileOptions = {}): CompiledTechnique {
  const diagnostics: Diagnostic[] = [];
  const structural = new Set(graph.structural);
  for (const n of graph.nodes) for (const c of n.conditions) structural.add(c.variable);

  const resolved = resolveResources(graph);

  // nodes whose condition is false are removed before analysis
  const disabled: string[] = [];
  const switchedOff: FlatNode[] = [];
  const nodes = graph.nodes.filter((n) => { const ok = conditionsHold(n.conditions, graph.variables); if (!ok) { disabled.push(n.path); switchedOff.push(n); } return ok; });
  const accesses = nodes.map((n) => accessesOf(n, graph, resolved));
  const isRoot = (n: FlatNode, a: NodeAccess[]) => n.sideEffect === true || a.some((x) => {
    if (!x.write) return false;
    const d = graph.resources.get(x.resource)!.decl;
    return d.visibility === 'imported' || d.visibility === 'exported' || d.lifetime === 'persistent';
  });
  const analysis: AnalysisNode[] = nodes.map((n, i) => ({ name: n.path, kind: nodeKind(n), accesses: accesses[i], root: isRoot(n, accesses[i]) }));

  // imported and persistent resources carry contents in from outside the execution: reading one before a write sees those, not a later producer's
  const external = new Set<string>();
  for (const [name, r] of graph.resources) if (r.decl.visibility === 'imported' || r.decl.lifetime === 'persistent') external.add(name);
  const dependencies = dependenciesOf(analysis, external);
  const live = liveNodes(analysis, dependencies);
  const order = orderNodes(analysis, dependencies, live, options.order ?? 'declaration');
  const steps: CompiledStep[] = order.map((nodeIndex, index) => ({ index, node: nodes[nodeIndex], accesses: accesses[nodeIndex] }));
  const culled = nodes.filter((_, i) => !live.has(i)).map((n) => n.path);

  // lifetimes
  const resources = new Map<string, ResourcePlan>();
  for (const [name, r] of graph.resources) {
    const decl = r.decl;
    resources.set(name, {
      name, decl, visibility: decl.visibility ?? 'internal', lifetime: decl.lifetime ?? 'transient', resolved: resolved.get(name) ?? null,
      first: -1, last: -1, uses: new Set(), slot: -1, bytes: resolvedBytes(resolved.get(name) ?? null),
    });
  }
  for (const step of steps) for (const access of step.accesses) {
    const plan = resources.get(access.resource)!;
    if (plan.first < 0) plan.first = step.index;
    plan.last = step.index;
    for (const use of usesOf(access)) plan.uses.add(use);
  }
  // Nodes a condition switched off may run after the next variable change. Their uses are part of the allocation too, so toggling a node on or
  // off never has to replace a texture (the host may hold views of exported ones).
  for (const node of switchedOff) {
    for (const access of accessesOf(node, graph, resolved)) {
      const plan = resources.get(access.resource)!;
      if (plan.first >= 0) for (const use of usesOf(access)) plan.uses.add(use);
    }
  }
  // the host may read an exported resource back or bind it (a material samples an exported texture, a copy reads it)
  for (const plan of resources.values()) if (plan.visibility === 'exported' && plan.first >= 0) { plan.uses.add('copy-src'); plan.uses.add('sampled'); }

  // transient contents are undefined at the start of an execution: reading one before it was written is almost always a mistake
  for (const plan of resources.values()) {
    if (plan.visibility !== 'internal' || plan.lifetime !== 'transient' || plan.first < 0) continue;
    const firstStep = steps[plan.first], a = firstStep.accesses.find((x) => x.resource === plan.name)!;
    if (a.read) diagnostics.push({ level: 'warning', message: `'${plan.name}' is read by '${firstStep.node.path}' before any node writes it; transient contents are undefined (make it persistent, or write it first)` });
  }
  const unused = [...resources.values()].filter((p) => p.first < 0).map((p) => p.name);
  for (const name of unused) {
    const v = resources.get(name)!.visibility;
    if (v === 'internal') diagnostics.push({ level: 'warning', message: `resource '${name}' is declared but no node uses it` });
  }

  // memory: imported resources are the host's; persistent / exported ones get their own allocation; transient internal ones are aliased
  const slots: Slot[] = [];
  const perSignature = new Map<string, number>();
  const addSlot = (signature: string, plan: ResourcePlan): Slot => {
    const n = perSignature.get(signature) ?? 0;
    perSignature.set(signature, n + 1);
    const slot: Slot = { index: slots.length, key: `${signature}#${n}`, signature, resources: [plan.name], uses: new Set(plan.uses), bytes: plan.bytes };
    slots.push(slot); plan.slot = slot.index;
    return slot;
  };
  const keyOf = (plan: ResourcePlan) => {
    const r = plan.resolved!;
    return r.kind === 'texture' ? `t|${r.dimension}|${r.format}|${r.size.join('x')}|${r.mips}${r.samples > 1 ? `|x${r.samples}` : ''}` : `b|${r.stride * r.count}`;
  };
  const candidates = [...resources.values()].filter((p) => p.visibility !== 'imported' && p.first >= 0);
  let unaliased = 0;
  const ends = new Map<number, number>();
  for (const plan of candidates.sort((a, b) => a.first - b.first)) {
    if (!plan.resolved) throw new TechniqueError(`resource '${plan.name}' has no size`);
    unaliased += plan.bytes;
    const aliasable = options.alias !== false && plan.visibility === 'internal' && plan.lifetime === 'transient';
    const key = keyOf(plan);
    const reuse = aliasable ? slots.find((s) => s.signature === key && s.resources.every((n) => resources.get(n)!.visibility === 'internal' && resources.get(n)!.lifetime === 'transient') && (ends.get(s.index) ?? Infinity) < plan.first) : undefined;
    if (reuse) {
      reuse.resources.push(plan.name); plan.slot = reuse.index;
      for (const u of plan.uses) reuse.uses.add(u);
    } else addSlot(aliasable ? key : `${key}|own:${plan.name}`, plan);
    ends.set(plan.slot, plan.last);
  }
  const bytesAliased = slots.reduce((sum, s) => sum + s.bytes, 0);

  const cost = orderCost(analysis, order), declared = orderCost(analysis, [...live].sort((a, b) => a - b));
  return {
    name: graph.name, steps, resources, slots, variables: graph.variables, structural, culled, disabled, unused, diagnostics,
    stats: { nodes: graph.nodes.length, live: steps.length, transitions: cost.transitions, declaredTransitions: declared.transitions, kindSwitches: cost.kindSwitches, bytes: unaliased, bytesAliased, slots: slots.length },
  };
}

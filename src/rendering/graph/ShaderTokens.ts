import type { CompiledTechnique, ResolvedTexture } from './Compile';
import type { FlatNode, FlatVariable } from './Flatten';
import { TechniqueError, type BindingDecl, type ComputeNode, type DrawNode, type TextureDecl } from './TechniqueTypes';

/**
 * Shader tokens (the Gigi way: the compiler is mostly string replacement). WGSL source in a node may contain, inside block comments:
 *
 *   `$(Variable:name)`  ->  `gigi.name`, a field of a generated uniform struct (only the variables a shader mentions are included)
 *   `$(Size:resource)`  ->  the resource's size as a constant: `vec3<u32>(w, h, d)` for textures, `<count>u` for buffers
 *   `$(Bindings)`       ->  the generated declarations: the variables uniform and one `@group(g) @binding(n) var ...` per node binding (g = the node's `group`, default 0)
 *
 * Without a `$(Bindings)` token the declarations are put in front of the source. A texture binding named `src` with a sampler also
 * gets `src_sampler`. Names in tokens are those of the technique the node was written in (sub-graph renames are handled for you).
 */

const TOKEN = /\/\*\$\(\s*([A-Za-z]+)\s*(?::\s*([^)]*?))?\s*\)\*\//g;

export interface UniformMember { name: string; flat: string; type: 'i32' | 'u32' | 'f32' | 'vec4<f32>'; offset: number; }
export interface UniformLayout { members: UniformMember[]; size: number; }

/** One declared binding with its WGSL slot. */
export interface BindingSlot {
  /** `@group` and `@binding` of the declaration. */
  group: number;
  binding: number;
  /** `variables`: the generated uniform; `resource`: a node binding; `sampler`: the sampler that goes with a texture binding. */
  kind: 'variables' | 'resource' | 'sampler';
  decl?: BindingDecl;
  /** WGSL name. */
  name: string;
}

export interface ExpandedShader {
  code: string;
  slots: BindingSlot[];
  uniform: UniformLayout | null;
}

const WGSL_TYPE: Record<string, UniformMember['type']> = { int: 'i32', uint: 'u32', float: 'f32', float4: 'vec4<f32>' };

/** Layout of the variables a shader uses, as WGSL lays out a uniform struct (vec4 members align to 16). */
function layoutUniform(variables: { local: string; flat: string; variable: FlatVariable }[]): UniformLayout {
  let offset = 0, align = 4;
  const members: UniformMember[] = variables.map(({ local, flat, variable }) => {
    const type = WGSL_TYPE[variable.decl.type], a = type === 'vec4<f32>' ? 16 : 4, size = type === 'vec4<f32>' ? 16 : 4;
    offset = Math.ceil(offset / a) * a;
    align = Math.max(align, a);
    const m: UniformMember = { name: local, flat, type, offset };
    offset += size;
    return m;
  });
  return { members, size: Math.max(16, Math.ceil(offset / Math.max(align, 16)) * Math.max(align, 16)) };
}

/** Write the current values of `layout`'s variables into `data`. */
export function writeUniform(layout: UniformLayout, variables: Map<string, FlatVariable>, data: DataView): void {
  for (const m of layout.members) {
    const v = variables.get(m.flat)!.value;
    if (m.type === 'vec4<f32>') for (let i = 0; i < 4; i++) data.setFloat32(m.offset + i * 4, (v as number[])[i], true);
    else if (m.type === 'f32') data.setFloat32(m.offset, v as number, true);
    else if (m.type === 'i32') data.setInt32(m.offset, v as number, true);
    else data.setUint32(m.offset, v as number >>> 0, true);
  }
}

/** WGSL texture sample type of a format, as the bind group layout needs it. */
export function sampleTypeOf(format: GPUTextureFormat): GPUTextureSampleType {
  if (format.startsWith('depth')) return 'depth';
  if (format.endsWith('uint')) return 'uint';
  if (format.endsWith('sint')) return 'sint';
  if (format === 'r32float' || format === 'rg32float' || format === 'rgba32float') return 'unfilterable-float';
  return 'float';
}

const VIEW: Record<string, string> = { '2d': '2d', '2d-array': '2d_array', '3d': '3d', cube: 'cube' };

/** WGSL declaration of one binding. */
function declare(slot: BindingSlot, plan: CompiledTechnique, node: ComputeNode | DrawNode, ctx: string): string {
  const at = `@group(${slot.group}) @binding(${slot.binding})`;
  if (slot.kind === 'sampler') return `${at} var ${slot.name}: sampler;`;
  const b = slot.decl!;
  const p = plan.resources.get(b.resource)!;
  if (p.decl.kind === 'buffer') {
    const element = (p.resolved?.kind === 'buffer' ? p.resolved.element : (p.decl.element ?? 'u32'));
    if (node.type === 'draw' && b.access !== 'read') throw new TechniqueError(`${ctx}: draw nodes can only read buffers ('${b.resource}')`);
    if (b.uniform) return `${at} var<uniform> ${slot.name}: ${element};`;
    return `${at} var<storage, ${b.access === 'read' ? 'read' : 'read_write'}> ${slot.name}: array<${element}>;`;
  }
  const decl = p.decl as TextureDecl;
  const r = p.resolved as ResolvedTexture | null;
  const format = decl.format ?? r?.format;
  const dimension = decl.dimension ?? r?.dimension ?? '2d';
  if (!format) throw new TechniqueError(`${ctx}: texture '${b.resource}' needs a format to be bound`);
  if (b.access === 'read') {
    const st = sampleTypeOf(format);
    if ((r?.samples ?? decl.samples ?? 1) > 1) {
      if (st === 'depth') return `${at} var ${slot.name}: texture_depth_multisampled_2d;`;
      return `${at} var ${slot.name}: texture_multisampled_2d<${st === 'uint' ? 'u32' : st === 'sint' ? 'i32' : 'f32'}>;`;
    }
    if (st === 'depth') return `${at} var ${slot.name}: texture_depth_${VIEW[dimension]};`;
    const scalar = st === 'uint' ? 'u32' : st === 'sint' ? 'i32' : 'f32';
    return `${at} var ${slot.name}: texture_${VIEW[dimension]}<${scalar}>;`;
  }
  if (node.type === 'draw') throw new TechniqueError(`${ctx}: draw nodes can only read textures ('${b.resource}')`);
  if (dimension === 'cube') throw new TechniqueError(`${ctx}: cube textures cannot be storage textures ('${b.resource}')`);
  return `${at} var ${slot.name}: texture_storage_${VIEW[dimension]}<${format}, ${b.access === 'write' ? 'write' : 'read_write'}>;`;
}

/** Replace the tokens of a node's shader and generate its bindings. */
export function expandShader(node: FlatNode & { type: 'compute' | 'draw' }, plan: CompiledTechnique): ExpandedShader {
  const ctx = `node '${node.path}'`;
  const used: { local: string; flat: string; variable: FlatVariable }[] = [];
  const sizeOf = (local: string): string => {
    const flat = node.scope.resources[local];
    const p = flat === undefined ? undefined : plan.resources.get(flat);
    if (!p) throw new TechniqueError(`${ctx}: $(Size:${local}) names an unknown resource`);
    if (!p.resolved) throw new TechniqueError(`${ctx}: $(Size:${local}) needs a resource with a known size (declare size on the imported resource)`);
    if (p.resolved.kind === 'buffer') return `${p.resolved.count}u`;
    const [w, h, d] = p.resolved.size;
    return `vec3<u32>(${w}u, ${h}u, ${d}u)`;
  };
  // pass 1: find the variables the shader mentions, in order of first use
  for (const m of node.shader.code.matchAll(TOKEN)) {
    if (m[1] !== 'Variable') continue;
    const local = m[2] ?? '';
    const flat = node.scope.variables[local];
    if (flat === undefined) throw new TechniqueError(`${ctx}: $(Variable:${local}) names an unknown variable`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(local)) throw new TechniqueError(`${ctx}: variable '${local}' is not a valid WGSL identifier`);
    if (!used.some((u) => u.local === local)) used.push({ local, flat, variable: plan.variables.get(flat)! });
  }
  const uniform = used.length ? layoutUniform(used) : null;

  // binding numbers count up inside each group; the variables uniform is binding 0 of the node's default group
  const slots: BindingSlot[] = [];
  const nextBinding = new Map<number, number>();
  const take = (group: number): number => { const n = nextBinding.get(group) ?? 0; nextBinding.set(group, n + 1); return n; };
  const defaultGroup = node.group ?? 0;
  if (uniform) slots.push({ group: defaultGroup, binding: take(defaultGroup), kind: 'variables', name: 'gigi' });
  for (const b of node.bindings) {
    const name = b.name ?? b.resource.replace(/[^A-Za-z0-9_]/g, '_'), group = b.group ?? defaultGroup;
    slots.push({ group, binding: take(group), kind: 'resource', decl: b, name });
    if (b.sampler) slots.push({ group, binding: take(group), kind: 'sampler', decl: b, name: `${name}_sampler` });
  }
  const declarations: string[] = [];
  if (uniform) {
    declarations.push(`struct GigiVariables {\n${uniform.members.map((m) => `  ${m.name}: ${m.type},`).join('\n')}\n}`);
    declarations.push(`@group(${defaultGroup}) @binding(0) var<uniform> gigi: GigiVariables;`);
  }
  for (const slot of slots) if (slot.kind !== 'variables') declarations.push(declare(slot, plan, node, ctx));
  const block = declarations.join('\n');

  let hasBindings = false;
  let code = node.shader.code.replace(TOKEN, (_all, kind: string, arg: string | undefined) => {
    switch (kind) {
      case 'Variable': return `gigi.${arg}`;
      case 'Size': return sizeOf(arg ?? '');
      case 'Bindings': hasBindings = true; return block;
      default: throw new TechniqueError(`${ctx}: unknown shader token $(${kind})`);
    }
  });
  if (!hasBindings) code = `${block}\n${code}`;
  return { code, slots, uniform };
}

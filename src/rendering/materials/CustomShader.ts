import type { ParamSchemaEntry, ParamType, ParamValues } from './Material';

export interface ParamLayoutEntry { name: string; type: ParamType; /** offset in floats */ offset: number; size: number; }
export interface ParamLayout { entries: ParamLayoutEntry[]; /** size in vec4s */ vec4Count: number; }

const SIZE: Record<ParamType, number> = { f32: 1, vec2: 2, vec3: 3, vec4: 4 };
const ALIGN: Record<ParamType, number> = { f32: 1, vec2: 2, vec3: 4, vec4: 4 };
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Pack parameters into vec4 slots without ever straddling a vec4 boundary:
 * f32 align 1, vec2 align 2, vec3/vec4 align 4. Deterministic and WGSL-accessor friendly.
 */
export function layoutParams(schema: ParamSchemaEntry[]): ParamLayout {
  const entries: ParamLayoutEntry[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  for (const p of schema) {
    if (!IDENT.test(p.name)) throw new Error(`Invalid parameter name '${p.name}'`);
    if (seen.has(p.name)) throw new Error(`Duplicate parameter '${p.name}'`);
    seen.add(p.name);
    const a = ALIGN[p.type];
    cursor = Math.ceil(cursor / a) * a;
    entries.push({ name: p.name, type: p.type, offset: cursor, size: SIZE[p.type] });
    cursor += SIZE[p.type];
  }
  return { entries, vec4Count: Math.max(1, Math.ceil(cursor / 4)) };
}

/** Write `values` into `out` (float array) at float offset `base`. Missing values keep their previous contents. */
export function packParams(layout: ParamLayout, values: ParamValues, out: Float32Array, base: number): void {
  for (const e of layout.entries) {
    const v = values[e.name];
    if (v === undefined) continue;
    const arr = typeof v === 'number' ? [v] : v;
    if (arr.length !== e.size) throw new Error(`Parameter '${e.name}' expects ${e.size} component(s), got ${arr.length}`);
    for (let k = 0; k < e.size; k++) out[base + e.offset + k] = arr[k];
  }
}

const COMP = ['x', 'y', 'z', 'w'];

/** WGSL accessors `param_<name>(base: u32)`; `base` = materials[i].paramBase. */
export function generateParamAccessors(layout: ParamLayout): string {
  let src = '';
  for (const e of layout.entries) {
    const slot = Math.floor(e.offset / 4), c = e.offset % 4;
    const sw = COMP.slice(c, c + e.size).join('');
    const ty = e.type === 'f32' ? 'f32' : `vec${e.size}<f32>`;
    const access = e.type === 'vec4' ? '' : `.${sw}`;
    src += `fn param_${e.name}(base: u32) -> ${ty} { return paramVec4(base + ${slot}u)${access}; }\n`;
  }
  return src;
}

/** Static validation of user WGSL (contract enforcement). Returns a list of human-readable errors. */
export function validateCustomShader(wgsl: string, vertexEntry: string, fragmentEntry: string, extraEntries: string[] = []): string[] {
  const errors: string[] = [];
  const stripped = wgsl.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/@\s*group\s*\(/.test(stripped)) errors.push('Custom shaders must not declare @group resources; use the engine binding contract.');
  if (/@\s*binding\s*\(/.test(stripped)) errors.push('Custom shaders must not declare @binding resources; use the engine binding contract.');
  /** True if the source declares entry point `name` for shader stage `stage`. */
  const hasEntry = (stage: string, name: string) => new RegExp(`@\\s*${stage}[^{;]*?\\bfn\\s+${name}\\s*\\(`).test(stripped);
  if (!hasEntry('vertex', vertexEntry)) errors.push(`Missing @vertex entry point '${vertexEntry}'.`);
  if (!hasEntry('fragment', fragmentEntry)) errors.push(`Missing @fragment entry point '${fragmentEntry}'.`);
  for (const e of extraEntries) if (!hasEntry('vertex', e)) errors.push(`Missing @vertex entry point '${e}'.`);
  return errors;
}

/** FNV-1a 32-bit hash -> hex (shader identity for dedupe). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

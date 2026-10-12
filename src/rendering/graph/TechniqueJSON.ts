import { TechniqueError, type Technique } from './TechniqueTypes';

/**
 * Techniques as files. `techniqueToJSON` / `parseTechnique` round-trip everything except callback nodes (which hold code). Parsing
 * checks the shape strictly, naming the path of the first problem: misspelt keys, wrong enum values and missing fields are errors, so
 * a hand-edited file fails with a message instead of misbehaving on the GPU.
 */

type Spec = { [key: string]: Rule };
type Rule =
  | 'string' | 'number' | 'boolean' | 'any' | 'object' | 'size' | 'samples' | 'string[]' | 'number[]' | 'size[]'
  | { enum: readonly string[] }
  | { list: Spec; key?: string }
  | { object: Spec }
  | { record: Rule }
  | { optional: Rule }
  | { oneOf: Rule[]; label: string };

const opt = (r: Rule): Rule => ({ optional: r });
const SIZE_DIM: Rule = 'size';

const BINDING: Spec = { resource: 'string', access: { enum: ['read', 'write', 'readwrite'] }, name: opt('string'), sampler: opt({ enum: ['nearest', 'linear'] }), mip: opt('number'), mipCount: opt('number'),
  group: opt('number'), uniform: opt('boolean'), dynamicOffset: opt('boolean'), size: opt('number'),
};
const CONDITION: Spec = { variable: 'string', op: { enum: ['eq', 'ne', 'lt', 'le', 'gt', 'ge'] }, value: 'number' };
const VERTEX_BUFFER: Spec = {
  resource: 'string', stepMode: opt({ enum: ['vertex', 'instance'] }), arrayStride: opt('number'), offset: opt('number'),
  attributes: { list: { location: 'number', format: 'string', offset: 'number' } },
};
const HOST_GROUPS: Rule = { list: { group: 'number', layout: 'string' } };
const NODE_BASE: Spec = { name: 'string', condition: opt({ object: CONDITION }), sideEffect: opt('boolean') };

const NODE_SPECS: Record<string, Spec> = {
  compute: {
    ...NODE_BASE, type: 'string', shader: { object: { code: 'string' } }, entryPoint: opt('string'), workgroupSize: opt('number[]'), group: opt('number'), hostGroups: opt(HOST_GROUPS),
    bindings: { list: BINDING }, dispatch: { oneOf: [{ object: { threads: 'size[]' } }, { object: { like: 'string' } }, { object: { indirect: 'string', offset: opt('number') } }], label: 'threads / like / indirect' },
  },
  draw: {
    ...NODE_BASE, type: 'string', shader: { object: { code: 'string' } }, vertexEntry: opt('string'), fragmentEntry: opt('string'), bindings: { list: BINDING }, group: opt('number'), hostGroups: opt(HOST_GROUPS),
    colorTargets: { list: { resource: 'string', loadOp: opt({ enum: ['clear', 'load'] }), clearValue: opt('number[]'), blend: opt({ enum: ['none', 'alpha', 'additive'] }), mip: opt('number'), layer: opt('number'), resolve: opt('string'), storeOp: opt({ enum: ['store', 'discard'] }) } },
    depthTarget: opt({ object: { resource: 'string', loadOp: opt({ enum: ['clear', 'load'] }), clearValue: opt('number'), compare: opt('string'), write: opt('boolean') } }),
    vertexBuffers: opt({ list: VERTEX_BUFFER }), indexBuffer: opt({ object: { resource: 'string', format: opt({ enum: ['uint16', 'uint32'] }), offset: opt('number') } }), indexCount: opt(SIZE_DIM), baseVertex: opt(SIZE_DIM), indirect: opt({ object: { resource: 'string', offset: opt('number') } }),
    vertexCount: opt(SIZE_DIM), instanceCount: opt(SIZE_DIM), topology: opt('string'), cullMode: opt({ enum: ['none', 'front', 'back'] }),
  },
  copy: { ...NODE_BASE, type: 'string', source: 'string', dest: 'string' },
  subgraph: {
    ...NODE_BASE, type: 'string', technique: { oneOf: ['string', 'object'], label: 'a technique name or an inline technique' },
    inputs: opt({ record: 'string' }), outputs: opt({ record: 'string' }),
    variables: opt({ record: { oneOf: [{ object: { bind: 'string' } }, { object: { value: 'any' } }], label: '{ bind } or { value }' } }),
    loop: opt({ oneOf: ['number', { object: { variable: 'string' } }], label: 'a count or { variable }' }),
  },
};

const TEXTURE_SPEC: Spec = {
  kind: 'string', name: 'string', visibility: opt({ enum: ['imported', 'internal', 'exported'] }), lifetime: opt({ enum: ['transient', 'persistent'] }), like: opt('string'), scale: opt('number'),
  dimension: opt({ enum: ['2d', '2d-array', '3d', 'cube'] }), format: opt('string'), size: opt('size[]'), mips: opt({ oneOf: ['number', { enum: ['full'] }], label: 'a count or "full"' }),
  samples: opt('samples'),
};
const BUFFER_SPEC: Spec = {
  kind: 'string', name: 'string', visibility: opt({ enum: ['imported', 'internal', 'exported'] }), lifetime: opt({ enum: ['transient', 'persistent'] }), like: opt('string'), scale: opt('number'),
  element: opt('string'), stride: opt('number'), count: opt(SIZE_DIM),
};
const VARIABLE_SPEC: Spec = { name: 'string', type: { enum: ['int', 'uint', 'float', 'float4'] }, value: opt({ oneOf: ['number', 'number[]'], label: 'a number or an array of numbers' }), visibility: opt({ enum: ['user', 'host', 'internal'] }) };

const fail = (path: string, message: string): never => { throw new TechniqueError(`${path}: ${message}`); };
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Check `value` against `rule`; `path` names it in errors. */
function check(value: unknown, rule: Rule, path: string): void {
  if (typeof rule === 'string') {
    switch (rule) {
      case 'any': return;
      case 'object': if (!isObject(value)) fail(path, 'expected an object'); return;
      case 'string': if (typeof value !== 'string' || value === '') fail(path, 'expected a non-empty string'); return;
      case 'number': if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'expected a number'); return;
      case 'boolean': if (typeof value !== 'boolean') fail(path, 'expected true or false'); return;
      case 'size':
        if (typeof value === 'number' && Number.isFinite(value)) return;
        if (isObject(value) && typeof value.variable === 'string') { checkKeys(value, { variable: 'string', scale: opt('number'), offset: opt('number') }, path); return; }
        return fail(path, 'expected a number or { variable, scale?, offset? }');
      case 'samples': if (value !== 1 && value !== 4) fail(path, 'expected 1 or 4 (WebGPU sample counts)'); return;
      case 'string[]': if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) fail(path, 'expected an array of strings'); return;
      case 'number[]': if (!Array.isArray(value) || value.some((v) => typeof v !== 'number' || !Number.isFinite(v))) fail(path, 'expected an array of numbers'); return;
      case 'size[]': if (!Array.isArray(value)) fail(path, 'expected an array of sizes'); (value as unknown[]).forEach((v, i) => check(v, 'size', `${path}[${i}]`)); return;
    }
  }
  if ('optional' in rule) { if (value !== undefined) check(value, rule.optional, path); return; }
  if ('enum' in rule) { if (typeof value !== 'string' || !rule.enum.includes(value)) fail(path, `expected one of ${rule.enum.map((e) => `"${e}"`).join(', ')}`); return; }
  if ('list' in rule) {
    if (!Array.isArray(value)) return fail(path, 'expected an array');
    (value as unknown[]).forEach((v, i) => checkKeys(v, rule.list, `${path}[${i}]`));
    return;
  }
  if ('object' in rule) { checkKeys(value, rule.object, path); return; }
  if ('record' in rule) {
    if (!isObject(value)) return fail(path, 'expected an object');
    for (const [k, v] of Object.entries(value)) check(v, rule.record, `${path}.${k}`);
    return;
  }
  const errors: string[] = [];
  for (const r of rule.oneOf) { try { check(value, r, path); return; } catch (e) { errors.push((e as Error).message); } }
  fail(path, `expected ${rule.label}`);
}

/** Check an object against a field table: required fields present and valid, no unknown fields. */
function checkKeys(value: unknown, spec: Spec, path: string): void {
  if (!isObject(value)) return fail(path, 'expected an object');
  for (const k of Object.keys(value)) if (!(k in spec)) fail(`${path}.${k}`, `unknown field (allowed: ${Object.keys(spec).join(', ')})`);
  for (const [k, rule] of Object.entries(spec)) {
    const optional = typeof rule === 'object' && 'optional' in rule;
    if (value[k] === undefined && !optional) fail(`${path}.${k}`, 'required field is missing');
    check(value[k], rule, `${path}.${k}`);
  }
}

/** Validate untrusted data (a parsed JSON file) and return it as a {@link Technique}. Throws a {@link TechniqueError} naming the first problem. */
export function parseTechnique(data: unknown, path = 'technique'): Technique {
  if (!isObject(data)) return fail(path, 'expected an object');
  for (const k of Object.keys(data)) if (!['name', 'variables', 'resources', 'nodes'].includes(k)) fail(`${path}.${k}`, 'unknown field (allowed: name, variables, resources, nodes)');
  check(data.name, 'string', `${path}.name`);
  check(data.variables, opt({ list: VARIABLE_SPEC }), `${path}.variables`);
  if (data.resources !== undefined && !Array.isArray(data.resources)) fail(`${path}.resources`, 'expected an array');
  ((data.resources as Record<string, unknown>[] | undefined) ?? []).forEach((r, i) => {
    const at = `${path}.resources[${i}]`;
    if (!isObject(r) || (r.kind !== 'texture' && r.kind !== 'buffer')) fail(`${at}.kind`, 'expected "texture" or "buffer"');
    checkKeys(r, r.kind === 'texture' ? TEXTURE_SPEC : BUFFER_SPEC, at);
  });
  if (!Array.isArray(data.nodes)) fail(`${path}.nodes`, 'expected an array');
  (data.nodes as Record<string, unknown>[]).forEach((n, i) => {
    const at = `${path}.nodes[${i}]`;
    const spec = isObject(n) ? NODE_SPECS[n.type as string] : undefined;
    if (!spec) return fail(`${at}.type`, `expected one of ${Object.keys(NODE_SPECS).map((t) => `"${t}"`).join(', ')} (callback nodes hold code and cannot come from a file, and neither can render nodes)`);
    checkKeys(n, spec, at);
    if (n.type === 'subgraph' && isObject(n.technique)) n.technique = parseTechnique(n.technique, `${at}.technique`);
  });
  return data as unknown as Technique;
}

/** Serialize a technique. Throws if it contains callback nodes (code cannot be stored). */
export function techniqueToJSON(technique: Technique, space = 2): string {
  const visit = (t: Technique, path: string) => {
    t.nodes.forEach((n, i) => {
      if (n.type === 'callback' || n.type === 'render') throw new TechniqueError(`${path}.nodes[${i}] ('${n.name}') is a ${n.type} node and cannot be serialized`);
      if (n.type === 'subgraph' && typeof n.technique !== 'string') visit(n.technique, `${path}.nodes[${i}].technique`);
    });
  };
  visit(technique, 'technique');
  return JSON.stringify(technique, null, space);
}

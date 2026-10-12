import {
  TechniqueError, type BindingDecl, type CallbackNode, type ComputeNode, type ClearNode, type CopyNode, type DrawNode, type RenderPassNode, type NodeCondition, type NodeDecl, type ResourceDecl,
  type SizeDim, type SubGraphNode, type Technique, type TechniqueRegistry, type VariableDecl,
} from './TechniqueTypes';

export type VariableValue = number | number[];

export interface FlatVariable { name: string; decl: VariableDecl; value: VariableValue; }
export interface FlatResource { name: string; decl: ResourceDecl; }
/** A leaf node with every resource and variable name replaced by its name in the flattened graph. */
export type FlatNode = (ComputeNode | DrawNode | CopyNode | ClearNode | CallbackNode | RenderPassNode) & {
  /** Path of the node through the sub-graphs it came from, e.g. `blur#1/horizontal`. */
  path: string;
  /** All conditions that must hold: the node's own and those of the sub-graph nodes around it. */
  conditions: NodeCondition[];
  /** The names the node's own source uses (as declared in its technique) -> flat names; shader tokens such as `$(Variable:radius)` are written in these. */
  scope: { variables: Record<string, string>; resources: Record<string, string> };
};

export interface FlatGraph {
  name: string;
  variables: Map<string, FlatVariable>;
  resources: Map<string, FlatResource>;
  nodes: FlatNode[];
  /** Variables read while flattening (loop counts); a change needs a recompile. */
  structural: Set<string>;
}

export interface FlattenOptions {
  registry?: TechniqueRegistry;
  /** Replace default variable values (top-level technique only), by name. */
  values?: Record<string, VariableValue>;
}

const MAX_DEPTH = 16;
const MAX_LOOP = 4096;

/** Default value of a variable of `decl.type`. */
export function defaultValue(decl: VariableDecl): VariableValue {
  if (decl.type === 'float4') {
    const v = decl.value;
    return Array.isArray(v) ? [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0, v[3] ?? 0] : [0, 0, 0, 0];
  }
  const v = Array.isArray(decl.value) ? decl.value[0] : decl.value;
  return decl.type === 'float' ? (v ?? 0) : Math.trunc(v ?? 0);
}

/**
 * Inline every sub-graph node into one flat list of leaf nodes (Gigi's "flattening"): loops are unrolled, sub-graph imports and exports
 * are replaced by the parent's resources, variable bindings by the parent's variables, everything else gets a path-qualified name.
 */
export function flatten(technique: Technique, options: FlattenOptions = {}): FlatGraph {
  const graph: FlatGraph = { name: technique.name, variables: new Map(), resources: new Map(), nodes: [], structural: new Set() };
  inline(graph, technique, '', new Map(), new Map(), [], false, options, 0, [technique.name]);
  return graph;
}

/** Add `technique` to `graph`. `importMap` / `varMap` map the technique's resource / variable names to existing flat names. */
function inline(
  graph: FlatGraph, technique: Technique, prefix: string, importMap: Map<string, string>, varMap: Map<string, string>,
  inherited: NodeCondition[], keepAll: boolean, options: FlattenOptions, depth: number, stack: string[],
): void {
  if (depth > MAX_DEPTH) throw new TechniqueError(`Sub-graphs are nested more than ${MAX_DEPTH} deep: ${stack.join(' > ')}`);
  const where = `technique '${technique.name}'`;

  // variables: bound to a parent variable, or new (path-qualified) with their default / overridden value
  const variable = new Map<string, string>();
  for (const decl of technique.variables ?? []) {
    if (variable.has(decl.name)) throw new TechniqueError(`${where}: variable '${decl.name}' is declared twice`);
    const bound = varMap.get(decl.name);
    if (bound !== undefined) { variable.set(decl.name, bound); continue; }
    const name = prefix + decl.name;
    const override = depth === 0 ? options.values?.[decl.name] : undefined;
    graph.variables.set(name, { name, decl: { ...decl, name }, value: override !== undefined ? coerce(decl, override) : defaultValue(decl) });
    variable.set(decl.name, name);
  }
  if (depth === 0) for (const k of Object.keys(options.values ?? {})) if (!variable.has(k)) throw new TechniqueError(`${where}: no variable named '${k}'`);

  // resources: imports / exports come from the parent, the rest are owned by this instance of the technique
  const resource = new Map<string, string>();
  for (const decl of technique.resources ?? []) {
    if (resource.has(decl.name)) throw new TechniqueError(`${where}: resource '${decl.name}' is declared twice`);
    const parent = importMap.get(decl.name);
    if (parent !== undefined) {
      const existing = graph.resources.get(parent);
      if (!existing) throw new TechniqueError(`${where}: resource '${decl.name}' is mapped to '${parent}', which does not exist`);
      if (existing.decl.kind !== decl.kind) throw new TechniqueError(`${where}: resource '${decl.name}' is a ${decl.kind} but '${parent}' is a ${existing.decl.kind}`);
      if (decl.kind === 'texture' && existing.decl.kind === 'texture' && decl.format && existing.decl.format && decl.format !== existing.decl.format) {
        throw new TechniqueError(`${where}: texture '${decl.name}' expects ${decl.format} but '${parent}' is ${existing.decl.format}`);
      }
      resource.set(decl.name, parent);
      continue;
    }
    if (depth > 0 && decl.visibility === 'imported') throw new TechniqueError(`${where}: imported resource '${decl.name}' has no input in the sub-graph node`);
    resource.set(decl.name, prefix + decl.name);
  }
  for (const decl of technique.resources ?? []) {
    const name = resource.get(decl.name)!;
    if (graph.resources.has(name)) continue;                           // mapped to a parent resource: the parent's declaration stands
    // a sub-graph's exported resource that the parent did not claim becomes an ordinary internal one
    const visibility = depth > 0 && decl.visibility === 'exported' ? 'internal' : decl.visibility;
    const like = decl.like !== undefined ? mapResource(resource, decl.like, `${where}, resource '${decl.name}'`) : undefined;
    graph.resources.set(name, { name, decl: { ...decl, name, visibility, ...(like !== undefined ? { like } : {}), ...mapResourceDims(decl, variable, graph, where) } as ResourceDecl });
  }

  const seen = new Set<string>();
  for (const node of technique.nodes) {
    if (seen.has(node.name)) throw new TechniqueError(`${where}: node '${node.name}' is declared twice`);
    seen.add(node.name);
    const ctx = `${where}, node '${node.name}'`;
    const conditions = [...inherited, ...(node.condition ? [mapCondition(node.condition, variable, ctx)] : [])];
    if (node.type === 'subgraph') { inlineSubgraph(graph, node, prefix, resource, variable, conditions, keepAll || node.sideEffect === true, options, depth, stack, ctx); continue; }
    graph.nodes.push({
      ...mapNode(node, resource, variable, ctx), ...(node.after ? { after: node.after.map((r) => mapResource(resource, r, ctx)) } : {}), name: prefix + node.name, path: prefix + node.name, conditions, sideEffect: keepAll || node.sideEffect === true,
      scope: { variables: Object.fromEntries(variable), resources: Object.fromEntries(resource) },
    } as FlatNode);
  }
}

/** Unroll one sub-graph node. */
function inlineSubgraph(
  graph: FlatGraph, node: SubGraphNode, prefix: string, resource: Map<string, string>, variable: Map<string, string>,
  conditions: NodeCondition[], keepAll: boolean, options: FlattenOptions, depth: number, stack: string[], ctx: string,
): void {
  const sub = typeof node.technique === 'string' ? options.registry?.[node.technique] : node.technique;
  if (!sub) throw new TechniqueError(`${ctx}: no technique named '${node.technique as string}' in the registry`);
  if (stack.includes(sub.name)) throw new TechniqueError(`${ctx}: technique '${sub.name}' contains itself (${[...stack, sub.name].join(' > ')})`);
  let count = 1, looping = false;
  if (node.loop !== undefined) {
    looping = true;
    if (typeof node.loop === 'number') count = node.loop;
    else {
      const flat = mapVariable(variable, node.loop.variable, ctx);
      graph.structural.add(flat);
      const v = graph.variables.get(flat)!.value;
      count = Array.isArray(v) ? v[0] : v;
    }
    if (!Number.isInteger(count) || count < 0 || count > MAX_LOOP) throw new TechniqueError(`${ctx}: loop count ${count} must be an integer from 0 to ${MAX_LOOP}`);
  }
  const subResources = new Set((sub.resources ?? []).map((r) => r.name));
  const subVariables = new Set((sub.variables ?? []).map((v) => v.name));
  for (const k of [...Object.keys(node.inputs ?? {}), ...Object.keys(node.outputs ?? {})]) if (!subResources.has(k)) throw new TechniqueError(`${ctx}: sub-technique '${sub.name}' has no resource '${k}'`);
  for (const k of Object.keys(node.variables ?? {})) if (!subVariables.has(k)) throw new TechniqueError(`${ctx}: sub-technique '${sub.name}' has no variable '${k}'`);

  for (let i = 0; i < count; i++) {
    const importMap = new Map<string, string>();
    for (const [subName, parentName] of Object.entries(node.inputs ?? {})) importMap.set(subName, mapResource(resource, parentName, ctx));
    for (const [subName, parentName] of Object.entries(node.outputs ?? {})) importMap.set(subName, mapResource(resource, parentName, ctx));
    const varMap = new Map<string, string>(), childPrefix = `${prefix}${node.name}${looping ? `#${i}` : ''}/`;
    const overrides: Record<string, VariableValue> = {};
    for (const [subName, how] of Object.entries(node.variables ?? {})) {
      if ('bind' in how) varMap.set(subName, mapVariable(variable, how.bind, ctx)); else overrides[subName] = how.value;
    }
    inline(graph, withValues(sub, overrides, looping ? i : undefined), childPrefix, importMap, varMap, conditions, keepAll, options, depth + 1, [...stack, sub.name]);
  }
}

/** A copy of `technique` whose variable defaults are replaced by `values` (and `loopIndex` set when looping). */
function withValues(technique: Technique, values: Record<string, VariableValue>, loopIndex: number | undefined): Technique {
  if (!Object.keys(values).length && loopIndex === undefined) return technique;
  return {
    ...technique,
    variables: (technique.variables ?? []).map((v) => {
      if (v.name in values) return { ...v, value: values[v.name] };
      if (v.name === 'loopIndex' && loopIndex !== undefined) return { ...v, value: loopIndex };
      return v;
    }),
  };
}

function coerce(decl: VariableDecl, value: VariableValue): VariableValue {
  if (decl.type === 'float4') {
    if (!Array.isArray(value) || value.length !== 4) throw new TechniqueError(`variable '${decl.name}' is a float4: pass four numbers`);
    return value.slice();
  }
  const v = Array.isArray(value) ? value[0] : value;
  if (!Number.isFinite(v)) throw new TechniqueError(`variable '${decl.name}' needs a finite number`);
  return decl.type === 'float' ? v : Math.trunc(v);
}

function mapResource(map: Map<string, string>, name: string, ctx: string): string {
  const flat = map.get(name);
  if (flat === undefined) throw new TechniqueError(`${ctx}: resource '${name}' is not declared`);
  return flat;
}
function mapVariable(map: Map<string, string>, name: string, ctx: string): string {
  const flat = map.get(name);
  if (flat === undefined) throw new TechniqueError(`${ctx}: variable '${name}' is not declared`);
  return flat;
}
function mapCondition(c: NodeCondition, variable: Map<string, string>, ctx: string): NodeCondition { return { ...c, variable: mapVariable(variable, c.variable, ctx) }; }
function mapDim(d: SizeDim, variable: Map<string, string>, ctx: string): SizeDim { return typeof d === 'number' ? d : { ...d, variable: mapVariable(variable, d.variable, ctx) }; }

/** Variable names inside the size fields of a resource declaration, renamed to flat names. */
function mapResourceDims(decl: ResourceDecl, variable: Map<string, string>, graph: FlatGraph, where: string): Partial<ResourceDecl> {
  const ctx = `${where}, resource '${decl.name}'`;
  const dims = (list: SizeDim[]) => list.map((d) => { const m = mapDim(d, variable, ctx); if (typeof m !== 'number') graph.structural.add(m.variable); return m; });
  if (decl.kind === 'texture') return decl.size ? { size: dims(decl.size) } : {};
  return decl.count !== undefined ? { count: dims([decl.count])[0] } : {};
}

function mapBindings(bindings: BindingDecl[], resource: Map<string, string>, ctx: string): BindingDecl[] {
  // the shader refers to a binding by the resource's local name, so that stays the default WGSL name after the resource is renamed
  return bindings.map((b) => ({ ...b, name: b.name ?? b.resource, resource: mapResource(resource, b.resource, ctx) }));
}

/** Copy a leaf node with its resource and variable names replaced by flat names. */
function mapNode(node: Exclude<NodeDecl, SubGraphNode>, resource: Map<string, string>, variable: Map<string, string>, ctx: string): Exclude<NodeDecl, SubGraphNode> {
  const dim = (d: SizeDim) => mapDim(d, variable, ctx);
  switch (node.type) {
    case 'compute': {
      const d = node.dispatch;
      const dispatch = 'threads' in d ? { threads: d.threads.map(dim) } : 'like' in d ? { like: mapResource(resource, d.like, ctx) } : { ...d, indirect: mapResource(resource, d.indirect, ctx) };
      return { ...node, bindings: mapBindings(node.bindings, resource, ctx), dispatch };
    }
    case 'draw':
      return {
        ...node, bindings: mapBindings(node.bindings, resource, ctx),
        colorTargets: node.colorTargets.map((t) => ({ ...t, resource: mapResource(resource, t.resource, ctx), ...(t.resolve !== undefined ? { resolve: mapResource(resource, t.resolve, ctx) } : {}) })),
        ...(node.depthTarget ? { depthTarget: { ...node.depthTarget, resource: mapResource(resource, node.depthTarget.resource, ctx) } } : {}),
        ...(node.vertexBuffers ? { vertexBuffers: node.vertexBuffers.map((v) => ({ ...v, resource: mapResource(resource, v.resource, ctx) })) } : {}),
        ...(node.indexBuffer ? { indexBuffer: { ...node.indexBuffer, resource: mapResource(resource, node.indexBuffer.resource, ctx) } } : {}),
        ...(node.indirect ? { indirect: { ...node.indirect, resource: mapResource(resource, node.indirect.resource, ctx) } } : {}),
        ...(node.baseVertex !== undefined ? { baseVertex: dim(node.baseVertex) } : {}),
        ...(node.indexCount !== undefined ? { indexCount: dim(node.indexCount) } : {}),
        ...(node.vertexCount !== undefined ? { vertexCount: dim(node.vertexCount) } : {}), ...(node.instanceCount !== undefined ? { instanceCount: dim(node.instanceCount) } : {}),
      };
    case 'copy': return { ...node, source: mapResource(resource, node.source, ctx), dest: mapResource(resource, node.dest, ctx), ...(node.size ? { size: node.size.map(dim) } : {}) };
    case 'clear': return { ...node, resource: mapResource(resource, node.resource, ctx), ...(node.size !== undefined ? { size: dim(node.size) } : {}) };
    case 'render':
      return {
        ...node,
        colorTargets: node.colorTargets.map((t) => ({ ...t, resource: mapResource(resource, t.resource, ctx), ...(t.resolve !== undefined ? { resolve: mapResource(resource, t.resolve, ctx) } : {}) })),
        ...(node.depthTarget ? { depthTarget: { ...node.depthTarget, resource: mapResource(resource, node.depthTarget.resource, ctx) } } : {}),
        ...(node.uses ? { uses: node.uses.map((u) => ({ ...u, resource: mapResource(resource, u.resource, ctx) })) } : {}),
        ...(node.segments ? { segments: node.segments.map((sg) => ({ ...sg, ...(sg.uses ? { uses: sg.uses.map((u) => ({ ...u, resource: mapResource(resource, u.resource, ctx) })) } : {}) })) } : {}),
      };
    case 'callback': return { ...node, reads: (node.reads ?? []).map((r) => mapResource(resource, r, ctx)), writes: (node.writes ?? []).map((r) => mapResource(resource, r, ctx)) };
  }
}

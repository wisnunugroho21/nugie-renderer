import { PriorityQueue } from '../core/PriorityQueue';

export interface PassDesc {
  name: string;
  /** Logical resources consumed / produced (e.g. 'shadowMap', 'depth'). */
  reads?: string[];
  writes?: string[];
  /** Keep the pass even if nothing consumes its outputs (e.g. the backbuffer). */
  sideEffect?: boolean;
  execute: (encoder: GPUCommandEncoder) => void;
}

type Dependencies = Set<number>[];

/** Derive read/write hazards in declaration order. Forward reads consume later producers;
 * a first read-modify-write consumes an external resource, then becomes its first producer.
 */
function dependenciesOf(passes: readonly PassDesc[]): Dependencies {
  const dependencies: Dependencies = passes.map(() => new Set<number>());
  const lastWriter = new Map<string, number>();
  const readers = new Map<string, number[]>();
  const writers = new Map<string, number[]>();
  for (let i = 0; i < passes.length; i++) for (const resource of passes[i].writes ?? []) {
    const list = writers.get(resource) ?? [];
    list.push(i);
    writers.set(resource, list);
  }
  for (let i = 0; i < passes.length; i++) {
    const pass = passes[i];
    for (const resource of pass.reads ?? []) {
      const writer = lastWriter.get(resource);
      if (writer !== undefined) dependencies[i].add(writer);
      else if (!pass.writes?.includes(resource)) {
        for (const producer of writers.get(resource) ?? []) dependencies[i].add(producer);
        continue;
      }
      const list = readers.get(resource) ?? [];
      list.push(i);
      readers.set(resource, list);
    }
    for (const resource of pass.writes ?? []) {
      const writer = lastWriter.get(resource);
      if (writer !== undefined && writer !== i) dependencies[i].add(writer);
      for (const reader of readers.get(resource) ?? []) if (reader !== i) dependencies[i].add(reader);
      lastWriter.set(resource, i);
      readers.set(resource, []);
    }
  }
  return dependencies;
}

/** Keep side-effect passes and their transitive dependencies without recursive traversal. */
function livePasses(passes: readonly PassDesc[], dependencies: Dependencies): Set<number> {
  const live = new Set<number>();
  const stack: number[] = [];
  passes.forEach((pass, index) => { if (pass.sideEffect) stack.push(index); });
  while (stack.length) {
    const index = stack.pop()!;
    if (live.has(index)) continue;
    live.add(index);
    for (const dependency of dependencies[index]) stack.push(dependency);
  }
  return live;
}

/** Stable Kahn sort: the lowest declaration index among ready passes always wins. */
function orderedPasses(passes: readonly PassDesc[], dependencies: Dependencies, live: Set<number>): PassDesc[] {
  const indegree = new Uint32Array(passes.length);
  const users: number[][] = passes.map(() => []);
  for (const index of live) for (const dependency of dependencies[index]) {
    indegree[index]++;
    users[dependency].push(index);
  }
  const ready = new PriorityQueue<number>((a, b) => a - b);
  for (const index of live) if (indegree[index] === 0) ready.push(index);
  const ordered: PassDesc[] = [];
  while (ready.length) {
    const index = ready.pop()!;
    ordered.push(passes[index]);
    for (const user of users[index]) if (--indegree[user] === 0) ready.push(user);
  }
  if (ordered.length !== live.size) {
    const blocked = [...live].filter((index) => indegree[index] > 0).map((index) => passes[index].name);
    throw new Error(`RenderGraph: dependency cycle between passes: ${blocked.join(', ')}`);
  }
  return ordered;
}

/** Frame graph: dependencies -> liveness -> stable ordering -> command recording.
 * Recompile after changing passes. Failed compilation cannot replay an earlier graph.
 */
export class RenderGraph {
  private passes: PassDesc[] = [];
  order: string[] = [];
  culled: string[] = [];
  private compiled: PassDesc[] | null = null;

  reset(): void {
    this.passes.length = 0;
    this.invalidate();
  }

  addPass(pass: PassDesc): void {
    this.passes.push(pass);
    this.invalidate();
  }

  private invalidate(): void {
    this.compiled = null;
    this.order.length = 0;
    this.culled.length = 0;
  }

  /** Compile the graph and return the execution order. Unused passes are listed in `culled`. */
  compile(): string[] {
    this.invalidate();
    const dependencies = dependenciesOf(this.passes);
    const live = livePasses(this.passes, dependencies);
    const ordered = orderedPasses(this.passes, dependencies, live);
    this.culled = this.passes.filter((_, index) => !live.has(index)).map((pass) => pass.name);
    this.compiled = ordered;
    return (this.order = ordered.map((pass) => pass.name));
  }

  execute(encoder: GPUCommandEncoder): void {
    if (!this.compiled) throw new Error('RenderGraph: compile the graph before executing');
    for (const pass of this.compiled) pass.execute(encoder);
  }
}

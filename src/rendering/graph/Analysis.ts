import { PriorityQueue } from '../../core/PriorityQueue';

/** How a node uses a resource; a change of usage between two nodes is a resource transition (a barrier on explicit APIs). */
export type UsageKind = 'sampled' | 'storage' | 'color' | 'depth' | 'vertex' | 'index' | 'copy-src' | 'copy-dst' | 'indirect' | 'callback';
export type NodeKind = 'compute' | 'render' | 'copy' | 'callback';

export interface NodeAccess {
  resource: string;
  read: boolean;
  write: boolean;
  usage: UsageKind;
}

/** What the analysis needs to know about a node. */
export interface AnalysisNode {
  name: string;
  kind: NodeKind;
  accesses: NodeAccess[];
  /** The node must run even if no other node consumes its outputs. */
  root: boolean;
}

export type Dependencies = Set<number>[];
export type OrderStrategy = 'declaration' | 'transitions';

const reads = (node: AnalysisNode): string[] => node.accesses.filter((a) => a.read).map((a) => a.resource);
const writes = (node: AnalysisNode): string[] => node.accesses.filter((a) => a.write).map((a) => a.resource);

/**
 * Derive read / write hazards in declaration order. Read-only accesses link back to the last write of the resource (no false ordering
 * between readers); a write waits for the previous writer and every reader since. Forward reads (a read before any write) consume later
 * producers; a first read-modify-write consumes the resource's external contents and then becomes its first producer.
 */
export function dependenciesOf(nodes: readonly AnalysisNode[]): Dependencies {
  const dependencies: Dependencies = nodes.map(() => new Set<number>());
  const lastWriter = new Map<string, number>();
  const readers = new Map<string, number[]>();
  const writers = new Map<string, number[]>();
  const nodeReads = nodes.map(reads), nodeWrites = nodes.map(writes);
  for (let i = 0; i < nodes.length; i++) for (const resource of nodeWrites[i]) {
    const list = writers.get(resource) ?? [];
    list.push(i);
    writers.set(resource, list);
  }
  for (let i = 0; i < nodes.length; i++) {
    for (const resource of nodeReads[i]) {
      const writer = lastWriter.get(resource);
      if (writer !== undefined) dependencies[i].add(writer);
      else if (!nodeWrites[i].includes(resource)) {
        for (const producer of writers.get(resource) ?? []) dependencies[i].add(producer);
        continue;
      }
      const list = readers.get(resource) ?? [];
      list.push(i);
      readers.set(resource, list);
    }
    for (const resource of nodeWrites[i]) {
      const writer = lastWriter.get(resource);
      if (writer !== undefined && writer !== i) dependencies[i].add(writer);
      for (const reader of readers.get(resource) ?? []) if (reader !== i) dependencies[i].add(reader);
      lastWriter.set(resource, i);
      readers.set(resource, []);
    }
  }
  return dependencies;
}

/** Keep root nodes and their transitive dependencies (iterative, so deep chains cannot overflow the stack). */
export function liveNodes(nodes: readonly AnalysisNode[], dependencies: Dependencies): Set<number> {
  const live = new Set<number>();
  const stack: number[] = [];
  nodes.forEach((node, index) => { if (node.root) stack.push(index); });
  while (stack.length) {
    const index = stack.pop()!;
    if (live.has(index)) continue;
    live.add(index);
    for (const dependency of dependencies[index]) stack.push(dependency);
  }
  return live;
}

/**
 * Topological order of the live nodes. `declaration`: the lowest declaration index among ready nodes always wins (stable). `transitions`:
 * among ready nodes prefer the one that needs the fewest resource-state changes and keeps the current node kind (compute / render / copy)
 * running, falling back to declaration order; this cuts barriers and pass switches without ever violating a dependency.
 */
export function orderNodes(nodes: readonly AnalysisNode[], dependencies: Dependencies, live: Set<number>, strategy: OrderStrategy = 'declaration'): number[] {
  const indegree = new Uint32Array(nodes.length);
  const users: number[][] = nodes.map(() => []);
  for (const index of live) for (const dependency of dependencies[index]) {
    indegree[index]++;
    users[dependency].push(index);
  }
  const order: number[] = [];
  if (strategy === 'declaration') {
    const ready = new PriorityQueue<number>((a, b) => a - b);
    for (const index of live) if (indegree[index] === 0) ready.push(index);
    while (ready.length) {
      const index = ready.pop()!;
      order.push(index);
      for (const user of users[index]) if (--indegree[user] === 0) ready.push(user);
    }
  } else {
    const ready: number[] = [];
    for (const index of live) if (indegree[index] === 0) ready.push(index);
    const state = new Map<string, UsageKind>();
    let kind: NodeKind | null = null;
    while (ready.length) {
      let best = 0, bestCost = Infinity;
      for (let r = 0; r < ready.length; r++) {
        const node = nodes[ready[r]];
        let cost = node.kind === kind ? 0 : 0.5;
        for (const access of node.accesses) { const s = state.get(access.resource); if (s !== undefined && s !== access.usage) cost++; }
        if (cost < bestCost || (cost === bestCost && ready[r] < ready[best])) { best = r; bestCost = cost; }
      }
      const index = ready[best];
      ready.splice(best, 1);
      order.push(index);
      kind = nodes[index].kind;
      for (const access of nodes[index].accesses) state.set(access.resource, access.usage);
      for (const user of users[index]) if (--indegree[user] === 0) ready.push(user);
    }
  }
  if (order.length !== live.size) {
    const blocked = [...live].filter((index) => indegree[index] > 0).map((index) => nodes[index].name);
    throw new Error(`RenderGraph: dependency cycle between passes: ${blocked.join(', ')}`);
  }
  return order;
}

/** Cost of an execution order: how often a resource changes usage, and how often the node kind changes. */
export function orderCost(nodes: readonly AnalysisNode[], order: readonly number[]): { transitions: number; kindSwitches: number } {
  const state = new Map<string, UsageKind>();
  let transitions = 0, kindSwitches = 0, kind: NodeKind | null = null;
  for (const index of order) {
    const node = nodes[index];
    if (kind !== null && node.kind !== kind) kindSwitches++;
    kind = node.kind;
    for (const access of node.accesses) {
      const s = state.get(access.resource);
      if (s !== undefined && s !== access.usage) transitions++;
      state.set(access.resource, access.usage);
    }
  }
  return { transitions, kindSwitches };
}

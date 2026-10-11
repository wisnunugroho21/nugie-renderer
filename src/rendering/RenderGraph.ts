import { dependenciesOf, liveNodes, orderNodes, orderCost, type AnalysisNode, type OrderStrategy } from './graph/Analysis';

export interface PassDesc {
  name: string;
  /** Logical resources consumed / produced (e.g. 'shadowMap', 'depth'). */
  reads?: string[];
  writes?: string[];
  /** Keep the pass even if nothing consumes its outputs (e.g. the backbuffer). */
  sideEffect?: boolean;
  execute: (encoder: GPUCommandEncoder) => void;
}

/** First and last position (in execution order) at which a resource is touched. */
export interface ResourceSpan { first: number; last: number; }

/**
 * Frame graph of engine passes: dependencies -> liveness -> stable ordering -> command recording. Passes are "callback nodes" of the
 * technique model (see `graph/TechniqueTypes.ts`); for data-driven nodes, resource lifetimes and aliasing use a `Technique`, and
 * `TechniqueInstance.asPass` plugs one into this graph. Recompile after changing passes. Failed compilation cannot replay an earlier graph.
 */
export class RenderGraph {
  private passes: PassDesc[] = [];
  order: string[] = [];
  culled: string[] = [];
  /** Where each logical resource is first and last used in `order` (valid after `compile`). */
  spans = new Map<string, ResourceSpan>();
  /** Resource-state changes and node-kind switches of the compiled order, and of the declaration order for comparison. */
  stats = { transitions: 0, kindSwitches: 0, declaredTransitions: 0, declaredKindSwitches: 0 };
  /** `declaration`: stable (the default, what the renderer relies on); `transitions`: reorder independent passes to reduce barriers. */
  strategy: OrderStrategy = 'declaration';
  private compiled: PassDesc[] | null = null;
  private nodes: AnalysisNode[] = [];

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
    this.spans.clear();
  }

  /** Compile the graph and return the execution order. Unused passes are listed in `culled`. */
  compile(): string[] {
    this.invalidate();
    this.nodes = this.passes.map((pass): AnalysisNode => ({
      name: pass.name, kind: 'callback', root: pass.sideEffect === true,
      accesses: [
        ...(pass.reads ?? []).map((resource) => ({ resource, read: true, write: (pass.writes ?? []).includes(resource), usage: 'callback' as const })),
        ...(pass.writes ?? []).filter((resource) => !(pass.reads ?? []).includes(resource)).map((resource) => ({ resource, read: false, write: true, usage: 'callback' as const })),
      ],
    }));
    const dependencies = dependenciesOf(this.nodes);
    const live = liveNodes(this.nodes, dependencies);
    const order = orderNodes(this.nodes, dependencies, live, this.strategy);
    this.culled = this.passes.filter((_, index) => !live.has(index)).map((pass) => pass.name);
    this.compiled = order.map((index) => this.passes[index]);
    order.forEach((nodeIndex, position) => {
      for (const access of this.nodes[nodeIndex].accesses) {
        const span = this.spans.get(access.resource);
        if (span) span.last = position; else this.spans.set(access.resource, { first: position, last: position });
      }
    });
    const cost = orderCost(this.nodes, order), declared = orderCost(this.nodes, [...live].sort((a, b) => a - b));
    this.stats = { transitions: cost.transitions, kindSwitches: cost.kindSwitches, declaredTransitions: declared.transitions, declaredKindSwitches: declared.kindSwitches };
    return (this.order = this.compiled.map((pass) => pass.name));
  }

  execute(encoder: GPUCommandEncoder): void {
    if (!this.compiled) throw new Error('RenderGraph: compile the graph before executing');
    for (const pass of this.compiled) pass.execute(encoder);
  }
}

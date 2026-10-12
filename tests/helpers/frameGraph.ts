import { FrameGraph } from '../../src/rendering/graph/FrameGraph';
import type { TechniqueBuilder } from '../../src/rendering/graph/TechniqueBuilder';
import type { TechniqueHost } from '../../src/rendering/graph/TechniqueInstance';

/** A frame graph's builder without a GPU: callback nodes own no GPU objects, so a bare host is enough. */
export const frameHost = {} as TechniqueHost;
export const newFrame = (): FrameGraph => new FrameGraph(frameHost);

export interface TestPass { name: string; reads?: string[]; writes?: string[]; sideEffect?: boolean; execute?: (encoder: GPUCommandEncoder) => void }

/** Add a callback node, declaring the logical resources it names (what a feature does with `graph.logical`). */
export function addPass(g: TechniqueBuilder, p: TestPass): void {
  g.callback(p.name, { reads: (p.reads ?? []).map((n) => g.logical(n)), writes: (p.writes ?? []).map((n) => g.logical(n)), keep: p.sideEffect, execute: p.execute ?? (() => {}) });
}

/** Execution order of the declared passes, after culling. */
export const orderOf = (g: TechniqueBuilder): string[] => g.compile().steps.map((s) => s.node.path);

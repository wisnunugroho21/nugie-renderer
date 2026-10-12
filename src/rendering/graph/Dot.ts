import type { CompiledTechnique } from './Compile';

/**
 * The compiled graph as Graphviz DOT (render with `dot -Tsvg`): boxes are nodes in execution order, ellipses are resources coloured by
 * visibility (blue imported, grey internal, green exported; dashed = transient, solid = persistent), edges are reads and writes. Memory
 * slots shared by several transient resources are drawn as one cluster each.
 */
export function techniqueToDot(plan: CompiledTechnique): string {
  const id = (s: string) => `"${s.replace(/"/g, '\\"')}"`;
  const color = { imported: '#9ec5fe', internal: '#dee2e6', exported: '#a3cfbb' } as const;
  const lines: string[] = [`digraph ${id(plan.name)} {`, '  rankdir=LR; node [fontname="monospace", fontsize=10];'];
  for (const step of plan.steps) lines.push(`  ${id(`n:${step.node.path}`)} [shape=box, style="filled", fillcolor="#ffe8cc", label=${id(`${step.index}. ${step.node.path}\\n(${step.node.type})`)}];`);
  const shared = new Map<number, string[]>();
  for (const p of plan.resources.values()) {
    if (p.first < 0) continue;
    lines.push(`  ${id(`r:${p.name}`)} [shape=ellipse, style="filled${p.lifetime === 'transient' ? ',dashed' : ''}", fillcolor="${color[p.visibility]}", label=${id(`${p.name}\\n${p.resolved ? (p.resolved.kind === 'texture' ? `${p.resolved.size.slice(0, 2).join('x')} ${p.resolved.format}` : `${p.resolved.count} x ${p.resolved.element}`) : 'host'}`)}];`);
    if (p.slot >= 0) shared.set(p.slot, [...(shared.get(p.slot) ?? []), p.name]);
  }
  for (const [slot, names] of shared) if (names.length > 1) lines.push(`  subgraph cluster_slot${slot} { label="shared memory (slot ${slot})"; style=dotted; ${names.map((n) => id(`r:${n}`)).join('; ')}; }`);
  for (const step of plan.steps) for (const a of step.accesses) {
    if (a.read) lines.push(`  ${id(`r:${a.resource}`)} -> ${id(`n:${step.node.path}`)};`);
    if (a.write) lines.push(`  ${id(`n:${step.node.path}`)} -> ${id(`r:${a.resource}`)};`);
  }
  lines.push('}');
  return lines.join('\n');
}

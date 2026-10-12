import { technique, type TechniqueBuilder } from './TechniqueBuilder';
import type { TechniqueHost } from './TechniqueInstance';

/**
 * Build a small technique, record it into its own command encoder, submit it and free it: for GPU work that happens now and then, outside a frame (growing a buffer, uploading
 * a streamed texture level, reading a buffer back). `build` declares the resources (as `imported`) and the nodes; `imports` maps their names to the host's objects.
 * Work inside a frame should keep a technique alive instead (see `CachedTechnique`).
 */
export function runOnce(
  host: TechniqueHost, name: string, build: (g: TechniqueBuilder) => void, imports: Record<string, GPUBuffer | GPUTexture>,
): void {
  const g = technique(name);
  build(g);
  const fx = g.instantiate(host, { label: name, imports });
  const encoder = host.device.createCommandEncoder({ label: name });
  fx.execute(encoder);
  host.queue.submit([encoder.finish()]);
  fx.dispose();
}

/** The host for code that only has a device: enough for copy and clear nodes on imported resources. */
export function deviceHost(device: GPUDevice): TechniqueHost {
  return { device, queue: device.queue };
}

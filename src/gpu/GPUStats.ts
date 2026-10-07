/** Resource and cache counters (Phase 4 metrics). Reset-able per frame where noted. */
export class GPUStats {
  pipelineCreations = 0;
  pipelineHits = 0;
  pipelineMisses = 0;
  /** Pipelines created after PipelineCache.freeze() – must stay 0 in steady state. */
  pipelineCreationsAfterFreeze = 0;
  shaderModules = 0;
  shaderHits = 0;
  shaderMisses = 0;
  buffers = 0;
  bufferBytes = 0;
  textures = 0;
  textureBytes = 0;
  textureHits = 0;
  textureMisses = 0;
  samplers = 0;
  samplerHits = 0;
  samplerMisses = 0;
  bindGroups = 0;
  bindGroupHits = 0;
  bindGroupMisses = 0;

  snapshot(): Record<string, number> { return { ...this } as unknown as Record<string, number>; }
}

/** Per-frame renderer statistics (reset at the start of each frame). */
export class RendererStats {
  // scene
  renderables = 0;
  visible = 0;
  frustumTested = 0;
  frustumRejected = 0;
  // rendering
  drawCalls = 0;
  instances = 0;
  triangles = 0;
  pipelineSwitches = 0;
  materialSwitches = 0;
  meshSwitches = 0;
  bufferUploadBytes = 0;
  transformUploadBytes = 0;
  transformUploadRanges = 0;
  // LOD
  lodCounts = new Uint32Array(16);
  lodCulled = 0;
  // lighting
  lighting = { lights: 0, globalLights: 0, clusters: 0, clustered: false };
  // animation
  animation = {
    activeAnimators: 0, activeSkeletons: 0, updatedSkeletons: 0, updatedJoints: 0, jointUploadBytes: 0,
    activeMorphStates: 0, activeMorphTargets: 0, morphUploadBytes: 0,
  };
  // CPU timings (ms)
  cpu = { extraction: 0, culling: 0, sorting: 0, batching: 0, upload: 0, encoding: 0, total: 0 };

  /** Zero the per-frame counters and the CPU timings the renderer itself measures. */
  reset(): void {
    this.renderables = this.visible = this.frustumTested = this.frustumRejected = 0;
    this.drawCalls = this.instances = this.triangles = 0;
    this.pipelineSwitches = this.materialSwitches = this.meshSwitches = 0;
    this.bufferUploadBytes = this.transformUploadBytes = this.transformUploadRanges = 0;
    this.lodCounts.fill(0); this.lodCulled = 0;
    this.lighting.lights = this.lighting.globalLights = this.lighting.clusters = 0; this.lighting.clustered = false;
    const a = this.animation;
    a.jointUploadBytes = a.morphUploadBytes = a.activeMorphStates = a.activeMorphTargets = 0;
    const c = this.cpu;
    // `extraction` is measured by the caller BEFORE render(), so it must survive the reset.
    c.culling = c.sorting = c.batching = c.upload = c.encoding = c.total = 0;
  }
}

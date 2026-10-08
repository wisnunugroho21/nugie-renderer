import type { Engine } from './Engine';

/**
 * Build the multi-line debug overlay text (batching, culling, draw calls, GPU pass times, buffers, errors).
 * Pure formatting: reads engine/renderer statistics and returns a string.
 * @param engine the running engine
 * @param sceneName label shown on the first line (e.g. the demo name)
 */
export function formatHud(engine: Engine, sceneName: string): string {
  const { renderer, renderWorld: rw, gpu, visibility, timings } = engine;
  const rs = renderer.stats, s = gpu.resources.stats, an = rs.animation, streamer = renderer.textureStreamer;
  const gpuMs = [...renderer.profiler.smoothed].map(([k, v]) => `${k} ${v.toFixed(2)}`).join('  ')
    || (renderer.profiler.supported ? '...' : 'timestamps unsupported');
  const lines: string[] = [
    `scene: ${sceneName}  batching: ${renderer.batching}  cull: ${visibility.mode}`,
    `renderables: ${rw.count}  visible: ${rs.visible}  culled: ${rs.frustumRejected}  (cull ${rs.cpu.culling.toFixed(3)} ms)`,
    `draws: ${rs.drawCalls}  instances: ${rs.instances}  tris: ${rs.triangles}`,
    `pipeline/material/mesh switches: ${rs.pipelineSwitches}/${rs.materialSwitches}/${rs.meshSwitches}`,
    `gpu ms: ${gpuMs}`,
  ];
  if (streamer) {
    const st = streamer.stats;
    lines.push(`streaming: ${(st.residentBytes / 1048576).toFixed(1)} MB resident, ${st.changes} level changes, ${(st.uploadedBytes / 1024).toFixed(0)} KB uploaded this frame`);
  }
  lines.push(`lights: ${rs.lighting.lights} (${rs.lighting.globalLights} global)  shading: ${rs.lighting.clustered ? `clustered (${rs.lighting.clusters} clusters)` : 'naive loop'}`);
  lines.push(`upload: ${rs.bufferUploadBytes} B (transforms ${rs.transformUploadBytes} B in ${rs.transformUploadRanges} ranges)`);
  if (renderer.lodLibrary.groups.length) {
    lines.push(`LOD: levels [${Array.from(rs.lodCounts.subarray(0, 4)).join(', ')}] culled ${rs.lodCulled} (select ${renderer.lod.ms.toFixed(2)} ms)`);
  }
  lines.push(
    `anim: ${an.activeAnimators} animators, ${an.activeSkeletons} skeletons (${an.updatedSkeletons} updated / ${an.updatedJoints} joints, ${an.jointUploadBytes} B), ` +
    `${an.activeMorphStates} morph states / ${an.activeMorphTargets} targets (${an.morphUploadBytes} B)  [anim ${timings.animationMs.toFixed(2)} ms, xform+skel ${timings.transformMs.toFixed(2)} ms]`,
    `cpu ms: sort ${rs.cpu.sorting.toFixed(2)} batch ${rs.cpu.batching.toFixed(2)} encode ${rs.cpu.encoding.toFixed(2)} total ${rs.cpu.total.toFixed(2)}`,
    `particles: ${renderer.particles ? renderer.particles.pools.map((p) => `${p.config.name}:${p.spawnedThisFrame}`).join(' ') : '-'} spawned this frame`,
    `buffers: ${s.buffers} (${(s.bufferBytes / 1024).toFixed(0)} KB)  textures: ${s.textures} (${(s.textureBytes / 1024).toFixed(0)} KB)  bindgroups: ${s.bindGroups}`,
    `pipelines: ${s.pipelineCreations} (after freeze ${s.pipelineCreationsAfterFreeze})  errors: ${gpu.errors.length + gpu.resources.shaders.errors.length + renderer.materials.shaderErrors.length}`,
  );
  return lines.join('\n');
}

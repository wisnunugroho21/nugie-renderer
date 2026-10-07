import type { GPUStats } from './GPUStats';

/** Deduplicates samplers by descriptor contents. */
export class SamplerCache {
  private cache = new Map<string, GPUSampler>();

  constructor(private device: GPUDevice, private stats: GPUStats) {}

  static key(d: GPUSamplerDescriptor): string {
    return [
      d.addressModeU ?? 'clamp-to-edge', d.addressModeV ?? 'clamp-to-edge', d.addressModeW ?? 'clamp-to-edge',
      d.magFilter ?? 'nearest', d.minFilter ?? 'nearest', d.mipmapFilter ?? 'nearest',
      d.lodMinClamp ?? 0, d.lodMaxClamp ?? 32, d.compare ?? '', d.maxAnisotropy ?? 1,
    ].join('|');
  }

  get(desc: GPUSamplerDescriptor = {}): GPUSampler {
    const key = SamplerCache.key(desc);
    let s = this.cache.get(key);
    if (s) { this.stats.samplerHits++; return s; }
    this.stats.samplerMisses++;
    s = this.device.createSampler({ ...desc, label: desc.label ?? `sampler:${key}` });
    this.cache.set(key, s);
    this.stats.samplers = this.cache.size;
    return s;
  }
}

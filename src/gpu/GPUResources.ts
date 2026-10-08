import { GPUStats } from './GPUStats';
import { BufferManager } from './BufferManager';
import { TextureManager } from './TextureManager';
import { SamplerCache } from './SamplerCache';
import { ShaderManager } from './ShaderManager';
import { PipelineCache } from './PipelineCache';
import { BindGroupCache } from './BindGroupCache';

/** Bundle of all resource managers sharing one stats object. */
export class GPUResources {
  readonly stats = new GPUStats();
  readonly buffers: BufferManager;
  readonly textures: TextureManager;
  readonly samplers: SamplerCache;
  readonly shaders: ShaderManager;
  readonly pipelines: PipelineCache;
  readonly bindGroups: BindGroupCache;

  /** Create all managers for `device`, sharing one stats object. */
  constructor(readonly device: GPUDevice) {
    this.buffers = new BufferManager(device, this.stats);
    this.textures = new TextureManager(device, this.stats);
    this.samplers = new SamplerCache(device, this.stats);
    this.shaders = new ShaderManager(device, this.stats);
    this.pipelines = new PipelineCache(this.stats);
    this.bindGroups = new BindGroupCache(this.stats);
  }
}

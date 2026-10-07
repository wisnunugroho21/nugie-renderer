import type { GPUStats } from './GPUStats';

export type ShaderDefines = Record<string, boolean | number>;

export interface ShaderError { shader: string; message: string; line: number; }

/**
 * Compiles + caches WGSL modules. Features are injected as module-scope `const`s
 * (e.g. `const HAS_SKINNING: bool = true;`) so shader code can use plain `if HAS_X {}`;
 * the compiler folds them. `//#include name` splices registered chunks.
 */
export class ShaderManager {
  private chunks = new Map<string, string>();
  private modules = new Map<string, GPUShaderModule>();
  readonly errors: ShaderError[] = [];

  constructor(private device: GPUDevice, private stats: GPUStats) {}

  registerChunk(name: string, source: string): void { this.chunks.set(name, source); }

  static key(id: string, defines: ShaderDefines): string {
    const d = Object.keys(defines).sort().map((k) => `${k}=${+defines[k]}`).join(',');
    return `${id}#${d}`;
  }

  /** Pure source assembly (testable without a device). */
  assemble(source: string, defines: ShaderDefines): string {
    // Includes are idempotent: a chunk is spliced in only the first time it is requested (shared dependencies are
    // pulled in by several chunks, and WGSL forbids duplicate declarations).
    const seen = new Set<string>();
    const resolve = (src: string, depth: number): string => {
      if (depth > 8) throw new Error('#include nesting too deep');
      return src.replace(/^[ \t]*\/\/#include\s+(\S+)[ \t]*$/gm, (_m, name: string) => {
        const c = this.chunks.get(name);
        if (c === undefined) throw new Error(`Unknown shader chunk '${name}'`);
        if (seen.has(name)) return '';
        seen.add(name);
        return resolve(c, depth + 1);
      });
    };
    let header = '';
    for (const k of Object.keys(defines).sort()) {
      const v = defines[k];
      header += typeof v === 'boolean' ? `const ${k}: bool = ${v};\n` : `const ${k}: u32 = ${v}u;\n`;
    }
    return header + resolve(source, 0);
  }

  get(id: string, source: string, defines: ShaderDefines = {}): GPUShaderModule {
    const key = ShaderManager.key(id, defines);
    let m = this.modules.get(key);
    if (m) { this.stats.shaderHits++; return m; }
    this.stats.shaderMisses++;
    const code = this.assemble(source, defines);
    m = this.device.createShaderModule({ label: key, code });
    this.modules.set(key, m);
    this.stats.shaderModules = this.modules.size;
    // Async validation / error reporting; never blocks the frame.
    m.getCompilationInfo?.().then((info) => {
      for (const msg of info.messages) {
        if (msg.type === 'error') {
          this.errors.push({ shader: key, message: msg.message, line: msg.lineNum });
          console.error(`WGSL error in ${key}:${msg.lineNum}: ${msg.message}`);
        }
      }
    });
    return m;
  }
}

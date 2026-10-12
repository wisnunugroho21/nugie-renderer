import { evaluateGlue, getCodecConfig, onCodecConfigChange, readWasm } from './CodecSources';

/** Basis Universal transcoder target formats (the numbering of `basis_transcoder`). */
export const BasisFormat = { ETC1: 0, ETC2: 1, BC1: 2, BC3: 3, BC4: 4, BC5: 5, BC7: 7, ASTC_4x4: 10, RGBA32: 13 } as const;

/** The parts of the transcoder's `KTX2File` class that are used. */
interface BasisKtx2File {
  isValid(): boolean; isUASTC(): boolean; isETC1S(): boolean; isHDR(): boolean;
  getWidth(): number; getHeight(): number; getLevels(): number; getLayers(): number; getFaces(): number; getHasAlpha(): boolean;
  getImageLevelInfo(level: number, layer: number, face: number): { origWidth: number; origHeight: number; width: number; height: number; numBlocksX: number; numBlocksY: number };
  startTranscoding(): boolean;
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(dst: Uint8Array, level: number, layer: number, face: number, format: number, getAlphaForOpaqueFormats: number, channel0: number, channel1: number): number;
  close(): void;
  delete(): void;
}
interface BasisModule { initializeBasis(): void; KTX2File?: new (data: Uint8Array) => BasisKtx2File; }

export interface BasisImageInfo {
  width: number; height: number; levels: number; layers: number; faces: number; hasAlpha: boolean;
  /** UASTC (high quality) or ETC1S (small); the choice decides which GPU formats are possible. */
  encoding: 'uastc' | 'etc1s';
}

/** One opened Basis Universal KTX2 file. Call {@link close} when done. */
export class BasisImage {
  readonly info: BasisImageInfo;
  private started = false;

  constructor(private file: BasisKtx2File) {
    // `isValid()` alone is not enough: the transcoder reports garbage input as "valid" with zero dimensions
    if (!file.isValid() || !file.getWidth() || !file.getHeight() || !file.getLevels()) { file.close(); file.delete(); throw new Error('Invalid or unsupported KTX2 / Basis file'); }
    if (file.isHDR()) { file.close(); file.delete(); throw new Error('UASTC HDR textures are not supported'); }
    this.info = {
      width: file.getWidth(), height: file.getHeight(), levels: file.getLevels(), layers: file.getLayers() || 1, faces: file.getFaces(),
      hasAlpha: file.getHasAlpha(), encoding: file.isUASTC() ? 'uastc' : 'etc1s',
    };
  }

  /** Logical (unpadded) size of mip level `level`. */
  levelSize(level: number): { width: number; height: number } {
    const i = this.file.getImageLevelInfo(level, 0, 0);
    return { width: i.origWidth, height: i.origHeight };
  }

  /** Transcode mip level `level` into `format` (a {@link BasisFormat} value); the bytes are tightly packed blocks (or RGBA8 for `RGBA32`). */
  transcode(level: number, format: number): Uint8Array {
    if (!this.started) {
      if (!this.file.startTranscoding()) throw new Error('Basis startTranscoding failed');
      this.started = true;
    }
    const out = new Uint8Array(this.file.getImageTranscodedSizeInBytes(level, 0, 0, format));
    if (!this.file.transcodeImage(out, level, 0, 0, format, 0, -1, -1)) throw new Error(`Basis transcoding of level ${level} failed`);
    return out;
  }

  /** Release the transcoder's copy of the file. */
  close(): void { this.file.close(); this.file.delete(); }
}

/** The Basis Universal transcoder (WebAssembly): turns UASTC / ETC1S KTX2 payloads into GPU texture formats. */
export class BasisTranscoder {
  private static cached: Promise<BasisTranscoder> | null = null;

  private constructor(private module: BasisModule) {}

  /** The shared transcoder; its WebAssembly module is fetched and compiled on first use. */
  static load(): Promise<BasisTranscoder> {
    if (!BasisTranscoder.cached) {
      BasisTranscoder.cached = BasisTranscoder.create().catch((error: unknown) => { BasisTranscoder.cached = null; throw error; });
      onCodecConfigChange(() => { BasisTranscoder.cached = null; });
    }
    return BasisTranscoder.cached;
  }

  /** Create a transcoder instance (the glue script is evaluated and the wasm binary instantiated). */
  private static async create(): Promise<BasisTranscoder> {
    const [glue, wasm] = await Promise.all([
      import('../vendor/basis_transcoder_glue.js?raw').then((m) => m.default),
      readWasm(getCodecConfig().basis ?? {}, async () => (await import('../vendor/basis_transcoder.wasm?url')).default),
    ]);
    const factory = evaluateGlue<(config: object) => unknown>(glue);
    const module = await new Promise<BasisModule>((resolve) => {
      const config: Record<string, unknown> = { wasmBinary: wasm, onRuntimeInitialized: () => resolve(config as unknown as BasisModule) };
      factory(config);
    });
    module.initializeBasis();
    if (!module.KTX2File) throw new Error('This Basis transcoder build cannot read KTX2 files');
    return new BasisTranscoder(module);
  }

  /** Open a Basis Universal KTX2 file. */
  open(bytes: Uint8Array): BasisImage {
    return new BasisImage(new this.module.KTX2File!(bytes));
  }
}

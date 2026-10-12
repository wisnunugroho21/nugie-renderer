/** Two parts (early / late) times the three ring slots of the storage-based path. */
const MAX_ENTRIES = 8;

/** Reusable commands with resource/geometry identity checks. Camera/light/material contents can change inside the same buffers. */
export class RetainedRenderBundles {
  private entries = new Map<string, { signature: unknown[]; bundle: GPURenderBundle; counts: [number, number, number] }>();

  get(part: string, signature: unknown[]): { bundle: GPURenderBundle; counts: [number, number, number] } | undefined {
    const e = this.entries.get(part);
    if (e && e.signature.length === signature.length && e.signature.every((v, i) => v === signature[i])) return e;
    return undefined;
  }

  /** Store a recorded bundle under `part` (evicting the oldest key beyond {@link MAX_ENTRIES}) and return the entry. */
  set(part: string, signature: unknown[], bundle: GPURenderBundle, counts: [number, number, number]): { bundle: GPURenderBundle; counts: [number, number, number] } {
    if (!this.entries.has(part) && this.entries.size >= MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
    const entry = { signature, bundle, counts };
    this.entries.set(part, entry);
    return entry;
  }
}

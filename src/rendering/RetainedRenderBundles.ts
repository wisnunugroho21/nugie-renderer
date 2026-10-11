/** Reusable commands with resource/geometry identity checks. Camera/light/material contents can change inside the same buffers. */
export class RetainedRenderBundles {
  private entries = new Map<string, { signature: unknown[]; bundle: GPURenderBundle; counts: [number, number, number] }>();

  get(part: string, signature: unknown[]): { bundle: GPURenderBundle; counts: [number, number, number] } | undefined {
    const e = this.entries.get(part);
    if (e && e.signature.length === signature.length && e.signature.every((v, i) => v === signature[i])) return e;
    return undefined;
  }

  set(part: string, signature: unknown[], bundle: GPURenderBundle, counts: [number, number, number]): void {
    if (!this.entries.has(part) && this.entries.size >= 8) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(part, { signature, bundle, counts });
  }
}

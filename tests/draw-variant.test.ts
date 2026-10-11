import { describe, expect, it } from 'vitest';
import { DRAW_VARIANT_COUNT, STANDARD_VARIANT, drawVariant, isSpecialized, variantLayoutName, variantVertexEntry } from '../src/rendering/materials/DrawVariant';

describe('draw variants', () => {
  it('shares one frozen instance per flag combination with dense unique indices', () => {
    const all = [false, true].flatMap(retained => [false, true].flatMap(directional => [false, true].map(uniformNormals => drawVariant({ retained, directional, uniformNormals }))));
    expect(new Set(all.map(v => v.index)).size).toBe(5);
    expect(Math.max(...all.map(v => v.index))).toBeLessThan(DRAW_VARIANT_COUNT);
    expect(drawVariant({ directional: true })).toBe(drawVariant({ directional: true }));
    expect(drawVariant()).toBe(STANDARD_VARIANT);
    expect(Object.isFrozen(STANDARD_VARIANT)).toBe(true);
  });

  it('keeps uniformNormals only on the non-retained directional path', () => {
    expect(drawVariant({ uniformNormals: true })).toBe(STANDARD_VARIANT);
    expect(drawVariant({ retained: true, directional: true, uniformNormals: true })).toBe(drawVariant({ retained: true, directional: true }));
    expect(drawVariant({ directional: true, uniformNormals: true }).uniformNormals).toBe(true);
  });

  it('names entries and layouts per path', () => {
    expect(isSpecialized(STANDARD_VARIANT)).toBe(false);
    expect(variantVertexEntry(STANDARD_VARIANT, 'vs_custom')).toBe('vs_custom');
    expect(variantVertexEntry(drawVariant({ retained: true, directional: true }), 'vs_main')).toBe('vs_retained');
    expect(variantVertexEntry(drawVariant({ directional: true }), 'vs_main')).toBe('vs_directional_storage');
    expect(variantVertexEntry(drawVariant({ directional: true, uniformNormals: true }), 'vs_main')).toBe('vs_directional_uniform');
    const layouts = [STANDARD_VARIANT, drawVariant({ retained: true }), drawVariant({ directional: true }), drawVariant({ retained: true, directional: true })].map(variantLayoutName);
    expect(new Set(layouts).size).toBe(4);
  });
});

import { describe, expect, it } from 'vitest';
import { rxLevel } from './signal';

describe('rxLevel', () => {
  it('uses the SPEC §8.2 thresholds, like the api rx filter', () => {
    expect(rxLevel(-20)).toBe('good');
    expect(rxLevel(-25)).toBe('good');
    expect(rxLevel(-25.01)).toBe('warning');
    expect(rxLevel(-27)).toBe('warning');
    expect(rxLevel(-27.01)).toBe('critical');
    expect(rxLevel(null)).toBe('none');
    expect(rxLevel(undefined)).toBe('none');
  });
});

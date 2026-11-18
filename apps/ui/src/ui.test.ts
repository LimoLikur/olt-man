import { describe, expect, it } from 'vitest';
import { tw } from './components/ui';

describe('tw', () => {
  it('lets a className override the base size classes only', () => {
    expect(tw('h-9 w-full px-3 focus-visible:ring-2', 'h-10 pl-9')).toBe('w-full px-3 focus-visible:ring-2 h-10 pl-9');
    expect(tw('h-9 px-2.5', 'w-48')).toBe('h-9 px-2.5 w-48');
    expect(tw('h-8 gap-1.5 px-3 text-xs', 'h-7')).toBe('gap-1.5 px-3 text-xs h-7');
    expect(tw('h-9 px-4', undefined)).toBe('h-9 px-4');
  });
});

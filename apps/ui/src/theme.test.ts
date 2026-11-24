import { describe, expect, it } from 'vitest';
import script from '../public/theme-init.js?raw';
import { parsePreference, resolveTheme, THEME_KEY } from './theme';

describe('theme', () => {
  it('reads only light and dark as explicit choices', () => {
    expect(parsePreference('light')).toBe('light');
    expect(parsePreference('dark')).toBe('dark');
    expect(parsePreference(null)).toBe('system');
    expect(parsePreference('system')).toBe('system');
    expect(parsePreference('DARK')).toBe('system');
  });

  it('follows the system theme only for the system preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('uses the same storage key as the pre-paint script', () => {
    expect(script).toContain(`localStorage.getItem('${THEME_KEY}')`);
  });
});

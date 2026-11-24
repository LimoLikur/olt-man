import { useSyncExternalStore } from 'react';

/** What the user picked; `system` follows prefers-color-scheme. */
export type ThemePreference = 'light' | 'dark' | 'system';
/** What is applied (`html.dark` or not). */
export type Theme = 'light' | 'dark';

// public/theme-init.js applies the stored theme before the first paint with the same key and rules.
export const THEME_KEY = 'oltman.theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const parsePreference = (v: string | null | undefined): ThemePreference => (v === 'light' || v === 'dark' ? v : 'system');

export const resolveTheme = (preference: ThemePreference, systemDark: boolean): Theme =>
  preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
}

// Browser storage can be unavailable (private mode, blocked site data): the theme is only a preference.
const readPreference = (): ThemePreference => {
  try {
    return parsePreference(localStorage.getItem(THEME_KEY));
  } catch {
    return 'system';
  }
};
const writePreference = (p: ThemePreference) => {
  try {
    if (p === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, p);
  } catch {
    // ignore
  }
};

const systemDark = () => window.matchMedia(DARK_QUERY).matches;

let state: ThemeState | null = null;
const listeners = new Set<() => void>();

const current = (): ThemeState => {
  if (!state) {
    const preference = readPreference();
    state = { preference, theme: resolveTheme(preference, systemDark()) };
  }
  return state;
};

function apply(preference: ThemePreference) {
  const theme = resolveTheme(preference, systemDark());
  const root = document.documentElement;
  if (root.classList.contains('dark') !== (theme === 'dark')) {
    // Without this, every element with a colour transition would fade to the new theme.
    root.classList.add('theme-switching');
    root.classList.toggle('dark', theme === 'dark');
    void getComputedStyle(root).color; // flush styles with transitions off
    requestAnimationFrame(() => root.classList.remove('theme-switching'));
  }
  const prev = current();
  if (prev.preference === preference && prev.theme === theme) return;
  state = { preference, theme };
  for (const l of listeners) l();
}

/** Once at startup: follow system theme changes and the choice made in other tabs. */
export function initTheme(): void {
  window.matchMedia(DARK_QUERY).addEventListener('change', () => apply(current().preference));
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY || e.key === null) apply(readPreference());
  });
  apply(readPreference());
}

export function setThemePreference(preference: ThemePreference): void {
  writePreference(preference);
  apply(preference);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useTheme = (): ThemeState => useSyncExternalStore(subscribe, current);

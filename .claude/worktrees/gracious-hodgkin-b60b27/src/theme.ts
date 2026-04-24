export const THEME_STORAGE_KEY = 'theme';
export const THEME_ATTRIBUTE = 'data-theme';

export const themeModes = ['light', 'dark', 'redwood'] as const;

export type ThemeMode = (typeof themeModes)[number];
export type SystemThemeMode = Exclude<ThemeMode, 'redwood'>;

const themeSet = new Set<ThemeMode>(themeModes);

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && themeSet.has(value as ThemeMode);
}

export function getStoredTheme(storage: Pick<Storage, 'getItem'> | null | undefined): ThemeMode | null {
  if (!storage) return null;

  try {
    const value = storage.getItem(THEME_STORAGE_KEY);
    return isThemeMode(value) ? value : null;
  } catch {
    return null;
  }
}

export function getSystemTheme(matchMediaFn?: typeof window.matchMedia): SystemThemeMode {
  if (!matchMediaFn) return 'light';

  try {
    return matchMediaFn('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

interface ResolveInitialThemeOptions {
  doc?: Document;
  storage?: Pick<Storage, 'getItem'> | null;
  matchMedia?: typeof window.matchMedia;
}

export function resolveInitialTheme(options: ResolveInitialThemeOptions = {}): ThemeMode {
  const rootTheme = options.doc?.documentElement?.dataset?.theme;
  if (isThemeMode(rootTheme)) return rootTheme;

  const storedTheme = getStoredTheme(options.storage);
  if (storedTheme) return storedTheme;

  return getSystemTheme(options.matchMedia);
}

interface ApplyThemeOptions {
  doc?: Document;
  storage?: Pick<Storage, 'setItem'> | null;
}

export function applyTheme(theme: ThemeMode, options: ApplyThemeOptions = {}): void {
  const root = options.doc?.documentElement;
  if (root) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'dark' ? 'dark' : 'light';
  }

  if (options.storage) {
    try {
      options.storage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore write failures for private/incognito or disabled storage.
    }
  }
}

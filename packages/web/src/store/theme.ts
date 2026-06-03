import { create } from "zustand";

/**
 * App theme store — "dark" (default) | "light".
 *
 * The active theme is applied to <html> as `data-theme="..."` (CSS variables in
 * global.css key off `:root[data-theme="light"]`) plus `style.colorScheme` (native
 * controls/scrollbars). Persisted to localStorage; index.html has a tiny inline
 * bootstrap that applies the saved theme BEFORE first paint to avoid a flash.
 */

export type Theme = "dark" | "light";

export const THEME_STORAGE_KEY = "kinetica-bi-theme";

function readInitialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable (private mode / SSR) — fall back to default.
  }
  return "dark";
}

function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.setAttribute("data-theme", theme);
  el.style.colorScheme = theme;
}

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore persistence failures
    }
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

// Apply the initial theme on module load so the store and DOM agree even if the
// index.html bootstrap is absent (e.g. tests, embeds).
applyTheme(useThemeStore.getState().theme);

import { create } from "zustand";
import { type BrandConfigPayload, type BrandingResponse, fetchBranding } from "../api/client";
import { useThemeStore, type Theme } from "./theme";

export { type BrandConfigPayload, type BrandingResponse };

export const BRAND_STORAGE_KEY = "kbi-brand-tokens";

export type BrandState = {
  // Resolved config (null = not yet fetched or default)
  config: BrandConfigPayload | null;
  // Derived from config for convenient component reads
  appName: string | null;   // config.appName ?? null
  logoUrl: string | null;   // relative URL to the logo, or null
  customCss: string | null; // config.customCss ?? null
  hasLoaded: boolean;       // true after first successful bootstrap
  // Actions
  bootstrap: () => Promise<void>;
  update: (config: BrandConfigPayload, logoUrl: string | null) => void;
};

/**
 * Apply brand token overrides to :root CSS custom properties.
 * Pure module function (not in state) — guards for DOM absence (SSR / tests).
 *
 * Uses removeProperty when value is null/undefined so Reset-to-defaults
 * clears previously-set overrides and the compiled global.css defaults resume.
 */
function applyBrandTokens(config: BrandConfigPayload | null, theme: Theme): void {
  if (typeof document === "undefined") return;
  if (!config) return; // No overrides — compiled defaults from global.css win

  const root = document.documentElement;
  const isDark = theme !== "light";

  const set = (prop: string, val: string | null | undefined): void => {
    if (val) root.style.setProperty(prop, val);
    else root.style.removeProperty(prop);
  };

  set("--accent",    isDark ? config.primaryColor : (config.lightPrimaryColor ?? config.primaryColor));
  set("--accent-2",  isDark ? config.accent2Color : (config.lightAccent2Color ?? config.accent2Color));
  set("--bg",        isDark ? config.bgColor       : (config.lightBgColor ?? config.bgColor));
  set("--panel",     isDark ? config.panelColor    : (config.lightPanelColor ?? config.panelColor));
  set("--text",      isDark ? config.textColor     : (config.lightTextColor ?? config.textColor));
  set("--muted",     isDark ? config.mutedColor    : (config.lightMutedColor ?? config.mutedColor));
  set("--border",    isDark ? config.borderColor   : (config.lightBorderColor ?? config.borderColor));
  set("--danger",    isDark ? config.dangerColor   : (config.lightDangerColor ?? config.dangerColor));
  set("--font-body", config.fontFamily);
}

/**
 * Inject (or update) a <link rel="icon"> tag to set the favicon.
 * No-op in SSR / when logoUrl is absent.
 */
function injectFavicon(logoUrl: string | null): void {
  if (typeof document === "undefined" || !logoUrl) return;
  let link = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = logoUrl;
}

// ---------------------------------------------------------------------------
// BroadcastChannel — created ONCE at module evaluation, NOT inside bootstrap.
// Guard with typeof check: bare `new BroadcastChannel()` throws in jsdom and
// would break every import of this module in the test environment.
// ---------------------------------------------------------------------------
const brandChannel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("kbi-brand-updated")
    : null;

function notifyOtherTabs(): void {
  brandChannel?.postMessage({ type: "brand-updated" });
}

// ---------------------------------------------------------------------------
// Zustand store — mirrors theme.ts structure exactly
// ---------------------------------------------------------------------------
export const useBrandStore = create<BrandState>((set) => ({
  config: null,
  appName: null,
  logoUrl: null,
  customCss: null,
  hasLoaded: false,

  /**
   * Fetch the active brand config from GET /api/branding (unauthenticated).
   * Applies token overrides, sets document.title, injects favicon, writes
   * localStorage cache (for Plan 82-02's FOUC inline script), and updates state.
   *
   * Called on app mount (in parallel with authStore.bootstrap) and on
   * BroadcastChannel message / window.focus (to pick up cross-tab changes).
   * Never throws — network/offline failures silently fall back to compiled defaults.
   *
   * NOTE: does NOT call notifyOtherTabs — initial load must NOT echo to other tabs.
   * Use update() for admin-save paths (Phase 83).
   */
  bootstrap: async () => {
    try {
      const data: BrandingResponse = await fetchBranding();

      // Apply token overrides to :root immediately
      applyBrandTokens(data.config, useThemeStore.getState().theme);

      // Set browser tab title (authoritative; overwrites static <title> in index.html)
      if (typeof document !== "undefined") {
        document.title = data.config.appName ?? "Kinetica BI";
      }

      // Inject/update favicon <link> in <head>
      injectFavicon(data.logoUrl);

      // Persist to localStorage — this is the exact shape Plan 82-02's inline script reads:
      // { ...config token keys, logoUrl, fontUrl }
      try {
        localStorage.setItem(
          BRAND_STORAGE_KEY,
          JSON.stringify({ ...data.config, logoUrl: data.logoUrl })
        );
      } catch {
        // quota / private-mode — non-fatal; FOUC guard degrades to no-brand first frame
      }

      set({
        config: data.config,
        appName: data.config.appName ?? null,
        logoUrl: data.logoUrl,
        customCss: data.config.customCss ?? null,
        hasLoaded: true,
      });
    } catch {
      // Network failure / server offline — compiled global.css defaults win.
      // Do not rethrow; App.tsx bootstrap should never be blocked on brand fetch.
    }
  },

  /**
   * Apply a brand config update (called from Phase 83 admin save).
   * Re-applies tokens, sets title, writes localStorage, updates state, and
   * posts to BroadcastChannel so other tabs pick up the change silently.
   */
  update: (newConfig: BrandConfigPayload, newLogoUrl: string | null) => {
    applyBrandTokens(newConfig, useThemeStore.getState().theme);
    if (typeof document !== "undefined") {
      document.title = newConfig.appName ?? "Kinetica BI";
    }
    injectFavicon(newLogoUrl);
    try {
      localStorage.setItem(
        BRAND_STORAGE_KEY,
        JSON.stringify({ ...newConfig, logoUrl: newLogoUrl })
      );
    } catch {
      // ignore quota / private-mode errors
    }
    set({
      config: newConfig,
      appName: newConfig.appName ?? null,
      logoUrl: newLogoUrl,
      customCss: newConfig.customCss ?? null,
    });
    notifyOtherTabs();
  },
}));

// ---------------------------------------------------------------------------
// BroadcastChannel message listener — picks up admin brand changes from other
// tabs and re-bootstraps silently (no toast / notification).
// ---------------------------------------------------------------------------
brandChannel?.addEventListener("message", () => {
  useBrandStore.getState().bootstrap();
});

// ---------------------------------------------------------------------------
// Theme subscription — re-apply brand tokens when dark ↔ light toggles.
// Created ONCE at module evaluation (not inside bootstrap) so it survives
// re-bootstrap calls and is never duplicated. Mirrors the module-level
// applyTheme() call at the bottom of theme.ts.
// ---------------------------------------------------------------------------
useThemeStore.subscribe((state) => {
  applyBrandTokens(useBrandStore.getState().config, state.theme);
});

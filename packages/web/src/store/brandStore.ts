import { create } from "zustand";
import { type BrandConfigPayload, type BrandingResponse, fetchBranding } from "../api/client";
import { useThemeStore, type Theme } from "./theme";

export { type BrandConfigPayload, type BrandingResponse };

export const BRAND_STORAGE_KEY = "kbi-brand-tokens";

export type BrandState = {
  // Resolved config (null = not yet fetched or default)
  config: BrandConfigPayload | null;
  // Derived from config for convenient component reads
  appName: string | null;      // config.appName ?? null
  logoUrl: string | null;      // relative URL to the primary logo, or null
  logoDarkUrl: string | null;  // relative URL to the dark-mode logo override, or null (BRANDUI-06)
  faviconUrl: string | null;   // dedicated favicon, or null → falls back to logoUrl (BRANDUI-07)
  customCss: string | null;    // config.customCss ?? null
  hasLoaded: boolean;          // true after first successful bootstrap
  // Actions
  bootstrap: () => Promise<void>;
  update: (config: BrandConfigPayload, logoUrl: string | null, logoDarkUrl?: string | null, faviconUrl?: string | null) => void;
  /** Re-apply the last-SAVED config to :root without touching localStorage or store state.
   *  Called by App.tsx nav guard when the user confirms leaving the branding page with
   *  unsaved changes — reverts the live :root preview back to the saved brand. */
  revertToSaved: () => void;
};

// ---------------------------------------------------------------------------
// Feel-lever helper functions (pure — no imports).
// Called from applyBrandTokens to apply density/radius/motion/type-scale
// preset values onto :root inline styles.
// ---------------------------------------------------------------------------

function applyDensityPreset(root: HTMLElement, preset: string | null): void {
  const TOKENS = ["--space-1","--space-2","--space-3","--space-4","--space-5","--space-6","--space-8","--space-10"];
  const scales: Record<string, string[]> = {
    comfortable: ["4px","8px","12px","14px","20px","24px","28px","36px"],
    spacious:    ["6px","12px","14px","18px","24px","28px","34px","44px"],
  };
  if (!preset || preset === "compact") { TOKENS.forEach(t => root.style.removeProperty(t)); return; }
  const vals = scales[preset];
  if (!vals) return;
  TOKENS.forEach((t, i) => root.style.setProperty(t, vals[i]));
}

function applyRadiusPreset(root: HTMLElement, preset: string | null): void {
  const RTOKENS = ["--radius","--radius-sm","--radius-md","--radius-lg"];
  if (!preset || preset === "default") { RTOKENS.forEach(t => root.style.removeProperty(t)); return; }
  const maps: Record<string, string[]> = {
    sharp: ["4px","2px","4px","6px"],
    round: ["20px","14px","16px","20px"],
  };
  (maps[preset] ?? []).forEach((v, i) => root.style.setProperty(RTOKENS[i], v));
}

function applyMotionPreset(root: HTMLElement, speed: string | null): void {
  if (!speed || speed === "default") {
    ["--duration-fast","--duration-base","--duration-slow"].forEach(t => root.style.removeProperty(t));
    return;
  }
  const maps: Record<string, [string, string, string]> = {
    none:    ["0ms","0ms","0ms"],
    reduced: ["50ms","100ms","150ms"],
    fast:    ["60ms","120ms","180ms"],
  };
  const [f, b, s] = maps[speed] ?? ["100ms","200ms","300ms"];
  root.style.setProperty("--duration-fast", f);
  root.style.setProperty("--duration-base", b);
  root.style.setProperty("--duration-slow", s);
}

function applyTypeScalePreset(root: HTMLElement, base: number | null): void {
  if (!base) { root.style.removeProperty("--text-base"); return; }
  root.style.setProperty("--text-base", `${base}px`);
}

/**
 * Apply brand token overrides to :root CSS custom properties.
 * Exported so BrandingSettingsPage can call it for live draft preview
 * without committing to the store (pure :root apply — no localStorage write,
 * no BroadcastChannel — that's update()'s job on Save).
 *
 * Uses removeProperty when value is null/undefined so Reset-to-defaults
 * clears previously-set overrides and the compiled global.css defaults resume.
 */
export function applyBrandTokens(config: BrandConfigPayload | null, theme: Theme): void {
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

  // Display font (Phase 83 — BRANDUI-03)
  set("--font-display", config.displayFontFamily);

  // Accent text color (Phase 83 — two-tier accent rule; dark vs light)
  set("--accent-text", isDark ? config.accentTextColor : (config.lightAccentTextColor ?? config.accentTextColor));

  // Density (--space-* scale multipliers)
  applyDensityPreset(root, config.densityPreset ?? null);

  // Radius preset
  applyRadiusPreset(root, config.radiusPreset ?? null);

  // Glow (requires --glow-opacity token in global.css body background)
  if (config.glowEnabled === false) root.style.setProperty("--glow-opacity", "0");
  else root.style.removeProperty("--glow-opacity");

  // Type scale base (only --text-base directly; other --text-* are absolute)
  applyTypeScalePreset(root, config.typeScaleBase ?? null);

  // Motion speed
  applyMotionPreset(root, config.motionSpeed ?? null);
}

/**
 * Inject, update, or REMOVE the <link rel="icon"> favicon.
 * - faviconUrl set   → create/update the link.
 * - faviconUrl null  → remove the injected link so the tab reverts to the browser
 *   default (Reset-to-default / no brand icon). Without this, a cleared favicon
 *   leaves a stale <link> and the old icon persists.
 * No-op in SSR.
 */
function injectFavicon(faviconUrl: string | null): void {
  if (typeof document === "undefined") return;
  const existing = document.querySelector("link[rel='icon']") as HTMLLinkElement | null;
  if (!faviconUrl) {
    if (existing) existing.remove();
    return;
  }
  let link = existing;
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = faviconUrl;
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
export const useBrandStore = create<BrandState>((set, get) => ({
  config: null,
  appName: null,
  logoUrl: null,
  logoDarkUrl: null,
  faviconUrl: null,
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

      // Inject/update favicon <link> — dedicated favicon if set, else the logo (BRANDUI-07).
      injectFavicon(data.faviconUrl ?? data.logoUrl);

      // Persist to localStorage — this is the exact shape Plan 82-02's inline script reads:
      // { ...config token keys, logoUrl, logoDarkUrl, faviconUrl, fontUrl }
      try {
        localStorage.setItem(
          BRAND_STORAGE_KEY,
          JSON.stringify({ ...data.config, logoUrl: data.logoUrl, logoDarkUrl: data.logoDarkUrl ?? null, faviconUrl: data.faviconUrl ?? null })
        );
      } catch {
        // quota / private-mode — non-fatal; FOUC guard degrades to no-brand first frame
      }

      set({
        config: data.config,
        appName: data.config.appName ?? null,
        logoUrl: data.logoUrl,
        logoDarkUrl: data.logoDarkUrl ?? null,
        faviconUrl: data.faviconUrl ?? null,
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
   *
   * logoDarkUrl is optional — existing callers (83-03 handleSave) that don't pass it
   * will preserve the current store value, so they are unaffected.
   */
  update: (newConfig: BrandConfigPayload, newLogoUrl: string | null, newLogoDarkUrl?: string | null, newFaviconUrl?: string | null) => {
    applyBrandTokens(newConfig, useThemeStore.getState().theme);
    if (typeof document !== "undefined") {
      document.title = newConfig.appName ?? "Kinetica BI";
    }
    // Resolve optional logo variants: use the provided value when given; else keep current store value.
    const resolvedLogoDarkUrl = newLogoDarkUrl !== undefined ? newLogoDarkUrl : get().logoDarkUrl;
    const resolvedFaviconUrl = newFaviconUrl !== undefined ? newFaviconUrl : get().faviconUrl;
    // Favicon: dedicated favicon if set, else the logo (BRANDUI-07).
    injectFavicon(resolvedFaviconUrl ?? newLogoUrl);
    try {
      localStorage.setItem(
        BRAND_STORAGE_KEY,
        JSON.stringify({ ...newConfig, logoUrl: newLogoUrl, logoDarkUrl: resolvedLogoDarkUrl, faviconUrl: resolvedFaviconUrl })
      );
    } catch {
      // ignore quota / private-mode errors
    }
    set({
      config: newConfig,
      appName: newConfig.appName ?? null,
      logoUrl: newLogoUrl,
      logoDarkUrl: resolvedLogoDarkUrl,
      faviconUrl: resolvedFaviconUrl,
      customCss: newConfig.customCss ?? null,
    });
    notifyOtherTabs();
  },

  revertToSaved: () => {
    applyBrandTokens(get().config, useThemeStore.getState().theme);
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

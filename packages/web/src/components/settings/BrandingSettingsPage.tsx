import { useState, useEffect } from "react";
import { useBrandStore } from "../../store/brandStore";
import { applyBrandTokens } from "../../store/brandStore";
import { useThemeStore } from "../../store/theme";
import { updateBrandConfig } from "../../api/client";
import type { BrandConfigPayload } from "../../api/client";
import { brandPageGuard } from "./brandPageGuard";
import "./BrandingSettingsPage.css";

/**
 * Branding settings page — single scrolling page gated on branding:manage.
 * Live-previews brand changes via applyBrandTokens (no store write until Save).
 * Mirrors RolesPage dirty-tracking (isDirty/saving, Save disabled when !isDirty).
 *
 * Leave-guard: syncs isDirty + revert into brandPageGuard so App.tsx's onSelect
 * intercept can prompt + revert before switching pages.
 *
 * The page root uses id="branding-admin-exempt" so custom CSS injected by
 * BrandStyleInjector can be scoped to exclude this page in Phase 84.
 */
export function BrandingSettingsPage() {
  const theme = useThemeStore((s) => s.theme);

  const [draft, setDraft] = useState<BrandConfigPayload>(
    () => useBrandStore.getState().config ?? {}
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Apply draft changes live to :root and mark dirty. */
  function handleDraftChange(updates: Partial<BrandConfigPayload>) {
    const next = { ...draft, ...updates };
    setDraft(next);
    setIsDirty(true);
    applyBrandTokens(next, theme);
  }

  /** Reset to Kinetica Aurora defaults: clear all overrides, keep dirty so user can save. */
  function handleReset() {
    // Pass empty config — applyBrandTokens with {} removes all overrides → Aurora defaults
    applyBrandTokens({}, theme);
    setDraft({});
    setIsDirty(true); // must stay dirty so the reset can be saved (Pitfall 1)
  }

  /** Save draft via PUT /api/branding; on success notify store + other tabs. */
  async function handleSave() {
    setSaving(true);
    try {
      const resp = await updateBrandConfig(draft);
      // Reflect saved state through the store (also notifies other tabs via BroadcastChannel)
      useBrandStore.getState().update(resp.config, useBrandStore.getState().logoUrl);
      setDraft(resp.config);
      setIsDirty(false);
    } catch (err) {
      // Errors surface via the store's error path; page stays dirty so user can retry
      console.error("Failed to save brand config:", err);
    } finally {
      setSaving(false);
    }
  }

  // Sync the leave-guard: App.tsx reads brandPageGuard before setPage to prompt + revert.
  useEffect(() => {
    brandPageGuard.isDirty = isDirty;
    brandPageGuard.revert = () => { useBrandStore.getState().revertToSaved(); };
    return () => {
      brandPageGuard.isDirty = false;
      brandPageGuard.revert = null;
    };
  }, [isDirty]);

  return (
    <div className="branding-admin" id="branding-admin-exempt">
      <div className="branding-header">
        <h2>Branding</h2>
        <div className="branding-header-actions">
          <button
            type="button"
            className="ds-btn ds-btn-ghost"
            onClick={handleReset}
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            className="ds-btn ds-btn-primary"
            disabled={!isDirty || saving}
            onClick={() => { void handleSave(); }}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="branding-sections">
        {/* Section 1: Logo & App Name */}
        <section className="branding-section" id="brand-logo">
          <h3>Logo &amp; App Name</h3>
          {/* 83-02 fills this — logo upload slot + app name field */}
        </section>

        {/* Section 2: Colors */}
        <section className="branding-section" id="brand-colors">
          <h3>Colors</h3>
          {/* 83-02 fills this — 18 react-colorful pickers (dark + light columns) + WCAG badges */}
        </section>

        {/* Section 3: Fonts */}
        <section className="branding-section" id="brand-fonts">
          <h3>Fonts</h3>
          {/* 83-02 fills this — body + display font selects */}
        </section>

        {/* Section 4: Feel */}
        <section className="branding-section" id="brand-feel">
          <h3>Feel</h3>
          {/* 83-03 fills this — density / radius / glow / type-scale / motion controls */}
        </section>

        {/* Section 5: Custom CSS */}
        <section className="branding-section" id="brand-css">
          <h3>Custom CSS</h3>
          {/* 83-03 fills this — CodeMirror CSS editor, debounced draft inject, stripped-declarations notice */}
        </section>
      </div>
    </div>
  );
}

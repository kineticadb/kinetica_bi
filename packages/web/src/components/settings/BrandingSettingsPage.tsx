import { useState, useEffect } from "react";
import { useBrandStore } from "../../store/brandStore";
import { applyBrandTokens } from "../../store/brandStore";
import { useThemeStore } from "../../store/theme";
import { updateBrandConfig, uploadBrandLogo } from "../../api/client";
import type { BrandConfigPayload } from "../../api/client";
import { brandPageGuard } from "./brandPageGuard";
import { BrandColorPicker } from "./BrandColorPicker";
import { WcagBadge } from "./WcagBadge";
import { FeelLevers } from "./FeelLevers";
import { BrandPreviewCard } from "./BrandPreviewCard";
import { CustomCssEditor } from "./CustomCssEditor";
import { LogoUploader } from "./LogoUploader";
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
 *
 * THEME-GUARD NOTE: This file is on the ALLOWLIST in theme-guard.spec.ts because
 * COLOR_FIELDS contains the Aurora default-hex palette values (the data, not chrome
 * colors). The #ffffff on-accent WCAG literal is also here for the same reason.
 */

// ── Aurora default hex values per token (dark mode) ──────────────────────────
// Read from :root in global.css (locked 2026-06-23, CHOSEN-DIRECTION.md).
// These are fallback values for the pickers when no override is set in the draft.
const DARK_DEFAULTS = {
  primaryColor: "#7f40ed",
  accent2Color: "#38bdf8",
  accentTextColor: "#c4b5fd",
  bgColor: "#0a0a12",
  panelColor: "#181628",
  textColor: "#ece9f6",
  mutedColor: "#9b95b8",
  borderColor: "#2a2742",
  dangerColor: "#fb7185",
} as const;

// Aurora default hex values per token (light mode).
// Read from :root[data-theme="light"] in global.css.
const LIGHT_DEFAULTS = {
  lightPrimaryColor: "#7f40ed",
  lightAccent2Color: "#0284c7",
  lightAccentTextColor: "#6d28d9",
  lightBgColor: "#eceaf3",
  lightPanelColor: "#f6f5fb",
  lightTextColor: "#1e1b2e",
  lightMutedColor: "#6b6490",
  lightBorderColor: "#c4c0d8",
  lightDangerColor: "#e11d48",
} as const;

interface ColorFieldDef {
  token: string;
  label: string;
  darkField: keyof typeof DARK_DEFAULTS;
  lightField: keyof typeof LIGHT_DEFAULTS;
}

/**
 * 9 token pairs — each row renders one dark + one light BrandColorPicker.
 * Token names match BrandConfigPayload field names from 83-01.
 */
const COLOR_FIELDS: ColorFieldDef[] = [
  { token: "--accent",      label: "Accent",       darkField: "primaryColor",     lightField: "lightPrimaryColor" },
  { token: "--accent-2",    label: "Accent 2",     darkField: "accent2Color",     lightField: "lightAccent2Color" },
  { token: "--accent-text", label: "Accent Text",  darkField: "accentTextColor",  lightField: "lightAccentTextColor" },
  { token: "--bg",          label: "Background",   darkField: "bgColor",          lightField: "lightBgColor" },
  { token: "--panel",       label: "Panel",        darkField: "panelColor",       lightField: "lightPanelColor" },
  { token: "--text",        label: "Text",         darkField: "textColor",        lightField: "lightTextColor" },
  { token: "--muted",       label: "Muted Text",   darkField: "mutedColor",       lightField: "lightMutedColor" },
  { token: "--border",      label: "Border",       darkField: "borderColor",      lightField: "lightBorderColor" },
  { token: "--danger",      label: "Danger",       darkField: "dangerColor",      lightField: "lightDangerColor" },
];

// ── Curated self-hosted font list ─────────────────────────────────────────────
// Only fonts installed via @fontsource-variable (Phase 80) are listed.
// No arbitrary http/https URLs — curated list only (BRANDUI-03).
export interface FontOption {
  label: string;
  css: string;
}

export const CURATED_BODY_FONTS: FontOption[] = [
  { label: "Manrope (Aurora Default)", css: '"Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: "Space Grotesk", css: '"Space Grotesk Variable", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: "System UI", css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: "Georgia (Serif)", css: 'Georgia, "Times New Roman", serif' },
];

export const CURATED_DISPLAY_FONTS: FontOption[] = [
  { label: "Space Grotesk (Aurora Default)", css: '"Space Grotesk Variable", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: "Manrope", css: '"Manrope Variable", "Segoe UI", system-ui, -apple-system, sans-serif' },
  { label: "System UI", css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: "Georgia (Serif)", css: 'Georgia, "Times New Roman", serif' },
];

export function BrandingSettingsPage() {
  const theme = useThemeStore((s) => s.theme);

  const [draft, setDraft] = useState<BrandConfigPayload>(
    () => useBrandStore.getState().config ?? {}
  );
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Set after Save when server-returned customCss differs from submitted (stripped declarations). */
  const [strippedNotice, setStrippedNotice] = useState<string | null>(null);
  /** Primary logo file chosen this session — uploaded on Save. */
  const [draftLogoFile, setDraftLogoFile] = useState<File | null>(null);
  /** Dark-mode logo override file chosen this session — uploaded on Save (BRANDUI-06). */
  const [draftDarkLogoFile, setDraftDarkLogoFile] = useState<File | null>(null);

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
    // Clear both chosen logo files so Save after Reset does not re-upload stale files (BRANDUI-06)
    setDraftLogoFile(null);
    setDraftDarkLogoFile(null);
    setIsDirty(true); // must stay dirty so the reset can be saved (Pitfall 1)
  }

  /** Save draft via PUT /api/branding (+ logo POST(s) when files were chosen). */
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      // Snapshot submitted CSS so we can diff against the sanitized version returned.
      const submittedCss = draft.customCss ?? "";

      // Upload the primary logo if a new file was chosen this session.
      let newLogoUrl: string | null = useBrandStore.getState().logoUrl;
      if (draftLogoFile) {
        const logoResp = await uploadBrandLogo(draftLogoFile, "primary");
        newLogoUrl = logoResp.logoUrl ?? null;
      }

      // Upload the dark-mode logo override if a new file was chosen (BRANDUI-06).
      let newLogoDarkUrl: string | null = useBrandStore.getState().logoDarkUrl;
      if (draftDarkLogoFile) {
        const darkResp = await uploadBrandLogo(draftDarkLogoFile, "dark");
        newLogoDarkUrl = darkResp.logoDarkUrl ?? null;
      }

      // PUT /api/branding — server sanitizes customCss and returns the cleaned config.
      const resp = await updateBrandConfig(draft);

      // Compare submitted vs server-sanitized CSS to detect stripped declarations.
      const savedCss = resp.config.customCss ?? "";
      if (savedCss !== submittedCss) {
        setStrippedNotice(
          "Some declarations were removed by the server (url()/@import/@font-face/etc.)."
        );
        setDraft((d) => ({ ...d, customCss: savedCss }));
      } else {
        setStrippedNotice(null);
      }

      // Reflect saved state through the store (writes localStorage + notifies other tabs).
      // Pass newLogoDarkUrl to thread the dark variant into the store + localStorage.
      useBrandStore.getState().update(resp.config, newLogoUrl, newLogoDarkUrl);
      setDraftLogoFile(null);
      setDraftDarkLogoFile(null);
      setIsDirty(false);
    } catch (err) {
      // Page stays dirty so the user can retry.
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

  // ── Resolved draft values (draft overrides or Aurora defaults) ──────────────
  const d = draft;

  return (
    <div className="branding-admin" id="branding-admin-exempt">
      <div className="branding-header">
        <h2>Branding</h2>
        <div className="branding-header-actions">
          <button
            type="button"
            className="ghost-sm"
            onClick={handleReset}
          >
            Reset to Defaults
          </button>
          <button
            type="button"
            className="btn-primary btn-sm"
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

          {/* App name text input */}
          <div className="ds-field brand-appname-field">
            <label className="ds-field-label" htmlFor="brand-appname">App Name</label>
            <input
              id="brand-appname"
              type="text"
              className="ds-input"
              value={d.appName ?? "Kinetica BI"}
              onChange={(e) => handleDraftChange({ appName: e.target.value })}
              placeholder="Kinetica BI"
            />
          </div>

          {/* Dual logo slots: primary (required) + dark-mode override (optional, BRANDUI-06) */}
          <div className="brand-logo-slots">
            <LogoUploader
              label="Primary logo"
              previewUrl={useBrandStore.getState().logoUrl}
              previewMode="light"
              onFileChosen={(f) => {
                setDraftLogoFile(f);
                if (f) setIsDirty(true);
              }}
            />
            <LogoUploader
              label="Dark-mode override (optional)"
              previewUrl={useBrandStore.getState().logoDarkUrl}
              previewMode="dark"
              onFileChosen={(f) => {
                setDraftDarkLogoFile(f);
                if (f) setIsDirty(true);
              }}
            />
          </div>
          <p className="brand-section-hint">
            Primary logo is shown in both modes by default. Upload a Dark-mode override to
            display a different logo when the app is in dark mode (e.g. an inverted or
            lighter variant). Uploads are validated server-side (SVG sanitized, max 256 KB).
          </p>
        </section>

        {/* Section 2: Colors — 18 pickers in dark | light columns */}
        <section className="branding-section" id="brand-colors">
          <h3>Colors</h3>

          <div className="brand-color-columns">
            {/* ── Dark column ── */}
            <div>
              <p className="brand-color-column-header">Dark</p>
              {COLOR_FIELDS.map(({ label, darkField }) => (
                <div key={darkField} className="brand-color-row">
                  <BrandColorPicker
                    label={label}
                    value={d[darkField]}
                    fallback={DARK_DEFAULTS[darkField]}
                    onChange={(hex) => handleDraftChange({ [darkField]: hex })}
                  />
                </div>
              ))}

              {/* WCAG critical-pair badges — dark column (warn-only, Save NOT blocked) */}
              <div className="brand-color-badge-row">
                <span className="ds-field-label">Text / BG:</span>
                <WcagBadge
                  fg={d.textColor ?? DARK_DEFAULTS.textColor}
                  bg={d.bgColor ?? DARK_DEFAULTS.bgColor}
                />
              </div>
              <div className="brand-color-badge-row">
                <span className="ds-field-label">Accent Text / Accent:</span>
                <WcagBadge
                  fg={d.accentTextColor ?? DARK_DEFAULTS.accentTextColor}
                  bg={d.primaryColor ?? DARK_DEFAULTS.primaryColor}
                />
              </div>
              <div className="brand-color-badge-row">
                <span className="ds-field-label">On-Accent (#fff) / Accent:</span>
                <WcagBadge
                  fg="#ffffff"
                  bg={d.primaryColor ?? DARK_DEFAULTS.primaryColor}
                />
              </div>
            </div>

            {/* ── Light column ── */}
            <div>
              <p className="brand-color-column-header">Light</p>
              {COLOR_FIELDS.map(({ label, lightField }) => (
                <div key={lightField} className="brand-color-row">
                  <BrandColorPicker
                    label={label}
                    value={d[lightField]}
                    fallback={LIGHT_DEFAULTS[lightField]}
                    onChange={(hex) => handleDraftChange({ [lightField]: hex })}
                  />
                </div>
              ))}

              {/* WCAG critical-pair badges — light column */}
              <div className="brand-color-badge-row">
                <span className="ds-field-label">Text / BG:</span>
                <WcagBadge
                  fg={d.lightTextColor ?? LIGHT_DEFAULTS.lightTextColor}
                  bg={d.lightBgColor ?? LIGHT_DEFAULTS.lightBgColor}
                />
              </div>
              <div className="brand-color-badge-row">
                <span className="ds-field-label">Accent Text / Accent:</span>
                <WcagBadge
                  fg={d.lightAccentTextColor ?? LIGHT_DEFAULTS.lightAccentTextColor}
                  bg={d.lightPrimaryColor ?? LIGHT_DEFAULTS.lightPrimaryColor}
                />
              </div>
              <div className="brand-color-badge-row">
                <span className="ds-field-label">On-Accent (#fff) / Accent:</span>
                <WcagBadge
                  fg="#ffffff"
                  bg={d.lightPrimaryColor ?? LIGHT_DEFAULTS.lightPrimaryColor}
                />
              </div>
            </div>
          </div>

          <p className="brand-theme-note">
            Live preview reflects the currently active theme. Editing the off-theme column
            (e.g. light colors while in dark mode) won&apos;t visibly re-skin the app until
            you toggle the theme. WCAG badges update for both columns simultaneously.
            Save is never blocked by a failing contrast badge.
          </p>
        </section>

        {/* Section 3: Fonts */}
        <section className="branding-section" id="brand-fonts">
          <h3>Fonts</h3>

          <div className="brand-fonts-grid">
            <div className="brand-font-field">
              <label className="ds-field-label" htmlFor="brand-font-body">Body Font</label>
              <select
                id="brand-font-body"
                className="ds-select"
                value={d.fontFamily ?? CURATED_BODY_FONTS[0].css}
                onChange={(e) => handleDraftChange({ fontFamily: e.target.value })}
              >
                {CURATED_BODY_FONTS.map((f) => (
                  <option key={f.css} value={f.css}>{f.label}</option>
                ))}
              </select>
            </div>

            <div className="brand-font-field">
              <label className="ds-field-label" htmlFor="brand-font-display">Display Font</label>
              <select
                id="brand-font-display"
                className="ds-select"
                value={d.displayFontFamily ?? CURATED_DISPLAY_FONTS[0].css}
                onChange={(e) => handleDraftChange({ displayFontFamily: e.target.value })}
              >
                {CURATED_DISPLAY_FONTS.map((f) => (
                  <option key={f.css} value={f.css}>{f.label}</option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Section 4: Feel */}
        <section className="branding-section" id="brand-feel">
          <h3>Feel</h3>
          <div className="brand-feel-layout">
            <FeelLevers draft={draft} onChange={handleDraftChange} />
            <BrandPreviewCard />
          </div>
        </section>

        {/* Section 5: Custom CSS */}
        <section className="branding-section" id="brand-css">
          <h3>Custom CSS</h3>
          <p className="brand-section-hint">
            Applied app-wide. Server sanitizes{" "}
            <code>url()</code>, <code>@import</code>, <code>@font-face</code>,{" "}
            <code>expression()</code> on Save. Reset clears this field.
          </p>
          <CustomCssEditor
            value={draft.customCss ?? ""}
            onChange={(v) => handleDraftChange({ customCss: v })}
            strippedNotice={strippedNotice}
          />
        </section>
      </div>
    </div>
  );
}

import { WcagBadge } from "./WcagBadge";

/** Resolved colors for the CURRENTLY ACTIVE theme (dark or light) — used for the
 *  WCAG summary so the preview shows contrast for the mode the app is actually in. */
export type PreviewWcag = {
  text: string;
  bg: string;
  accentText: string;
  accent: string;
  onAccent: string;
};

/**
 * BrandPreviewCard — compact card rendering representative app components
 * that re-skin live as the admin edits, because they all consume :root tokens.
 *
 * Shows: primary button, ghost button, a chip/badge, a text input, body + muted
 * text, an accent-colored label, danger text, a faux nav-item, and (when `wcag`
 * is provided) the active-theme WCAG critical-pair badges — so all the brandable
 * color/text tokens are visible as feel/color levers change.
 *
 * Mostly presentational. Uses only existing app classes and CSS tokens so it
 * naturally reflects the live :root overrides.
 */
export function BrandPreviewCard({ wcag }: { wcag?: PreviewWcag }) {
  return (
    <div className="brand-preview-card" aria-label="live component preview">
      <p className="brand-preview-card-label">Preview</p>

      {/* Buttons */}
      <div className="brand-preview-row">
        <button type="button" className="btn-primary btn-sm">
          Primary
        </button>
        <button type="button" className="ghost-sm">
          Ghost
        </button>
      </div>

      {/* Chip / badge */}
      <div className="brand-preview-row">
        <span className="ds-chip">Chip</span>
        <span className="ds-badge">Badge</span>
      </div>

      {/* Text input */}
      <div className="brand-preview-row">
        <input
          className="ds-input"
          type="text"
          placeholder="Text input"
          readOnly
          aria-label="preview input"
        />
      </div>

      {/* Text tokens: body, muted, accent, danger */}
      <div className="brand-preview-row">
        <span>Body text</span>
        <span className="text-muted">Muted text</span>
      </div>
      <div className="brand-preview-row">
        <span className="brand-preview-accent-text">Accent text label</span>
        <span className="text-danger">Danger text</span>
      </div>

      {/* Faux nav item */}
      <div className="brand-preview-row">
        <div className="brand-preview-nav-item">
          <span className="brand-preview-nav-dot" />
          <span>Nav item</span>
        </div>
      </div>

      {/* WCAG summary — active theme only (the mode the app is currently in) */}
      {wcag && (
        <div className="brand-preview-wcag">
          <div className="brand-color-badge-row">
            <span className="ds-field-label">Text / BG:</span>
            <WcagBadge fg={wcag.text} bg={wcag.bg} />
          </div>
          <div className="brand-color-badge-row">
            <span className="ds-field-label">Accent Text / BG:</span>
            <WcagBadge fg={wcag.accentText} bg={wcag.bg} />
          </div>
          <div className="brand-color-badge-row">
            <span className="ds-field-label">On-Accent (white) / Accent:</span>
            <WcagBadge fg={wcag.onAccent} bg={wcag.accent} />
          </div>
        </div>
      )}
    </div>
  );
}

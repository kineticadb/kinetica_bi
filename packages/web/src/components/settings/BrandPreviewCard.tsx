/**
 * BrandPreviewCard — compact card rendering representative app components
 * that re-skin live as the admin edits, because they all consume :root tokens.
 *
 * Shows: primary button, ghost button, a chip/badge, a text input, an accent-
 * colored label, and a faux nav-item — so component states are visible as
 * feel/color levers change.
 *
 * Pure presentational: no state, no callbacks. Uses only existing app classes
 * and CSS tokens so it naturally reflects the live :root overrides.
 */
export function BrandPreviewCard() {
  return (
    <div className="brand-preview-card" aria-label="live component preview">
      <p className="brand-preview-card-label">Preview</p>

      {/* Buttons */}
      <div className="brand-preview-row">
        <button type="button" className="ds-btn ds-btn-primary">
          Primary
        </button>
        <button type="button" className="ds-btn ds-btn-ghost">
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

      {/* Accent text */}
      <div className="brand-preview-row">
        <span className="brand-preview-accent-text">Accent text label</span>
      </div>

      {/* Faux nav item */}
      <div className="brand-preview-row">
        <div className="brand-preview-nav-item">
          <span className="brand-preview-nav-dot" />
          <span>Nav item</span>
        </div>
      </div>
    </div>
  );
}

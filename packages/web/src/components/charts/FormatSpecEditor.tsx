/**
 * FormatSpecEditor — Phase 86 Plan 01
 *
 * Shared kind picker + per-kind controls, extracted from ColumnFormatEditorModal.tsx.
 * Used by TimelineConfigPanel and NumericLineConfigPanel for the Y-axis format control.
 *
 * FRONTEND-ONLY — does NOT touch packages/server.
 * CSS classes: ds-field, ds-field-label, ds-select, config-group, config-group-label,
 *              config-hint, config-toggle — all confirmed present in global.css.
 * No invented class names. Theme tokens only (no raw hex).
 */

import {
  type FormatSpec,
  type FormatSpecNumber,
  type FormatSpecDate,
  type FormatSpecD3,
  type FormatSpecSI,
} from "../../lib/columnFormatter";

// ---------------------------------------------------------------------------
// Default spec builder (extracted from ColumnFormatEditorModal — zero logic change)
// ---------------------------------------------------------------------------
export function defaultSpecForKind(kind: FormatSpec["kind"]): FormatSpec {
  switch (kind) {
    case "number":
      return { kind: "number", thousandsSep: true, decimals: 2, currency: false, percent: false };
    case "date":
      return { kind: "date", preset: "iso" };
    case "d3":
      return { kind: "d3", specifier: "" };
    case "si":
      return { kind: "si", decimals: 1 };
    case "none":
    default:
      return { kind: "none" };
  }
}

// ---------------------------------------------------------------------------
// Sub-component: NumberControls (extracted from ColumnFormatEditorModal — zero logic change)
// ---------------------------------------------------------------------------
export function NumberControls({
  spec,
  onChange,
}: {
  spec: FormatSpecNumber;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Number format</div>

      {/* Thousands separator */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.thousandsSep}
          onChange={(e) => onChange({ ...spec, thousandsSep: e.target.checked })}
          aria-label="Thousands separator"
        />
        <span>Thousands separator</span>
      </label>

      {/* Decimal places */}
      <div className="ds-field">
        <label className="ds-field-label">Decimal places</label>
        <input
          type="number"
          min={0}
          value={spec.decimals}
          onChange={(e) => {
            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
            onChange({ ...spec, decimals: v });
          }}
          aria-label="Decimal places"
        />
      </div>

      {/* Currency toggle + symbol */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.currency !== false}
          onChange={(e) =>
            onChange({ ...spec, currency: e.target.checked ? "$" : false })
          }
          aria-label="Currency"
        />
        <span>Currency</span>
      </label>
      {spec.currency !== false && (
        <div className="ds-field">
          <label className="ds-field-label">Currency symbol</label>
          <input
            type="text"
            value={spec.currency as string}
            onChange={(e) => onChange({ ...spec, currency: e.target.value })}
            aria-label="Currency symbol"
            placeholder="$"
          />
        </div>
      )}

      {/* Percent toggle */}
      <label className="config-toggle">
        <input
          type="checkbox"
          checked={spec.percent}
          onChange={(e) => onChange({ ...spec, percent: e.target.checked })}
          aria-label="Percent"
        />
        <span>Percent (appends %, no ×100)</span>
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: DateControls (extracted from ColumnFormatEditorModal — zero logic change)
// ---------------------------------------------------------------------------
export function DateControls({
  spec,
  onChange,
}: {
  spec: FormatSpecDate;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Date format</div>

      <div className="ds-field">
        <label className="ds-field-label">Preset</label>
        <select
          className="ds-select"
          value={spec.preset}
          onChange={(e) =>
            onChange({ ...spec, preset: e.target.value as FormatSpecDate["preset"] })
          }
          aria-label="Date preset"
        >
          <option value="iso">2026-06-19</option>
          <option value="us">06/19/2026</option>
          <option value="long">Jun 19, 2026</option>
          <option value="us_time">06/19/2026 13:45</option>
          <option value="long_time">Jun 19, 2026 13:45</option>
          <option value="custom">Custom pattern…</option>
        </select>
      </div>

      {spec.preset === "custom" && (
        <div className="ds-field">
          <label className="ds-field-label">Custom pattern</label>
          <input
            type="text"
            placeholder="YYYY-MM-DD HH:mm"
            value={spec.customPattern ?? ""}
            onChange={(e) => onChange({ ...spec, customPattern: e.target.value })}
            aria-label="Custom date pattern"
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: D3Controls (extracted from ColumnFormatEditorModal — zero logic change)
// ---------------------------------------------------------------------------
export function D3Controls({
  spec,
  onChange,
}: {
  spec: FormatSpecD3;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Advanced (d3-format)</div>

      <div className="ds-field">
        <label className="ds-field-label">d3 specifier</label>
        <input
          type="text"
          value={spec.specifier}
          onChange={(e) => onChange({ ...spec, specifier: e.target.value })}
          aria-label="d3 specifier"
          placeholder=".2f"
        />
      </div>

      <div className="config-hint">
        Uses raw d3-format semantics: the <code>%</code> type multiplies by 100 here
        (unlike the Number &rarr; Percent preset which appends a literal % with no ×100).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: SIControls (extracted from ColumnFormatEditorModal — zero logic change)
// ---------------------------------------------------------------------------
export function SIControls({
  spec,
  onChange,
}: {
  spec: FormatSpecSI;
  onChange: (s: FormatSpec) => void;
}): JSX.Element {
  return (
    <div className="config-group">
      <div className="config-group-label">Smart abbreviation</div>
      <div className="ds-field">
        <label className="ds-field-label">Decimal places</label>
        <input
          type="number"
          min={0}
          value={spec.decimals}
          onChange={(e) => {
            const v = Math.max(0, parseInt(e.target.value, 10) || 0);
            onChange({ ...spec, decimals: v });
          }}
          aria-label="Decimal places"
        />
      </div>
      <div className="config-hint">
        e.g. 1,234,567 → 1.2M · 3,400,000,000 → 3.4G. Uses SI prefixes (k / M / G / T);
        decimal places ≈ significant digits after the prefix.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export: FormatSpecEditor — shared kind picker + per-kind controls
// ---------------------------------------------------------------------------
export function FormatSpecEditor({
  spec,
  onChange,
}: {
  spec: FormatSpec | null;
  onChange: (s: FormatSpec | null) => void;
}): JSX.Element {
  return (
    <>
      <div className="ds-field">
        <span className="ds-field-label">Format kind</span>
        <select
          className="ds-select"
          aria-label="Format kind"
          value={spec?.kind ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            if (val === "") {
              onChange(null);
            } else {
              onChange(defaultSpecForKind(val as FormatSpec["kind"]));
            }
          }}
        >
          <option value="">— Use column default —</option>
          <option value="none">None</option>
          <option value="number">Number</option>
          <option value="date">Date</option>
          <option value="d3">Advanced (d3-format)</option>
          <option value="si">Smart abbreviation (k / M / G / T)</option>
        </select>
      </div>

      {spec?.kind === "number" && (
        <NumberControls
          spec={spec as FormatSpecNumber}
          onChange={onChange}
        />
      )}
      {spec?.kind === "date" && (
        <DateControls
          spec={spec as FormatSpecDate}
          onChange={onChange}
        />
      )}
      {spec?.kind === "d3" && (
        <D3Controls
          spec={spec as FormatSpecD3}
          onChange={onChange}
        />
      )}
      {spec?.kind === "si" && (
        <SIControls
          spec={spec as FormatSpecSI}
          onChange={onChange}
        />
      )}
    </>
  );
}

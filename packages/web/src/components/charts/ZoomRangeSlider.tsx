/**
 * Dual-handle range slider for selecting a zoom-level range.
 *
 * Renders as a single visual track with two thumbs — one for the minimum
 * zoom and one for the maximum. Built from two overlaid `<input type="range">`
 * elements so we get native keyboard accessibility (ArrowLeft/Right + Home/End
 * adjust whichever thumb is focused) without a third-party slider library.
 *
 * Semantics:
 *   - Values are INCLUSIVE in the UI surface. `value=[3, 10]` reads as
 *     "show this layer from zoom 3 through zoom 10 (inclusive of both)."
 *   - Translation to OL's `Layer.setMinZoom` / `setMaxZoom` is the caller's
 *     responsibility (OL's minZoom is EXCLUSIVE, so caller subtracts 1 on
 *     the lower bound — see MapChartRenderer.applyZoomRangeToLayer).
 *
 * Cross-thumb guard:
 *   - When the operator drags the min thumb past the max thumb (or vice
 *     versa), we clamp so min <= max and BOTH thumbs end up at the same
 *     value (single-zoom-level visibility). The slider does NOT swap the
 *     two handles — that would invert which thumb the user is dragging
 *     mid-gesture and break the perceived pointer-to-thumb link.
 */

import type { CSSProperties } from "react";

export type ZoomRangeValue = readonly [number, number];

export type ZoomRangeSliderProps = {
  /** Current [minZoom, maxZoom] inclusive. */
  value: ZoomRangeValue;
  onChange: (next: ZoomRangeValue) => void;
  /** Slider lower bound (default 0 — OL's typical view minimum). */
  min?: number;
  /** Slider upper bound (default 28 — OL's view default maximum). */
  max?: number;
  /** Step increment (default 1 — zoom levels are typically integers). */
  step?: number;
  /** Accessible label prefix shared by both thumbs. */
  ariaLabelPrefix?: string;
};

export default function ZoomRangeSlider({
  value,
  onChange,
  min = 0,
  max = 28,
  step = 1,
  ariaLabelPrefix = "Zoom",
}: ZoomRangeSliderProps): JSX.Element {
  const [minVal, maxVal] = value;
  const range = max - min;

  const handleMinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    // Clamp: min thumb cannot exceed max thumb. When they collide, set min=max
    // (single-zoom-level visibility) — DO NOT swap (would invert pointer-to-thumb link mid-drag).
    if (v > maxVal) {
      onChange([maxVal, maxVal]);
      return;
    }
    onChange([v, maxVal]);
  };

  const handleMaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    if (v < minVal) {
      onChange([minVal, minVal]);
      return;
    }
    onChange([minVal, v]);
  };

  // Selected-track styling: percentage offsets into the slider's total range.
  // Range==0 guard prevents NaN when min===max (degenerate config).
  const leftPct = range === 0 ? 0 : ((minVal - min) / range) * 100;
  const widthPct = range === 0 ? 0 : ((maxVal - minVal) / range) * 100;
  const selectedTrackStyle: CSSProperties = {
    left: `${leftPct}%`,
    width: `${widthPct}%`,
  };

  return (
    <div className="zoom-range-slider" data-testid="zoom-range-slider">
      {/* Visual track stack: base (full grey) + selected (accent) overlay. */}
      <div className="zoom-range-track" aria-hidden="true" />
      <div
        className="zoom-range-track-selected"
        aria-hidden="true"
        style={selectedTrackStyle}
      />
      {/* Two overlaid native range inputs — only the thumbs are interactable;
          the tracks of these inputs are hidden via CSS. The visual track
          above is decorative-only. */}
      <input
        type="range"
        className="zoom-range-thumb zoom-range-thumb-min"
        aria-label={`${ariaLabelPrefix} minimum`}
        min={min}
        max={max}
        step={step}
        value={minVal}
        onChange={handleMinChange}
        data-testid="zoom-range-min"
      />
      <input
        type="range"
        className="zoom-range-thumb zoom-range-thumb-max"
        aria-label={`${ariaLabelPrefix} maximum`}
        min={min}
        max={max}
        step={step}
        value={maxVal}
        onChange={handleMaxChange}
        data-testid="zoom-range-max"
      />
      {/* Numeric labels — locked to thumb positions so operators see the
          exact selected range. */}
      <div className="zoom-range-labels" aria-hidden="true">
        <span data-testid="zoom-range-min-label">{minVal}</span>
        <span data-testid="zoom-range-max-label">{maxVal}</span>
      </div>
    </div>
  );
}

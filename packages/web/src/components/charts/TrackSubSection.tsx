/**
 * Phase 40 Plan 01 Task 2: TrackSubSection — pure controlled React component.
 *
 * Reads/writes `config.track_config` (JSON string) via coalesceTrackConfig +
 * JSON.stringify. Ships DORMANT in Plan 40-01 (no host mount in
 * KineticaWmsLayerForm.tsx); Plan 40-02 wires it in.
 *
 * LOCKS (Phase 40 CONTEXT.md):
 *   - Do NOT write to trackConfig.lineWidth — only trailSize (TRACKLINEWIDTHS)
 *   - Do NOT auto-disable on field clearing
 *   - Do NOT reset track_config on render-mode flip
 *   - Do NOT add WKB-column gate (track detection is column-name-based)
 *   - trackIdAttr dropdown excludes spatial-bound columns (xColumn/yColumn/spatialColumn)
 *   - trackOrderAttr dropdown shows ALL columns (operator-locked)
 *   - useEffect auto-seed fires on columns change ONLY, only when track_config is null
 *
 * REQ coverage (TRACK-V17-01, TRACK-V17-02, TRACK-V17-04, TRACK-V17-06).
 * TRACK-V17-03 (host-mount gate) and TRACK-V17-05 (fingerprint regression)
 * are Plan 40-02.
 */

import { useCallback, useEffect, useMemo } from "react";
import type { Column } from "../../lib/columnTypes";
import { isTrackTable } from "../../lib/trackDetect";
import {
  coalesceTrackConfig,
  TRACK_DEFAULTS,
  type TrackConfig,
} from "../../lib/trackConfig";
import { POINT_SHAPES } from "../../lib/wmsUrlBuilder";
import {
  normalizeAARRGGBB,
  rgbFromAARRGGBB,
  alphaFromAARRGGBB,
  joinAARRGGBB,
} from "../../lib/colorHex";

type TrackSubSectionProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: Column[];
  isValid?: (valid: boolean) => void;
};

export default function TrackSubSection({
  config,
  onChange,
  columns = [],
  isValid,
}: TrackSubSectionProps): JSX.Element {

  // ── Deserialize track_config ──────────────────────────────────────
  const trackConfig: TrackConfig = useMemo(
    () => coalesceTrackConfig((config.track_config as string | null) ?? null),
    [config.track_config],
  );

  // ── Detect track table from column shapes ─────────────────────────
  const detectedColumns = useMemo(() => isTrackTable(columns), [columns]);

  // ── Central patch helper (ONLY write site — NEVER lineWidth) ──────
  const patchTrack = useCallback(
    (next: TrackConfig) => {
      onChange({ ...config, track_config: JSON.stringify(next) });
    },
    [config, onChange],
  );

  // ── Auto-detect useEffect (TRACK-V17-01) ─────────────────────────
  // Fires on columns change ONLY. Seeds defaults only when track_config is null
  // (no persisted state). MUST NOT overwrite a persisted config even when
  // isTrackTable returns truthy — Pitfall 4 lock.
  useEffect(() => {
    const detected = isTrackTable(columns);
    const hasPersistedState = (config.track_config as string | null) !== null;
    if (detected && !hasPersistedState) {
      patchTrack({
        enabled: true,
        trackIdAttr: detected.trackIdCol,
        trackOrderAttr: detected.orderCol,
        headColor: TRACK_DEFAULTS.headColor,
        trailColor: TRACK_DEFAULTS.trailColor,
        headSize: TRACK_DEFAULTS.headSize,
        trailSize: TRACK_DEFAULTS.trailSize,
        headShape: TRACK_DEFAULTS.headShape,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns]);
  // NOTE: patchTrack + config.track_config intentionally EXCLUDED from deps —
  // auto-seed fires on columns-change only (mirrors CbConfigForm cardinality probe pattern).

  // ── isValid useEffect (TRACK-V17-06 — always true, no required-completeness gate) ──
  useEffect(() => {
    isValid?.(true);
  }, [isValid]);

  // ── Override checkbox handler ─────────────────────────────────────
  const onToggleEnabled = (checked: boolean) => {
    if (!checked) {
      // Preserve all fields; only flip enabled.
      patchTrack({ ...trackConfig, enabled: false });
      return;
    }
    // Re-enable: seed defaults for undefined fields, preserve operator-set values.
    patchTrack({
      trackIdAttr: detectedColumns?.trackIdCol ?? "TRACKID",
      trackOrderAttr: detectedColumns?.orderCol ?? "TIMESTAMP",
      headColor: TRACK_DEFAULTS.headColor,
      trailColor: TRACK_DEFAULTS.trailColor,
      headSize: TRACK_DEFAULTS.headSize,
      trailSize: TRACK_DEFAULTS.trailSize,
      headShape: TRACK_DEFAULTS.headShape,
      ...trackConfig, // operator-set values override defaults
      enabled: true,
    });
  };

  // ── Column eligibility (trackIdAttr excludes spatial-bound) ───────
  const spatialBound = useMemo(() => {
    const s = new Set<string>();
    const xCol = (config.xColumn as string) ?? "";
    const yCol = (config.yColumn as string) ?? "";
    const wktCol = (config.spatialColumn as string) ?? "";
    if (xCol) s.add(xCol);
    if (yCol) s.add(yCol);
    if (wktCol) s.add(wktCol);
    return s;
  }, [config.xColumn, config.yColumn, config.spatialColumn]);

  const trackIdColumns = useMemo(
    () => columns.filter((c) => !spatialBound.has(c.name)),
    [columns, spatialBound],
  );
  // trackOrderAttr: ALL columns (no exclusion) — operator-locked per CONTEXT.md

  return (
    <div className="config-group" role="group" aria-labelledby="map-track-params-label">
      <label id="map-track-params-label" className="config-group-label">
        TRACK PARAMS
      </label>

      <label className="config-toggle">
        <input
          type="checkbox"
          aria-label="Treat as track table"
          checked={trackConfig.enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
        />
        Treat as track table
        {detectedColumns !== null && (
          <span className="config-hint config-hint-inline" data-testid="track-auto-detected-hint">
            {" (auto-detected)"}
          </span>
        )}
      </label>

      {trackConfig.enabled && (
        <>
          {/* Track ID column — excludes spatial-bound columns */}
          <label className="config-field">
            Track ID column
            <select
              className="ds-select"
              aria-label="Track ID column"
              value={trackConfig.trackIdAttr ?? ""}
              disabled={columns.length === 0}
              onChange={(e) => patchTrack({ ...trackConfig, trackIdAttr: e.target.value || undefined })}
            >
              <option value="">— select —</option>
              {trackIdColumns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* Track order column — ALL columns (no exclusion) */}
          <label className="config-field">
            Track order column
            <select
              className="ds-select"
              aria-label="Track order column"
              value={trackConfig.trackOrderAttr ?? ""}
              disabled={columns.length === 0}
              onChange={(e) => patchTrack({ ...trackConfig, trackOrderAttr: e.target.value || undefined })}
            >
              <option value="">— select —</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>

          {/* Head color — two-control AARRGGBB (mirrors raster pointColor) */}
          <label className="config-color-field">
            Head color
            <div className="config-color-row">
              <input
                type="color"
                className="config-color-picker"
                aria-label="Head color (RGB)"
                value={`#${rgbFromAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor)}`}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    headColor: joinAARRGGBB(
                      alphaFromAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor),
                      e.target.value.replace("#", ""),
                    ),
                  })
                }
              />
              <input
                type="text"
                className="config-color-text"
                aria-label="Head color (AARRGGBB hex)"
                value={normalizeAARRGGBB(trackConfig.headColor || TRACK_DEFAULTS.headColor)}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    headColor: normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.headColor),
                  })
                }
              />
            </div>
          </label>

          {/* Head size — numeric 1-20 */}
          <label className="config-field">
            Head size
            <input
              type="number"
              className="ds-input"
              aria-label="Head size"
              min={1}
              max={20}
              value={trackConfig.headSize ?? TRACK_DEFAULTS.headSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? TRACK_DEFAULTS.headSize : Math.max(1, Math.min(20, v));
                patchTrack({ ...trackConfig, headSize: clamped });
              }}
            />
          </label>

          {/* Head shape — full 12-value POINT_SHAPES */}
          <label className="config-field">
            Head shape
            <select
              className="ds-select"
              aria-label="Head shape"
              value={trackConfig.headShape ?? TRACK_DEFAULTS.headShape}
              onChange={(e) => patchTrack({ ...trackConfig, headShape: e.target.value })}
            >
              <option value="">— select —</option>
              {POINT_SHAPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          {/* Trail color — two-control AARRGGBB */}
          <label className="config-color-field">
            Trail color
            <div className="config-color-row">
              <input
                type="color"
                className="config-color-picker"
                aria-label="Trail color (RGB)"
                value={`#${rgbFromAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor)}`}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    trailColor: joinAARRGGBB(
                      alphaFromAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor),
                      e.target.value.replace("#", ""),
                    ),
                  })
                }
              />
              <input
                type="text"
                className="config-color-text"
                aria-label="Trail color (AARRGGBB hex)"
                value={normalizeAARRGGBB(trackConfig.trailColor || TRACK_DEFAULTS.trailColor)}
                onChange={(e) =>
                  patchTrack({
                    ...trackConfig,
                    trailColor: normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.trailColor),
                  })
                }
              />
            </div>
          </label>

          {/* Line width — single field writing to trailSize ONLY (NOT lineWidth) */}
          <label className="config-field">
            Line width
            <input
              type="number"
              className="ds-input"
              aria-label="Line width"
              min={1}
              max={20}
              value={trackConfig.trailSize ?? TRACK_DEFAULTS.trailSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const clamped = isNaN(v) ? TRACK_DEFAULTS.trailSize : Math.max(1, Math.min(20, v));
                // CRITICAL: writes to trailSize ONLY. Never lineWidth — Phase 40 CONTEXT lock.
                patchTrack({ ...trackConfig, trailSize: clamped });
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}

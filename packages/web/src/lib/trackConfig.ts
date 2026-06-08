/**
 * Phase 40: lib/trackConfig.ts — extracted from wmsUrlBuilder.ts (Phase 38).
 *
 * Pure helper module for track_config JSON parsing + form defaults.
 * Phase 38 kept these inline; Phase 40 form UI is the 2nd consumer (per Phase 38
 * CONTEXT.md "Phase 40 may extract if a 2nd consumer surfaces"), so the
 * extraction earns its keep.
 *
 * Backward-compat: `wmsUrlBuilder.ts` re-exports TrackConfig + coalesceTrackConfig
 * so the line-440 callsite and any Phase 38 spec imports continue to resolve
 * without churn.
 */

export type TrackConfig = {
  enabled: boolean;
  trackIdAttr?: string;       // default "TRACKID" when omitted at emission time
  trackOrderAttr?: string;    // default "TIMESTAMP" when omitted at emission time
  xCol?: string;              // Phase 52: x/longitude column for track points
  yCol?: string;              // Phase 52: y/latitude column for track points
  headColor?: string;         // 8-char AARRGGBB — emitted as TRACKHEADCOLORS
  trailColor?: string;        // 8-char AARRGGBB — emitted as TRACKLINECOLORS
  headSize?: number;          // emitted as TRACKHEADSIZES
  trailSize?: number;         // emitted as TRACKLINEWIDTHS
  lineWidth?: number;         // alias for trailSize; trailSize takes precedence when both set
  headShape?: string;         // emitted as TRACKHEADSHAPES (TRACKFIX-V19-05: was TRACKMARKERSHAPES — OQ-9 misnaming fixed)
  // TRACKFIX-V19-05: New marker params (distinct from head params)
  markerColor?: string;       // 8-char AARRGGBB — emitted as TRACKMARKERCOLORS
  markerShape?: string;       // emitted as TRACKMARKERSHAPES (distinct from headShape/TRACKHEADSHAPES)
  markerSize?: number;        // emitted as TRACKMARKERSIZES
};

/** Parse raw track_config JSON. Returns { enabled: false } on null or parse failure. */
export function coalesceTrackConfig(raw: string | null): TrackConfig {
  if (raw === null) return { enabled: false };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "enabled" in parsed) {
      return parsed as TrackConfig;
    }
    return { enabled: false };
  } catch {
    return { enabled: false };
  }
}

/**
 * Form defaults applied when the override checkbox flips enabled false→true and
 * the corresponding field is currently undefined. Each default is applied
 * INDEPENDENTLY per field — only undefined fields get seeded; operator-set values
 * are preserved verbatim.
 *
 * TRACKFIX-V19-05: Updated to Kinetica WMS doc defaults (2026-06-07 operator-confirmed):
 *   white head / green line / blue marker
 * Size defaults: head visibly larger than marker by default.
 * Shape default: circle for head, none for marker.
 */
export const TRACK_DEFAULTS = {
  headColor: "FFFFFFFF",   // white (Kinetica WMS doc default)
  trailColor: "FF00FF00",  // green (Kinetica WMS doc default)
  headSize: 10,            // Kinetica WMS doc default
  trailSize: 3,            // Kinetica WMS doc default
  headShape: "circle",
  // TRACKFIX-V19-05: New marker defaults (blue marker, hidden by default with shape "none")
  markerColor: "FF0000FF", // blue
  markerShape: "none",
  markerSize: 2,
} as const;

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
  headColor?: string;         // 8-char AARRGGBB
  trailColor?: string;        // 8-char AARRGGBB
  headSize?: number;
  trailSize?: number;         // emitted as TRACKLINEWIDTHS
  lineWidth?: number;         // alias for trailSize; trailSize takes precedence when both set
  headShape?: string;
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
 * Color defaults mirror wmsUrlBuilder Track-block emission defaults (line ~440-470).
 * Size defaults: head visibly larger than trail by default.
 * Shape default: circle (the only safe spike-confirmed default).
 */
export const TRACK_DEFAULTS = {
  headColor: "FFFF0000",   // red
  trailColor: "FF0000FF",  // blue
  headSize: 8,
  trailSize: 2,
  headShape: "circle",
} as const;

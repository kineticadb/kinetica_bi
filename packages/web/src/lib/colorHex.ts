/**
 * AARRGGBB color-hex helpers — used by the WMS color params POINTCOLORS,
 * SHAPEFILLCOLORS, SHAPELINECOLORS.
 *
 * Kinetica WMS accepts an 8-char hex where the first 2 chars are the alpha
 * channel (00 = fully transparent, FF = fully opaque) and the last 6 are RGB.
 *
 * Storage contract on widget configs:
 *   - New values are stored as 8-char upper-case AARRGGBB (no '#' prefix).
 *   - Legacy values may be 6-char RRGGBB; readers MUST normalize via
 *     `normalizeAARRGGBB` to handle backward compatibility. A 6-char value
 *     reads as fully opaque (alpha = FF).
 *
 * All helpers are pure / side-effect-free and tolerate:
 *   - leading '#'
 *   - lower-case input
 *   - undefined / empty input (returns the supplied fallback)
 *   - malformed input (returns the supplied fallback)
 */

/**
 * Normalize an arbitrary color-hex string to 8-char upper-case AARRGGBB.
 *
 * - 6-char RRGGBB → "FF" + RRGGBB (opaque)
 * - 8-char AARRGGBB → upper-cased
 * - 4-char ARGB or 3-char RGB → fallback (we don't support short-form here)
 * - leading '#' is stripped
 * - undefined / empty / malformed → returns `fallback`
 */
export function normalizeAARRGGBB(hex: string | undefined, fallback: string = "FFFFFFFF"): string {
  if (!hex) return fallback.toUpperCase();
  const clean = hex.replace(/^#/, "").toUpperCase();
  if (!/^[0-9A-F]+$/.test(clean)) return fallback.toUpperCase();
  if (clean.length === 8) return clean;
  if (clean.length === 6) return "FF" + clean;
  return fallback.toUpperCase();
}

/** Extract the last 6 chars (RGB) from a normalized AARRGGBB hex. */
export function rgbFromAARRGGBB(hex: string | undefined, fallback: string = "FFFFFFFF"): string {
  return normalizeAARRGGBB(hex, fallback).slice(2);
}

/** Extract the first 2 chars (alpha) from a normalized AARRGGBB hex. */
export function alphaFromAARRGGBB(hex: string | undefined, fallback: string = "FFFFFFFF"): string {
  return normalizeAARRGGBB(hex, fallback).slice(0, 2);
}

/**
 * Join a 2-char alpha and a 6-char RGB into an 8-char AARRGGBB.
 * Tolerates '#' prefix and short-form values via clamp / pad.
 */
export function joinAARRGGBB(alpha: string, rgb: string): string {
  const a = alpha.replace(/^#/, "").toUpperCase().padStart(2, "0").slice(-2);
  const r = rgb.replace(/^#/, "").toUpperCase().padStart(6, "0").slice(-6);
  return a + r;
}

/** Convert a 0-100 percent (alpha) to a 2-char hex byte 00-FF. */
export function alphaPercentToHex(pct: number): string {
  if (!Number.isFinite(pct)) return "FF";
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const byte = Math.round((clamped / 100) * 255);
  return byte.toString(16).padStart(2, "0").toUpperCase();
}

/** Convert a 2-char hex byte (00-FF) to a 0-100 percent (rounded). */
export function alphaHexToPercent(hex: string): number {
  const byte = parseInt(hex.replace(/^#/, ""), 16);
  if (Number.isNaN(byte)) return 100;
  return Math.round((Math.max(0, Math.min(255, byte)) / 255) * 100);
}

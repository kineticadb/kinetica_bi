/**
 * WCAG contrast helpers using the colord a11y plugin.
 * extend([a11yPlugin]) is called ONCE at module level (not per render).
 */
import { colord, extend } from "colord";
import a11yPlugin from "colord/plugins/a11y";

extend([a11yPlugin]);

/**
 * Returns the WCAG contrast ratio between bg and fg (1–21).
 * bg and fg are any valid CSS color strings (e.g. "#000000").
 */
export function contrastRatio(bg: string, fg: string): number {
  return colord(bg).contrast(fg);
}

/**
 * Returns true if ratio passes the WCAG AA threshold.
 * Default threshold = 4.5 (AA normal text/UI).
 * Pass threshold = 3.0 for AA large text or large UI components.
 */
export function passesAA(ratio: number, threshold = 4.5): boolean {
  return ratio >= threshold;
}

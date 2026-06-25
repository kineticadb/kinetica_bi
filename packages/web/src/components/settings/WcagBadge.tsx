import { contrastRatio, passesAA } from "./wcag";

interface WcagBadgeProps {
  /** Foreground color (text/icon) */
  fg: string;
  /** Background color */
  bg: string;
  /** AA contrast threshold. Default 4.5 (AA normal). Use 3.0 for large/UI. */
  threshold?: number;
}

/**
 * Warn-only WCAG contrast badge.
 * Renders a pass/fail indicator for the fg-on-bg color pair.
 * Save is NEVER blocked by a failing badge.
 */
export function WcagBadge({ fg, bg, threshold = 4.5 }: WcagBadgeProps) {
  const ratio = contrastRatio(bg, fg);
  const pass = passesAA(ratio, threshold);
  return (
    <span
      className={pass ? "wcag-pass" : "wcag-fail"}
      title={`Contrast ratio ${ratio.toFixed(2)}:1 — WCAG AA ${pass ? "passes" : "FAIL"} (threshold ${threshold}:1)`}
    >
      {ratio.toFixed(1)}:1 {pass ? "AA" : "FAIL"}
    </span>
  );
}

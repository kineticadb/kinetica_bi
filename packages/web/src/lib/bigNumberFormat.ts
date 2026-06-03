/**
 * Pure formatting + conditional-color logic for the Big Number widget.
 * Extracted from BigNumberRenderer so the value-format cases (incl. Date) and
 * the range-based color rules are unit-testable without the render harness.
 */

export type BigNumberColorRule = { min?: number; max?: number; color: string };

export type BigNumberFormatConfig = {
  format?: string;
  decimals?: number;
  color?: string;
  colorRules?: BigNumberColorRule[];
};

/**
 * Format a raw cell value for display per the configured format.
 *  - number   → locale string with `decimals` fraction digits
 *  - percent  → fixed-decimals + "%"
 *  - currency → "$" + locale string
 *  - compact  → Intl compact notation (1.2K)
 *  - date     → epoch (ms; tolerates seconds when |v| < 1e11) or parseable string → localized date
 * Non-numeric values fall back to their string form (or "—" when nullish).
 */
export function formatBigNumberValue(rawValue: unknown, cfg: BigNumberFormatConfig): string {
  // Absent value reads as an em-dash, not "0" (Number(null) === 0 would otherwise coerce).
  if (rawValue === null || rawValue === undefined || rawValue === "") return "—";
  const format = cfg.format || "number";
  const decimals = cfg.decimals ?? 0;
  const numValue = typeof rawValue === "number" ? rawValue : Number(rawValue);

  if (format === "date") {
    const ms = !isNaN(numValue)
      ? (Math.abs(numValue) < 1e11 ? numValue * 1000 : numValue)
      : Date.parse(String(rawValue));
    const d = new Date(ms);
    return isNaN(d.getTime()) ? String(rawValue ?? "—") : d.toLocaleDateString();
  }

  if (isNaN(numValue)) return String(rawValue ?? "—");

  switch (format) {
    case "percent":
      return numValue.toFixed(decimals) + "%";
    case "currency":
      return "$" + numValue.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    case "compact":
      return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: decimals }).format(numValue);
    default:
      return numValue.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }
}

/**
 * Resolve the value color: the first rule whose [min, max) range contains the
 * numeric value wins (either bound optional → open-ended). Falls back to
 * `baseColor` when the value is non-numeric or no rule matches.
 */
export function pickBigNumberColor(
  rawValue: unknown,
  baseColor: string,
  colorRules: BigNumberColorRule[] | undefined,
): string {
  const numValue = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (isNaN(numValue) || !Array.isArray(colorRules)) return baseColor;
  for (const rule of colorRules) {
    const minOk = rule.min === undefined || rule.min === null || numValue >= rule.min;
    const maxOk = rule.max === undefined || rule.max === null || numValue < rule.max;
    if (minOk && maxOk && rule.color) return rule.color;
  }
  return baseColor;
}

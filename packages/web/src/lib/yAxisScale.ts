/**
 * yAxisScale.ts — single source of truth for Y-axis scale props across
 * TimelineRenderer / NumericLineRenderer / WidgetRenderer (bar).
 *
 * Mirrors the customWhere.ts precedent: pure lib, zero React / Recharts /
 * Zustand / network imports, colocated spec.
 *
 * Rules:
 *   - Absent / undefined mode → returns {} (byte-identical no-op — YAXIS-V119-04).
 *   - "zero"  → { domain: [0, "auto"] }
 *   - "smart" → { domain: ["auto", "auto"] }  (no forced 0 — YAXIS-V119-02)
 *   - "log"   → { scale: "log", domain: [<smallest positive value>, "auto"], allowDataOverflow: true }
 *               NaN / Infinity / non-positive values are excluded from the positive-min search.
 *               If no positive value exists → {} (graceful degrade — YAXIS-V119-03).
 *
 * Consumer: spread the returned object onto <YAxis> props in recharts.
 *   Example: <YAxis {...yAxisScaleProps(widget.yAxisMode, dataValues)} />
 */

/** The three explicit Y-axis scale modes. */
export type YAxisScaleMode = "zero" | "smart" | "log";

/** Recharts axis-prop subset returned by yAxisScaleProps. Empty object → emit NOTHING (byte-identical). */
export type YAxisScaleAxisProps = {
  domain?: [number | "auto", number | "auto"];
  scale?: "log";
  allowDataOverflow?: boolean;
};

/**
 * Maps a Y-axis scale mode to recharts axis props.
 *
 * @param mode   - The scale mode, or undefined (absent config).
 * @param values - The numeric data values used to compute the log lower bound.
 *                 Only inspected when mode === "log". May be empty.
 * @returns      - An object ready to spread onto a recharts <YAxis> element.
 *                 Returns {} for undefined mode or log with no positive data.
 */
export function yAxisScaleProps(
  mode: YAxisScaleMode | undefined,
  values: number[],
): YAxisScaleAxisProps {
  if (mode === undefined) return {}; // YAXIS-V119-04: absent → no props (byte-identical)
  if (mode === "zero") return { domain: [0, "auto"] };
  if (mode === "smart") return { domain: ["auto", "auto"] }; // YAXIS-V119-02: no forced 0

  // mode === "log": find smallest finite positive value
  let posMin = Infinity;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v > 0 && v < posMin) {
      posMin = v;
    }
  }

  if (posMin === Infinity) return {}; // no positive data → graceful degrade (YAXIS-V119-03)

  return { scale: "log", domain: [posMin, "auto"], allowDataOverflow: true };
}

/**
 * Phase 39 Plan 02+03: CbConfigForm — full implementation.
 *
 * Reads/writes `config.cb_config` (JSON string) via coalesceCbConfig + JSON.stringify.
 * NEVER reads or writes legacy cb-column / classbreak-array fields from Phase 38
 * hard cutover — all writes go through patchCb → JSON.stringify(cbConfig).
 *
 * Sections:
 *   1. Column picker with WKB + spatial-bound exclusion (CB-V17-08)
 *   2. Form-level Advanced header → "Treat numeric column as categorical" override
 *   3. Categorical UX: <other> toggle + probeCardinality wiring + value validation (CB-V17-04)
 *   4. Auto-suggest button + N slider + modal-confirm + AbortController (CB-V17-06)
 *   5. Break-row builder: value / color / label / remove / add (CB-V17-02/03/05)
 *   6. Per-row advanced chevron: 5 fields (pointSize/pointShape/shapeLineWidth/
 *      shapeLineColor/shapeFillColor) (CB-V17-07)
 *   7. [+ Add break] button + validity hint
 *   8. isValid signaling on breaks.length + value-presence + categorical duplicate check
 *
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark, faChevronRight, faChevronDown } from "@fortawesome/free-solid-svg-icons";
import { isIntegerColumnType, type Column } from "../../lib/columnTypes";
import {
  coalesceCbConfig,
  createDefaultBreak,
  filterCbEligibleColumns,
  detectValsTypeFromColumn,
  PALETTE_COLORS,
  type CbBreak,
  type CbConfig,
} from "../../lib/cbConfig";
import {
  normalizeAARRGGBB,
  rgbFromAARRGGBB,
  alphaFromAARRGGBB,
  joinAARRGGBB,
} from "../../lib/colorHex";
import { probeCardinality } from "../../lib/cardinalityProbe";
import { useToastStore } from "../../store/toast";
import { quantileFn, topValuesFn, columnStatsFn } from "../../api/client";
import { CB_COLOR_THEMES, getCbColorTheme, themeColorsFor } from "../../lib/cbColorThemes";
import { POINT_SHAPES } from "../../lib/wmsUrlBuilder";

type CbConfigFormProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns: Column[];
  isValid?: (valid: boolean) => void;
  /** "schema.table" string for probeCardinality. Plan 39-03 consumes. */
  tableRef?: string;
  /** Separate schema + table for quantileFn. Plan 39-03 consumes.
   *  When the parent layer is bound to a dynamic view, pass schema="" and
   *  tableName=<materialized view name> (a bare unprefixed identifier) — the
   *  server SQL builders emit `FROM ${tableName}` directly in that case. */
  schema?: string;
  tableName?: string;
  /**
   * When set, the Auto-suggest button is disabled and shows this string as the
   * hover tooltip. Phase 44 follow-up: dynamic-view-bound layers must wait for
   * materialization before we can run top-values/column-stats/quantile queries
   * against the view; if the view isn't materialized yet, pass a reason like
   * "Materialize this dynamic view to enable auto-suggest" so the operator
   * understands they need to define breaks manually until materialization.
   */
  autoSuggestDisabledReason?: string;
};

// ── Cardinality state machine ───────────────────────────────────────
type CardinalityState =
  | null
  | { state: "loading" }
  | { state: "ok"; count: number }
  | { state: "error" };

// Alpha (AA in AARRGGBB) for shape FILL when derived from a break's point color.
// "Slightly transparent" — 0xCC ≈ 80% opacity so fills read clearly but let
// overlapping polygons blend. Shape LINE matches the point color exactly.
const SHAPE_FILL_ALPHA = "CC";

/**
 * Derive shape line + fill colors from a break's point color (used by Auto-suggest
 * and Apply-color-theme): line = the point color verbatim; fill = same RGB with a
 * slightly-transparent alpha so it visually tracks the point color.
 */
function shapeColorsFromPoint(pointColor: string): {
  shapeLineColor: string;
  shapeFillColor: string;
} {
  const normalized = normalizeAARRGGBB(pointColor, "FF000000");
  return {
    shapeLineColor: normalized,
    shapeFillColor: joinAARRGGBB(SHAPE_FILL_ALPHA, rgbFromAARRGGBB(normalized)),
  };
}

export default function CbConfigForm({
  config,
  onChange,
  columns,
  isValid,
  tableRef,
  schema,
  tableName,
  autoSuggestDisabledReason,
}: CbConfigFormProps): JSX.Element {
  // ── Deserialize cb_config ────────────────────────────────────────
  const cbConfig: CbConfig = coalesceCbConfig((config.cb_config as string | null) ?? null);

  // ── Per-row advanced reveal state ────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const toggleExpanded = (i: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  // ── Form-level Advanced section reveal ──────────────────────────
  const [advancedOpen, setAdvancedOpen] = useState<boolean>(false);

  // ── Eligible columns + spatial-bound set ────────────────────────
  const spatialBound = new Set(
    [config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn]
      .filter((v) => typeof v === "string" && v.length > 0) as string[],
  );
  const eligibleColumns = useMemo(
    () => filterCbEligibleColumns(columns, spatialBound),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn],
  );
  const hasWkbColumns = useMemo(
    () =>
      columns.some((c) => {
        const t = c.type.toLowerCase();
        return t.includes("bytes") || t.includes("wkb");
      }),
    [columns],
  );

  // ── Central patch helper (ONLY write site — NEVER legacy fields) ─
  const patchCb = useCallback(
    (next: CbConfig) => {
      onChange({ ...config, cb_config: JSON.stringify(next) });
    },
    [config, onChange],
  );

  // ── "Force categorical" override derived from cbConfig ──────────
  const currentColumn = columns.find((c) => c.name === cbConfig.attr);
  const columnIsNumeric = detectValsTypeFromColumn(currentColumn) === "numeric";
  const advancedForceCategorical = cbConfig.valsType === "categorical" && columnIsNumeric;
  const onToggleForceCategorical = (checked: boolean) => {
    const newValsType: "numeric" | "categorical" = checked ? "categorical" : "numeric";
    const nextBreaks = cbConfig.breaks.map((b) => ({
      ...b,
      value: newValsType === "numeric" ? 0 : "",
      min: newValsType === "numeric" ? (b.min ?? 0) : undefined,
      max: newValsType === "numeric" ? (b.max ?? 0) : undefined,
    }));
    patchCb({ ...cbConfig, valsType: newValsType, breaks: nextBreaks });
  };

  // ── Cardinality probe state ──────────────────────────────────────
  const [cardinality, setCardinality] = useState<CardinalityState>(null);
  const probeAbortRef = useRef<AbortController | null>(null);
  const warnFiredRef = useRef<boolean>(false);

  // ── Cardinality probe runner ─────────────────────────────────────
  const runProbe = useCallback(
    async (col: string, ref: string) => {
      if (probeAbortRef.current) probeAbortRef.current.abort();
      const controller = new AbortController();
      probeAbortRef.current = controller;
      warnFiredRef.current = false;
      setCardinality({ state: "loading" });
      try {
        const count = await probeCardinality(ref || "unknown", col, controller.signal);
        setCardinality({ state: "ok", count });
        if (count > 256) {
          useToastStore.getState().showToast(
            "Too many distinct values — Kinetica classbreak supports up to 256.",
            "error",
          );
        } else if (count > 100 && !warnFiredRef.current) {
          warnFiredRef.current = true;
          useToastStore.getState().showToast(
            "That's a lot of breakpoints — consider a heatmap or numerical range instead.",
            "permission",
          );
        }
      } catch (err: unknown) {
        if ((err as { name?: string })?.name === "AbortError") return;
        setCardinality({ state: "error" });
      }
    },
    [],
  );

  // ── Column picker handler ─────────────────────────────────────────
  const onPickCbColumn = (newAttr: string) => {
    const newCol = columns.find((c) => c.name === newAttr);
    const detectedType = detectValsTypeFromColumn(newCol);
    // Override: if advanced "force categorical" is checked AND new column is numeric,
    // keep valsType=categorical; otherwise use detected type.
    const newValsType =
      cbConfig.valsType === "categorical" && advancedForceCategorical
        ? "categorical"
        : detectedType;
    const typeChanged = cbConfig.valsType !== newValsType;
    let nextBreaks: CbBreak[] = cbConfig.breaks.map((b) => ({
      ...b,
      value: typeChanged ? (newValsType === "numeric" ? 0 : "") : b.value,
      min: typeChanged ? (newValsType === "numeric" ? 0 : undefined) : b.min,
      max: typeChanged ? (newValsType === "numeric" ? 0 : undefined) : b.max,
    }));
    // Categorical column-change rule: auto-toggle includeOtherBucket=true + append <other> row
    let nextIncludeOther = cbConfig.includeOtherBucket;
    if (typeChanged && newValsType === "categorical") {
      nextIncludeOther = true;
      const hasOther = nextBreaks.some((b) => b.value === "<other>");
      if (!hasOther) {
        const otherRow: CbBreak = {
          ...createDefaultBreak("categorical", nextBreaks.length),
          value: "<other>",
        };
        nextBreaks = [...nextBreaks, otherRow];
      }
    }
    patchCb({
      ...cbConfig,
      attr: newAttr,
      valsType: newValsType,
      breaks: nextBreaks,
      includeOtherBucket: nextIncludeOther,
    });
    setCardinality(null);
    warnFiredRef.current = false;
    if (newAttr && newValsType === "categorical") {
      runProbe(newAttr, tableRef ?? "");
    }
  };

  // ── <other> bucket toggle handler ───────────────────────────────
  const onToggleOtherBucket = (checked: boolean) => {
    const next: CbConfig = { ...cbConfig, includeOtherBucket: checked };
    if (checked) {
      const hasOther = cbConfig.breaks.some((b) => b.value === "<other>");
      if (!hasOther) {
        const otherRow: CbBreak = {
          ...createDefaultBreak("categorical", cbConfig.breaks.length),
          value: "<other>",
        };
        next.breaks = [...cbConfig.breaks, otherRow];
      }
    } else {
      next.breaks = cbConfig.breaks.filter((b) => b.value !== "<other>");
    }
    patchCb(next);
  };

  // ── Add / remove / update break handlers ────────────────────────
  const addBreak = () => {
    const newBreak = createDefaultBreak(cbConfig.valsType, cbConfig.breaks.length);
    patchCb({ ...cbConfig, breaks: [...cbConfig.breaks, newBreak] });
  };

  const removeBreak = (idx: number) => {
    patchCb({ ...cbConfig, breaks: cbConfig.breaks.filter((_, i) => i !== idx) });
    // Collapse the removed row from expanded set, shift indices down
    setExpandedRows((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  };

  const updateBreak = (idx: number, patch: Partial<CbBreak>) => {
    patchCb({
      ...cbConfig,
      breaks: cbConfig.breaks.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    });
  };

  // ── Color theme apply (ColorBrewer) ──────────────────────────────
  // Recolor all break rows using the theme's palette variant tuned for the
  // current break count; repeats colors when breaks > palette length.
  const applyColorTheme = (themeId: string) => {
    const theme = getCbColorTheme(themeId);
    if (!theme || cbConfig.breaks.length === 0) return;
    const colors = themeColorsFor(theme, cbConfig.breaks.length);
    patchCb({
      ...cbConfig,
      breaks: cbConfig.breaks.map((b, i) => ({
        ...b,
        color: colors[i],
        // Shape line/fill track the new point color (fill slightly transparent).
        ...shapeColorsFromPoint(colors[i]),
      })),
    });
  };

  // ── Auto-suggest state ───────────────────────────────────────────
  const [nValue, setNValue] = useState<number>(5);
  // Numeric classification method (categorical always uses top-values).
  const [cbMethod, setCbMethod] = useState<"quantile" | "equal" | "stddev">("quantile");
  const [autoSuggestInFlight, setAutoSuggestInFlight] = useState<boolean>(false);
  const [autoSuggestError, setAutoSuggestError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<boolean>(false);
  const autoSuggestAbortRef = useRef<AbortController | null>(null);

  // ── Categorical value suggestions (datalist) ─────────────────────
  // For string columns, fetch the top-50 distinct values so each break's value
  // input offers a dropdown of suggestions — while still accepting free text
  // (native <datalist> is non-restrictive). Best-effort: failures are silent.
  const [valueSuggestions, setValueSuggestions] = useState<string[]>([]);
  const suggestAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // Phase 44 follow-up: empty schema is VALID (dv-bound layer — tableName holds
    // a bare materialized-view identifier). Guard against undefined-not-empty.
    if (
      cbConfig.valsType !== "categorical" ||
      !cbConfig.attr ||
      schema === undefined ||
      !tableName
    ) {
      setValueSuggestions([]);
      return;
    }
    if (suggestAbortRef.current) suggestAbortRef.current.abort();
    const controller = new AbortController();
    suggestAbortRef.current = controller;
    topValuesFn({ schema, table: tableName, column: cbConfig.attr, n: 50 }, controller.signal)
      .then(({ values }) => {
        if (!controller.signal.aborted) setValueSuggestions(values);
      })
      .catch(() => {
        // Suggestions are best-effort; ignore errors (incl. AbortError).
      });
    return () => controller.abort();
  }, [schema, tableName, cbConfig.attr, cbConfig.valsType]);

  // ── Auto-suggest runner ──────────────────────────────────────────
  const runAutoSuggest = useCallback(async () => {
    // Phase 44 follow-up: empty schema is VALID (dv-bound layer querying a bare
    // materialized-view identifier). Guard against undefined-not-empty.
    if (schema === undefined || !tableName || !cbConfig.attr) return;
    // Abort any in-flight request
    if (autoSuggestAbortRef.current) {
      autoSuggestAbortRef.current.abort();
    }
    const controller = new AbortController();
    autoSuggestAbortRef.current = controller;
    setAutoSuggestInFlight(true);
    setAutoSuggestError(null);
    try {
      const oldBreaks = cbConfig.breaks;
      const advancedFrom = (idx: number) => {
        const old = idx < oldBreaks.length ? oldBreaks[idx] : null;
        const color = old?.color ?? PALETTE_COLORS[idx % PALETTE_COLORS.length];
        return {
          color,
          label: old?.label ?? "",
          pointSize: old?.pointSize ?? 5,
          pointShape: old?.pointShape ?? "circle",
          shapeLineWidth: old?.shapeLineWidth ?? 1,
          // Shape line/fill track the point color (fill slightly transparent).
          ...shapeColorsFromPoint(color),
        };
      };

      if (cbConfig.valsType === "categorical") {
        // Categorical Auto-suggest: top-N distinct values by frequency (GROUP BY + COUNT).
        const { values } = await topValuesFn(
          { schema, table: tableName, column: cbConfig.attr, n: nValue },
          controller.signal,
        );
        const valueRows: CbBreak[] = values.map((v, idx) => ({
          value: v,
          ...advancedFrom(idx),
        }));
        // Preserve the <other> sink bucket when the toggle is on (append at end).
        const newBreaks =
          cbConfig.includeOtherBucket
            ? [...valueRows, { value: "<other>", ...advancedFrom(valueRows.length) }]
            : valueRows;
        patchCb({ ...cbConfig, breaks: newBreaks });
      } else {
        // Numeric classification → N ranges, method-dependent.
        const round2 = (x: number) => Math.round(x * 100) / 100;
        // Phase 44 follow-up: Kinetica CB_VALS REQUIRES every break to have both
        // bounds (`lo:hi`, lo inclusive, hi exclusive). Open-ended ranges are not
        // a valid Kinetica config. We close the outer buckets with the column's
        // true min/max from columnStatsFn so the first bucket runs [colMin, b0)
        // and the last runs [b_{N-2}, colMax + nudge).
        //
        // NUDGE: Because the upper bound is EXCLUSIVE, a row with value === colMax
        // would fall outside every bucket. We extend the last bucket's max by:
        //   - integer columns: +1   (preserves clean integer boundaries)
        //   - other (float/decimal): +0.01  (matches round2 precision; harmless)
        // Type detected from the columns prop using cbConfig.attr; defaults to
        // integer nudge when the column metadata is missing (safer — rounds up).
        const attrColType = columns.find((c) => c.name === cbConfig.attr)?.type;
        const lastBucketNudge = isIntegerColumnType(attrColType) ? 1 : 0.01;

        const rangesFromBoundaries = (
          boundaries: number[],
          fullMin: number,
          fullMax: number,
        ): { min: number; max: number }[] =>
          Array.from({ length: boundaries.length + 1 }, (_, i) => ({
            min: i === 0 ? round2(fullMin) : boundaries[i - 1],
            max: i < boundaries.length ? boundaries[i] : round2(fullMax + lastBucketNudge),
          }));

        let ranges: { min: number; max: number }[];
        if (cbMethod === "equal") {
          // Equal Interval: N equal-width closed bins spanning [min, max + nudge].
          const { min, max } = await columnStatsFn(
            { schema, table: tableName, column: cbConfig.attr },
            controller.signal,
          );
          const width = (max - min) / nValue;
          ranges = Array.from({ length: nValue }, (_, i) => ({
            min: round2(min + i * width),
            max: i === nValue - 1
              ? round2(max + lastBucketNudge)
              : round2(min + (i + 1) * width),
          }));
        } else if (cbMethod === "stddev") {
          // Standard Deviation: 1σ-wide bands centered on the mean. Outer classes
          // close to the column's true min/max (Kinetica requires closed ranges).
          const { min, max, mean, stddev } = await columnStatsFn(
            { schema, table: tableName, column: cbConfig.attr },
            controller.signal,
          );
          const boundaries = Array.from({ length: nValue - 1 }, (_, idx) => {
            const k = idx + 1;
            return round2(mean + (k - nValue / 2) * stddev);
          });
          ranges = rangesFromBoundaries(boundaries, min, max);
        } else {
          // Quantile: NTILE bucket boundaries (N-1 interior cut-points). Parallel-
          // fetch the column stats so we can close the outer buckets with the column's
          // true min/max (Kinetica requires closed ranges).
          const [{ min, max }, { breaks: boundaries }] = await Promise.all([
            columnStatsFn(
              { schema, table: tableName, column: cbConfig.attr },
              controller.signal,
            ),
            quantileFn(
              { schema, table: tableName, column: cbConfig.attr, n: nValue },
              controller.signal,
            ),
          ]);
          ranges = rangesFromBoundaries(boundaries, min, max);
        }

        const newBreaks: CbBreak[] = ranges.map((r, idx) => ({
          value: 0,
          min: r.min,
          max: r.max,
          ...advancedFrom(idx),
        }));
        patchCb({ ...cbConfig, breaks: newBreaks });
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) return;
      if ((err as { name?: string })?.name === "AbortError") return;
      const msg = (err as { message?: string })?.message ?? "Unknown error";
      setAutoSuggestError(`Auto-suggest failed: ${msg}`);
      useToastStore.getState().showToast(`Auto-suggest failed: ${msg}`, "error");
    } finally {
      if (autoSuggestAbortRef.current === controller) {
        setAutoSuggestInFlight(false);
        autoSuggestAbortRef.current = null;
      }
    }
  }, [schema, tableName, cbConfig, nValue, cbMethod, patchCb]);

  // ── Auto-suggest click handler ───────────────────────────────────
  const onAutoSuggestClick = () => {
    if (cbConfig.breaks.length > 0) {
      setShowConfirm(true);
    } else {
      runAutoSuggest();
    }
  };

  // ── isValid signaling ────────────────────────────────────────────
  useEffect(() => {
    if (!isValid) return;
    if (cbConfig.breaks.length < 2) {
      isValid(false);
      return;
    }
    const allValuesPresent = cbConfig.breaks.every((b) => {
      if (cbConfig.valsType === "numeric") {
        // Numeric ranges require finite min < max on every row (incl. the open
        // edges left by Auto-suggest, which the operator must fill before save).
        return (
          typeof b.min === "number" &&
          Number.isFinite(b.min) &&
          typeof b.max === "number" &&
          Number.isFinite(b.max) &&
          b.min < b.max
        );
      }
      // categorical: <other> sentinel always valid; others must be non-empty
      if (b.value === "<other>") return true;
      return typeof b.value === "string" && b.value.length > 0;
    });
    if (!allValuesPresent) {
      isValid(false);
      return;
    }
    // Categorical-only: no duplicate non-empty values (excluding <other>)
    if (cbConfig.valsType === "categorical") {
      const seen = new Set<string>();
      for (const b of cbConfig.breaks) {
        if (b.value === "<other>") continue;
        const v = String(b.value);
        if (seen.has(v)) {
          isValid(false);
          return;
        }
        seen.add(v);
      }
    }
    isValid(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cbConfig.breaks.length, JSON.stringify(cbConfig.breaks.map((b) => [b.value, b.min, b.max])), cbConfig.valsType]);

  // ── Derived inline error state for categorical rows ──────────────
  const breakErrors: Record<number, string> = {};
  if (cbConfig.valsType === "categorical") {
    const seenValues = new Map<string, number>(); // value → first row index
    cbConfig.breaks.forEach((b, i) => {
      if (b.value === "<other>") return;
      if (typeof b.value !== "string" || b.value.length === 0) {
        breakErrors[i] = "Value cannot be empty";
        return;
      }
      const v = String(b.value);
      if (seenValues.has(v)) {
        breakErrors[i] = "Duplicate value";
        breakErrors[seenValues.get(v)!] = "Duplicate value";
      } else {
        seenValues.set(v, i);
      }
    });
  }

  // ── Hard-cap derived state ───────────────────────────────────────
  const hardCap = cardinality?.state === "ok" && cardinality.count > 256;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="config-group" role="group" aria-labelledby="cb-config-form-label">
      <label id="cb-config-form-label" className="config-group-label">
        CLASS BREAK PARAMS
      </label>

      {/* ── Column picker ─────────────────────────────────────── */}
      <label className="ds-field-label" htmlFor="cb-attr">
        CB column
      </label>
      <select
        id="cb-attr"
        className="ds-select"
        aria-label="CB column"
        value={cbConfig.attr}
        onChange={(e) => onPickCbColumn(e.target.value)}
      >
        <option value="">— select —</option>
        {eligibleColumns.map((col) => (
          <option key={col.name} value={col.name}>
            {col.name}
          </option>
        ))}
      </select>

      {/* WKB hint — always shown when WKB columns are present in the table (CB-V17-08) */}
      {hasWkbColumns && (
        <div className="config-hint" style={{ color: "var(--muted)" }}>
          WKB columns not supported for classbreak in v1.7
        </div>
      )}
      {/* Empty hint — only when no WKB and no eligible columns */}
      {eligibleColumns.length === 0 && !hasWkbColumns && (
        <div className="config-hint">No CB-eligible columns on this table.</div>
      )}

      {/* ── Form-level Advanced section ───────────────────────── */}
      <button
        type="button"
        className="ghost cb-advanced-header"
        aria-expanded={advancedOpen}
        onClick={() => setAdvancedOpen((v) => !v)}
      >
        <FontAwesomeIcon icon={advancedOpen ? faChevronDown : faChevronRight} />
        {" Advanced"}
      </button>
      {advancedOpen && (
        <div className="cb-advanced-panel">
          <label>
            <input
              type="checkbox"
              aria-label="Treat numeric column as categorical"
              checked={advancedForceCategorical}
              disabled={!columnIsNumeric || cbConfig.attr === ""}
              onChange={(e) => onToggleForceCategorical(e.target.checked)}
            />
            {" Treat numeric column as categorical"}
          </label>
        </div>
      )}

      {/* ── Cardinality probe loading hint (shown whenever probe in-flight) ── */}
      {cardinality?.state === "loading" && (
        <div className="config-hint">Counting distinct values…</div>
      )}

      {/* ── Categorical UX (Plan 39-03) ───────────────────────── */}
      {cbConfig.valsType === "categorical" && (
        <div className="cb-categorical-section">
          {/* Cardinality probe state hints (non-loading) */}
          {cardinality?.state === "ok" && cardinality.count > 256 && (
            <div className="config-hint config-cardinality-warn" style={{ color: "#ef4444" }}>
              <strong>Too many distinct values</strong>
              <div>Kinetica&apos;s classbreak mode supports up to 256 categories.</div>
            </div>
          )}
          {cardinality?.state === "ok" && cardinality.count > 100 && cardinality.count <= 256 && (
            <div className="config-hint config-cardinality-warn" style={{ color: "var(--accent)" }}>
              <strong>That&apos;s a lot of breakpoints</strong>
            </div>
          )}
          {cardinality?.state === "error" && (
            <div className="config-hint" style={{ color: "#ef4444" }}>
              Could not count distinct values. Try again.
            </div>
          )}

          {/* <other> bucket toggle */}
          <label className="cb-other-toggle">
            <input
              type="checkbox"
              aria-label="Include <other> bucket"
              checked={cbConfig.includeOtherBucket ?? false}
              onChange={(e) => onToggleOtherBucket(e.target.checked)}
            />
            Include &lt;other&gt; bucket
          </label>
          {!cbConfig.includeOtherBucket && (
            <div className="config-hint" style={{ color: "var(--muted)" }}>
              NULL values will not appear in the map.
            </div>
          )}
        </div>
      )}

      {/* ── Auto-suggest panel — numeric (method-based) OR categorical (top values) ── */}
      {cbConfig.attr !== "" && (
        <div className="cb-autosuggest-panel">
          {/* Numeric classification method picker (categorical always uses top values). */}
          {cbConfig.valsType === "numeric" && (
            <label className="cb-method-label">
              Method
              <select
                className="ds-select"
                aria-label="Classification method"
                value={cbMethod}
                onChange={(e) => setCbMethod(e.target.value as "quantile" | "equal" | "stddev")}
              >
                <option value="quantile">Quantile (equal count)</option>
                <option value="equal">Equal Interval</option>
                <option value="stddev">Standard Deviation</option>
              </select>
            </label>
          )}
          <label className="cb-autosuggest-n-label">
            N: <span data-testid="cb-n-value">{nValue}</span>
            <input
              type="range"
              aria-label="N (number of break rows)"
              min={2}
              max={16}
              step={1}
              value={nValue}
              onChange={(e) => setNValue(parseInt(e.target.value, 10))}
            />
          </label>
          <button
            type="button"
            className="btn-primary cb-autosuggest-button"
            aria-label="Auto-suggest breaks"
            disabled={
              cbConfig.attr === "" ||
              autoSuggestInFlight ||
              autoSuggestDisabledReason !== undefined
            }
            title={
              autoSuggestDisabledReason !== undefined
                ? autoSuggestDisabledReason
                : cbConfig.attr === ""
                  ? "Select a column for auto-suggest"
                  : cbConfig.valsType === "categorical"
                    ? "Fill breaks with the most common values"
                    : "Fill breaks using the selected classification method"
            }
            onClick={onAutoSuggestClick}
          >
            {autoSuggestInFlight ? "Running…" : "Auto-suggest breaks"}
          </button>
          {autoSuggestError && (
            <div
              className="cb-autosuggest-error"
              data-testid="cb-autosuggest-error"
              style={{ color: "#ef4444", fontSize: "0.85em" }}
            >
              {autoSuggestError}
            </div>
          )}
          {showConfirm && (
            <div
              className="cb-autosuggest-confirm"
              role="dialog"
              aria-modal="true"
              aria-labelledby="cb-confirm-label"
              data-testid="cb-autosuggest-confirm"
            >
              <p id="cb-confirm-label">
                Replace {cbConfig.breaks.length} break rows with{" "}
                {cbConfig.valsType === "categorical"
                  ? `the top ${nValue} values`
                  : `${nValue} ${
                      cbMethod === "equal"
                        ? "equal-interval"
                        : cbMethod === "stddev"
                          ? "standard-deviation"
                          : "quantile"
                    } ranges`}?
              </p>
              <button
                type="button"
                className="btn-primary"
                aria-label="Replace breaks"
                onClick={() => {
                  setShowConfirm(false);
                  runAutoSuggest();
                }}
              >
                Replace
              </button>
              <button
                type="button"
                className="ghost"
                aria-label="Cancel auto-suggest"
                onClick={() => setShowConfirm(false)}
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Break rows container ──────────────────────────────── */}
      {/* Color theme picker — recolors all breaks with a ColorBrewer palette tuned
          to the break count (repeats colors when breaks > palette length). Acts as
          a one-shot action: resets to the placeholder after applying. */}
      {cbConfig.breaks.length > 0 && (
        <label className="ds-field-label cb-theme-label" htmlFor="cb-color-theme">
          Color theme
          <select
            id="cb-color-theme"
            className="ds-select"
            aria-label="Color theme"
            value=""
            onChange={(e) => {
              if (e.target.value) applyColorTheme(e.target.value);
            }}
          >
            <option value="">Apply a color theme…</option>
            {(["Sequential", "Diverging", "Qualitative"] as const).map((group) => (
              <optgroup key={group} label={group}>
                {CB_COLOR_THEMES.filter((t) => t.group === group).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      )}

      {/* Shared suggestion list for categorical value inputs (top-50 distinct values).
          Non-restrictive: inputs referencing it still accept free text. */}
      {valueSuggestions.length > 0 && (
        <datalist id="cb-value-suggestions">
          {valueSuggestions.map((v) => (
            <option key={v} value={v} />
          ))}
        </datalist>
      )}

      <div className="config-classbreak-rows" data-testid="cb-rows">
        {cbConfig.breaks.map((b, i) => (
          <div key={i} className="config-classbreak-row" data-row-index={i}>
            {/* Per-row chevron toggle */}
            <button
              type="button"
              className="ghost-sm cb-row-chevron"
              aria-label={`Toggle advanced for row ${i + 1}`}
              onClick={() => toggleExpanded(i)}
            >
              <FontAwesomeIcon icon={expandedRows.has(i) ? faChevronDown : faChevronRight} />
            </button>

            {/* Row label span */}
            <span className="config-classbreak-row-label">Break {i + 1}</span>

            {/* Value input — <other> chip vs. numeric vs. categorical text */}
            {b.value === "<other>" ? (
              <span
                className="cb-other-chip"
                data-testid={`cb-other-chip-${i}`}
              >
                &lt;other&gt;
              </span>
            ) : cbConfig.valsType === "numeric" ? (
              <span className="cb-range-inputs">
                <input
                  type="number"
                  aria-label={`Min for break ${i + 1}`}
                  placeholder="Min (incl.)"
                  value={typeof b.min === "number" ? b.min : ""}
                  onChange={(e) =>
                    updateBreak(i, {
                      min: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
                <span className="cb-range-sep">:</span>
                <input
                  type="number"
                  aria-label={`Max for break ${i + 1}`}
                  placeholder="Max (excl.)"
                  value={typeof b.max === "number" ? b.max : ""}
                  onChange={(e) =>
                    updateBreak(i, {
                      max: e.target.value === "" ? undefined : Number(e.target.value),
                    })
                  }
                />
              </span>
            ) : (
              <input
                type="text"
                aria-label={`Value for break ${i + 1}`}
                list="cb-value-suggestions"
                placeholder="Value (type or pick)"
                value={String(b.value ?? "")}
                onChange={(e) => updateBreak(i, { value: e.target.value })}
              />
            )}

            {/* Color picker pair — canonical AARRGGBB idiom (mirrors raster pointColor) */}
            <input
              type="color"
              className="config-color-picker"
              aria-label={`Color (RGB) for break ${i + 1}`}
              value={`#${rgbFromAARRGGBB(b.color || PALETTE_COLORS[i % PALETTE_COLORS.length])}`}
              onChange={(e) =>
                updateBreak(i, {
                  color: joinAARRGGBB(
                    alphaFromAARRGGBB(b.color || PALETTE_COLORS[i % PALETTE_COLORS.length]),
                    e.target.value.replace("#", ""),
                  ),
                })
              }
            />
            <input
              type="text"
              className="config-color-text"
              aria-label={`Color (AARRGGBB hex) for break ${i + 1}`}
              value={normalizeAARRGGBB(b.color || PALETTE_COLORS[i % PALETTE_COLORS.length])}
              onChange={(e) =>
                updateBreak(i, {
                  color: normalizeAARRGGBB(
                    e.target.value,
                    PALETTE_COLORS[i % PALETTE_COLORS.length],
                  ),
                })
              }
            />

            {/* Label input */}
            <input
              type="text"
              aria-label={`Label for break ${i + 1}`}
              placeholder="Label (optional)"
              value={b.label ?? ""}
              onChange={(e) => updateBreak(i, { label: e.target.value })}
            />

            {/* Remove button — disabled on <other> row */}
            <button
              type="button"
              className="ghost-sm ghost-danger"
              aria-label={`Remove break ${i + 1}`}
              disabled={b.value === "<other>"}
              onClick={() => removeBreak(i)}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>

            {/* Inline validation error (categorical only) */}
            {breakErrors[i] && (
              <div
                className="cb-row-error"
                style={{ color: "#ef4444", fontSize: "0.85em" }}
                data-testid={`cb-row-error-${i}`}
              >
                {breakErrors[i]}
              </div>
            )}

            {/* Per-row advanced panel */}
            {expandedRows.has(i) && (
              <div className="cb-row-advanced" data-testid={`cb-row-advanced-${i}`}>
                <label>
                  Point size
                  <input
                    type="number"
                    aria-label={`Point size for break ${i + 1}`}
                    min={1} max={20}
                    step={1}
                    value={b.pointSize ?? 5}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      const clamped = isNaN(v) ? 5 : Math.max(1, Math.min(20, v));
                      updateBreak(i, { pointSize: clamped });
                    }}
                  />
                </label>
                <label>
                  Point shape
                  <select
                    className="ds-select"
                    aria-label={`Point shape for break ${i + 1}`}
                    value={b.pointShape ?? "circle"}
                    onChange={(e) => updateBreak(i, { pointShape: e.target.value })}
                  >
                    {POINT_SHAPES.map((shape) => (
                      <option key={shape} value={shape}>
                        {shape}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Shape line width
                  <input
                    type="number"
                    aria-label={`Shape line width for break ${i + 1}`}
                    min={1} max={20}
                    step={1}
                    value={b.shapeLineWidth ?? 1}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      const clamped = isNaN(v) ? 1 : Math.max(1, Math.min(20, v));
                      updateBreak(i, { shapeLineWidth: clamped });
                    }}
                  />
                </label>
                <label>
                  Shape line color
                  <span className="config-color-row">
                    <input
                      type="color"
                      className="config-color-picker"
                      aria-label={`Shape line color (RGB) for break ${i + 1}`}
                      value={`#${rgbFromAARRGGBB(b.shapeLineColor || "FF000000")}`}
                      onChange={(e) =>
                        updateBreak(i, {
                          shapeLineColor: joinAARRGGBB(
                            alphaFromAARRGGBB(b.shapeLineColor || "FF000000"),
                            e.target.value.replace("#", ""),
                          ),
                        })
                      }
                    />
                    <input
                      type="text"
                      className="config-color-text"
                      aria-label={`Shape line color (AARRGGBB hex) for break ${i + 1}`}
                      value={normalizeAARRGGBB(b.shapeLineColor || "FF000000")}
                      onChange={(e) =>
                        updateBreak(i, {
                          shapeLineColor: normalizeAARRGGBB(e.target.value, "FF000000"),
                        })
                      }
                    />
                  </span>
                </label>
                <label>
                  Shape fill color
                  <span className="config-color-row">
                    <input
                      type="color"
                      className="config-color-picker"
                      aria-label={`Shape fill color (RGB) for break ${i + 1}`}
                      value={`#${rgbFromAARRGGBB(b.shapeFillColor || "FFFFFFFF")}`}
                      onChange={(e) =>
                        updateBreak(i, {
                          shapeFillColor: joinAARRGGBB(
                            alphaFromAARRGGBB(b.shapeFillColor || "FFFFFFFF"),
                            e.target.value.replace("#", ""),
                          ),
                        })
                      }
                    />
                    <input
                      type="text"
                      className="config-color-text"
                      aria-label={`Shape fill color (AARRGGBB hex) for break ${i + 1}`}
                      value={normalizeAARRGGBB(b.shapeFillColor || "FFFFFFFF")}
                      onChange={(e) =>
                        updateBreak(i, {
                          shapeFillColor: normalizeAARRGGBB(e.target.value, "FFFFFFFF"),
                        })
                      }
                    />
                  </span>
                </label>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ── [+ Add break] button ───────────────────────────────── */}
      <button
        type="button"
        className="config-classbreak-add ghost-sm"
        aria-label="+ Add break"
        disabled={cbConfig.attr === "" || hardCap}
        onClick={addBreak}
      >
        + Add break
      </button>

      {/* Validity hint */}
      {cbConfig.breaks.length < 2 && (
        <div className="config-hint" style={{ color: "var(--muted)" }}>
          Add at least 2 break rows
        </div>
      )}
    </div>
  );
}

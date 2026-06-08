/**
 * Phase 12: KineticaWmsLayerForm — extracted from MapConfigPanel.tsx (Phase 11).
 *
 * Pure controlled component: renders spatial-mode picker, spatial column dropdowns,
 * render-mode picker, mode-specific param groups (raster/heatmap/classbreak/contour),
 * and the classbreak builder. Receives layer config via {config, onChange, columns}.
 *
 * NO TABLE PICKER. Per CONTEXT.md, the layer's table binding is a top-level field on
 * DashboardLayerDto (`layer.table_id`), not a JSON-blob field. The table dropdown is
 * rendered by LayersModal (Plan 04) ABOVE this form. When the user changes the table,
 * LayersModal runs autoSuggestSpatialMode + clears stale columns + calls
 * onPatch(layerId, {table_id, config: {...}}) — the form just sees a new {config, columns}
 * pair on its next render.
 *
 * Used by:
 *   - LayersModal (Phase 12 Plan 04) — primary consumer, embeds in the right pane
 *   - MapConfigPanel (Phase 12 Plan 05) — shrinks to title + basemap + layer-inclusion picker;
 *     layer config is edited via the LayersModal, NOT inside the widget config panel
 *
 * PITFALL locks (carried over from MapConfigPanel — see STATE.md Phase 11 decisions):
 * - PITFALL M-05 — BLUR_RADIUS / CONTOUR_BANDWIDTH labelled "Kinetica map units"
 * - PITFALL M-06 — classbreak cardinality probe; warn at >100, hard cap at 256
 */

import { useEffect, useMemo, useState } from "react";
import {
  getValidSpatialColumns,
  getTrackIdColumns,
  getTrackOrderColumns,
  autoSuggestSpatialMode,
  type SpatialMode,
  type Column,
} from "../../lib/columnTypes";
import { coalesceTrackConfig, TRACK_DEFAULTS, type TrackConfig } from "../../lib/trackConfig";
import { useWmsCapabilitiesStore } from "../../store/wmsCapabilities";
import { useToastStore } from "../../store/toast";
import { useDynamicViewStore } from "../../store/dynamicViewStore";
import { POINT_SHAPES, type PointShape } from "../../lib/wmsUrlBuilder";
import type { DashboardLayerDto, DynamicViewRow, TableDto } from "../../api/client";
import {
  normalizeAARRGGBB,
  rgbFromAARRGGBB,
  alphaFromAARRGGBB,
  joinAARRGGBB,
  alphaPercentToHex,
  alphaHexToPercent,
} from "../../lib/colorHex";
import CodeMirror, { oneDark } from "@uiw/react-codemirror";
import { useThemeStore } from "../../store/theme";
import { html as htmlLang } from "@codemirror/lang-html";
import ChipCombobox, { type ChipComboboxOption } from "./ChipCombobox";
import ZoomRangeSlider, { type ZoomRangeValue } from "./ZoomRangeSlider";
import CbConfigForm from "./CbConfigForm";

// Zoom-range defaults — full OL view range. Stored in `layer.config.minZoom`
// + `layer.config.maxZoom` (inclusive semantics on the wire; MapChartRenderer
// translates to OL's exclusive minZoom convention via `applyZoomRangeToLayer`).
const ZOOM_RANGE_MIN_DEFAULT = 0;
const ZOOM_RANGE_MAX_DEFAULT = 28;

// ─── Prop interface ────────────────────────────────────────────────────────────

type KineticaWmsLayerFormProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  columns?: { name: string; type: string }[];
  isValid?: (valid: boolean) => void;
  // v1.4 Phase 22 (CONFIG-V14-03) — INFO POPUP fields routed as top-level DashboardLayerDto patches.
  // info_* are TOP-LEVEL columns on dashboard_layers, not nested config keys, so they ride a
  // separate onChangeInfoConfig callback (NOT inside the config blob).
  infoEnabled?: number;
  infoColumns?: string | null;
  infoTemplate?: string | null;
  onChangeInfoConfig?: (patch: {
    info_enabled?: number;
    info_columns?: string | null;
    info_template?: string | null;
  }) => void;
  /** True when LayersModal's missing-table predicate fires (selectedLayer.table_id not in associatedTables). */
  tableMissing?: boolean;
  // v1.6 Phase 35 (DV-V16-13) — Data Source picker section. Optional for back-compat with any
  // legacy caller (MapConfigPanel embeds this form WITHOUT a layer DTO since per-layer config
  // happens in LayersModal). When `layer` is supplied, the picker renders three optgroups
  // (Tables / Dynamic Views) and emits a top-level DashboardLayerDto patch via onDataSourceChange.
  layer?: DashboardLayerDto;
  associatedTables?: TableDto[];
  dynamicViews?: DynamicViewRow[];
  onDataSourceChange?: (patch: { table_id: number; dynamic_view_id: number | null }) => void;
};

// ─── RenderMode type ──────────────────────────────────────────────────────────

type RenderMode = "raster" | "heatmap" | "classbreak" | "contour";

// ─── Locked UI-SPEC.md label strings (gsd-ui-checker validates these verbatim) ──

const SPATIAL_MODE_LABELS: Record<SpatialMode, string> = {
  latlon: "Latitude / Longitude pair",
  wkt: "WKT geometry column",
  wkb: "Kinetica geometry column",
  track: "Track (x/y point sequence)",
};

const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  raster: "Raster (point markers)",
  heatmap: "Heatmap (density)",
  classbreak: "Classbreak (categorical)",
  contour: "Contour (lines)",
};

const ALL_SPATIAL_MODES: SpatialMode[] = ["latlon", "wkt", "wkb", "track"];
const ALL_RENDER_MODES: RenderMode[] = ["raster", "heatmap", "classbreak", "contour"];

// Full Kinetica colormap catalog, grouped per the Kinetica WMS docs. The original
// SPIKE-NOTES.md catalog covered only 8 entries (viridis/plasma/inferno/magma/
// cividis/turbo/jet/hot); the operator requested the complete docs-canonical set.
// Groups render as <optgroup>s in the select for scan-by-category usability.
//
// `cividis` + `turbo` from the legacy 8-entry catalog have been REMOVED — they
// are NOT in Kinetica's WMS docs and the deployed server rejects them. Legacy
// widget configs that persisted either value still render (preserved via the
// synthetic "Current" optgroup fallback in renderedGroups below).
type ColormapGroup = { label: string; values: readonly string[] };

const COLORMAP_GROUPS: readonly ColormapGroup[] = [
  {
    label: "Perceptually-Uniform",
    values: ["viridis", "inferno", "plasma", "magma"],
  },
  {
    label: "Sequential I",
    values: [
      "Blues", "BuGn", "BuPu", "GnBu", "Greens", "Greys", "Oranges", "OrRd",
      "PuBu", "PuBuGn", "PuRd", "Purples", "RdPu", "Reds",
      "YlGn", "YlGnBu", "YlOrBr", "YlOrRd",
    ],
  },
  {
    label: "Sequential II",
    values: [
      "afmhot", "autumn", "bone", "cool", "copper", "gist_heat",
      "gray", "gist_gray", "gist_yarg", "binary", "hot", "pink",
      "spring", "summer", "winter",
    ],
  },
  {
    label: "Diverging",
    values: [
      "BrBG", "bwr", "coolwarm", "PiYG", "PRGn", "PuOr",
      "RdBu", "RdGy", "RdYlBu", "RdYlGn", "Spectral", "seismic",
    ],
  },
  {
    label: "Qualitative",
    values: ["Accent", "Dark2", "Paired", "Pastel1", "Pastel2", "Set1", "Set2", "Set3"],
  },
  {
    label: "Misc",
    values: [
      "gist_earth", "terrain", "ocean", "gist_stern", "brg", "CMRmap",
      "cubehelix", "gnuplot", "gnuplot2", "gist_ncar", "spectral",
      "nipy_spectral", "jet", "rainbow", "gist_rainbow", "hsv", "flag", "prism",
    ],
  },
];

// Flat list — used as the legacy fallback when capabilities.colormaps is unset,
// and as the membership check for "is this an unknown colormap" (so we can
// preserve a legacy persisted value in the select even if it falls outside the
// catalog above).
const COLORMAP_CATALOG: readonly string[] = COLORMAP_GROUPS.flatMap((g) => g.values);

// ─── KineticaWmsLayerForm ─────────────────────────────────────────────────────

export default function KineticaWmsLayerForm({
  config,
  onChange,
  columns = [],
  isValid,
  infoEnabled = 1,
  infoColumns = null,
  infoTemplate = null,
  onChangeInfoConfig,
  tableMissing = false,
  // Phase 35 (DV-V16-13) — Data Source picker inputs
  layer,
  associatedTables = [],
  dynamicViews = [],
  onDataSourceChange,
}: KineticaWmsLayerFormProps): JSX.Element {
  const capabilities = useWmsCapabilitiesStore((s) => s.capabilities);

  // Phase 44 follow-up: dynamic-view-aware auto-suggest target resolution.
  // When the layer is bound to a dynamic view, the class-break auto-suggest
  // must query against the materialized view (a bare unprefixed identifier
  // like `_kbi_dv_uALICE_d5_7`) — NOT the base table the dv was sourced from.
  // If the dv isn't materialized yet, the auto-suggest button is disabled
  // with a reason tooltip so the operator knows to materialize first.
  // Subscribe scoped to the dv-id only so unrelated dv store updates don't re-render this form.
  const dvEntry = useDynamicViewStore((s) =>
    layer?.dynamic_view_id != null ? s.views[layer.dynamic_view_id] : undefined,
  );

  // Capability gating with graceful fallback (null = loading → show all modes)
  const allowedSpatialModes: SpatialMode[] = capabilities?.spatialModes ?? ALL_SPATIAL_MODES;
  const allowedRenderModes: RenderMode[] = (capabilities?.renderModes as RenderMode[]) ?? ALL_RENDER_MODES;

  // Resolve the auto-suggest target (schema / tableName / disabled-reason) based on
  // whether the layer is bound to a base table or a dynamic view.
  //   - Base-table layer            → schema = table.schema,    tableName = table.name
  //   - DV layer, materialized      → schema = "",              tableName = dvEntry.viewName
  //   - DV layer, NOT materialized  → button disabled with status-specific tooltip
  // The empty-schema case is handled by the server SQL builders, which emit
  // `FROM <tableName>` directly when schema === "".
  const cbAutoSuggestTarget = useMemo(() => {
    if (!layer) {
      return { schema: undefined, tableName: undefined, autoSuggestDisabledReason: undefined };
    }
    if (layer.dynamic_view_id != null) {
      if (dvEntry?.status === "materialized" && dvEntry.viewName) {
        return {
          schema: "",
          tableName: dvEntry.viewName,
          autoSuggestDisabledReason: undefined,
        };
      }
      const reason =
        dvEntry?.status === "pending"
          ? "Dynamic view is still materializing — try again in a moment"
          : dvEntry?.status === "over_threshold"
            ? "Dynamic view exceeds the max-records threshold — cannot auto-suggest; define breaks manually"
            : dvEntry?.status === "error"
              ? `Dynamic view materialization failed (${dvEntry.error ?? "unknown error"}) — define breaks manually`
              : "Materialize this dynamic view to enable auto-suggest — define breaks manually for now";
      return { schema: "", tableName: "", autoSuggestDisabledReason: reason };
    }
    // Base-table layer
    const t = associatedTables.find((t) => t.id === layer.table_id);
    return {
      schema: t?.schema ?? "",
      tableName: t?.name ?? "",
      autoSuggestDisabledReason: undefined,
    };
  }, [layer, dvEntry, associatedTables]);

  const spatialMode = (config.spatialMode as SpatialMode | undefined) ?? undefined;
  const renderMode = (config.renderMode as RenderMode | undefined) ?? "raster";

  // Auto-suggest hint visibility: true after auto-suggest, false after manual override.
  // Persisted on draft as __autoSuggestActive so it survives re-renders while the modal is open.
  // NOTE: __autoSuggestActive is a draft-only flag; it is NOT semantically part of widget.config.
  // The __autoSuggestActive hint STAYS (mirrors Phase 11 11-07 decision).
  const [autoSuggestActive, setAutoSuggestActiveLocal] = useState<boolean>(
    () => Boolean((config as Record<string, unknown>).__autoSuggestActive),
  );

  // CodeMirror theme follows the app theme (One Dark in dark mode, built-in light otherwise).
  const editorTheme = useThemeStore((s) => s.theme) === "dark" ? oneDark : "light";

  // Reset isValid to true when switching away from classbreak mode
  useEffect(() => {
    if (renderMode !== "classbreak" && isValid) {
      isValid(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderMode]);

  // Phase 52: isValid signaling for track mode — all four pickers must be set
  useEffect(() => {
    if (spatialMode !== "track") return;
    const tc = coalesceTrackConfig((config.track_config as string | null) ?? null);
    isValid?.(!!tc.xCol && !!tc.yCol && !!tc.trackIdAttr && !!tc.trackOrderAttr);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialMode, config.track_config, isValid]);

  // Phase 53 (RENDER-V19-01): Silent heatmap→raster coercion under Track mode.
  // No toast, no confirm — matches auto-suggest-wins philosophy from Phase 52.
  useEffect(() => {
    if (spatialMode !== "track") return;
    if (renderMode === "heatmap" || renderMode === "contour") {
      onChange({ ...config, renderMode: "raster" }); // silent — NO toast, NO confirm
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spatialMode, renderMode]);

  // Phase 53 (RENDER-V19-01): Effective render mode for UI — shows raster immediately
  // before the coercion effect's onChange round-trips back from the parent.
  const effectiveRenderMode: RenderMode =
    spatialMode === "track" && (renderMode === "heatmap" || renderMode === "contour")
      ? "raster"
      : renderMode;

  // NOTE: KineticaWmsLayerForm is PURELY CONTROLLED — it does NOT auto-suggest spatial mode
  // on columns change. Auto-suggest is the caller's (LayersModal / MapConfigPanel) responsibility.
  // When the user changes the table in LayersModal, the parent runs autoSuggestSpatialMode and
  // clears stale columns BEFORE calling onPatch — the form just sees a new {config, columns} pair.
  // We DO NOT implement the columns-change stale-clear effect here (that's the caller's job).
  // The auto-suggest-on-mount also does NOT run here — the caller owns the initial config.

  const onSelectSpatialMode = (mode: SpatialMode) => {
    setAutoSuggestActiveLocal(false);
    // When switching away from track, reset isValid to true (track pickers cleared)
    if (mode !== "track") {
      isValid?.(true);
    }
    // Clear stale spatial columns when switching mode
    onChange({
      ...config,
      spatialMode: mode,
      __autoSuggestActive: false,
      // Clear all stale column references when mode changes
      latColumn: "",
      lonColumn: "",
      wktColumn: "",
      wkbColumn: "",
      // NOTE: Do NOT clear track_config here — Phase 53 needs it preserved for re-selection
    });
  };

  const onSelectRenderMode = (mode: RenderMode) => {
    onChange({ ...config, renderMode: mode });
  };

  // Spatial column pickers — filtered via getValidSpatialColumns (Phase 11 11-02)
  const validColumns = spatialMode && spatialMode !== "track" ? getValidSpatialColumns(columns, spatialMode) : [];

  // Phase 52: Track column pickers — four typed column lists for track mode
  const trackXColumns = getValidSpatialColumns(columns, "latlon"); // numeric only
  const trackYColumns = getValidSpatialColumns(columns, "latlon");
  const trackIdColumns = getTrackIdColumns(columns);
  const trackOrderColumns = getTrackOrderColumns(columns);
  const trackCfg = coalesceTrackConfig((config.track_config as string | null) ?? null);

  // Phase 52: Pick a track column and merge into track_config
  const onPickTrackCol = (key: "xCol" | "yCol" | "trackIdAttr" | "trackOrderAttr", v: string) => {
    const next = {
      ...coalesceTrackConfig((config.track_config as string | null) ?? null),
      enabled: true,
      [key]: v || undefined,
    };
    onChange({ ...config, track_config: JSON.stringify(next) });
  };

  // Phase 53 (COLOR-V19-01): Write arbitrary track_config field while preserving all existing fields.
  const onSetTrackField = (key: keyof TrackConfig, v: string | number | undefined) => {
    const next = {
      ...coalesceTrackConfig((config.track_config as string | null) ?? null),
      enabled: true,
      [key]: v,
    };
    onChange({ ...config, track_config: JSON.stringify(next) });
  };

  const onPickColumn = (key: string, value: string) => {
    onChange({ ...config, [key]: value });
  };

  // Heatmap: intersect grouped catalog with capabilities.colormaps. When the
  // server has reported a supported set, drop catalog entries the server can't
  // render. Empty groups (all values filtered out) are dropped entirely so the
  // select doesn't show a label with no children.
  const supportedColormaps: string[] | null | undefined = capabilities?.colormaps;
  const colormapGroups: ColormapGroup[] = (() => {
    if (!supportedColormaps || supportedColormaps.length === 0) {
      return [...COLORMAP_GROUPS];
    }
    const supportedSet = new Set(supportedColormaps);
    const filtered: ColormapGroup[] = [];
    for (const group of COLORMAP_GROUPS) {
      const values = group.values.filter((v) => supportedSet.has(v));
      if (values.length > 0) filtered.push({ label: group.label, values });
    }
    return filtered;
  })();
  // Legacy-value preservation: if a layer config persisted a colormap that
  // falls outside the catalog (server-side custom or stale rename), prepend a
  // synthetic "Current" group with just that value so the select still shows
  // the persisted choice rather than silently falling back to the first option.
  const currentColormap = (config.colormap as string) || "viridis";
  const isKnownColormap = colormapGroups.some((g) =>
    g.values.includes(currentColormap),
  );
  const renderedGroups: ColormapGroup[] = isKnownColormap
    ? colormapGroups
    : [{ label: "Current", values: [currentColormap] }, ...colormapGroups];

  // ─── Phase 22 (CONFIG-V14-03) — INFO POPUP state derivation ───────────────
  // Alphabetically-sorted column options for the chip-combobox + insert-column picker.
  // Locked: column order in picker = column order in popup KV mode (cross-phase parity
  // requires InfoPopup to also sort before passing to renderInfoTemplate — see Plan 22-03 Task 4).
  const sortedColumnOptions = useMemo<ChipComboboxOption[]>(
    () =>
      [...columns]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.name, typeLabel: c.type })),
    [columns],
  );

  // Parse infoColumns JSON-array string into selected[] for ChipCombobox; null → null sentinel.
  // Lenient parse: matches renderInfoTemplate.ts fallback (try/catch → all-columns).
  const selectedColumns: string[] | null = useMemo(() => {
    if (infoColumns === null) return null;
    try {
      const parsed = JSON.parse(infoColumns) as unknown;
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === "string")) {
        return parsed as string[];
      }
    } catch {
      /* fall through to null sentinel — popup also falls back to all-columns */
    }
    return null;
  }, [infoColumns]);

  // ChipCombobox onChange handler: compress to null when next selection equals all options.
  const handleColumnsChange = (next: string[] | null) => {
    if (!onChangeInfoConfig) return;
    if (next === null) {
      onChangeInfoConfig({ info_columns: null });
      return;
    }
    // Compress to sentinel when user re-selected everything.
    const allColumnNames = sortedColumnOptions.map((o) => o.value);
    const isAllSelected =
      next.length === allColumnNames.length &&
      allColumnNames.every((c) => next.includes(c));
    if (isAllSelected) {
      onChangeInfoConfig({ info_columns: null });
      return;
    }
    // Persist as JSON-stringified, alphabetically sorted (so storage matches picker order
    // and the InfoPopup KV mode order — single canonical sort).
    const sortedNext = [...next].sort((a, b) => a.localeCompare(b));
    onChangeInfoConfig({ info_columns: JSON.stringify(sortedNext) });
  };

  const handleToggleEnabled = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChangeInfoConfig?.({ info_enabled: e.target.checked ? 1 : 0 });
  };

  const handleTemplateChange = (value: string) => {
    // Empty string → persist as null sentinel (KV-mode fallback per POPUP-V14-04 lock).
    onChangeInfoConfig?.({ info_template: value === "" ? null : value });
  };

  const handleInsertColumn = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const col = e.target.value;
    if (!col) return;
    // Insert-at-end (deferred: cursor-position injection per 22-CONTEXT.md design discretion).
    const next = (infoTemplate ?? "") + `{${col}}`;
    onChangeInfoConfig?.({ info_template: next });
    // Reset the select to the placeholder option (re-pick same column would otherwise be a no-op).
    e.target.value = "";
  };

  const isInfoEnabled = infoEnabled === 1;
  const sectionDisabled = tableMissing || !isInfoEnabled;
  // Toggle itself stays enabled UNLESS table is missing (toggle is the master switch).
  const toggleDisabled = tableMissing;

  // Phase 35 (DV-V16-13) — Data Source picker: render only when a layer DTO is supplied
  // (LayersModal's per-layer right pane). Single picker handles both table + dv binding
  // with optgroups; the "dv:<id>" value-space discriminant mirrors Plan 35-04's
  // ChartConfigPanel pattern. Mutual exclusion enforced at picker level: choosing a dv
  // writes { dynamic_view_id, table_id = sourceTableId } so the schema's table_id NOT NULL
  // constraint is preserved (research finding #4 lock) and drill-down / filter-bar code
  // paths keep working without rewrites.
  const renderDataSourcePicker = (): JSX.Element | null => {
    if (!layer || !onDataSourceChange) return null;

    const dvBound =
      layer.dynamic_view_id !== null &&
      layer.dynamic_view_id !== undefined &&
      dynamicViews.some((d) => d.id === layer.dynamic_view_id);

    const currentValue = dvBound
      ? `dv:${layer.dynamic_view_id}`
      : String(layer.table_id);

    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      const v = e.target.value;
      if (v.startsWith("dv:")) {
        const dvId = parseInt(v.slice(3), 10);
        const dv = dynamicViews.find((d) => d.id === dvId);
        if (!dv) return;
        // Research finding #4 lock: keep table_id = dv.source_table_id (NOT NULL preserved).
        onDataSourceChange({
          table_id: dv.source_table_id,
          dynamic_view_id: dvId,
        });
      } else {
        const tableId = parseInt(v, 10);
        // Explicit null clears any previous dv binding (Plan 35-01's "key" in attrs discriminant).
        onDataSourceChange({
          table_id: tableId,
          dynamic_view_id: null,
        });
      }
    };

    const tableNotInList = !associatedTables.find((t) => t.id === layer.table_id);

    return (
      <div className="config-group">
        <div className="config-group-label">DATA SOURCE</div>
        <select
          className="ds-select"
          aria-label="Layer data source"
          value={currentValue}
          onChange={handleChange}
        >
          <optgroup label="Tables">
            {/* If layer.table_id references a table no longer in associatedTables AND the layer
                is NOT dv-bound, surface a (table removed) placeholder so the select stays
                controlled. */}
            {tableNotInList && !dvBound && (
              <option value={String(layer.table_id)}>(table removed)</option>
            )}
            {associatedTables.map((t) => (
              <option key={`t-${t.id}`} value={String(t.id)}>
                {t.schema ? `${t.schema}.${t.name}` : t.name}
              </option>
            ))}
          </optgroup>
          {/* Dynamic Views optgroup — hidden entirely when the prop is empty. */}
          {dynamicViews.length > 0 && (
            <optgroup label="Dynamic Views">
              {dynamicViews.map((dv) => (
                <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>
                  {dv.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
    );
  };

  return (
    <div className="config-panel">
      <div className="config-panel-body">

        {/* ─── Phase 35 DATA SOURCE (DV-V16-13) — three-optgroup picker ───── */}
        {renderDataSourcePicker()}

        {/* ─── SPATIAL MODE ─────────────────────────────────────────────────── */}
        <div
          className="config-group config-spatial-mode"
          role="radiogroup"
          aria-labelledby="map-spatial-mode-label"
        >
          <label id="map-spatial-mode-label" className="config-group-label">
            SPATIAL MODE
          </label>

          {ALL_SPATIAL_MODES.filter((m) => m === "track" || allowedSpatialModes.includes(m)).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="map-spatial-mode"
                value={m}
                checked={spatialMode === m}
                aria-label={SPATIAL_MODE_LABELS[m]}
                onChange={() => onSelectSpatialMode(m)}
              />
              {SPATIAL_MODE_LABELS[m]}
            </label>
          ))}

          {/* Auto-detect hint — visible while auto-suggest is active */}
          {autoSuggestActive && (
            <div className="config-hint">Auto-detected from column types</div>
          )}

          {/* Per-mode column dropdowns (latlon / wkt / wkb) */}
          {spatialMode === "latlon" && (
            <>
              <label className="ds-field-label">
                Latitude column
                <select
                  className="ds-select"
                  value={(config.latColumn as string) || ""}
                  onChange={(e) => onPickColumn("latColumn", e.target.value)}
                >
                  <option value="">— select —</option>
                  {validColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ds-field-label">
                Longitude column
                <select
                  className="ds-select"
                  value={(config.lonColumn as string) || ""}
                  onChange={(e) => onPickColumn("lonColumn", e.target.value)}
                >
                  <option value="">— select —</option>
                  {validColumns.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {spatialMode === "wkt" && (
            <label className="ds-field-label">
              Geometry column (WKT)
              <select
                className="ds-select"
                value={(config.wktColumn as string) || ""}
                onChange={(e) => onPickColumn("wktColumn", e.target.value)}
              >
                <option value="">— select —</option>
                {validColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {spatialMode === "wkb" && (
            <label className="ds-field-label">
              Geometry column (Kinetica)
              <select
                className="ds-select"
                value={(config.wkbColumn as string) || ""}
                onChange={(e) => onPickColumn("wkbColumn", e.target.value)}
              >
                <option value="">— select —</option>
                {validColumns.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* Phase 52: Track column pickers (TRACKMODE-V19-01/02) */}
          {spatialMode === "track" && (
            <>
              <label className="ds-field-label">
                X column (longitude)
                <select
                  className="ds-select"
                  aria-label="Track X column"
                  value={trackCfg.xCol ?? ""}
                  onChange={(e) => onPickTrackCol("xCol", e.target.value)}
                >
                  <option value="">— select —</option>
                  {trackXColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="ds-field-label">
                Y column (latitude)
                <select
                  className="ds-select"
                  aria-label="Track Y column"
                  value={trackCfg.yCol ?? ""}
                  onChange={(e) => onPickTrackCol("yCol", e.target.value)}
                >
                  <option value="">— select —</option>
                  {trackYColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="ds-field-label">
                Track ID column
                <select
                  className="ds-select"
                  aria-label="Track ID column"
                  value={trackCfg.trackIdAttr ?? ""}
                  onChange={(e) => onPickTrackCol("trackIdAttr", e.target.value)}
                >
                  <option value="">— select —</option>
                  {trackIdColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="ds-field-label">
                Ordering column
                <select
                  className="ds-select"
                  aria-label="Track ordering column"
                  value={trackCfg.trackOrderAttr ?? ""}
                  onChange={(e) => onPickTrackCol("trackOrderAttr", e.target.value)}
                >
                  <option value="">— select —</option>
                  {trackOrderColumns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>

        {/* ─── RENDER MODE ──────────────────────────────────────────────────── */}
        <div
          className="config-group config-render-mode"
          role="radiogroup"
          aria-labelledby="map-render-mode-label"
        >
          <label id="map-render-mode-label" className="config-group-label">
            RENDER MODE
          </label>

          {/* Phase 39 (CB-V17-01): contour hidden from picker; RenderMode type unchanged.
              Existing layers with renderMode="contour" still render the contour params
              block below (Pitfall 6 mitigation per 39-RESEARCH.md).

              classbreak is NOT gated on allowedRenderModes: the deployed Kinetica's
              GetCapabilities XML does not advertise the cb_raster/classbreak Style, but
              Phase 37 spike confirmed STYLES=cb_raster renders. The server's
              wmsCapabilities.ts documents this and warns downstream code must not gate
              classbreak/contour on renderModes. raster/heatmap stay capability-gated.

              Phase 53 (RENDER-V19-01): Under track, heatmap is also excluded — track
              rendering only supports raster + classbreak. */}
          {ALL_RENDER_MODES.filter((m) => {
            if (m === "contour") return false;
            if (spatialMode === "track" && m === "heatmap") return false;
            if (m === "classbreak") return true;
            return allowedRenderModes.includes(m);
          }).map((m) => (
            <label key={m}>
              <input
                type="radio"
                name="map-render-mode"
                value={m}
                checked={effectiveRenderMode === m}
                aria-label={RENDER_MODE_LABELS[m]}
                onChange={() => onSelectRenderMode(m)}
              />
              {RENDER_MODE_LABELS[m]}
            </label>
          ))}
        </div>

        {/* ─── TRACK STYLE (Phase 53 RENDER-V19-02, COLOR-V19-01) ─────────── */}
        {/* Rendered when spatialMode === "track" regardless of effectiveRenderMode:
            appears for both Track+Raster and Track+Classbreak. */}
        {spatialMode === "track" && (
          <div className="config-group" role="group" aria-labelledby="map-track-style-label">
            <label id="map-track-style-label" className="config-group-label">
              TRACK STYLE
            </label>

            {/* Head color — hidden under classbreak (per-break colors drive TRACKHEADCOLORS; TRACKFIX-V19-06) */}
            {effectiveRenderMode !== "classbreak" && (
              <>
                <label className="config-color-field">
                  Head color
                  <div className="config-color-row">
                    <input
                      type="color"
                      className="config-color-picker"
                      aria-label="Track head color (RGB)"
                      value={`#${rgbFromAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor)}`}
                      onChange={(e) =>
                        onSetTrackField(
                          "headColor",
                          joinAARRGGBB(
                            alphaFromAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor),
                            e.target.value.replace("#", ""),
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="config-color-text"
                      aria-label="Track head color (AARRGGBB hex)"
                      value={normalizeAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor)}
                      onChange={(e) =>
                        onSetTrackField(
                          "headColor",
                          normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.headColor),
                        )
                      }
                    />
                  </div>
                </label>
                <label className="config-range-field">
                  Head color alpha
                  <input
                    type="range"
                    className="config-range"
                    aria-label="Track head color alpha"
                    min={0}
                    max={100}
                    step={1}
                    value={alphaHexToPercent(alphaFromAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor))}
                    onChange={(e) =>
                      onSetTrackField(
                        "headColor",
                        joinAARRGGBB(
                          alphaPercentToHex(Number(e.target.value)),
                          rgbFromAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor),
                        ),
                      )
                    }
                  />
                  <span className="config-range-value">
                    {alphaHexToPercent(alphaFromAARRGGBB(trackCfg.headColor ?? TRACK_DEFAULTS.headColor))}%
                  </span>
                </label>
              </>
            )}

            {/* Head size */}
            <label className="config-range-field">
              Head size
              <input
                type="range"
                className="config-range"
                aria-label="Track head size"
                min={1}
                max={20}
                step={1}
                value={trackCfg.headSize ?? TRACK_DEFAULTS.headSize}
                onChange={(e) => onSetTrackField("headSize", Number(e.target.value))}
              />
              <span className="config-range-value">{trackCfg.headSize ?? TRACK_DEFAULTS.headSize}</span>
            </label>

            {/* Head shape */}
            <label className="ds-field-label">
              Head shape
              <select
                className="ds-select"
                aria-label="Track head shape"
                value={trackCfg.headShape ?? TRACK_DEFAULTS.headShape}
                onChange={(e) => onSetTrackField("headShape", e.target.value)}
              >
                {POINT_SHAPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            {/*
             * GAP-54-03 (TRACKFIX-V19-02): Relabelled "Trail color" → "Track line color"
             * and "Line width" → "Track line width" for operator discoverability.
             * The underlying track_config fields and WMS emission are UNCHANGED:
             *   trailColor  → TRACKLINECOLORS  (wmsUrlBuilder.ts ~449)
             *   trailSize   → TRACKLINEWIDTHS  (wmsUrlBuilder.ts ~455-457)
             * Do NOT introduce a separate trail vs. line pair — Kinetica exposes a single
             * connecting-line color+width (TRACKLINECOLORS/TRACKLINEWIDTHS). If per-segment
             * styling is needed in the future that requires a new Kinetica param, open a spike.
             */}
            {/* Track line color — hidden under classbreak (per-break colors drive TRACKLINECOLORS; TRACKFIX-V19-06) */}
            {effectiveRenderMode !== "classbreak" && (
              <>
                <label className="config-color-field">
                  Track line color
                  <div className="config-color-row">
                    <input
                      type="color"
                      className="config-color-picker"
                      aria-label="Track line color (RGB)"
                      value={`#${rgbFromAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor)}`}
                      onChange={(e) =>
                        onSetTrackField(
                          "trailColor",
                          joinAARRGGBB(
                            alphaFromAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor),
                            e.target.value.replace("#", ""),
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="config-color-text"
                      aria-label="Track line color (AARRGGBB hex)"
                      value={normalizeAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor)}
                      onChange={(e) =>
                        onSetTrackField(
                          "trailColor",
                          normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.trailColor),
                        )
                      }
                    />
                  </div>
                </label>
                <label className="config-range-field">
                  Track line color alpha
                  <input
                    type="range"
                    className="config-range"
                    aria-label="Track line color alpha"
                    min={0}
                    max={100}
                    step={1}
                    value={alphaHexToPercent(alphaFromAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor))}
                    onChange={(e) =>
                      onSetTrackField(
                        "trailColor",
                        joinAARRGGBB(
                          alphaPercentToHex(Number(e.target.value)),
                          rgbFromAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor),
                        ),
                      )
                    }
                  />
                  <span className="config-range-value">
                    {alphaHexToPercent(alphaFromAARRGGBB(trackCfg.trailColor ?? TRACK_DEFAULTS.trailColor))}%
                  </span>
                </label>
              </>
            )}

            {/* Track line width (writes trailSize → TRACKLINEWIDTHS) */}
            <label className="config-range-field">
              Track line width
              <input
                type="range"
                className="config-range"
                aria-label="Track line width"
                min={0}
                max={20}
                step={1}
                value={trackCfg.trailSize ?? TRACK_DEFAULTS.trailSize}
                onChange={(e) => onSetTrackField("trailSize", Number(e.target.value))}
              />
              <span className="config-range-value">{trackCfg.trailSize ?? TRACK_DEFAULTS.trailSize}</span>
            </label>

            {/* ─── Track marker subgroup (TRACKFIX-V19-05: markerColor/markerShape/markerSize) ─── */}
            {/* Track marker color — hidden under classbreak (per-break colors drive TRACKMARKERCOLORS; TRACKFIX-V19-06) */}
            {effectiveRenderMode !== "classbreak" && (
              <>
                <label className="config-color-field">
                  Track marker color
                  <div className="config-color-row">
                    <input
                      type="color"
                      className="config-color-picker"
                      aria-label="Track marker color (RGB)"
                      value={`#${rgbFromAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor)}`}
                      onChange={(e) =>
                        onSetTrackField(
                          "markerColor",
                          joinAARRGGBB(
                            alphaFromAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor),
                            e.target.value.replace("#", ""),
                          ),
                        )
                      }
                    />
                    <input
                      type="text"
                      className="config-color-text"
                      aria-label="Track marker color (AARRGGBB hex)"
                      value={normalizeAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor)}
                      onChange={(e) =>
                        onSetTrackField(
                          "markerColor",
                          normalizeAARRGGBB(e.target.value, TRACK_DEFAULTS.markerColor),
                        )
                      }
                    />
                  </div>
                </label>
                <label className="config-range-field">
                  Track marker color alpha
                  <input
                    type="range"
                    className="config-range"
                    aria-label="Track marker color alpha"
                    min={0}
                    max={100}
                    step={1}
                    value={alphaHexToPercent(alphaFromAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor))}
                    onChange={(e) =>
                      onSetTrackField(
                        "markerColor",
                        joinAARRGGBB(
                          alphaPercentToHex(Number(e.target.value)),
                          rgbFromAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor),
                        ),
                      )
                    }
                  />
                  <span className="config-range-value">
                    {alphaHexToPercent(alphaFromAARRGGBB(trackCfg.markerColor ?? TRACK_DEFAULTS.markerColor))}%
                  </span>
                </label>
              </>
            )}

            {/* Track marker shape — reuses POINT_SHAPES (12 options incl "none") → TRACKMARKERSHAPES */}
            <label className="ds-field-label">
              Track marker shape
              <select
                className="ds-select"
                aria-label="Track marker shape"
                value={trackCfg.markerShape ?? TRACK_DEFAULTS.markerShape}
                onChange={(e) => onSetTrackField("markerShape", e.target.value)}
              >
                {POINT_SHAPES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>

            {/* Track marker size → TRACKMARKERSIZES */}
            <label className="config-range-field">
              Track marker size
              <input
                type="range"
                className="config-range"
                aria-label="Track marker size"
                min={0}
                max={20}
                step={1}
                value={trackCfg.markerSize ?? TRACK_DEFAULTS.markerSize}
                onChange={(e) => onSetTrackField("markerSize", Number(e.target.value))}
              />
              <span className="config-range-value">{trackCfg.markerSize ?? TRACK_DEFAULTS.markerSize}</span>
            </label>
          </div>
        )}

        {/* ─── RASTER PARAMS ────────────────────────────────────────────────── */}
        {/* Phase 53 (RENDER-V19-02): hidden under Track+Raster — track styling owns marker appearance. */}
        {effectiveRenderMode === "raster" && spatialMode !== "track" && (
          <div className="config-group" role="group" aria-labelledby="map-raster-params-label">
            <label id="map-raster-params-label" className="config-group-label">
              RASTER PARAMS
            </label>

            {/* Point color (POINTCOLORS) — stored as 8-char AARRGGBB (alpha + RGB).
                Color picker drives RGB; alpha slider drives the first 2 chars; the text input
                shows / accepts the full 8-char value. Legacy 6-char values normalize to
                fully-opaque (FF + RRGGBB) on read so existing layers keep their look. */}
            <label className="config-color-field">
              Point color
              <div className="config-color-row">
                <input
                  type="color"
                  className="config-color-picker"
                  aria-label="Point color (RGB)"
                  value={`#${rgbFromAARRGGBB((config.pointColor as string) || "FFFF3838")}`}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      pointColor: joinAARRGGBB(
                        alphaFromAARRGGBB((config.pointColor as string) || "FFFF3838"),
                        e.target.value.replace("#", ""),
                      ),
                    })
                  }
                />
                <input
                  type="text"
                  className="config-color-text"
                  aria-label="Point color (AARRGGBB hex)"
                  value={normalizeAARRGGBB((config.pointColor as string) || "FFFF3838")}
                  onChange={(e) =>
                    onChange({ ...config, pointColor: normalizeAARRGGBB(e.target.value, "FFFF3838") })
                  }
                />
              </div>
            </label>

            <label className="config-range-field">
              Point color alpha
              <input
                type="range"
                className="config-range"
                aria-label="Point color alpha"
                min={0}
                max={100}
                step={1}
                value={alphaHexToPercent(alphaFromAARRGGBB((config.pointColor as string) || "FFFF3838"))}
                onChange={(e) =>
                  onChange({
                    ...config,
                    pointColor: joinAARRGGBB(
                      alphaPercentToHex(Number(e.target.value)),
                      rgbFromAARRGGBB((config.pointColor as string) || "FFFF3838"),
                    ),
                  })
                }
              />
              <span className="config-range-value">
                {alphaHexToPercent(alphaFromAARRGGBB((config.pointColor as string) || "FFFF3838"))}%
              </span>
            </label>

            <label className="config-range-field">
              Point size
              <input
                type="range"
                className="config-range"
                min={2}
                max={20}
                step={1}
                value={(config.pointSize as number) ?? 4}
                onChange={(e) =>
                  onChange({ ...config, pointSize: Number(e.target.value) })
                }
              />
              <span className="config-range-value">{(config.pointSize as number) ?? 4}</span>
            </label>

            <label className="config-range-field">
              Point opacity
              <input
                type="range"
                className="config-range"
                min={0}
                max={100}
                step={1}
                value={(config.pointOpacity as number) ?? 100}
                onChange={(e) =>
                  onChange({ ...config, pointOpacity: Number(e.target.value) })
                }
              />
              <span className="config-range-value">
                {(config.pointOpacity as number) ?? 100}%
              </span>
            </label>

            <label className="ds-field-label">
              Point shape
              <select
                className="ds-select"
                aria-label="Point shape"
                value={(config.pointShape as PointShape) ?? "circle"}
                onChange={(e) =>
                  onChange({ ...config, pointShape: e.target.value as PointShape })
                }
              >
                {POINT_SHAPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            {/* Shape fill color (SHAPEFILLCOLORS) — AARRGGBB. See Point color comment above. */}
            <label className="config-color-field">
              Shape fill color (WKT)
              <div className="config-color-row">
                <input
                  type="color"
                  className="config-color-picker"
                  aria-label="Shape fill color (RGB)"
                  value={`#${rgbFromAARRGGBB((config.shapeFillColor as string) || "FFFF3838")}`}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      shapeFillColor: joinAARRGGBB(
                        alphaFromAARRGGBB((config.shapeFillColor as string) || "FFFF3838"),
                        e.target.value.replace("#", ""),
                      ),
                    })
                  }
                />
                <input
                  type="text"
                  className="config-color-text"
                  aria-label="Shape fill color (AARRGGBB hex)"
                  value={normalizeAARRGGBB((config.shapeFillColor as string) || "FFFF3838")}
                  onChange={(e) =>
                    onChange({ ...config, shapeFillColor: normalizeAARRGGBB(e.target.value, "FFFF3838") })
                  }
                />
              </div>
            </label>

            <label className="config-range-field">
              Shape fill alpha
              <input
                type="range"
                className="config-range"
                aria-label="Shape fill alpha"
                min={0}
                max={100}
                step={1}
                value={alphaHexToPercent(alphaFromAARRGGBB((config.shapeFillColor as string) || "FFFF3838"))}
                onChange={(e) =>
                  onChange({
                    ...config,
                    shapeFillColor: joinAARRGGBB(
                      alphaPercentToHex(Number(e.target.value)),
                      rgbFromAARRGGBB((config.shapeFillColor as string) || "FFFF3838"),
                    ),
                  })
                }
              />
              <span className="config-range-value">
                {alphaHexToPercent(alphaFromAARRGGBB((config.shapeFillColor as string) || "FFFF3838"))}%
              </span>
            </label>

            {/* Shape line color (SHAPELINECOLORS) — AARRGGBB. See Point color comment above. */}
            <label className="config-color-field">
              Shape line color (WKT)
              <div className="config-color-row">
                <input
                  type="color"
                  className="config-color-picker"
                  aria-label="Shape line color (RGB)"
                  value={`#${rgbFromAARRGGBB((config.shapeLineColor as string) || "FF000000")}`}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      shapeLineColor: joinAARRGGBB(
                        alphaFromAARRGGBB((config.shapeLineColor as string) || "FF000000"),
                        e.target.value.replace("#", ""),
                      ),
                    })
                  }
                />
                <input
                  type="text"
                  className="config-color-text"
                  aria-label="Shape line color (AARRGGBB hex)"
                  value={normalizeAARRGGBB((config.shapeLineColor as string) || "FF000000")}
                  onChange={(e) =>
                    onChange({ ...config, shapeLineColor: normalizeAARRGGBB(e.target.value, "FF000000") })
                  }
                />
              </div>
            </label>

            <label className="config-range-field">
              Shape line alpha
              <input
                type="range"
                className="config-range"
                aria-label="Shape line alpha"
                min={0}
                max={100}
                step={1}
                value={alphaHexToPercent(alphaFromAARRGGBB((config.shapeLineColor as string) || "FF000000"))}
                onChange={(e) =>
                  onChange({
                    ...config,
                    shapeLineColor: joinAARRGGBB(
                      alphaPercentToHex(Number(e.target.value)),
                      rgbFromAARRGGBB((config.shapeLineColor as string) || "FF000000"),
                    ),
                  })
                }
              />
              <span className="config-range-value">
                {alphaHexToPercent(alphaFromAARRGGBB((config.shapeLineColor as string) || "FF000000"))}%
              </span>
            </label>

            <label className="config-range-field">
              Shape line width
              <input
                type="range"
                className="config-range"
                aria-label="Shape line width"
                min={0}
                max={20}
                step={1}
                value={(config.shapeLineWidth as number) ?? 1}
                onChange={(e) =>
                  onChange({ ...config, shapeLineWidth: Number(e.target.value) })
                }
              />
              <span className="config-range-value">
                {(config.shapeLineWidth as number) ?? 1}
              </span>
            </label>

            <label className="config-toggle">
              Antialiasing
              <input
                type="checkbox"
                aria-label="Antialiasing"
                checked={(config.antialiasing as boolean) ?? false}
                onChange={(e) =>
                  onChange({ ...config, antialiasing: e.target.checked })
                }
              />
            </label>
          </div>
        )}

        {/* ─── HEATMAP PARAMS ───────────────────────────────────────────────── */}
        {renderMode === "heatmap" && (
          <div className="config-group" role="group" aria-labelledby="map-heatmap-params-label">
            <label id="map-heatmap-params-label" className="config-group-label">
              HEATMAP PARAMS
            </label>

            <label className="ds-field-label">
              Colormap
              <select
                className="ds-select"
                value={currentColormap}
                onChange={(e) => onChange({ ...config, colormap: e.target.value })}
              >
                {renderedGroups.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.values.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            {/* Reverse colormap — emits REVERSE_COLORMAP=TRUE to Kinetica WMS
                per the docs. Inverts the colormap's color order without
                changing the colormap itself (e.g. viridis purple→yellow
                becomes yellow→purple). Default false (operator opts in).

                Always persist the explicit boolean (true OR false) — never
                undefined. Previously the unchecked branch set `undefined`,
                which `JSON.stringify` drops on the PATCH wire; the server's
                shallow-merge then preserved the prior `true` value and the
                WMS URL kept emitting `REVERSE_COLORMAP=TRUE` after a
                supposedly-clearing toggle. Explicit `false` overwrites the
                stored value end-to-end. */}
            <label className="config-toggle">
              <input
                type="checkbox"
                checked={Boolean(config.reverseColormap)}
                onChange={(e) =>
                  onChange({
                    ...config,
                    reverseColormap: e.target.checked,
                  })
                }
              />
              Reverse colormap
            </label>

            {/* PITFALL M-05 — BLUR_RADIUS labelled "Kinetica map units" */}
            <label className="config-range-field">
              Blur radius (Kinetica map units)
              <input
                type="range"
                className="config-range"
                min={1}
                max={32}
                step={1}
                value={(config.blurRadius as number) ?? 5}
                onChange={(e) =>
                  onChange({ ...config, blurRadius: parseInt(e.target.value, 10) })
                }
              />
              <span className="config-range-value">{(config.blurRadius as number) ?? 5}</span>
            </label>
          </div>
        )}

        {/* ─── CLASSBREAK PARAMS (Phase 39: replaced by CbConfigForm) ───────────────────
            Phase 44 follow-up: schema + tableName + autoSuggestDisabledReason come from
            cbAutoSuggestTarget so dv-bound layers query the materialized view (or disable
            auto-suggest entirely when the view isn't materialized yet).
            Phase 53 (RENDER-V19-03): gate on effectiveRenderMode (coerced) + pass
            trackContext so per-break advanced panels are hidden under Track+Classbreak. */}
        {effectiveRenderMode === "classbreak" && (
          <CbConfigForm
            config={config}
            onChange={onChange}
            columns={columns}
            isValid={isValid}
            tableRef={(config.tableRef as string) || ""}
            schema={cbAutoSuggestTarget.schema}
            tableName={cbAutoSuggestTarget.tableName}
            autoSuggestDisabledReason={cbAutoSuggestTarget.autoSuggestDisabledReason}
            trackContext={spatialMode === "track"}
          />
        )}

        {/* ─── CONTOUR PARAMS ───────────────────────────────────────────────── */}
        {renderMode === "contour" && (
          <div className="config-group" role="group" aria-labelledby="map-contour-params-label">
            <label id="map-contour-params-label" className="config-group-label">
              CONTOUR PARAMS
            </label>

            <label className="config-color-field">
              Contour color
              <div className="config-color-row">
                <input
                  type="color"
                  className="config-color-picker"
                  value={`#${(config.contourColor as string) || "FF0000"}`}
                  onChange={(e) =>
                    onChange({
                      ...config,
                      contourColor: e.target.value.replace("#", "").toUpperCase(),
                    })
                  }
                />
                <input
                  type="text"
                  className="config-color-text"
                  value={(config.contourColor as string) || "FF0000"}
                  onChange={(e) =>
                    onChange({ ...config, contourColor: e.target.value.toUpperCase() })
                  }
                />
              </div>
            </label>

            <label className="config-toggle">
              Smooth contours
              <input
                type="checkbox"
                checked={(config.contourSmooth as boolean) ?? true}
                onChange={(e) =>
                  onChange({ ...config, contourSmooth: e.target.checked })
                }
              />
            </label>

            {/* PITFALL M-05 — CONTOUR_BANDWIDTH labelled "Kinetica map units" */}
            <label className="config-range-field">
              Bandwidth (Kinetica map units)
              <input
                type="range"
                className="config-range"
                min={0.1}
                max={100}
                step={0.1}
                value={(config.contourBandwidth as number) ?? 10}
                onChange={(e) =>
                  onChange({ ...config, contourBandwidth: Number(e.target.value) })
                }
              />
              <span className="config-range-value">
                {(config.contourBandwidth as number) ?? 10}
              </span>
            </label>
          </div>
        )}

        {/* ─── ZOOM RANGE (post-VERIFY operator request) ──────────────────────
            Per-layer visibility-by-zoom. Stored as `layer.config.minZoom` +
            `layer.config.maxZoom` (INCLUSIVE semantics on the wire). When
            either is undefined, that bound is treated as "no limit" — defaults
            to [0, 28] (OL's full default view-zoom range). MapChartRenderer
            translates inclusive [min, max] to OL's setMinZoom (EXCLUSIVE) /
            setMaxZoom (INCLUSIVE) convention via `applyZoomRangeToLayer`.

            Dual-handle slider visual; cross-thumb guard prevents min > max
            (collisions collapse to single-zoom visibility, never swap). */}
        <div
          className="config-group zoom-range-config-section"
          role="group"
          aria-labelledby="map-zoom-range-label"
        >
          <label id="map-zoom-range-label" className="config-group-label">
            ZOOM RANGE
          </label>
          <div className="zoom-range-description">
            Show this layer only at zoom levels in the selected range.
          </div>
          <ZoomRangeSlider
            value={[
              (config.minZoom as number | undefined) ?? ZOOM_RANGE_MIN_DEFAULT,
              (config.maxZoom as number | undefined) ?? ZOOM_RANGE_MAX_DEFAULT,
            ]}
            onChange={(next: ZoomRangeValue) => {
              const [nextMin, nextMax] = next;
              // Persist null/undefined when the user lands on the defaults
              // (saves bytes + signals "no constraint"). Inclusive semantics
              // on the wire — MapChartRenderer translates to OL's convention.
              const minPatch =
                nextMin === ZOOM_RANGE_MIN_DEFAULT ? undefined : nextMin;
              const maxPatch =
                nextMax === ZOOM_RANGE_MAX_DEFAULT ? undefined : nextMax;
              const nextConfig: Record<string, unknown> = { ...config };
              if (minPatch === undefined) {
                delete nextConfig.minZoom;
              } else {
                nextConfig.minZoom = minPatch;
              }
              if (maxPatch === undefined) {
                delete nextConfig.maxZoom;
              } else {
                nextConfig.maxZoom = maxPatch;
              }
              onChange(nextConfig);
            }}
            min={ZOOM_RANGE_MIN_DEFAULT}
            max={ZOOM_RANGE_MAX_DEFAULT}
          />
        </div>

        {/* ─── INFO POPUP (Phase 22 CONFIG-V14-03) ────────────────────────── */}
        <div
          className={`config-group info-popup-config-section${tableMissing ? " disabled" : ""}`}
          role="group"
          aria-labelledby="map-info-popup-label"
        >
          <label id="map-info-popup-label" className="config-group-label">
            INFO POPUP
          </label>

          {tableMissing && (
            <div className="info-popup-config-section-message">
              Bind a table to configure info popup
            </div>
          )}

          <label className="config-toggle">
            <input
              type="checkbox"
              aria-label="Enable info popup"
              checked={isInfoEnabled}
              disabled={toggleDisabled}
              aria-disabled={toggleDisabled}
              onChange={handleToggleEnabled}
            />
            Enable info popup
          </label>

          <label className="ds-field-label">
            Columns to display
          </label>
          <ChipCombobox
            options={sortedColumnOptions}
            selected={selectedColumns}
            onChange={handleColumnsChange}
            disabled={sectionDisabled}
            ariaLabel="Info popup columns"
          />

          <label className="ds-field-label" htmlFor="map-info-insert-column">
            Insert column
          </label>
          <select
            id="map-info-insert-column"
            className="ds-select info-popup-config-insert-column"
            aria-label="Insert column"
            value=""
            onChange={handleInsertColumn}
            disabled={sectionDisabled}
            aria-disabled={sectionDisabled}
          >
            <option value="">{`— pick to insert {column_name} token —`}</option>
            {/* Show only currently-selected columns (matches what would render in the popup) */}
            {(selectedColumns ?? sortedColumnOptions.map((o) => o.value)).map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>

          <label className="ds-field-label" htmlFor="map-info-template-editor">
            HTML template
          </label>
          <div
            className={`info-popup-config-editor${sectionDisabled ? " disabled" : ""}`}
            aria-disabled={sectionDisabled}
          >
            <CodeMirror
              value={infoTemplate ?? ""}
              height="180px"
              theme={editorTheme}
              extensions={[htmlLang()]}
              onChange={handleTemplateChange}
              editable={!sectionDisabled}
              readOnly={sectionDisabled}
              placeholder="— leave blank to render as a key-value table."
            />
          </div>
          {/* Inline syntax note (locked verbatim by 22-CONTEXT.md) */}
          <div className="info-popup-config-syntax-note">
            {`Use {column_name} to insert values.`}
          </div>
          {/* Inline security warning (locked verbatim by 22-CONTEXT.md) */}
          <div className="info-popup-config-security-note">
            HTML is rendered as-is — do not paste templates from untrusted sources.
          </div>
        </div>

      </div>
    </div>
  );
}

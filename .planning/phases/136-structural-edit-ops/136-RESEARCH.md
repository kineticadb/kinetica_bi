# Phase 136: Structural & Edit Ops - Research

**Researched:** 2026-10-13
**Domain:** AI structural/edit ops over the Phase 134 session layer and Phase 135 gateway (zod contracts, ChartConfigPanel SQL generation, Kinetica WMS heatmap layers, react-grid-layout placement, agent-loop repair semantics)
**Confidence:** HIGH on codebase facts (every claim cites file:line, read this session); MEDIUM on Kinetica `VAL_ATTR` (one official docs page, not yet confirmed against the operator's server)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chart edits (AIACT-V20-01/02/03)**
- **D-01 The AI never writes SQL.** It supplies structured fields only; the app generates the widget SQL with the same generator the config panel uses at Apply (`ChartConfigPanel` `generatedSql`). Today `widget.config.sql` is frozen at Apply time, so an AI edit must regenerate it, or the edit silently does nothing (see TD-V20-ALLOWLIST-KEYS).
- **D-02 Changing chart type:** allowed only among compatible types that share metric and group-by (bar, line, pie), keeping the fields. An incompatible change (e.g. bar to records) is done as remove plus add.
- **D-03 Editable chart fields:** metric and aggregation; group-by, sort and top-N (operator confirmed: keep the requirement wording); title and axis/legend labels (plain text); colours from a **named palette or theme vocabulary only**, never hex. The model cannot emit hex (roadmap criterion 2), so the palette names map to token-driven colours.
- **D-04 A chart's table cannot be changed.** Re-pointing a chart at another table is refused; the AI adds a new widget instead.
- **D-05 Marking edited saved widgets:** a saved widget the AI has edited in the session gets an **"AI edited" state flag**, like AI-added widgets, so it can be highlighted and badged. This phase owns the flag and selector; Phase 137 owns the final visuals. A minimal existing-class badge is acceptable here.

**Removing & rearranging (AIACT-V20-02/05/10)**
- **D-06 Removing saved widgets or layers asks once per conversation.** The first time the AI wants to remove **saved** content, it must ask ("Remove the saved Pie Chart? Yes / No") instead of applying. After a Yes, later removals of saved content in the **same conversation** need no confirmation. The approval is cleared by Keep, Discard or reload, along with the session history (134 D-04).
  - Content the AI added itself can always be removed without asking.
  - This phase builds the gate and approval state, plus a scripted or harness way to answer it. The clickable Yes/No UI is Phase 137's clarification choices (AIWID-V20-06).
- **D-07 Moving saved widgets:** the AI may **freely** resize and reorder **saved** widgets in the session, without asking. It's revertible and persisted only by Keep. This refines 134 D-14: *automatic placement* of a new widget never pushes saved widgets, but explicit AI layout ops may move them.
- **D-08 Placement** (carried from 134 D-14): new widgets fill gaps first, then go below existing content, with sensible sizes per type (KPI or big number small, map large, records table wide). **If no gap fits, put it below everything**; the answer says where it went.
- **D-09 At most 6 new widgets per answer** (env-tunable, Claude names the variable, default 6). Extra add ops are skipped and reported in the change log; they are never applied.

**Heatmap layers via AI (AIACT-V20-04/05/06)**
- **D-10 Heatmap style settings the AI may set:**
  - colour ramp (only the named ramps the layer editor offers; never hex)
  - radius/blur
  - opacity
  - weight/value column (numeric, validated against the live schema)
- **D-11 Choosing a map when several exist:** put the new heatmap on the **map that already shows the same table**. Ask (clarification choices) only if that still leaves more than one candidate or none. If there is exactly one map, use it.
- **D-12 No map on the dashboard:** one answer **adds a map widget** (large, placed per D-08) **plus the heatmap layer**. This counts toward the D-09 cap.
- **D-13 Saved layers follow the same rules as widgets:**
  - The AI may restyle saved **heatmap** layers freely; other layer types can't be restyled (AI-F12).
  - Any layer type may be **removed**, under the D-06 ask-once rule.
  - Any layer type may be **hidden or shown**.
  - AI-added (negative-id) layers must never reach `apiUpdateLayer` (134 D-16).
- **D-14 Render on both paths:** an AI-added or restyled heatmap must render through **both `buildWmsParams` sites in MapChartRenderer**, with tiles and legend (roadmap criterion 4). The automated, operator and human-verify map test plan in ROADMAP.md Phase 136 applies.

**Bad references & refusals (AIACT-V20-11)**
- **D-15 Quiet repair with a hint:** on an unknown column or table, the gateway's rejection tells the AI the closest valid names, e.g. "no column `fare`; closest: `fare_amount`, `total_amount`". The AI retries, at most 2 attempts per bad reference.
  - The user just sees the corrected result. The answer may mention what was used.
  - Hints come **only from tables and columns the user can access**.
- **D-16 Refusal is a plain answer plus what to try.** After 2 failed attempts, or when a request is impossible (no such table, no access, unsupported type or layer, chart table change), that part is **not applied** and the answer says why and what's available.
  - **Other valid parts of the same answer still apply.** This is per-op skip, compatible with 135 atomic apply: the answer's ops still apply only if the answer completes. A rejected op is reported as skipped, never applied.
- **D-17 No access looks like not found:** "I couldn't find a table called X." Never disclose that an inaccessible table exists (AISAFE-V20-03). The same applies to repair hints.
- **D-18 Fixing W2 from 135 verification:** the agent loop's rejection counter is keyed by tool name and never resets, so after 2 rejections, later **valid** calls of that tool are blocked and recorded only in `tools`.
  - Key the counter per bad reference/target, or reset it on success. The 2-attempt limit applies to repairing **the same** bad reference.
  - Surface blocked calls in `skipped` so the change log and answer show them.

**Carried constraints**
- **D-19 TD-V20-ALLOWLIST-KEYS is owned here.** Chart `metric`/`aggregation` are keyed under widget type `"chart"`, which matches no real type, while renderers read `metricColumn` and a frozen `config.sql`. Layer `opacity` is 0-1 in the allow-list while the renderer reads `config.POINTOPACITY` 0-100.
  - Fix these with a translation seam like 134-10's `WIDGET_OVERLAY_KEY_MAP`.
  - The same fix makes the v1.11 radio controls for those fields work too. Verify them.
- **D-20 Rights:** session-only ops are allowed for any `ai:use` user (135 D-16), with per-op checks for view and table/column access. Edit rights are enforced at Keep (141).
- **D-21 Layer column checks:** a layer `patch` today gets the allow-list check but no column-existence check (135 verification info item). Add live-schema column checks for heatmap layer ops (weight column, geometry/lat-lon).

### Claude's Discretion
- Op and tool payload shapes: extending `add_widget`/`add_layer` and adding layout ops such as `move_widget` / `resize_widget` or a single `set_layout`. Must stay inside the shared `AiOp` contract and the strict-schema style.
- The compatible-type matrix details (D-02), per-type default sizes (D-08), the palette and ramp vocabulary names (D-03, D-10), and how "closest name" is computed (D-15).
- How the D-06 approval is represented (a session-layer flag plus a server-side "needs confirmation" outcome) and how the harness answers it.
- The env variable name for D-09.

### Deferred Ideas (OUT OF SCOPE)
- The clickable Yes/No confirmation for removing saved content, and the clickable map choice: Phase 137 (AIWID-V20-06 clarification choices). This phase builds the gate and state.
- Restyling raster, class-break and track layers: AI-F12.
- Persistent "don't ask again" removal approval per user or dashboard: rejected for now (per-conversation chosen). Revisit only if the operator asks.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AIACT-V20-01 | AI can add a visualization | `add_widget` op + per-type positive config catalogue (shared); SQL generated app-side by extracted `buildChartSql` (Q1); placement via shared pure `placeWidget` (Q4); 6-per-answer cap (Q5) |
| AIACT-V20-02 | AI can remove a visualization | `remove_widget` + D-06 ask-once gate (server "needs confirmation" outcome + client fold gate) (Q5) |
| AIACT-V20-03 | AI can edit a visualization (chart type, metric, group-by, sort; colours via theme tokens only) | typed edit tool -> `patch`; `change_widget_type` op for bar/line/pie; allow-list re-keyed by real type + overlay seam regenerating `sql`/`drillDownColumn` (Q1, Q2); palette enum, no hex (Q1) |
| AIACT-V20-04 | AI can add a heatmap map layer | `add_layer` payload extension, `makeSessionLayer` rewrite, D-11/D-12 host resolution, `VAL_ATTR` emission added to `wmsUrlBuilder` (Q3) |
| AIACT-V20-05 | AI can remove a map layer | `remove_layer` + D-06 gate; temp layers vs saved layers (Q5) |
| AIACT-V20-06 | AI can edit a heatmap layer's style | strict AI heatmap allow-list (colormap, reverse, blurRadius, opacity, valueColumn, visible, name) + `opacity` -> `POINTOPACITY` seam (Q1, Q3) |
| AIACT-V20-10 | AI places new widgets sensibly and can resize/reorder | shared `placeWidget`, atomic `set_layout` op, `derived.layout` overrides that never reach `onLayoutChange` persistence (Q4) |
| AIACT-V20-11 | Bad table/column repaired (<= 2 attempts) or refused, never applied | W2 fix keyed per bad reference, closest-name hints from accessible columns only, layer column checks, skipped surfacing (Q5) |
</phase_requirements>

## Summary

The phase is mostly **contract + seam work, not new libraries**. Three facts shape everything. (1) `POST /api/sql` is a raw passthrough that runs whatever `config.sql` the browser sends with the user's own Kinetica credentials (`packages/server/src/index.ts:3024-3036`); there is no server re-validation of `config.sql`. D-01 is therefore enforced **structurally**: `sql` must never be an AI-settable key and the app must generate it. Today the gateway's `add_widget` check is a **denylist** (`gateway.ts:88-96`) and does NOT block `sql`, so a model could currently ship `config.sql` straight into the renderer (`WidgetRenderer.tsx:432`). That is the single most important thing to close, by switching `add_widget`/`patch` to a **positive per-type catalogue** in `packages/shared`. (2) Chart SQL, `drillDownColumn` and `drillDownColumnType` are all frozen at Apply (`ChartConfigPanel.tsx:1097-1113`), so any AI metric/group-by edit must re-derive all three, not just `sql`. (3) Heatmap layers have **no weight-column and no layer-editor weight control today**: `wmsUrlBuilder.ts:368-392` emits only `BLUR_RADIUS`, `COLORMAP`, `REVERSE_COLORMAP`. D-10's weight column needs a new `valueColumn` config field emitting Kinetica's `VAL_ATTR` (documented for `STYLES=heatmap`), plus a layer-editor control so the editor stays at parity.

The seam recommendation (D-19): keep the persisted allow-list names (`metric`, `aggregation`, `opacity`), re-key the widget allow-list by the **real types** (bar/line/pie/table/bignumber), and translate at the one shared render-time merge point (`WidgetRenderer.tsx:354-356` for widgets, `applyLayerOverrides.ts` for layers). One new pure helper (`deriveChartConfig`) regenerates `sql` + drill columns when an overlay touches SQL-affecting keys, so v1.11 radio controls and AI overlays both benefit with no second mechanism. AI-added (temp) widgets fold the same helper at fold time.

The agent-loop W2 fix is simple and should not pre-block anything: always run the gateway, count failures per bad reference (`<tool>:<table>:<column>`), and let valid calls through always. Blocked/refused repeats surface in `skipped` (today `result.rejected`, `runAnswer.ts:124`). New outcomes (needs-confirmation, needs-choice) ride the same SSE `result` event as a `clarifications` array that Phase 137 renders.

**Primary recommendation:** Build a strict positive catalogue and validators in `packages/shared` first (one owner plan), then fan out: server gateway/loop, web pure libs + overlay seam, WMS heatmap `VAL_ATTR` + form control, and finally the session fold + DashboardsPage + harness. One plan owns ROADMAP/REQUIREMENTS/STATE.

## Standard Stack

No new dependencies. Everything below already exists and is pinned in the repo.

### Core
| Library | Version (repo) | Purpose | Why Standard |
|---------|----------------|---------|--------------|
| zod (shared) | ^3.25.76 (`packages/shared/package.json`) | `AiOp` contract, allow-lists, catalogue validators | Contract already in v3 style (`aiOp.ts`); keep `.strict()` payloads |
| zod/v4 (server tools) | via `zod/v4` subpath | MutateTool arg schemas | Tools use `import { z } from "zod/v4"` (`tools/mutate.ts:4`); provider schemas must be FLAT (see Pitfall 6) |
| react-grid-layout | existing (`ResponsiveGridLayout`, `DashboardsPage.tsx:85`) | grid | 36 cols, `rowHeight={5}`, `margin={[8,8]}` (`DashboardsPage.tsx:1571-1573`) |
| vitest | web/server/shared existing | tests | Server gate is set-based per CLAUDE.md |
| OpenLayers `ImageWMS`/`ImageLayer` | existing | heatmap tiles | Both `buildWmsParams` call sites spread `...cfg` (`MapChartRenderer.tsx:1371`, `:1630`) |

### Supporting (existing internal modules to reuse)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `packages/web/src/lib/widgetOverlayKeys.ts` | `WIDGET_OVERLAY_KEY_MAP` + `translateWidgetOverlay` | extend with chart keys + value transforms |
| `packages/web/src/lib/applyLayerOverrides.ts` | shared layer overlay merge (map + legend) | add `opacity` -> `POINTOPACITY` |
| `packages/web/src/lib/chartTheme.ts` | `AURORA_CHART_PALETTE` hex (lib/ is outside theme-guard) | palette-name -> colour resolution for AI |
| `lib/aggregationLabels.ts` `AGGREGATIONS` | valid aggregation set (SUM, AVG, MIN, MAX, COUNT, COUNT_DISTINCT, STDDEV, VARIANCE) | aggregation enum mapping |
| `lib/columnTypes.ts` `isNumericType` (`ChartConfigPanel.tsx:95` has a local copy) | numeric type test | weight/lat/lon type checks |
| `.widget-filter-badge` class (`global.css` ~3170) | accent pill with `--on-accent` text | minimal "AI edited" badge (D-05); header slot at `WidgetCard.tsx:135-142` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server generates widget SQL | Web generates | Server has no access to ChartConfigPanel deps (`whereCustomWhere`, `resolveMetricExpr`, `buildBucketExpr`, auth store) and the renderer runs the SQL client-side anyway. **Use web generation**; server only validates structured fields against the live schema. |
| One generic `patch` tool | typed `edit_widget`/`edit_heatmap_layer` tools | Typed flat tools give the provider enum constraints (colour names, aggregation, ramps) and are easier for weaker models; `patch` stays registered for dynamicView/back-compat. |
| Registry-derived AI validators | hand-written shared catalogue + web drift test | S3 already decided this (`133-SPIKES.md:174`): `packages/shared` cannot import the registry (React). |

**Installation:** none.

**Version verification:** no packages added, so no registry check applies. (Kinetica WMS docs fetched: https://docs.kinetica.com/7.1/api/rest/wms_rest/ on 2026-10-13.)

## Architecture Patterns

### Q1. Chart SQL, execution, and the translation seam

**How `generatedSql` is built** (`ChartConfigPanel.tsx:366-506`, a `useMemo`). Inputs actually read: `draft.table` (the `schema.name` string), `draft.customWhere`, `usesAggregation`/`requiresGroupBy` (from `chartDef`), widget type (`isBar`, `isLine`, `isTable`, `isHeatmap`), `draft.metricColumn`, `draft.aggregation` (uppercase, from `AGGREGATIONS`), `draft.groupByColumn`, `draft.groupByColumns`, `draft.sortDir` (ASC/DESC), `draft.limit` (ladder `[5,10,25,50,100,250,500]`, else 100), `draft.metricId` (custom metric), `columnTypeMap` + `xBucket`/`yBucket` (heatmap only), and `useAuthStore.getState().maxBarGroupBySeriesCap` (bar/multi-line limit multiplier, `:441-446`). Output shapes for the AI subset:

| Type | SQL shape (ChartConfigPanel.tsx) |
|------|-----------------------------------|
| bar/line/pie (single group-by) | `SELECT g, AGG(m) AS value FROM t[ WHERE (cw)] GROUP BY g ORDER BY value DIR LIMIT n` (`:505`) |
| bar/line, `groupByColumns.length >= 2` | multi-column variant, `LIMIT n * cap * 2` (`:419-451`, `:477`) |
| table | same grouped variant (`usesMultiColumnGroupBy` includes table) |
| bignumber (`requiresGroupBy:false`) | `SELECT AGG(m) AS value FROM t[ WHERE (cw)]` (`:397-413`) |
| records (`usesAggregation:false`) | `SELECT cols FROM t[ WHERE (cw)][ ORDER BY sortField DIR]`, with a regex identifier filter on cols/sortField (`:374-384`) |
| incomplete fields | placeholder `SELECT * FROM t LIMIT 100` (`:407`, `:430`, `:495`) |

**Extractable? Yes, into a pure web function.** Create `packages/web/src/lib/chartSql.ts` exporting `buildChartSql(input)` where `input = { widgetType, table, tableId, config, flags: { usesAggregation, requiresGroupBy }, columnTypeMap?, maxBarGroupBySeriesCap, resolveMetricExpr }`; `ChartConfigPanel` calls it (output byte-identical, protected by a characterization test over every branch above: the existing `ChartConfigPanel.spec.tsx` + `ChartConfigPanel.customMetric.spec.tsx` already cover many). The AI path passes `maxBarGroupBySeriesCap` from the auth store at the call site (the fold must stay store-free, so pass it via the baseline) and ignores heatmap args. Do NOT build the generator in `packages/shared` (it depends on web-only libs) and do NOT generate server-side.

**Security hardening the extraction MUST add** (the panel does not do it today): the generator interpolates `aggregation`, `metricColumn`, `groupByColumn` unquoted into SQL (`:410-411`, `:498-505`). In the panel those come from `<select>`s; for the AI path they come from the model. Require in `buildChartSql`: aggregation `∈ AGGREGATIONS values`, every identifier `^[A-Za-z_][A-Za-z0-9_]*$` (else return the placeholder / throw an `UnsafeIdentifier` that the fold turns into a skipped op). The gateway live-schema check (exact-name match against the user-credentialed probe) is the second layer; the regex is the independent third.

**Where widget SQL executes and whether it is re-validated.** Browser: `AggregatedWidgetRenderer` reads `cfg.sql` (`WidgetRenderer.tsx:432`) -> `fromSwap` (view swap) -> `runSql` (`:691`) -> `POST /api/sql` -> `kineticaSqlHelper` with the **user's** session credentials (`index.ts:3024-3036`). **No server-side validation, allow-list or read-only guard exists on this route.** Consequences for planning:
1. `config.sql` must be impossible for an AI op to set. Today it is not: `gateway.ts:88-96` is a denylist (`AI_BLOCKED_CONFIG_KEYS = ["customWhere"]` + permanently blocked + dv keys), so `add_widget {config:{sql:"DROP ..."}}` would pass the gateway, and `makeSessionWidget` copies `op.config` verbatim (`foldSession.ts:15-27`). **Fix: positive per-type catalogue for add_widget config and a defence-in-depth strip of `sql`/`customWhere`/`metricId`/`dynamicViewId`/`table`/`drillDown*`/`layout`-from-model in `makeSessionWidget`** (the app injects `sql`, `table`, `tableId`, `drillDownColumn`, `drillDownColumnType`, `layout`).
2. Add a hostile-input positive control: `add_widget` with `config.sql`, with `aggregation:"SUM) FROM x; DROP"`, with `metricColumn:"a b"` -> each rejected at gateway AND (if bypassed) at fold/generator.
3. `customWhere` (designer-authored raw predicate on SAVED widgets) is preserved by the generator for saved-widget edits; the AI can neither set nor clear it.

**What breaks today for metric/aggregation (TD-V20-ALLOWLIST-KEYS), exactly:**
- `WIDGET_ALLOW_LIST` keys are `map`, `chart`, `records` (`actionAllowList.ts:106-127`). `resolveAllowList("widget","bar")` returns null -> `"no allow-list for target"` (`:316+`). So every bar/line/pie patch is rejected for **both** radio and AI. `WIDGET_CAPTURE_FIELDS.chart` (`radioGroupCapture.ts:47-49`) is keyed `chart` too, so radios never even capture it.
- Even if it validated, the overlay merges `metric`/`aggregation` into config (`WidgetRenderer.tsx:354-356`) but the renderer reads `metricColumn` (`:1057-1068` etc.) and the frozen `cfg.sql` (`:432`), so nothing changes. Also the enum is lowercase (`sum`) while the generator needs `SUM`/`COUNT_DISTINCT` (`ChartConfigPanel.tsx:410`; real saved config `"aggregation":"SUM"`).
- The gateway column check only knows `metricColumn|groupByColumn|groupByColumns` (`gateway.ts:23`, `:59-67`), so a `metric` patch (the allow-list name) would skip the column-existence check entirely.

**Recommended seam design (mirror 134-10):**
1. `packages/shared/src/actionAllowList.ts`: re-key `WIDGET_ALLOW_LIST` by real types `bar|line|pie|table|bignumber` (keep `map`, `records`; drop `chart`). Keep the persisted names `metric` and `aggregation` (lowercase enum, as in the persisted radio contract). Add fields named as the renderer keys so no seam is needed for them: `groupByColumn`, `sortDir` (`ASC|DESC`), `limit` (ladder), `xAxisLabel`, `yAxisLabel`, `yFieldLabel`, `label`, `subLabel`, `showLegend`, and `color`/`color1..6`/`barColor` as **palette-name enums**. Bump `ALLOW_LIST_VERSION` to `v4` (ripples: `lib.aiContract.spec.ts` AIC-3/AIC-4, `/api/ai/config` `allowListVersion`, shared `actionAllowList.spec.ts`, web shim `lib/actionAllowList.ts`).
2. `widgetOverlayKeys.ts`: extend `WIDGET_OVERLAY_KEY_MAP` for bar/line/pie/table/bignumber with `metric: "metricColumn"` and add a **value-transform map** (the existing seam maps keys only): `aggregation` lower -> UPPER (`count_distinct` -> `COUNT_DISTINCT`), palette name -> hex (via `chartTheme`), `limit` snap to ladder. Export `translateWidgetOverlay(type, patch)` unchanged in signature.
3. New pure `deriveChartConfig(type, mergedConfig, ctx)` in `lib/chartSql.ts` returning `{ sql, drillDownColumn, drillDownColumnType }`; for aggregated category charts `drillDownColumn = groupByColumn` (`ChartConfigPanel.tsx:672-690`: drill follows group-by) and the type from `inferDataTypeFromColumn(col, tableColumns)`. If the patch sets `metric`/`aggregation` on a widget whose `metricId` is a number, also set `metricId: null` (`isCustomSelection(null)` is false, `customMetricSql.ts:23-24`) or the generator keeps the custom expression and ignores the AI's metric.
4. Apply at the **single render-time merge** `WidgetRenderer.tsx:354-356`: after translate, if the overlay keys intersect `{metricColumn, aggregation, groupByColumn, sortDir, limit}` call `deriveChartConfig` on the merged config (table name from `tables` prop by `config.tableId`, fallback `config.table`). Overlays from multiple controls are merged (recency order) BEFORE this, so radio + AI compose correctly and SQL regenerates once. Temp (AI-added) widgets are real `WidgetDto`s in the fold, so `foldSession` calls the same `translateWidgetOverlay` + `deriveChartConfig` when patching them (today it already calls `translateWidgetOverlay` for temp widgets, `foldSession.ts:226-227`).
5. Layer `opacity`: `LayersModal.tsx:525-550` writes `config.POINTOPACITY` (0-100) and `MapChartRenderer.tsx:1498,:1539` reads it. Add `LAYER_OVERLAY_KEY_MAP = { opacity: v => ({ POINTOPACITY: Math.round(v*100) }) }` applied inside `applyLayerOverrides.ts` (one place; map AND `LegendRenderer` both call it) and when the fold merges a patch into a temp layer (`foldSession.ts:233-239`). Mirror it in `radioGroupCapture.ts` so capture reads `POINTOPACITY/100` (as 134-10 did for widgets via `WIDGET_OVERLAY_KEY_MAP`, `radioGroupCapture.ts:112-116`). Note `pointOpacity` (raster point alpha, WMS param) is a DIFFERENT field and must not be touched.
6. **How radio controls benefit:** `WIDGET_CAPTURE_FIELDS` gains `bar/line/pie/table/bignumber` entries -> the Radio editor can capture/apply metric+aggregation; layer radios applying `opacity` now take effect. Behaviour change to flag: any previously persisted radio option carrying layer `opacity` (previously a no-op) will start applying. Verify by a canary spec in the style of `actionEngine.canary.spec.tsx`.

**Colours (no hex, D-03).** Vocabulary = the six AURORA names in `chartTheme.ts:48-55`: `violet, sky, teal, amber, pink, lime` (order = `AURORA_CHART_PALETTE`). Shared exports `AI_PALETTE_NAMES` as `z.enum`; web `lib/aiPalette.ts` maps name -> hex (hex lives in `lib/`, which the theme-guard does not scan; do not add hex to any component or to `packages/shared`). Drift test: `AI_PALETTE_NAMES.length === AURORA_CHART_PALETTE.length`. "The model cannot emit hex" holds structurally (enum) and is proven by a fuzz test: `#ff0000`, `ff0000`, `FF3B82F6`, `red`, `rgb(1,2,3)`, `var(--accent)` all rejected on `color`/`color1..6`/`barColor`; `violet` accepted (positive control).

### Q2. Compatible chart-type matrix and default sizes

Config keys per definition (`components/charts/definitions/*.ts`; real saved configs checked in `packages/server/data/kinetica.db`, read-only):

| Key | bar | line | pie | table | bignumber | records | map |
|-----|-----|------|-----|-------|-----------|---------|-----|
| `table` (schema.name), `tableId`, `sql`, `drillDownColumn(+Type)` | yes | yes | yes | yes | yes | yes (sql) | no (layers carry tables) |
| `metricColumn`, `aggregation` | yes | yes | yes | yes | yes | no | no |
| `groupByColumn` (+`groupByColumns`) | yes (+multi) | yes (+multi) | yes (single) | yes (+multi) | no (`requiresGroupBy:false`) | no | no |
| `sortDir`, `limit` | yes | yes | yes | yes | no | n/a | no |
| labels | `xAxisLabel`,`yAxisLabel`,`yFieldLabel` | `yFieldLabel` | none | none | `label`,`subLabel` | none | `title` |
| colour | `color` | `color` | `color1..color6` | `barColor` | `color` | none | none |
| legend | `showLegend` | `showLegend` | `showLegend` | none | none | none | none |

**Compatible-type rule (D-02):** `{bar, line, pie}` interchangeable. Preconditions enforced by the gateway (from snapshot binding) and the fold: refuse -> pie when `groupByColumns.length >= 2` (pie ignores multi series; `sqlLimit` also differs by type, `ChartConfigPanel.tsx:441`); `sql` MUST be regenerated on every type change because the bar/multi-line limit multiplier is type-dependent. On change, new config = `{ ...defaultsFor(newType), ...existingConfig }` (existing wins) so type-specific appearance keys get sane defaults; unused keys are inert. `table`, `bignumber`, `records`, `map` are NOT in the set (remove + add). Saved-widget type change is a derived override (`derived.widgetMeta[id].type`) applied in `applySessionToWidgets` since overlays only merge `config`. `type` stays a PERMANENTLY_BLOCKED patch key (identity), so type change is its own op (`change_widget_type`), not a patch key.

**Additional edit refusals (state in the contract, planner: add tests):** a saved chart bound to a dynamic view (`config.dynamicViewId`, e.g. real widgets 13 and 15) cannot be AI-edited in 136 (columns come from `columns_json`, not the table; Phase 139 owns dvs). A saved chart whose `config.table`/`tableId` cannot be resolved against the dashboard's tables cannot be regenerated -> skipped `patch_rejected` with reason.

**Default sizes (D-08).** Grid: 36 columns, `rowHeight` 5 px, margin 8 (`DashboardsPage.tsx:1571-1573`); pixel height = `h*5 + (h-1)*8`. Today every new widget is 18x24 (`getWidgetLayout`, `DashboardsPage.tsx:589-600`, `handleAddVisualization:1180`). Real operator maps are 20-28 wide and 41-45 high (widgets 1, 7 in `kinetica.db`). Starting values, to be tuned at the operator human-verify checkpoint:

| Type | w x h | approx px h | note |
|------|-------|-------------|------|
| bignumber | 9 x 14 | 190 | KPI, 4 across |
| bar / line / pie | 18 x 30 | 380 | half width |
| table | 18 x 36 | 450 | half width |
| records | 36 x 36 | 450 | full width |
| map | 28 x 45 | 575 | matches the operator's real maps |
| minimum for `set_layout` | w>=6, h>=6 | | existing `minW/minH 6` |

### Q3. Heatmap layers (exact fields, ramps, WMS params)

**Fields the layer editor writes** (real saved heatmap rows, `kinetica.db` layer 4/11/22; defaults at `DashboardsPage.tsx:1342-1360`; form at `KineticaWmsLayerForm.tsx`):
`renderMode:"heatmap"`, `spatialMode:"latlon"|"wkt"|"wkb"`, `latColumn`/`lonColumn` (latlon) or `wktColumn` / `wkbColumn`, `colormap` (default `"viridis"`), `reverseColormap` (explicit boolean, never undefined, `KineticaWmsLayerForm.tsx:1378-1401`), `blurRadius` (range 1-32, default 5, `:1408-1418`), `visible:true`, `name` (legend display name, `LayersLegendPanel.tsx:244-247`), optional `minZoom/maxZoom`, plus raster fields (`pointColor`, `pointSize`, `pointOpacity`, `pointShape`, `shape*`, `antialiasing`) that heatmap ignores. Top-level DTO fields: `table_id`, `layer_type:"KineticaWms"`, `cb_config:null`, `track_config:null`, `info_*`. `isConfigComplete` requires `spatialMode` plus the mode's columns, else the layer is silently skipped (`MapChartRenderer.tsx:167-182`, call `:1310`). A layer whose `table_id` is not in the map's `tables` prop (= the dashboard's associated tables) is also skipped (`:1316-1319`) -> **AI heatmap layers are limited to tables associated with the dashboard** (see Open Question 1).

**Layer opacity** = `config.POINTOPACITY` 0-100 (LayersModal slider, applied via `imageLayer.setOpacity`, `MapChartRenderer.tsx:1498,:1539`). This is the right target for D-10 "opacity" and works for heatmap.

**Named ramps.** Catalogue is `COLORMAP_GROUPS` (`KineticaWmsLayerForm.tsx:148-188`, ~85 names, case-sensitive mixed case such as `Blues`, `YlOrRd`); the form also intersects with `wmsCapabilities.colormaps` and notes `cividis`/`turbo` are rejected by the deployed server (`:137-146`). Recommendation: move the catalogue to `packages/shared` (`COLORMAP_GROUPS`), import it in the form (no behaviour change), and give the AI a **curated subset** (e.g. `viridis, inferno, plasma, magma, hot, jet, YlOrRd, Blues, Reds, Greens, coolwarm, Spectral, RdYlBu`) validated as `⊆ catalogue` by a drift test. A 85-value enum bloats provider tool schemas (S6 tool-calling was scored with a small tool set). Do not include `cividis`/`turbo`.

**WMS param names** (`wmsUrlBuilder.ts:368-392`): `STYLES=heatmap`, `COLORMAP`, `REVERSE_COLORMAP` (always emitted TRUE/FALSE, comment `:378-392` explains OL `updateParams` merge), `BLUR_RADIUS` (Kinetica map units, 1-32), spatial `X_ATTR`=lon, `Y_ATTR`=lat, `GEO_ATTR` (wkt and wkb share it, `:316-336`). `LAYERS` = `schema.table` (or a filter/dv view name).

**Weight/value column: not wired today.** Kinetica docs (https://docs.kinetica.com/7.1/api/rest/wms_rest/, fetched 2026-10-13) list `VAL_ATTR` ("attribute to use to calculate the data points for the heat map"; numeric column/expression), `BLUR_RADIUS` 1-32 default 5, `COLORMAP` default `jet`, `REVERSE_COLORMAP`, `GRADIENT_START_COLOR`/`GRADIENT_END_COLOR`. The app never emits `VAL_ATTR` (grep `VAL_ATTR` in `wmsUrlBuilder.ts` = 0). Plan: add optional `valueColumn?: string` to `MapWidgetConfig`, emit `params.VAL_ATTR = config.valueColumn` in the heatmap branch only when non-empty (existing heatmap layers stay byte-identical: snapshot test), and add a numeric-column select to the heatmap params group of `KineticaWmsLayerForm.tsx` (reuse `ds-field-label` + `ds-select`, the existing columns prop). Because both MapChartRenderer sites build `wmsConfigInput = { ...cfg, tableId, tableRef }` (`:1371`, `:1620-1630`), no renderer change is needed beyond snapshot tests on **both** sites; the fingerprint already includes `wmsParams` (`:1637`). The server `/api/wms` proxy forwards the query string without a param allow-list (`index.ts:2987-3000`), so `VAL_ATTR` passes through. Confidence MEDIUM: one docs page, version 7.1; the operator-run GetMap check must include a `VAL_ATTR` request (and a no-`VAL_ATTR` control). `VAL_ATTR` accepts expressions, so only a validated, regex-safe, live-schema-checked, numeric column name may be emitted.

**Legend derivation.** The in-map and standalone legends show, for heatmap, a header row + render-mode chip only, no break rows (`LayersLegendPanel.tsx` doc, `:16`); name comes from `config.name`. So "legend correct" for an AI heatmap means: a layer name is set (`name`), eye state follows `visible`, and `useEffectiveLayers`-fed legends include session layers (already true, `hooks/useEffectiveLayers.ts:15-16`).

**AI-added layer config.** Extract `handleLayerCreate`'s default config (`DashboardsPage.tsx:1342-1360`) into `lib/layerDefaults.ts` (`DEFAULT_LAYER_CONFIG`; its comment says defaults "MUST match" the form), then `makeSessionLayer` builds `{ ...DEFAULT_LAYER_CONFIG, renderMode:"heatmap", spatialMode, <columns>, colormap, reverseColormap:false, blurRadius:5, POINTOPACITY:100, name, ...style }` with `table_id: op.tableId` (today hard-coded 0 so it is auto-hidden, `foldSession.ts:32-47`). Leave `DashboardsPage.tsx` import swap to the DashboardsPage-owner plan to avoid a collision.

**Proposed `add_layer` op payload (shared, strict):**
```
add_layer { tempId, widgetId, tableId, renderMode: literal("heatmap"),
            spatialMode: "latlon"|"wkt"|"wkb",
            latColumn?, lonColumn?, wktColumn?, wkbColumn?,   // superRefine: columns required per mode
            style?: { colormap?, reverseColormap?, blurRadius?(1..32), opacity?(0..1), valueColumn? },
            name? }
```
`patch` on a layer for the AI uses a **separate strict AI heatmap allow-list** (`colormap, reverseColormap, blurRadius, opacity, valueColumn, visible, name`), NOT `validateLayerSnapshot`, which is a denylist that accepts any other key (`actionAllowList.ts:285-299`) and is meant for the radio designer UI. Spatial/binding keys stay blocked for patches (`DATA_BINDING_KEYS`); `renderMode` is not AI-patchable. Restyle is only allowed when the target layer's `renderMode === "heatmap"` (shadow must record `renderMode`; `visible` is allowed on any type per D-13).

**D-11/D-12 map host choice (pure function, shared, testable):** `resolveHeatmapHost({maps, layers, tableId})`: zero maps -> `{kind:"add_map"}` (answer adds a large map + layer; counts toward the cap); exactly one map -> use it; else candidates = maps already showing a layer on `tableId` (via `layer.widgetId`); exactly one -> use it; zero or several -> `{kind:"ask", options:[{widgetId,title}]}` surfaced as a clarification. Note the app has no layer->map FK: association is `map.config.includedLayerIds` (empty = all dashboard layers) (`MapChartRenderer.tsx:575-600`). The Phase 137 snapshot builder must emit `layers[].widgetId` from that rule; define the rule once in shared (`layersOfMap`) so both sides agree.

### Q4. Layout

**Grid facts.** `ResponsiveGridLayout`, `cols {lg:36,md:36,sm:18,...}`, `rowHeight 5`, `margin [8,8]`, `layouts={{lg: layouts}}`, `onLayoutChange` -> `handleLayoutChange` (`DashboardsPage.tsx:1549-1578`). Compaction is RGL's default vertical, so non-static items float up into vertical gaps on their own; horizontal gap-fill is not automatic.

**What 134 built.** `layouts` memo (`:703-721`): saved items from `getWidgetLayout(w, savedIndex)` (config.layout, else index-based 18x24 cascade), `static: true` while locked; AI items use `sessionGeometry[id]` (user drags, keyed by temp id), then `config.layout`, then a minimal `{x:0, y:bottom, w:18, h:24}`. `handleLayoutChange` (`:1272-1297`) writes negative ids to `setGeometry` and returns early for everything else when `isAiEditLocked()`, so saved geometry is never persisted while AI changes are unsaved (134 D-13). `aiSessionStore.geometry` is pruned only for ids no longer live (`aiSessionStore.ts:~107`).

**Design (pure, shared, no React):** new `packages/shared/src/layout.ts`:
- `GRID_COLS = 36`, `MIN_W = MIN_H = 6`, `DEFAULT_SIZE: Record<AiWidgetType,{w,h}>` (table above).
- `resolveRect(layout | undefined, index)` = the exact `getWidgetLayout` fallback (move `getWidgetLayout` logic here; `DashboardsPage` re-uses it in the DashboardsPage-owner plan).
- `rectsOverlap(a,b)` (strict inequality on edges so touching is fine).
- `placeWidget(existing: Rect[], size): Rect`: first-fit row-major scan, `y` from 0 to `bottom = max(y+h)`, `x` from 0 to `GRID_COLS - w`, first position overlapping nothing; at `y = bottom` always fits at `x = 0`, which is the "below everything" fallback (D-08). Never moves existing rects. Optional refinement: try the preferred size, then shrink toward the minimum before falling back below.
- `validateLayout(rects)` for `set_layout`: integers, `x>=0`, `x+w<=36`, `w>=6`, `h>=6`, `h<=200`, no pairwise overlap across the full resulting set.

**Who places:** the server gateway, so the model's tool result can say where it went (D-08 "the answer says where it went") and the op is deterministic on replay. `ShadowState.widgets` gains `rect` (from snapshot `layout`, else `resolveRect(undefined, index)`); on `add_widget` the gateway calls `placeWidget(existingRects, DEFAULT_SIZE[type])`, writes `config.layout = {x,y,w,h}` into the returned op (the model cannot set `layout`; it is not in the catalogue), and the label says "placed at row X, column Y" or "below existing content". The existing 134 fold already honours `config.layout` for AI widgets. For scripted/harness ops with no `layout`, the fold/`layouts` memo falls back to the same `placeWidget` over baseline + prior session rects (no second algorithm).

**`set_layout` (single atomic op):** `set_layout { items: [{id, x, y, w, h}] (1..30) }`. Gateway: every id exists in shadow, then `validateLayout` over the full resulting rect set (a swap/reorder is two items in ONE op, so intermediate overlap cannot occur; a per-widget move/resize op could not express a swap). Rejection reasons list overlapping ids so the model can retry. Fold: `derived.layout: Record<id, SessionRect>`. `layouts` memo applies `derived.layout[id]` for saved items (still `static` while locked, so the user cannot drag them) and AI items. `handleLayoutChange` is untouched: saved items already bail on `isAiEditLocked()` BEFORE any `updateWidget`/`setWidgets` (`:1279`), so AI geometry for saved widgets never persists; assert with a spec that fires `onLayoutChange` while a `derived.layout` override exists and expects zero `updateWidget` calls. Precedence for AI-added widgets: `applyTurn` must delete `geometry[id]` for ids touched by a `set_layout` in that turn (otherwise RGL's echo of its own compacted layout, written by `handleLayoutChange` into `setGeometry`, would permanently shadow the AI op because `geometry` wins over `config.layout`).

### Q5. Server side: ops, tools, gateway, loop

**Shared contract (`packages/shared`, ONE plan owns all of: `aiOp.ts`, `actionAllowList.ts`, `aiAsk.ts`, `layout.ts`, `index.ts`):**
- `aiOp.ts`: extend `add_layer` (payload above); add `set_layout`, `change_widget_type {id, type: bar|line|pie}`; `AI_OP_KINDS` grows from 9 (ripple: `lib.aiContract.spec.ts` AIC-4 and any web spec counting kinds); keep every payload `.strict()` and add **no SQL/raw-text field**. `add_widget` keeps `{tempId,type,title,config}` but `config` is validated per type by the catalogue (below). Title edits: allow `title` as an AI-only extra key on widget patch (handled in fold as `derived.widgetMeta[id].title`, not config), keeping one edit path.
- `AI_WIDGET_CONFIG` catalogue: per type, the allowed keys with zod validators + required keys (bar/line/pie/table: `metricColumn, aggregation, groupByColumn`; bignumber: `metricColumn, aggregation`; records/map: none required). Positive allow-list: unknown keys (`sql`, `customWhere`, `table`, `drillDownColumn`, `layout`, `dynamicViewId`, `metricId`, hex strings...) reject.
- `aiAsk.ts`: add optional `approvals: { removeSaved: boolean }` (strict) to `AskRequestSchema` for D-06. Approval is UX, not security (session-only ops are revertible, edit rights enforced at Keep), so a client-held flag is acceptable.

**Gateway (`gateway.ts`, one owner plan together with `shadow.ts`, `tools/types.ts`).** Today's order is shape -> allow_list -> permission -> reference -> live_schema -> ok. Changes:
- allow_list: replace the add_widget denylist (`:88-96`) with the catalogue; layer `patch` uses the AI heatmap allow-list plus `renderMode === heatmap` for style keys; `set_layout` shape checks.
- reference: `add_layer.widgetId` must exist and be `type:"map"` in shadow (today unchecked, `:104-117`); table must be on the dashboard (`dashboardTableIds`, add to `GatewayDeps`; otherwise "table X is not available", identical wording to not-found, D-17); `change_widget_type` target exists and type in {bar,line,pie}; D-04: any `tableId` in a widget patch is already blocked (`PERMANENTLY_BLOCKED_KEYS`), and a chart `patch`/`change_widget_type` never accepts a table.
- live_schema: generalise `columnsIn` to a per-op `collectColumnRefs(op)` returning `{ tableId, refs:[{name, role}] }`; roles `any` (metric/group-by/lat/lon/wkt/wkb/valueColumn existence), `numeric` for `metric` (except COUNT/COUNT_DISTINCT), `valueColumn`, `latColumn`, `lonColumn` when `LiveColumn.type` is known (if the registered type is unknown, fall back to existence only; do not guess). Add `metric` to the checked keys. For layer `patch` the table is `shadow.layers.get(id).tableId` (extend the shadow layer entry with `tableId`, `renderMode`, `widgetId`, `saved`); this closes the D-21/135 info item.
- Hints (D-15/D-17): `nearest()` (`gateway.ts:47-57`) uses `lev<=2 || common prefix>=3` over the probed table's column names, which are by construction columns of a table the user was just probed on. Improve ranking (case-insensitive; substring either way; shared `_`-token; sort by distance; cap 3) so `fare` suggests `fare_amount` and `total_amount` (token `amount`). Never hint other tables. Unknown/inaccessible table: fixed text "table N is not available; use list_tables for valid ids", no names, identical for not-found and no-access (`liveSchema.describe` already returns the same `{ok:false}` for all failures, `liveSchema.ts:41-47`).
- Confirmation/choice outcome: extend `GatewayResult` with `{ ok:false, stage:"clarification", reasons, clarification: {kind:"confirm_remove"|"choose_map", question, options} }`. `remove_widget`/`remove_layer` of an id `> 0` with `approvals.removeSaved !== true` returns it (negative ids always pass, D-06). The remove is NOT applied and does not count as a bad-reference rejection.
- Add-cap (D-09) lives in the loop (below), not the gateway, because it counts across calls.

**Agent loop (`agentLoop.ts`, one owner plan with `tools/mutate.ts`, `runAnswer.ts`, `aiConfig.ts`).**
- **W2 fix (D-18).** Delete the pre-gateway per-tool block (`:222-229`) and the by-name counter (`:62`, `:88`, `:237`). Always run `checkAiOp`. On failure derive `refKey` (`<tool>:<tableId|target>:<first bad column or stage>`; gateway returns `refKey` for live_schema/reference failures, else `<tool>:<stage>`), `attempts[refKey]++`. Repair guidance: attempt 1 and 2 return the gateway text + hints to the model; when the same `refKey` fails a 2nd time, append "Do not retry this; tell the user it was skipped and what is available" and record in `rejected`; a 3rd identical-ref attempt is refused without re-running and recorded as `skipped` ("refused after 2 attempts"). A VALID call is never blocked by earlier failures of the same tool (positive control: 2 bad `add_widget`, then a good one applies). Today `skipped` = `result.rejected` (`runAnswer.ts:124`) whose `label` is just the tool name (`agentLoop.ts:238`); improve `label` to the human op label (`describeOp`) so the change log names the skipped part. Existing specs to update: `lib.aiAgentLoop.spec.ts` LOOP-5 (asserts the per-tool limit), plus new ones below.
- **D-09 cap:** env `AI_MAX_NEW_WIDGETS` (default 6, range 1-30) parsed in `aiConfig.ts` (`parseIntInRange`, `:34-40`, field on `AiConfig`, included in `formatAiConfigLog`, `:118-124`; ripple: `lib.aiConfig.spec.ts`, `boot.aiConfig.spec.ts` exact-string expectations; `packages/server/.env.example`). The loop counts gateway-OK `add_widget` ops; the 7th+ is not applied, tool result says "limit reached; do not add more", recorded in `rejected`/`skipped` (stage `"cap"` string; `AiToolAuditEntry.stage` is a free string, `aiAudit.ts:12`).
- **Confirmation surface:** the loop collects `clarifications[]` (dedupe by kind+target), returns them on `AgentLoopResult`, and `runAnswer.ts:124` adds `clarifications` to the SSE `result` event (and the audit `changes.rejected` with reason "needs confirmation"). The model's tool result says: "Asked the user to confirm; do not repeat; end your reply by asking the question". Phase 137 renders buttons and re-asks with `approvals.removeSaved: true`.
- **Tools (`tools/mutate.ts`)**: keep `patch`/`remove_*`; add FLAT typed tools `edit_widget` (id + optional metric/aggregation/groupBy/sortDir/topN/title/labels/colour/showLegend), `change_widget_type`, `add_heatmap_layer`, `edit_heatmap_layer`, `set_layout`; extend `add_widget` args with the typed optional fields and make `tableId` optional (map has no table). Provider schema constraints (`tools/registry.ts:29-48`, `findComposite`): no `anyOf/oneOf/$ref`, so avoid `z.union`/`.nullable()`/discriminated unions in tool args; `limit` as `z.enum(["5","10","25","50","100","250","500"])` converted in `toOp`; use `z.enum` for colours, aggregation, ramps. `registry.spec` (`lib.aiToolsRegistry.spec.ts`) already guards flatness. System rules in `context.ts` (`AI_SYSTEM_RULES`) gain: use the named colours/ramps, never hex; never write SQL; tool descriptions carry the vocab. `DashboardView.layers` (context.ts:36-45, tools/types.ts:35-37) gains `widgetId` so the model can see map hosts.
- Re-verification: changing the tool set invalidates the S6 tool-calling scores (`135-SPIKES.md`). Plan ONE short live check, not a re-run (free tier is 20 requests/day/model).

### Q6. The "AI edited" flag (D-05)

`SessionDerived` (`aiSession/types.ts:33-40`) gains: `editedWidgetIds: ReadonlySet<number>` (saved ids with an applied config patch or type/title change), `movedWidgetIds` (saved ids with `set_layout`), `editedLayerIds`, `layout: Record<number, SessionRect>`, `widgetMeta: Record<number,{type?,title?}>`. Computed in `foldSession` (not stored), so revert/forward (`setCursor` refolds a prefix) updates the flag for free and Discard/Keep clears it with the log. Exports: `selectAiEditedWidgetIds` next to `selectHasUnsavedAiChanges` in `aiSessionStore.ts`. Minimal visual: in `WidgetCard.tsx` header (`:135-142`) render `<span className="widget-filter-badge">AI edited</span>` (existing class; text uses `--on-accent`, so it is light/dark safe). `EMPTY_DERIVED` (`constants.ts:12-19`) and `hasSessionChanges` (`applySession.ts:10-19`) must be extended; `applySessionToWidgets` (`:21-24`) must apply `widgetMeta` (type/title) while staying ref-stable when nothing changed.

Also owned here: temp-layer visibility. `useLayerVisibilityToggle.ts:36` returns early for `layerId < 0` with the comment "Visibility of AI layers is wired in Phase 136": today the legend eye does nothing for AI layers. Add a session-store `layerVisibility` map (user eye on temp layers) merged by `applySessionToLayers`; never calls `apiUpdateLayer`. AI `patch {visible}` on layers (any type) flows through the existing contribution/`applyLayerOverrides` path.

### Q7. Removal approval state (D-06) in the session layer

`aiSessionStore` gains `removalApproved: boolean` (initial false; cleared by `reset()`, which already runs on Keep/Discard/dashboard switch/leave; reload clears memory) and `approveRemoval()`. `evaluateTurn(baseline, prior, rawOps, { removalApproved })` skips `remove_widget`/`remove_layer` of ids `> 0` with new `SkipReason "needs_confirmation"` when not approved (defence in depth + makes the harness testable without a server); temp ids are never gated. `Sim` (`foldSession.ts:50-55`) must also learn saved-vs-temp, layer `renderMode` (to refuse restyle of non-heatmap layers, `unsupported_target`), and widget `type` changes (so a later patch validates against the new type). Harness: `__kbiAiHarness.approveRemoval()`, `addChart(...)`, `editChart(id, fields)`, `changeType(id, type)`, `addHeatmap(...)`, `editHeatmap(...)`, `removeLayer(id)`, `setLayout(items)`; update `help()` text and `devHarness.spec.ts`.

### Recommended Project Structure (new/changed files)
```
packages/shared/src/
  aiOp.ts            # add_layer payload, set_layout, change_widget_type
  actionAllowList.ts # v4: re-keyed widget allow-list, AI heatmap allow-list, AI_WIDGET_CONFIG, AI_PALETTE_NAMES, colormap catalogue
  aiAsk.ts           # approvals
  layout.ts          # GRID_COLS, DEFAULT_SIZE, resolveRect, placeWidget, validateLayout, resolveHeatmapHost, layersOfMap
packages/server/src/lib/ai/
  gateway.ts shadow.ts tools/{types,mutate}.ts agentLoop.ts runAnswer.ts context.ts ; lib/aiConfig.ts
packages/web/src/lib/
  chartSql.ts        # buildChartSql + deriveChartConfig (extracted from ChartConfigPanel)
  aiPalette.ts aiWidgetDefaults.ts layerDefaults.ts
  widgetOverlayKeys.ts applyLayerOverrides.ts radioGroupCapture.ts wmsUrlBuilder.ts
  aiSession/{foldSession,types,constants,applySession,devHarness}.ts ; store/aiSessionStore.ts
```
`aiWidgetDefaults.ts` is hand-written (palette-resolved colours, S3-style catalogue) rather than importing the chart registry from the fold: the registry imports React config panels (`definitions/map.ts:2`), which would drag the whole UI into the pure fold and its specs. Add a drift spec comparing it with `getChartType(type).defaultConfig` after `registerAllChartTypes()` (the S3 decision).

### Anti-Patterns to Avoid
- **Letting any AI-set key reach `config.sql`, `table`, `drillDown*`, `layout`, `metricId`, `dynamicViewId`:** all derived by the app; positive catalogue only.
- **A second SQL generator for the AI:** one extracted `buildChartSql`; the panel and the AI cannot diverge.
- **Using `validateLayerSnapshot` for AI layer patches:** denylist; accepts arbitrary keys.
- **Per-widget `move_widget`/`resize_widget` ops:** cannot express a swap without transient overlap; use atomic `set_layout`.
- **Pre-blocking tool calls by failure count (the W2 bug):** run the gateway always; count only repeated failures of the same reference.
- **Writing `derived.layout` into `widgetActionStore`/overlays:** layout is not config; it must not flow near `updateWidget`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chart SQL | a second SQL builder for the AI | extracted `buildChartSql` (from `ChartConfigPanel.tsx:366`) | one source of truth; `customWhere`, custom metrics, limits, multi-series already handled |
| Key translation | per-site renames | `WIDGET_OVERLAY_KEY_MAP` / `applyLayerOverrides` seam | 134-10 pattern; radio + AI share it |
| Colour validation | regex hex scanners | `z.enum(AI_PALETTE_NAMES)` | structural; nothing to bypass |
| Ramp validation | free-text colormap + server check | shared `COLORMAP_GROUPS` subset enum | same vocabulary as the editor |
| Placement | ad-hoc y offsets | `placeWidget` first-fit in `packages/shared/src/layout.ts` | testable, shared by server answer text and client replay |
| Identifier safety | quoting by hand | live-schema exact-name match + `^[A-Za-z_][A-Za-z0-9_]*$` | mirrors records path (`ChartConfigPanel.tsx:374-384`) |
| Closest names | external fuzzy lib | improved in-file `nearest()` | tiny; inputs are one table's column list |
| Layer vs session merge | new store | existing `applySessionToLayers` + `widgetActionStore` layer contribution under `AI_SOURCE_ID` | already source-keyed and rebuilt from the whole log |

**Key insight:** every renderer reads frozen or renamed keys (`sql`, `metricColumn`, `POINTOPACITY`). Hand-rolled per-feature fixes will diverge; one derive step at the shared merge points fixes AI, radio, and temp widgets together.

## Common Pitfalls

### Pitfall 1: Frozen `sql` / `drillDownColumn`
**What goes wrong:** AI patches `metricColumn`; chart still shows old data, or drill filters on the old column (`= 'undefined'`).
**Why:** `sql`, `drillDownColumn`, `drillDownColumnType` are stored at Apply (`ChartConfigPanel.tsx:1097-1113`); renderer runs `cfg.sql` (`WidgetRenderer.tsx:432`).
**How to avoid:** `deriveChartConfig` regenerates all three; spec asserts the rendered `runSql` argument changes (mutation proof: remove the derive call -> spec must fail).
**Warning signs:** overlay merges but `runSql` mock receives the old string.

### Pitfall 2: Custom-metric widget ignores the AI's metric
**What goes wrong:** saved widget has numeric `metricId`; generator takes the custom branch and never reads `metricColumn`.
**How to avoid:** patch of `metric`/`aggregation` also sets `metricId: null`.

### Pitfall 3: `sql` accepted from the model (see Q1)
**What goes wrong:** `/api/sql` has no guard; any `config.sql` runs as the user.
**How to avoid:** positive catalogue + fold strip + hostile-input specs (acceptance criteria that read 0 BEFORE the work, per CLAUDE.md: e.g. a `grep -c "AI_WIDGET_CONFIG" packages/shared/src/actionAllowList.ts` is 0 today).

### Pitfall 4: RGL echoes shadow AI layout ops
**What goes wrong:** `handleLayoutChange` writes RGL's compacted layout into `setGeometry`, which outranks `derived.layout`/`config.layout`, so a later AI resize is ignored.
**How to avoid:** clear `geometry[id]` for ids touched by `set_layout` in `applyTurn`; spec it.

### Pitfall 5: Saved widget `static` + AI move
**What goes wrong:** saved items are `static: true` when locked; RGL does not resolve static-vs-static overlaps.
**How to avoid:** `validateLayout` rejects any overlapping resulting set at the gateway; client re-validates in fold (skip with `patch_rejected`).

### Pitfall 6: Non-flat tool schemas
**What goes wrong:** `z.union`, `.nullable()`, discriminated unions produce `anyOf`; `buildToolRegistry` throws at startup (`registry.ts:45-48`).
**How to avoid:** flat typed tools, string enums for number ladders, keep the existing flatness spec green.

### Pitfall 7: Allow-list version/count ripples
**What goes wrong:** bumping to v4 and adding op kinds breaks `AIC-3` (`"v3"`), `AIC-4` (9 kinds), `actionAllowList.spec.ts`, web `s3Validators.spike.spec.ts`/shim, `/api/ai/config` tests, `lib.aiConfig.spec` log string (new env), RBAC-style count assertions. Executors miss these (see memory: adding-permission-ripples-across-specs).
**How to avoid:** the shared-contract plan owns every such spec in one pass; grep before and after.

### Pitfall 8: Heatmap silently not rendering
**What goes wrong:** layer skipped because `isConfigComplete` fails (missing lat/lon) or `table_id` not in `tables`, so nothing renders and nothing errors (CLAUDE.md: undefined/missing renders broken but green).
**How to avoid:** gateway requires the mode's columns + dashboard-associated table; a web spec renders `MapChartRenderer` with a session heatmap layer and asserts an `ImageWMS` source with `STYLES=heatmap`, `COLORMAP`, `BLUR_RADIUS`, `VAL_ATTR` on BOTH effect sites; operator human-verify for light/dark.

### Pitfall 9: `VAL_ATTR` availability unverified
Docs say heatmap requires CUDA builds and `VAL_ATTR` is documented for 7.1. Keep the operator GetMap check (200, `image/png`, non-blank) with and without `VAL_ATTR`; if rejected, drop weight from the AI vocabulary and report.

### Pitfall 10: Hints leaking inaccessible names
Hints derive only from the user-credentialed probe of tables already on the dashboard. Do not add a "did you mean table X" feature that scans `registeredTables`. Positive control: spec with an inaccessible table whose name is a near match to the bad one; assert it never appears in tool result, `rejected`, audit, or SSE.

### Pitfall 11: Radio behaviour change
Layer radio `opacity` and chart radios start taking effect. Verify with a canary spec, note in SUMMARY.

## Code Examples

### Seam: value + key translation (extend the 134-10 pattern)
```typescript
// Source: packages/web/src/lib/widgetOverlayKeys.ts (existing pattern, lines 11-31) - extend, do not replace
export const WIDGET_OVERLAY_KEY_MAP = {
  map: { show_scale_bar: "showScaleBar", show_fullscreen: "showFullscreenButton", show_popup: "infoEnabled" },
  records: { page_size: "pageSize" },
  bar: { metric: "metricColumn" }, line: { metric: "metricColumn" }, pie: { metric: "metricColumn" },
  table: { metric: "metricColumn" }, bignumber: { metric: "metricColumn" },
} as const;
const VALUE_TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  aggregation: (v) => String(v).toUpperCase(),          // sum -> SUM, count_distinct -> COUNT_DISTINCT
  color: (v) => paletteHex(String(v)), barColor: (v) => paletteHex(String(v)),
};
```

### Gateway: positive add_widget catalogue (replaces the denylist at gateway.ts:88-96)
```typescript
// AI_WIDGET_CONFIG[type] = { keys: Record<string, z.ZodTypeAny>, required: string[] } (shared)
const spec = AI_WIDGET_CONFIG[op.type];
const cfg = { ...op.config }; delete cfg.tableId;               // tableId checked at live_schema
const unknown = Object.keys(cfg).filter((k) => !(k in spec.keys));
const missing = spec.required.filter((k) => !(k in cfg));
// 'sql', 'customWhere', 'table', 'layout', hex colours all land in `unknown` / fail the enum
```

### Loop: W2 per-reference counting (sketch)
```typescript
const attempts = new Map<string, number>();
const g = await checkAiOp(gateway, tool, call.argsJson);          // ALWAYS run; never pre-block
if (!g.ok) {
  const key = g.refKey ?? `${tool.name}:${g.stage}`;
  const n = (attempts.get(key) ?? 0) + 1; attempts.set(key, n);
  rejected.push({ label: g.label ?? tool.name, stage: g.stage, reasons: g.reasons });
  answer([part.config(g.reasons.join("; ") + (n >= 2 ? " Do not retry this; tell the user it was skipped." : ""))], true);
}
```

### Placement (shared, pure)
```typescript
export function placeWidget(existing: Rect[], size: {w:number;h:number}): Rect {
  const bottom = existing.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  for (let y = 0; y <= bottom; y++)
    for (let x = 0; x <= GRID_COLS - size.w; x++) {
      const cand = { x, y, ...size };
      if (!existing.some((r) => rectsOverlap(r, cand))) return cand;   // at y===bottom, x===0 always fits
    }
  return { x: 0, y: bottom, ...size };
}
```

### Heatmap param (additive, backward compatible)
```typescript
// packages/web/src/lib/wmsUrlBuilder.ts, inside the heatmap branch (after REVERSE_COLORMAP, line ~392)
if (config.valueColumn) params.VAL_ATTR = config.valueColumn;      // absent => URL byte-identical to today
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Allow-list keyed `"chart"`, persisted names read by nobody | keyed by real type + overlay seam (134-10 pattern) | radio + AI chart patches work |
| `add_widget` config denylist | per-type positive catalogue | closes raw-SQL path (D-01) |
| Layer patch via `validateLayerSnapshot` (denylist, radio UI) | strict AI heatmap allow-list | only style keys reach layers |
| Per-tool-name rejection counter | per-bad-reference counter, valid calls never blocked | W2 fixed, surfaced in `skipped` |

**Deprecated/outdated:** `WIDGET_ALLOW_LIST.chart` and `WIDGET_CAPTURE_FIELDS.chart` (match no real type).

## Open Questions

1. **Tables not yet on the dashboard.**
   - Known: the config panel offers only `associatedTables`; `MapChartRenderer` hides layers whose `table_id` is not in `tables` (`:1316-1319`); association is persisted state outside the session layer; the S-list user story "designer generates a dashboard from a table" implies the table is added first. `list_tables` today lists ALL registered tables (`tools/read.ts:60-78`).
   - Unclear: whether the operator expects the AI to add content for a registered-but-unassociated table.
   - Recommendation: restrict add_widget/add_layer to dashboard-associated tables in 136; the model's refusal says "table X isn't on this dashboard; add it under Tables first" (worded like not-found for inaccessible tables, D-17). Raise at plan-check; revisit in 137/141 if the operator wants session-only association.
2. **Layer -> map association in the Phase 137 snapshot.** `SnapLayer.widgetId` exists but saved layers have no FK; rule = `includedLayerIds` else all. Define `layersOfMap` in shared now; 137's snapshot builder consumes it.
3. **`VAL_ATTR` on the operator's Kinetica version** (MEDIUM). Covered by the operator-run GetMap check; fallback is dropping weight from the vocabulary.
4. **Geometry column type checking.** The live probe returns names only (`liveSchema.ts` builds types from the registered `Table.columns`, which can be stale per SSYNC-F6). Recommendation: existence-only for wkt/wkb, numeric check for lat/lon/value only when a type is known.
5. **Provider tool-set drift.** Adding ~6 tools changes the S6 baseline; one targeted live check (a handful of requests of the free-tier 20/day cap), everything else scripted.
6. **Gap-fill vs RGL vertical compaction.** First-fit already returns the lowest fitting row; RGL may additionally float non-static AI items up by sub-row gaps. Human-verify "layout sensibility"; no algorithm change expected.

## Test and Verification Strategy

(`nyquist_validation` is `false` in `.planning/config.json`, so the formal Nyquist section is omitted; this answers research question 7.)

**Frameworks:** vitest in web, server, shared. Commands: `cd packages/shared && npx vitest --run`; `cd packages/server && npx tsc --noEmit && npx vitest run tests/lib.aiGateway.spec.ts tests/lib.aiAgentLoop.spec.ts tests/lib.aiTools.spec.ts` (server gate is SET-BASED: failing files must be a subset of the known TD-V16-TEST-ISOLATION set); `cd packages/web && npx tsc --noEmit && npx vitest run src/lib/aiSession src/lib/chartSql.spec.ts && npx vitest run src/styles/theme-guard.spec.ts`. Remember `packages/server/.env` leaks into server vitest (memory: dev-env-leaks-into-server-vitest) and `.env` must never be read.

| Requirement | Automated proof | Notes |
|-------------|-----------------|-------|
| 01 add viz | shared catalogue accepts/rejects table; gateway GW specs; scripted-provider loop run (`ScriptedProvider`, `lib.aiAgentLoop.spec.ts` `setup()`); fold spec asserts generated `sql` text, `table`, `drillDownColumn` | positive control: valid add; negative: `config.sql` rejected (reads fail before the work) |
| 02/05 remove | gateway returns `clarification` for id>0 without approval, passes with approval, passes for negative ids; fold gate; undo = `setCursor` restores | mutation proof: delete gate -> specs fail |
| 03 edit | `buildChartSql` characterization (all branches) + overlay seam spec in WidgetRenderer asserting new `runSql` string + radio canary | `limit`/`sortDir`/aggregation ladder |
| 04/06 heatmap | validator round-trip over saved heatmap/map configs exported from `kinetica.db` (read-only `sqlite3`, e.g. layers 4, 11, 22 above) plus invalid cases; `buildWmsParams` snapshot asserted on BOTH `MapChartRenderer` sites (add effect `:1372`, update effect `:1630`); legacy heatmap URL byte-identical when `valueColumn` absent | the two-site snapshot is the CLAUDE.md "map WMS is a separate read-path" guard |
| 10 layout | `placeWidget`/`validateLayout` unit tests (gap fits, no gap -> below, no overlap fuzz); fold `set_layout`; `DashboardsPage` spec: `onLayoutChange` with active override => zero `updateWidget` | |
| 11 repair/refuse | W2 specs: 2 bad then valid applies; 3rd identical refused and in `skipped`; hint shows closest accessible names; inaccessible-table near-name never leaks (positive control); cap 7th add skipped | |

**Harness (`window.__kbiAiHarness`)** drives every web op without a server; extend as in Q7. **Operator-run (not automatable):** (1) WMS GetMap check like spike S1.4 for an AI heatmap, with and without `VAL_ATTR`: HTTP 200, `image/png`, non-blank; (2) human-verify light and dark: tiles, legend row, "AI edited" badge, layout sensibility. **Live provider:** at most a handful of asks (free tier: 20 requests per day per model; one ask uses several requests); everything else scripted.

**Acceptance-criteria hygiene (CLAUDE.md):** every grep criterion must read 0 (or fail) before the work. Candidates verified absent today: `VAL_ATTR` in `wmsUrlBuilder.ts` (0), `AI_MAX_NEW_WIDGETS` (0), `placeWidget` (0), `set_layout` (0), `needs_confirmation` (0), `deriveChartConfig` (0), `AI_PALETTE_NAMES` (0). Do NOT use incidental anchors such as `colormap` or `opacity` (already present many times). "Layout is sensible", "heatmap legible in dark mode" and "no visible flash" are `checkpoint:human-verify`, not greps.

## Suggested Plan Breakdown (waves and file ownership)

Parallel-executor collision rule: each shared file has exactly ONE owning plan in a wave. Only plan 136-08 touches ROADMAP/REQUIREMENTS/STATE (memory: parallel-executors-roadmap-collision; do all GSD bookkeeping by hand).

| Wave | Plan | Owns (files) | Depends |
|------|------|--------------|---------|
| 0 | **136-01 shared contract** | `packages/shared/src/{aiOp,actionAllowList,aiAsk,layout,index}.ts` + their specs; `server/tests/lib.aiContract.spec.ts`; `server/src/lib/aiContract.ts`; web `lib/actionAllowList.ts` shim and any spec counting op kinds/version; colormap catalogue move | none |
| 1 | **136-02 web chart SQL + libs** | `web/src/lib/{chartSql,aiPalette,aiWidgetDefaults,layerDefaults}.ts`, `ChartConfigPanel.tsx` (call-through only), characterization specs | 01 |
| 1 | **136-03 server gateway** | `server/src/lib/ai/{gateway,shadow}.ts`, `tools/types.ts`, gateway/shadow specs (catalogue, refs, column checks incl. layers, hints, placement stamping, clarification outcome) | 01 |
| 1 | **136-04 heatmap render path** | `web/src/lib/wmsUrlBuilder.ts`, `KineticaWmsLayerForm.tsx` (value-column control, catalogue import), `MapChartRenderer.spec.tsx` snapshots on both sites, `wmsUrlBuilder.spec.ts` | 01 |
| 2 | **136-05 server loop + tools** | `agentLoop.ts`, `tools/mutate.ts`, `runAnswer.ts`, `context.ts`, `lib/aiConfig.ts` + specs, `.env.example` (`AI_MAX_NEW_WIDGETS`), loop/tools/config specs | 03 |
| 2 | **136-06 web overlay seam** | `widgetOverlayKeys.ts`, `applyLayerOverrides.ts`, `radioGroupCapture.ts`, `WidgetRenderer.tsx` (the merge at `:354-356` only), radio canary spec | 01, 02 |
| 3 | **136-07 web session fold** | `aiSession/{foldSession,types,constants,applySession}.ts`, `store/aiSessionStore.ts`, `hooks/useEffectiveLayers.ts`, specs (new ops, flags, approval, `set_layout`, geometry clearing) | 02, 06 |
| 4 | **136-08 UI wiring + harness** | `DashboardsPage.tsx` (layouts memo, `getWidgetLayout` move, layer-defaults import), `WidgetCard.tsx` ("AI edited" badge), `hooks/useLayerVisibilityToggle.ts`, `aiSession/devHarness.ts` + spec | 07 |
| 5 | **136-09 end-to-end proofs + bookkeeping** | cross-stack scripted-provider e2e (server) + harness e2e (web), saved-config round-trip fixture, operator checkpoint (GetMap, light/dark, layout), ROADMAP/REQUIREMENTS/STATE (this plan ONLY) | all |

Waves 1 and 2 can run their plans in parallel (disjoint files). Wave 3/4 are serial because `foldSession`/`DashboardsPage` are single-owner hot files. If the planner wants fewer plans, merge 02+06 and 07+08.

## Sources

### Primary (HIGH confidence, read this session)
- `packages/shared/src/{aiOp,actionAllowList,aiAsk,index}.ts`; `packages/server/src/lib/ai/{gateway,agentLoop,runAnswer,context,shadow,liveSchema}.ts`, `tools/{mutate,read,registry,types}.ts`, `providers/scripted.ts`; `packages/server/src/lib/{aiConfig,aiContract}.ts`; `packages/server/src/index.ts:2987-3036` (`/api/wms`, `/api/sql`); tests `lib.aiAgentLoop.spec.ts`, `lib.aiGateway.spec.ts`, `lib.aiContract.spec.ts`, `helpers/aiTestKit.ts`
- `packages/web/src/lib/aiSession/*`, `store/aiSessionStore.ts`, `lib/widgetOverlayKeys.ts`, `lib/applyLayerOverrides.ts`, `lib/applyWidgetAction.ts`, `lib/radioGroupCapture.ts`, `lib/radioGroupLayerPatch.ts`, `lib/wmsUrlBuilder.ts`, `lib/chartTheme.ts`, `hooks/useLayerVisibilityToggle.ts`, `hooks/useAiSessionActions.ts`
- `packages/web/src/components/{DashboardsPage,WidgetCard,LayersModal,LayersLegendPanel}.tsx`, `components/charts/{ChartConfigPanel,WidgetRenderer,MapChartRenderer,KineticaWmsLayerForm}.tsx`, `components/charts/definitions/*.ts`
- Local app DB `packages/server/data/kinetica.db` (read-only SELECT of `dashboard_layers`, `widgets`): real saved heatmap/map/bar/pie/bignumber configs
- `.planning/phases/{133-*/133-SPIKES.md, 135-*/135-VERIFICATION.md}`, `.planning/{ROADMAP,REQUIREMENTS,PROJECT}.md`
- Kinetica WMS REST docs (official): https://docs.kinetica.com/7.1/api/rest/wms_rest/ (heatmap params `VAL_ATTR`, `BLUR_RADIUS`, `COLORMAP`, `REVERSE_COLORMAP`, `GRADIENT_*`; `X_ATTR`/`Y_ATTR`/`GEO_ATTR`)

### Secondary (MEDIUM confidence)
- WebSearch result confirming heatmap `BLUR_RADIUS` 1-32 default 5 and CUDA-only availability (docs.kinetica.com 5.2/6.x/7.x WMS pages)

### Tertiary (LOW confidence)
- None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies; all modules read directly
- Architecture: HIGH for seams/locations (file:line verified); MEDIUM for placement tuning and RGL compaction interplay (operator human-verify)
- Pitfalls: HIGH for code-derived pitfalls (1-7, 10-11); MEDIUM for 9 (`VAL_ATTR` on operator's server)

**Research date:** 2026-10-13
**Valid until:** 2026-11-12 (stable internal codebase; re-check if Phases 137-139 land first, since they touch the snapshot builder and `foldSession`)

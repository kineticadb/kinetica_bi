---
phase: 11-map-chart
plan: 10
type: execute
wave: 6
depends_on: [11-09]
files_modified:
  - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
  - kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
autonomous: false
gap_closure: true
requirements: [MAP-01, MAP-02, MAP-03, MAP-04, FILT-04]

locked_decision:
  name: "ChartConfigPanel custom-panel scaffold strategy"
  choice: "Option A — wrap <Custom> in the shared Title + Data Source scaffold; preserve auto-save flow"
  rejected: "Option B (Apply/Cancel for custom-panel charts) — breaks the existing onChange→onSave auto-save chain at ChartConfigPanel.tsx:168-186 that MapConfigPanel relies on; introduces UX inconsistency between custom and non-custom config flows"
  rationale:
    - "MapConfigPanel was authored against the auto-save contract — every onChange immediately invokes parent onSave with merged tableId. Option B would require either rewriting MapConfigPanel's save semantics or introducing a draft staging buffer specifically for the custom path."
    - "AP-4 lock at ChartConfigPanel.tsx:90-94 already resolves selectedSource (with tableId) from selectedTableName via dataSourceOptions/selectedTable memos. Option A reuses these unchanged; Option B duplicates the resolution path."
    - "Phase 9 09-02 SUMMARY decision (Pitfall 5 / AP-4 lock): widget.config.tableId persisted from BOTH onSave call sites in ChartConfigPanel — Option A keeps both call sites symmetric; Option B forks the persistence shape."
    - "Smallest blast radius: ~30-50 LOC changed in ChartConfigPanel; MapConfigPanel needs only a stale-selection-clear effect on columns change."

must_haves:
  truths:
    - "User can open a map widget config modal and see a Title input"
    - "User can open a map widget config modal and see a Data Source (Table / View) picker"
    - "User can select a table from the Data Source picker and see the spatial-column dropdowns populate"
    - "User can save the map config and the persisted widget.config contains both tableRef (string, e.g. 'public.taxi_trips') AND tableId (number)"
    - "User can switch tables mid-configuration and stale spatial-column selections from the prior table are cleared"
    - "User can render a map widget end-to-end (Add → Configure → Save → tile fetch) — Criterion 1 GREEN"
    - "All four render modes work without re-mounting the OL Map (Criterion 2 GREEN)"
    - "Filter changes invalidate tiles via TileWMS.updateParams (Criterion 3 GREEN)"
    - "MapChartRenderer cleans up on unmount with no memory leak (Criterion 4 GREEN)"
    - "Cache-Control: no-store header is present on /api/wms tile responses (Criterion 5 GREEN)"
    - "__autoSuggestActive draft flag does NOT leak into persisted widget.config (caveat from 11-07-SUMMARY.md resolved)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      provides: "CustomConfigPanel branch wrapped in Title + Data Source scaffold; tableRef + tableId both persisted on auto-save; __autoSuggestActive stripped before persistence"
      contains: "ChartConfigPanel — custom panel scaffold"
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx"
      provides: "Spec covering Title + Data Source visible for map type; table selection populates columns; save persists tableRef + tableId; __autoSuggestActive stripped"
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "Stale-selection-clear effect: when columns prop reference changes, clear latColumn/lonColumn/wktColumn/wkbColumn selections that no longer exist in the new column list"
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx"
      provides: "Spec asserting columns-change clears stale spatial-column selections"
    - path: ".planning/phases/11-map-chart/11-VERIFICATION.md"
      provides: "Updated verification doc — all 5 criteria re-tested; 1 RED + 4 BLOCKED → 5 GREEN (or remaining gaps documented)"
  key_links:
    - from: "ChartConfigPanel.tsx CustomConfigPanel branch (line ~162)"
      to: "shared Title + Data Source scaffold (currently only at line ~249)"
      via: "extracted JSX render — both branches use the same scaffold"
      pattern: "config-group-label.*Title.*config-group-label.*Data Source"
    - from: "ChartConfigPanel.tsx CustomConfigPanel onChange (currently line 168-186)"
      to: "onSave({title: titleDraft, config: {...c, tableRef: selectedTableName, tableId: selectedSource?.tableId}})"
      via: "auto-save spread"
      pattern: "tableRef:\\s*selectedTableName.*tableId:\\s*selectedSource"
    - from: "ChartConfigPanel.tsx CustomConfigPanel onChange"
      to: "strip __autoSuggestActive before persistence"
      via: "destructure-and-drop pattern"
      pattern: "__autoSuggestActive:\\s*_drop"
    - from: "MapConfigPanel.tsx columns prop"
      to: "stale-selection-clear useEffect on columns dependency"
      via: "validate latColumn/lonColumn/wktColumn/wkbColumn against new column names"
      pattern: "useEffect.*columns.*latColumn|wktColumn|wkbColumn"
---

<objective>
Close the verifier-flagged RED gap (Criterion 1) blocking Phase 11 ship: the map config modal renders MapConfigPanel WITHOUT a Title input or Data Source picker because `ChartConfigPanel.tsx:162-188` early-returns the `<Custom>` component before the shared Title + Data Source scaffold renders. As a result, users cannot select a table → `allColumns` is empty → spatial-column dropdowns are empty → no WMS request can be issued → Criteria 2-5 are blocked from any testing.

Purpose: Restore the parent scaffold for the custom-panel branch so map widgets are configurable end-to-end. Persist `tableRef` AND `tableId` at save time (matches Phase 9 FILT-02 / AP-4 lock). Clear stale spatial-column selections when the user swaps tables mid-config. Strip the `__autoSuggestActive` draft flag from persisted config (resolves 11-07-SUMMARY caveat). Re-verify all 5 Phase 11 success criteria against deployed Kinetica.

Output: ChartConfigPanel.tsx renders Title + Data Source above the CustomConfigPanel for ALL custom-panel chart types (today: only `map`). MapConfigPanel.tsx clears stale selections on table swap. Updated `11-VERIFICATION.md` reports all 5 criteria GREEN (or documents remaining gaps with diagnostics).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-VERIFICATION.md
@.planning/phases/11-map-chart/11-09-integration-checkpoint-SUMMARY.md
@.planning/phases/11-map-chart/11-07-map-config-panel-shell-SUMMARY.md
@.planning/phases/11-map-chart/11-08-config-panel-mode-params-SUMMARY.md
@.planning/phases/11-map-chart/11-UI-SPEC.md
@kinetica_bi/src/components/charts/ChartConfigPanel.tsx
@kinetica_bi/src/components/charts/MapConfigPanel.tsx
@kinetica_bi/src/components/charts/registry.ts

<interfaces>
<!-- Key types and contracts for executors. Extracted directly from the codebase. -->
<!-- Use these as-is — no codebase exploration needed. -->

From src/components/charts/registry.ts (lines 37-51):
```typescript
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  /** Column list from the selected table — passed by ChartConfigPanel */
  columns?: { name: string; type: string }[];
  /** Phase 11 11-08: panels can signal Apply-disable state to the parent */
  isValid?: (valid: boolean) => void;
};
```

From src/components/charts/ChartConfigPanel.tsx (Props at line 20-28):
```typescript
type Props = {
  widgetType: string;
  title: string;
  config: Record<string, unknown>;
  tables?: TableInfo[];
  views?: ViewInfo[];
  onSave: (payload: { title: string; config: Record<string, unknown> }) => void;
  onCancel: () => void;
};

type TableInfo = { id: number; name: string; schema: string; columns: Record<string, string> };
type ViewInfo = { id: number; table_id: number; view_name: string; filter_clause: string; status: string };
```

From src/components/charts/ChartConfigPanel.tsx (existing data-source resolution at lines 70-104, MUST be reused unchanged):
```typescript
// dataSourceOptions: tables + created-status views, with kind + tableId
// selectedTableName: (draft.table as string) || ""
// selectedSource: dataSourceOptions.find(o => o.value === selectedTableName) ?? null
// selectedTable: tables.find(t => t.id === selectedSource.tableId) ?? null
// allColumns: Object.entries(selectedTable.columns).map(([name, type]) => ({ name, type }))
```

From src/components/charts/ChartConfigPanel.tsx (existing CustomConfigPanel branch at lines 162-188 — BAD: early-returns without scaffold):
```typescript
if (chartDef.CustomConfigPanel) {
  const Custom = chartDef.CustomConfigPanel;
  return <Custom
    config={draft}
    columns={allColumns}
    isValid={(valid) => setCustomPanelValid(valid)}
    onChange={(c) => {
      setDraft(c);
      const customDrillDownColumn = (c.drillDownColumn as string) || "";
      const customDrillDownColumnType = customDrillDownColumn
        ? inferDataTypeFromColumn(customDrillDownColumn, selectedTable?.columns ?? {})
        : "null";
      onSave({
        title: titleDraft,
        config: {
          ...c,
          tableId: selectedSource?.tableId,           // <-- persisted, but NO tableRef
          drillDownColumn: customDrillDownColumn,
          drillDownColumnType: customDrillDownColumnType,
        },
      });
    }}
  />;
}
```

From src/components/charts/ChartConfigPanel.tsx (existing handleTableChange at lines 194-203 — reuse for the scaffold's onChange):
```typescript
const handleTableChange = (fullName: string) => {
  setDraft((prev) => ({
    ...prev,
    table: fullName,
    metricColumn: "",
    aggregation: "SUM",
    groupByColumn: "",
  }));
};
```

From src/components/charts/MapConfigPanel.tsx (the column dependency surface — lines 322-380):
```typescript
// Component reads config.latColumn, config.lonColumn, config.wktColumn, config.wkbColumn,
// config.cbColumn (classbreak), config.spatialMode, config.renderMode, config.basemap
// columns prop = { name: string; type: string }[] from parent (allColumns from ChartConfigPanel)
// __autoSuggestActive draft flag persisted on config (11-07 SUMMARY: known leak risk)
```

From src/components/charts/MapChartRenderer.tsx (line 105 — tableRef resolution):
```typescript
const tableRef = tableRefProp ?? (widget.config as any)?.layerName ?? "";
// PROBLEM: today reads `layerName`, not `tableRef`. Phase 11-10 must persist BOTH:
//   - widget.config.tableRef (e.g. "public.taxi_trips") — string, used as WMS LAYERS param
//   - widget.config.tableId (number) — used as filter-store key (AP-4 lock)
// MapChartRenderer's tableRef fallback to layerName remains for backwards-compat; the new
// canonical field is widget.config.tableRef (matches what we name in 11-10 persistence).
// Verify in Task 1 read-first: confirm `table` (string slot) is what selectedTableName is
// stored on by the existing scaffold; if so, persist as `tableRef: selectedTableName`.
```
</interfaces>

<gap_brief>
**RED — Criterion 1**: Map config modal has no table picker.
- `ChartConfigPanel.tsx:162-188` early-returns `<Custom>` before the Title + Data Source + Apply/Cancel scaffold (lines 249-431) is rendered.
- `MapConfigPanel.tsx:78` reads `config.tableRef` but exposes no UI to set it.
- Spatial dropdowns are empty (no table selected → `allColumns = []` → no columns to populate dropdowns).
- WMS request can't target a layer.

**Verifier's fix scope (verbatim from 11-09-SUMMARY.md):**
1. Restore Title + Data Source UI in CustomConfigPanel branch — Option A or B. **LOCKED: Option A (see frontmatter `locked_decision`).**
2. Persist `tableRef` AND `tableId` on save (matches Phase 9 FILT-02 / AP-4 lock).
3. Clear stale spatial column selections in MapConfigPanel when columns change (table swap mid-config).
4. Re-run all 5 criteria after fix lands → produce updated `11-VERIFICATION.md` with all 5 GREEN.

**Caveat from 11-07-SUMMARY.md (still open):** `__autoSuggestActive` draft flag may leak into persisted config. Per 11-07-SUMMARY.md "ChartConfigPanel draft strip" section: a 2-line strip at the onChange site resolves it. Bake into Task 1 since hands are already in the file.
</gap_brief>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Restore Title + Data Source scaffold for CustomConfigPanel branch + persist tableRef + tableId + strip __autoSuggestActive</name>

  <files>
    kinetica_bi/src/components/charts/ChartConfigPanel.tsx
    kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
  </files>

  <read_first>
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (THE file being modified — read full)
    - kinetica_bi/src/components/charts/registry.ts (ConfigPanelProps interface — confirm shape)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (consumer — confirm config keys it reads)
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (consumer — line 105 tableRef resolution)
    - .planning/phases/11-map-chart/11-07-map-config-panel-shell-SUMMARY.md (the __autoSuggestActive strip recommendation, lines 105-112)
    - .planning/phases/11-map-chart/11-VERIFICATION.md (the gap detail)
  </read_first>

  <behavior>
    - Test 1 (RED first): When `widgetType === "map"` and `tables` is provided, ChartConfigPanel renders a `Title` config-group label AND a `Data Source` config-group label BEFORE the MapConfigPanel content.
    - Test 2: Title input is editable and updates `titleDraft`; subsequent saves include the new title.
    - Test 3: Data Source `<select>` lists every entry from `tables` (schema-prefixed `schema.name` format) and views with `status === "created"`.
    - Test 4: Selecting a table from Data Source picker triggers `handleTableChange` (resets metric/aggregation/groupBy); the `columns` prop forwarded to MapConfigPanel reflects the newly-selected table's columns.
    - Test 5: When MapConfigPanel calls onChange (auto-save), the parent's onSave receives `config.tableRef === selectedTableName` (string, e.g. "public.taxi_trips") AND `config.tableId === selectedSource.tableId` (number).
    - Test 6: When MapConfigPanel sets `config.__autoSuggestActive = true`, the parent's onSave RECEIVES a config object WITHOUT a `__autoSuggestActive` key (stripped before persistence).
    - Test 7: Apply/Cancel buttons render at the bottom of the modal even for custom-panel charts (NOT a separate save flow — Cancel must close, Apply is a no-op since auto-save covers persistence; the Apply button's purpose for custom-panel charts is closing the modal after final review).

    Note on test scaffolding: Tests must mock `getChartType("map")` to return a definition with a stub `CustomConfigPanel` that renders a probe element + accepts `columns` + can fire `onChange({...})` programmatically (test fixture, not real MapConfigPanel — keeps the spec focused on ChartConfigPanel scaffold restoration). Use `vi.mock("./registry")` or pass through a test-only chart def via the existing registry registration pattern.
  </behavior>

  <action>
**RED first.** Add new tests to `ChartConfigPanel.spec.tsx` matching `<behavior>` above. Run; confirm they fail (the file currently early-returns at line 162-188 without Title/Data Source/Apply/Cancel; new tests must light up).

**GREEN.** Edit `ChartConfigPanel.tsx`:

**Step 0: HOIST `handleTableChange` and `hasSources` ABOVE the CustomConfigPanel branch (CRITICAL — fixes Temporal Dead Zone).** The new scaffold (Step 1) references `handleTableChange` and `hasSources` inside the `if (chartDef.CustomConfigPanel)` block at line 162. Today both are declared AFTER that block (`handleTableChange` at lines 194-203; `hasSources` at line 218). If left as-is, the executor will hit a `ReferenceError` / TypeScript "used before declaration" error.

Concretely:
1. **Move `handleTableChange`** (currently lines 194-203, the const declaration starting `const handleTableChange = (fullName: string) => {`) to the position **immediately after the `allColumns` memo** (currently ends at line 104) — i.e., insert it at what is currently line 105, before the `numericColumns` memo at line 106. Delete it from its current location at lines 194-203.
2. **Move `const hasSources = dataSourceOptions.length > 0;`** (currently line 218) to the position **immediately after the relocated `handleTableChange`** — i.e., it sits adjacent to `handleTableChange` and above the `numericColumns` memo and the rest of the chart-specific computations. Delete it from its current location at line 218.
3. After the move, the order ABOVE the `if (!chartDef)` early-return at line 151 should be: `dataSourceOptions` memo → `selectedTableName` → `selectedSource` memo → `selectedTable` memo → `allColumns` memo → `handleTableChange` (relocated) → `hasSources` (relocated) → `numericColumns` memo → `drillDownColumns` memo → `usesAggregation` → `generatedSql` memo → `if (!chartDef)` early-return → `if (chartDef.CustomConfigPanel)` branch (now safely references both hoisted helpers).
4. Verify the non-custom branch (currently at lines 249-431) still compiles — it referenced both `handleTableChange` and `hasSources` from their original positions; after the move they're declared earlier in scope, so the non-custom branch continues to see them in its closure unchanged.

This hoisting is **mechanical motion only** — zero behavioral change. The relocated declarations are pure (no side effects, no hooks beyond the ones they already use). Adjacent line numbers in subsequent steps assume hoisting is complete.

**Step 1: Replace the early-return CustomConfigPanel block (currently lines 162-188; line numbers may shift slightly after Step 0's hoist — locate by the `if (chartDef.CustomConfigPanel) {` opener).** The new block renders the same Title section (lines 252-264 of the non-custom branch) and Data Source section (lines 267-296 of the non-custom branch) that the non-custom branch uses, then renders `<Custom>` in place of the chart-specific field groups, then renders the Apply/Cancel actions (lines 399-429 of the non-custom branch). Concretely, replace the `if (chartDef.CustomConfigPanel) { ... }` block with:

```typescript
if (chartDef.CustomConfigPanel) {
  const Custom = chartDef.CustomConfigPanel;
  return (
    <div className="config-panel">
      {/* ChartConfigPanel — custom panel scaffold (Phase 11-10 fix; addresses 11-VERIFICATION.md Criterion 1 RED) */}
      <div className="config-panel-body">
        {/* Title section — identical to non-custom branch */}
        <div className="config-group">
          <div className="config-group-label">Title</div>
          <label className="ds-field">
            <input
              type="text"
              className="ds-input"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Chart title"
            />
          </label>
        </div>

        {/* Data Source section — identical to non-custom branch */}
        {hasSources && (
          <div className="config-group">
            <div className="config-group-label">Data Source</div>
            <label className="ds-field">
              <span className="ds-field-label">Table / View</span>
              <select
                className="ds-select"
                value={selectedTableName}
                onChange={(e) => handleTableChange(e.target.value)}
              >
                <option value="">Select a data source...</option>
                {tables && tables.length > 0 && (
                  <optgroup label="Tables">
                    {tables.map((t) => {
                      const fullName = t.schema ? `${t.schema}.${t.name}` : t.name;
                      return <option key={`t-${t.id}`} value={fullName}>{fullName}</option>;
                    })}
                  </optgroup>
                )}
                {views && views.filter((v) => v.status === "created").length > 0 && (
                  <optgroup label="Views">
                    {views.filter((v) => v.status === "created").map((v) => (
                      <option key={`v-${v.id}`} value={v.view_name}>{v.view_name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
          </div>
        )}

        {/* Custom panel slot — receives draft + columns + isValid; onChange auto-saves with scaffold-resolved tableRef + tableId */}
        <Custom
          config={draft}
          columns={allColumns}
          isValid={(valid) => setCustomPanelValid(valid)}
          onChange={(c) => {
            setDraft(c);
            // Phase 10 DRILL-02: thread drillDownColumn + drillDownColumnType through Custom panels too.
            const customDrillDownColumn = (c.drillDownColumn as string) || "";
            const customDrillDownColumnType = customDrillDownColumn
              ? inferDataTypeFromColumn(customDrillDownColumn, selectedTable?.columns ?? {})
              : "null";
            // Phase 11-10: strip __autoSuggestActive draft flag before persistence (resolves 11-07-SUMMARY caveat).
            // Destructure-and-drop pattern keeps this defensive and explicit.
            const { __autoSuggestActive: _drop, ...persistedConfig } = c as Record<string, unknown> & {
              __autoSuggestActive?: unknown;
            };
            // Phase 11-10: persist BOTH tableRef (string for WMS LAYERS param) AND tableId (number for filter-store key, AP-4 lock).
            onSave({
              title: titleDraft,
              config: {
                ...persistedConfig,
                tableRef: selectedTableName,
                tableId: selectedSource?.tableId,
                drillDownColumn: customDrillDownColumn,
                drillDownColumnType: customDrillDownColumnType,
              },
            });
          }}
        />
      </div>

      {/* Apply/Cancel actions — for custom-panel charts the auto-save flow has already persisted; Apply is a "close after review" affordance and Cancel is the abort. */}
      <div className="config-panel-actions">
        <button
          className="btn-primary btn-sm"
          disabled={!customPanelValid}
          title={!customPanelValid ? "Add at least 2 break rows" : undefined}
          onClick={onCancel}
        >
          Apply
        </button>
        <button className="ghost-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
```

Note: the scaffold's `onChange={(e) => handleTableChange(e.target.value)}` and the conditional `{hasSources && (...)}` both reference identifiers that Step 0 hoisted into scope above this block. If Step 0 was skipped, `tsc --noEmit` will flag "Block-scoped variable 'handleTableChange'/'hasSources' used before its declaration" — that's the canary that confirms the hoist is required.

**Step 2: Confirm Imports Already Sufficient.** No new imports needed — `inferDataTypeFromColumn` is already imported at line 3. `useState/useEffect/useMemo` already imported at line 1.

**Step 3: Verify the unmodified non-custom branch (now starting around line 249, may shift slightly due to Step 0's hoist) still works.** No edits to its JSX. The non-custom branch's references to `handleTableChange` and `hasSources` continue to resolve — they were merely relocated upward in the same function scope.

**Step 4: Add the new tests from `<behavior>` to `ChartConfigPanel.spec.tsx`.** If the spec file does not exist yet, create it. Test scaffold pattern:

```typescript
// Mock the registry to provide a stub CustomConfigPanel for testing
vi.mock("./registry", async () => {
  const actual = await vi.importActual("./registry");
  return {
    ...actual,
    getChartType: (type: string) => {
      if (type === "map") {
        return {
          type: "map",
          label: "Map",
          icon: "M",
          fields: [],
          defaultConfig: {},
          usesAggregation: false,
          CustomConfigPanel: ({ config, columns, onChange, isValid }) => (
            <div data-testid="map-custom-panel">
              <div data-testid="cols-count">{(columns ?? []).length}</div>
              <button
                data-testid="fire-onchange"
                onClick={() => onChange({ ...config, spatialMode: "latlon", __autoSuggestActive: true })}
              >fire</button>
            </div>
          ),
        };
      }
      // delegate to actual for other types
      return (actual as any).getChartType(type);
    },
  };
});
```

Test cases:
- `it("renders Title + Data Source for map widget type")` — render with `widgetType="map"` + tables fixture → assert `getByText("Title")` AND `getByText("Data Source")` present.
- `it("populates columns prop after table selection")` — select first table from `<select>` → assert `getByTestId("cols-count").textContent` reflects that table's column count.
- `it("persists tableRef and tableId on auto-save")` — select table → click `fire-onchange` → assert `onSave` mock called with `expect.objectContaining({ config: expect.objectContaining({ tableRef: "public.taxi_trips", tableId: 42 }) })`.
- `it("strips __autoSuggestActive from persisted config")` — same as above → assert `onSave.mock.calls[0][0].config` does NOT have `__autoSuggestActive` key.
- `it("renders Apply + Cancel buttons even for custom-panel charts")` — assert `getByRole("button", { name: /apply/i })` AND `getByRole("button", { name: /cancel/i })`.

Run `npm run -w kinetica_bi test -- ChartConfigPanel` — all new tests GREEN; pre-existing tests still GREEN.
  </action>

  <verify>
    <automated>cd kinetica_bi && npm run test -- ChartConfigPanel.spec.tsx --run 2>&1 | tail -20</automated>
  </verify>

  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/ChartConfigPanel.tsx` contains the marker comment `ChartConfigPanel — custom panel scaffold` (verifies the new scaffold block landed). Check: `grep -q "ChartConfigPanel — custom panel scaffold" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
    - **Hoist verification (Step 0):** `handleTableChange` and `hasSources` are both declared ABOVE the `if (chartDef.CustomConfigPanel)` branch. Check via line-number ordering: `awk '/const handleTableChange =/{lhc=NR} /const hasSources =/{lhs=NR} /if \(chartDef\.CustomConfigPanel\)/{lcp=NR} END{ if (lhc>0 && lhs>0 && lcp>0 && lhc<lcp && lhs<lcp) print "OK"; else print "FAIL hoist: handleTableChange="lhc" hasSources="lhs" CustomConfigPanel="lcp }' kinetica_bi/src/components/charts/ChartConfigPanel.tsx` — output must be exactly `OK`.
    - **No duplicate declarations after hoist:** `handleTableChange` and `hasSources` each appear exactly once in the file. Check: `grep -c "const handleTableChange =" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns `1` AND `grep -c "const hasSources =" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns `1`.
    - File contains the persistence pattern `tableRef: selectedTableName` AND `tableId: selectedSource?.tableId` co-located. Check: `grep -E "tableRef:\s*selectedTableName" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` AND `grep -E "tableId:\s*selectedSource" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
    - File contains the `__autoSuggestActive` strip pattern. Check: `grep -E "__autoSuggestActive:\s*_drop" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
    - The early-return pattern at the old line 162 is GONE (the new code does NOT early-return; it renders inside a wrapping div). Check: the line-162-area no longer contains `return <Custom`. Manual grep: `grep -n "return <Custom" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns no matches (the new pattern is `<Custom` inside JSX, not a top-level early-return).
    - `npm run -w kinetica_bi test -- ChartConfigPanel.spec.tsx --run` exits 0 with all tests passing (including 5 new tests from the `<behavior>` block).
    - The pre-existing 238-test suite count INCREASES by exactly 5 (the new tests added in this task). Check: `cd kinetica_bi && npm run test --run 2>&1 | grep -E "Tests:?\s+[0-9]+\s+passed"` reports total ≥ 243.
    - TypeScript build is clean (no Temporal Dead Zone / "used before declaration" errors). Check: `cd kinetica_bi && npx tsc --noEmit 2>&1 | tee /tmp/tsc.log; test ! -s /tmp/tsc.log || ! grep -E "ChartConfigPanel.tsx" /tmp/tsc.log`
  </acceptance_criteria>

  <done>
    - `ChartConfigPanel.tsx` CustomConfigPanel branch renders Title + Data Source scaffold + Apply/Cancel.
    - `handleTableChange` and `hasSources` hoisted above the CustomConfigPanel branch (no TDZ error).
    - Auto-save persists `tableRef` (string) AND `tableId` (number) AND strips `__autoSuggestActive`.
    - 5 new spec tests passing; pre-existing tests still passing.
    - TypeScript build clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: MapConfigPanel — clear stale spatial-column selections when columns prop changes (table swap mid-config)</name>

  <files>
    kinetica_bi/src/components/charts/MapConfigPanel.tsx
    kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
  </files>

  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (THE file being modified — read full, especially lines 320-400 around the column-using config keys)
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (existing 38 tests — confirm fixtures + helper patterns; do NOT break them)
    - kinetica_bi/src/lib/columnTypes.ts (getValidSpatialColumns + SpatialMode + Column type)
  </read_first>

  <behavior>
    - Test 1 (RED first): Mount MapConfigPanel with columns `[{name: "lat_a", type: "double"}, {name: "lon_a", type: "double"}]` and config `{ spatialMode: "latlon", latColumn: "lat_a", lonColumn: "lon_a" }`. Re-render with columns `[{name: "lat_b", type: "double"}, {name: "lon_b", type: "double"}]` (different table — neither `lat_a` nor `lon_a` exists). Assert that `onChange` was called with `{ ..., latColumn: "", lonColumn: "" }` (cleared).
    - Test 2: Same setup but with WKT mode — config `{ spatialMode: "wkt", wktColumn: "geom_a" }`, re-render with columns where `geom_a` does not exist → assert `onChange` called with `wktColumn: ""`.
    - Test 3: Same for WKB mode — `wkbColumn`.
    - Test 4: Classbreak `cbColumn` is also stale-cleared when missing from new columns list — config `{ cbColumn: "vendor_a", classbreaks: [...] }`, re-render without `vendor_a` → assert `onChange` called with `cbColumn: ""` AND `classbreaks: []` (rebuild needed for the new column).
    - Test 5 (regression): If the spatial column DOES still exist in the new columns list (table swap to a table with the same column name), the value is PRESERVED — no spurious onChange fires.
    - Test 6 (no-op guard): If columns reference changes but the actual contents are equal (memoization edge case), the effect does NOT fire spurious onChange. Implementation hint: compare by `columns.map(c => c.name).join(",")` not by reference.
  </behavior>

  <action>
**RED first.** Add the 6 tests above to `MapConfigPanel.spec.tsx`. Use the existing render helper. Run; confirm they fail (today MapConfigPanel does not clear on columns change).

**GREEN.** Edit `MapConfigPanel.tsx` — add a `useEffect` near the top of the component (after the existing `useState` for `autoSuggestActive`, before the auto-suggest effect):

```typescript
// Phase 11-10: stale-selection-clear on table swap.
// When the columns prop changes (different table selected in parent ChartConfigPanel),
// any previously-selected spatial column or classbreak column that no longer exists
// in the new column list is cleared. Prevents widget.config from carrying ghost
// references to columns that don't exist in the new table — which would otherwise
// produce empty WMS tiles or runtime errors.
const columnsKey = columns.map((c) => c.name).join(",");
const prevColumnsKeyRef = useRef<string>(columnsKey);
useEffect(() => {
  // No-op on initial mount (prevColumnsKeyRef === columnsKey on first run after the ref init).
  if (prevColumnsKeyRef.current === columnsKey) return;
  prevColumnsKeyRef.current = columnsKey;

  const colNames = new Set(columns.map((c) => c.name));
  const patch: Record<string, unknown> = {};
  let changed = false;

  const latColumn = (config.latColumn as string) || "";
  const lonColumn = (config.lonColumn as string) || "";
  const wktColumn = (config.wktColumn as string) || "";
  const wkbColumn = (config.wkbColumn as string) || "";
  const cbColumn = (config.cbColumn as string) || "";

  if (latColumn && !colNames.has(latColumn)) { patch.latColumn = ""; changed = true; }
  if (lonColumn && !colNames.has(lonColumn)) { patch.lonColumn = ""; changed = true; }
  if (wktColumn && !colNames.has(wktColumn)) { patch.wktColumn = ""; changed = true; }
  if (wkbColumn && !colNames.has(wkbColumn)) { patch.wkbColumn = ""; changed = true; }
  if (cbColumn && !colNames.has(cbColumn)) {
    patch.cbColumn = "";
    patch.classbreaks = [];   // rebuild needed against new column type
    changed = true;
  }

  if (changed) {
    onChange({ ...config, ...patch });
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [columnsKey]);
```

**Note on dependency array.** `columnsKey` is a primitive string derived from `columns`. Using `columnsKey` (not `columns`) as the dep prevents reference-instability bugs (parent may re-create `columns` array on every render even when contents are stable). The eslint-disable is intentional and matches the Phase 9 PITFALL S-02 pattern (primitive dep over reference dep).

**Make sure `useRef` is imported.** Today MapConfigPanel imports `useCallback, useEffect, useRef, useState` from line 6 — already covered, no import edit needed.

Run `npm run -w kinetica_bi test -- MapConfigPanel.spec.tsx --run` — all 6 new tests GREEN; existing 38 tests still GREEN (44 total).
  </action>

  <verify>
    <automated>cd kinetica_bi && npm run test -- MapConfigPanel.spec.tsx --run 2>&1 | tail -20</automated>
  </verify>

  <acceptance_criteria>
    - File `kinetica_bi/src/components/charts/MapConfigPanel.tsx` contains the marker comment `Phase 11-10: stale-selection-clear on table swap`. Check: `grep -q "stale-selection-clear on table swap" kinetica_bi/src/components/charts/MapConfigPanel.tsx`
    - File contains the `prevColumnsKeyRef` pattern (verifies primitive-dep approach). Check: `grep -q "prevColumnsKeyRef" kinetica_bi/src/components/charts/MapConfigPanel.tsx`
    - File contains all 5 column-clear branches: `latColumn`, `lonColumn`, `wktColumn`, `wkbColumn`, `cbColumn`. Check: `grep -E "patch\.(lat|lon|wkt|wkb|cb)Column = \"\"" kinetica_bi/src/components/charts/MapConfigPanel.tsx | wc -l` returns 5.
    - `npm run -w kinetica_bi test -- MapConfigPanel.spec.tsx --run` exits 0; total tests in the spec file ≥ 44 (38 existing + 6 new).
    - Whole-suite test count INCREASES by exactly 6 over Task 1's baseline. Check: `cd kinetica_bi && npm run test --run 2>&1 | grep -oE "[0-9]+ passed" | head -1` reports total ≥ 249.
    - TypeScript build still clean. Check: `cd kinetica_bi && npx tsc --noEmit 2>&1 | grep -E "MapConfigPanel" || echo "clean"` outputs `clean`.
  </acceptance_criteria>

  <done>
    - MapConfigPanel clears stale spatial-column + classbreak-column selections on table swap.
    - 6 new spec tests passing; pre-existing 38 tests still passing.
    - TypeScript build clean.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Re-verify all 5 Phase 11 success criteria against deployed Kinetica + update 11-VERIFICATION.md</name>

  <files>
    .planning/phases/11-map-chart/11-VERIFICATION.md
  </files>

  <read_first>
    - .planning/phases/11-map-chart/11-VERIFICATION.md (current 1 RED / 4 BLOCKED state — to be replaced)
    - .planning/phases/11-map-chart/11-09-integration-checkpoint-SUMMARY.md (verifier's fix scope items 1-4)
    - .planning/ROADMAP.md § Phase 11 (the canonical 5 success criteria text)
    - .planning/phases/11-map-chart/11-UI-SPEC.md (label strings for spot-check)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (post-fix)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (post-fix)
  </read_first>

  <what-built>
    Tasks 1 + 2 closed the table-picker gap blocking Phase 11:
    - ChartConfigPanel.tsx now renders Title + Data Source scaffold + Apply/Cancel ABOVE/BELOW the MapConfigPanel slot for custom-panel charts.
    - Auto-save persists `tableRef` (string) AND `tableId` (number) on `widget.config` and strips `__autoSuggestActive`.
    - MapConfigPanel.tsx clears stale spatial/classbreak column selections when the user swaps tables mid-config.
    - 11 new unit tests passing; full suite still GREEN.

    The 5 ROADMAP Phase 11 success criteria can now be re-tested end-to-end against deployed Kinetica.
  </what-built>

  <how-to-verify>
**Setup (once):**
1. `cd kinetica_bi && npm run dev` — frontend on http://localhost:5173 (or configured port).
2. `cd kinetica_bi && npm run dev:server` (in another terminal) — backend with KINETICA_URL pointing at the deployed Kinetica from prior phases.
3. Login. Open a dashboard with at least one configured table containing a geometry column AND a separate table with lat/lon columns (taxi_trips style).

**Criterion 1 — Spatial-column-mode picker renders + tiles align (was RED):**
1. Click `+ Add Widget` → select `Map` → click the new map widget's gear icon.
2. **Confirm:** Title input visible at top of modal.
3. **Confirm:** Data Source dropdown lists every dashboard-configured table + view.
4. Select a table with lat/lon columns. **Confirm:** spatial-mode picker renders 3 radios; spatial-column dropdowns populate; auto-suggest hint appears if applicable.
5. Pick `Latitude / Longitude pair` mode → pick lat column + lon column. **Confirm:** map tile request fires; tiles align with the basemap (visible Kinetica points overlaid on OSM).
6. Open the same widget config gear again — switch to `WKT geometry column` mode (table must have a WKT column) — pick the column. **Confirm:** tiles re-render with WKT-derived geometry.
7. Switch to `Kinetica geometry column` mode (if available). **Confirm:** tiles render via GEO_ATTR.
8. **Table-swap stale-selection-clear scenario (Task 2 manual coverage):** Configure spatial mode for table A (e.g. pick `Latitude / Longitude pair` + lat/lon columns); then re-open the config gear and swap the Data Source picker to table B (whose column names differ from table A). **Confirm:** the map config UI clears the prior spatial-column selections (lat/lon/wkt/wkb dropdowns reset to empty) AND the saved widget.config no longer contains `latColumn` / `lonColumn` values referencing table A's columns. Verify by inspecting the persisted widget.config (DevTools React Inspector or dashboard-export endpoint).
   → **Expected verdict: GREEN**

**Criterion 2 — Four render modes selectable, mode switch preserves pan/zoom:**
1. With a configured map showing data: pan + zoom to a non-default location.
2. Open gear → switch render mode `Raster → Heatmap → Classbreak → Contour`. For each:
   - **Confirm:** tile display updates without an OL `Map` remount (no flash, no recenter, no zoom reset).
   - **Confirm:** pan/zoom position is preserved.
3. Classbreak: pick break column → cardinality probe fires → add 2 break rows → save. **Confirm:** classbreak tiles render. Apply button disabled until ≥ 2 rows.
   → **Expected verdict: GREEN**

**Criterion 3 — Filter changes invalidate tiles, no stale tiles:**
1. With map showing data, click a bar/pie chart on the same dashboard pointing at the same table.
2. **Confirm:** map tiles immediately invalidate and refetch with the new filter applied (visibly fewer/different points).
3. Open Network tab → filter by `wms` → confirm new tile request URL has the `_v=<filterVersion>` cache-buster query param AND a `QUERY` param reflecting the active filter.
4. Click another value to add a second filter. **Confirm:** tiles refetch again.
5. Click `Clear all` on the filter bar. **Confirm:** tiles refetch back to unfiltered state.
   → **Expected verdict: GREEN**

**Criterion 4 — Cleanup on unmount, no leak, no duplicate tile fetches:**
1. With map widget rendered, navigate away (click another dashboard or use back button).
2. Open browser DevTools → Memory tab → take heap snapshot. Look for retained `Map` instances or `TileWMS` sources tied to the prior dashboard. **Expected:** none retained beyond GC roots.
3. Navigate back. **Confirm:** map remounts cleanly; no duplicate `GET /api/wms?...` requests for the same tile coords (one request per tile, not two).
4. React StrictMode double-mount: in dev mode, confirm `useEffect` cleanup fires correctly (no console warnings about double dispose).
   → **Expected verdict: GREEN**

**Criterion 5 — Cache-Control: no-store on /api/wms responses:**
1. Open Network tab → filter by `wms`.
2. Click any tile request. **Confirm:** Response Headers contain `Cache-Control: no-store`.
3. Apply a filter to trigger tile refetch. **Confirm:** new requests also carry `Cache-Control: no-store`.
4. Run `curl -I "http://localhost:<port>/api/wms?<any-valid-tile-params>" -H "Cookie: <session>"` and verify the header in CLI output.
   → **Expected verdict: GREEN**

**__autoSuggestActive leak spot-check (caveat from 11-07-SUMMARY):**
1. Open map widget config → switch spatial mode (triggers auto-suggest path).
2. Save and re-open. Inspect the persisted dashboard JSON via dashboard-export endpoint OR via DevTools React Inspector on the widget object.
3. **Confirm:** `widget.config.__autoSuggestActive` is undefined (stripped before persistence).

**UI-SPEC.md label spot-check (deferred from 11-09):**
- Verbatim labels visible in modal: `SPATIAL MODE`, `RENDER MODE`, `BASEMAP`, render-mode-specific param-group labels (`RASTER PARAMS`, `HEATMAP PARAMS`, `CLASSBREAK PARAMS`, `CONTOUR PARAMS`). Confirm verbatim against UI-SPEC.md "Microcopy / Labels (config panel)" table.

**After running all 5 criteria:**
- Edit `.planning/phases/11-map-chart/11-VERIFICATION.md` (overwrite the existing 1 RED / 4 BLOCKED content). Replace with:
  - Date: today
  - Verifier: user email
  - Per-criterion status: GREEN / RED with evidence
  - Verdict: `5 GREEN — Phase 11 ships` OR `<N> GREEN / <M> RED — gaps documented below` if any remain.
  - If all 5 GREEN: include explicit confirmation that `__autoSuggestActive` leak is resolved AND UI-SPEC label spot-check passed AND the table-swap stale-selection-clear scenario passed.
  - If any RED: include diagnostic detail in the same shape as the original 11-VERIFICATION.md (file+line refs, symptoms, fix scope).
  </how-to-verify>

  <action>
This is a checkpoint:human-verify task — Claude does NOT execute the verification autonomously. The user runs the deployed Kinetica + browser-based UAT walkthrough described in `<how-to-verify>` above, then updates `.planning/phases/11-map-chart/11-VERIFICATION.md` with verdict + per-criterion evidence.

Claude's role at this checkpoint:
1. Confirm Tasks 1 + 2 succeeded (test suites GREEN, code markers present per their `<acceptance_criteria>`).
2. Pause for user. Print the `<how-to-verify>` walkthrough and the resume signal expectations.
3. Wait for the user's resume signal (`approved` or `gaps: <details>`).
4. After resume, read the updated `11-VERIFICATION.md` and confirm:
   - File timestamp is current (today or later than 2026-05-05).
   - All 5 success criteria have status lines.
   - A verdict line is present.
5. If verdict is `5 GREEN`: Phase 11 is shippable; create the plan summary (per `<output>` block at the bottom of this PLAN) and commit.
6. If verdict is partial / any RED: write the SUMMARY documenting which criteria remain RED and recommend `/gsd:plan-phase 11 --gaps` for the next iteration.

**Do NOT autonomously edit `11-VERIFICATION.md` content.** The user owns the verification verdict. Claude only confirms the file was updated and reads the result.
  </action>

  <verify>
    <automated>grep -E "Verification date:\s+2026-(05|06)" .planning/phases/11-map-chart/11-VERIFICATION.md && grep -cE "Success Criterion [1-5]" .planning/phases/11-map-chart/11-VERIFICATION.md && grep -E "5 GREEN|Verdict" .planning/phases/11-map-chart/11-VERIFICATION.md</automated>
  </verify>

  <acceptance_criteria>
    - File `.planning/phases/11-map-chart/11-VERIFICATION.md` exists and contains a date string matching today (or later than 2026-05-05). Check: `grep -E "Verification date:\s+2026-(05|06)" .planning/phases/11-map-chart/11-VERIFICATION.md`
    - File contains a status line for each of the 5 criteria. Check: `grep -cE "Success Criterion [1-5]" .planning/phases/11-map-chart/11-VERIFICATION.md` returns ≥ 5.
    - File contains an explicit verdict line. Check: `grep -E "5 GREEN|Verdict" .planning/phases/11-map-chart/11-VERIFICATION.md` returns ≥ 1 match.
    - User has signed off via resume signal: `approved` (5 GREEN) or `gaps: <details>` (some RED).
    - If verdict is `5 GREEN`: Phase 11 is shippable; the `__autoSuggestActive` leak resolution is documented; UI-SPEC label spot-check is documented; the table-swap stale-selection-clear scenario (Criterion 1 step 8) is documented as passing.
    - If verdict is partial (some criteria still RED): the file documents each remaining gap in the same shape as the original 11-VERIFICATION.md (RED criterion + symptoms + diagnostic detail + fix scope). User must explicitly route to `/gsd:plan-phase 11 --gaps` for a follow-up plan.
  </acceptance_criteria>

  <done>
    - `.planning/phases/11-map-chart/11-VERIFICATION.md` updated with current date, per-criterion status, and explicit verdict.
    - User signed off via `approved` (5 GREEN) or `gaps: <details>` (partial).
    - If 5 GREEN: Phase 11 is shippable; v1.2 milestone advances to Phase 12.
    - If any RED: a follow-up `/gsd:plan-phase 11 --gaps` invocation is recommended in the SUMMARY.
  </done>

  <resume-signal>Type `approved` (all 5 GREEN), or `gaps: <criterion-numbers> <details>` (e.g. `gaps: 3 — filter change does not invalidate tiles; QUERY param missing on second click`). User must update 11-VERIFICATION.md with verbatim findings before resuming.</resume-signal>
</task>

</tasks>

<verification>
**Phase-level verification — re-runs the 5 ROADMAP Phase 11 success criteria post-fix.**

This verification IS the gap closure for Phase 11. It re-tests the 5 criteria from `ROADMAP.md § Phase 11`:

1. Spatial-column-mode picker renders + tiles align across all 3 spatial modes.
2. All 4 render modes selectable; mode-switch preserves pan/zoom.
3. Filter changes invalidate tiles via `TileWMS.updateParams` + `_v=filterVersion`.
4. Map cleanup on unmount — no leak, no duplicate tile fetches.
5. `Cache-Control: no-store` header on `/api/wms` responses.

PLUS:
- `__autoSuggestActive` leak resolved (caveat from 11-07-SUMMARY).
- UI-SPEC label spot-check (deferred from 11-09).
- Table-swap stale-selection-clear scenario manually verified (Task 2 manual coverage in Criterion 1 step 8).

The verification step (Task 3) MUST produce an updated `11-VERIFICATION.md`. Plan-level verification commands (run by execute-plan):

```bash
# Code-level checks
grep -q "ChartConfigPanel — custom panel scaffold" kinetica_bi/src/components/charts/ChartConfigPanel.tsx
grep -q "stale-selection-clear on table swap" kinetica_bi/src/components/charts/MapConfigPanel.tsx
grep -q "tableRef:\s*selectedTableName" kinetica_bi/src/components/charts/ChartConfigPanel.tsx
grep -q "__autoSuggestActive:\s*_drop" kinetica_bi/src/components/charts/ChartConfigPanel.tsx

# Hoist verification (Step 0 of Task 1)
awk '/const handleTableChange =/{lhc=NR} /const hasSources =/{lhs=NR} /if \(chartDef\.CustomConfigPanel\)/{lcp=NR} END{ if (lhc>0 && lhs>0 && lcp>0 && lhc<lcp && lhs<lcp) print "OK"; else print "FAIL" }' kinetica_bi/src/components/charts/ChartConfigPanel.tsx
# expect: OK

# Test suite GREEN
cd kinetica_bi && npm run test --run 2>&1 | tail -5

# Verification doc updated to today (or later)
grep -E "Verification date:\s+2026-(05|06)" .planning/phases/11-map-chart/11-VERIFICATION.md

# Verdict explicitly recorded
grep -E "Verdict|5 GREEN" .planning/phases/11-map-chart/11-VERIFICATION.md
```
</verification>

<success_criteria>
**Plan 11-10 ships when ALL of the following are true:**

1. **Code:** `ChartConfigPanel.tsx` CustomConfigPanel branch renders the shared Title + Data Source scaffold; `tableRef` AND `tableId` persisted; `__autoSuggestActive` stripped at save time. `handleTableChange` and `hasSources` are hoisted above the CustomConfigPanel branch (no TDZ error).
2. **Code:** `MapConfigPanel.tsx` clears stale `latColumn`/`lonColumn`/`wktColumn`/`wkbColumn`/`cbColumn` selections when the columns prop changes.
3. **Tests:** 11 new spec tests passing (5 in ChartConfigPanel.spec.tsx, 6 in MapConfigPanel.spec.tsx); full suite GREEN (≥ 249 tests).
4. **TypeScript:** `tsc --noEmit` clean.
5. **Verification:** Updated `.planning/phases/11-map-chart/11-VERIFICATION.md` documents all 5 ROADMAP Phase 11 success criteria as GREEN (or each remaining RED documented with diagnostic detail + new gap-closure plan triggered).
6. **__autoSuggestActive:** Confirmed not present in persisted widget.config in a freshly-saved map widget.

**Plan 11-10 returns BLOCKED if:**
- Any criterion remains RED after the fix (a follow-up `/gsd:plan-phase 11 --gaps` is required and the new VERIFICATION.md documents which).

**Plan 11-10 returns COMPLETE if:**
- All 5 ROADMAP Phase 11 success criteria are GREEN in the updated VERIFICATION.md.
- Phase 11 is shippable; v1.2 milestone moves to Phase 12.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-10-SUMMARY.md` documenting:
- The locked decision (Option A) and its rationale.
- Code diff summary (lines changed in each file).
- Test count delta (before / after).
- The updated 11-VERIFICATION.md verdict (5 GREEN OR partial with diagnostics).
- Whether `__autoSuggestActive` leak is closed.
- Whether Phase 11 is now shippable (yes if 5 GREEN, no with next-step pointer if any RED).
- Resolution of the 11-07-SUMMARY caveat.
</output>
</content>
</invoke>
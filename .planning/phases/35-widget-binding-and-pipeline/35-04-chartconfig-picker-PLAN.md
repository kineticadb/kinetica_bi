---
phase: 35-widget-binding-and-pipeline
plan: 04
type: execute
wave: 3
depends_on:
  - "35-03"
files_modified:
  - kinetica_bi/src/components/charts/ChartConfigPanel.tsx
  - kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
  - kinetica_bi/src/components/WidgetConfigModal.tsx
autonomous: true
requirements:
  - DV-V16-12
must_haves:
  truths:
    - "ChartConfigPanel renders three optgroups (Tables / Views / Dynamic Views) when usesDataSource: true; each hidden when its array is empty"
    - "Selecting a dynamic-view writes BOTH dynamicViewId AND tableId (= sourceTableId) to widget.config on Save (coexistence locked from research finding #3 — drill-down + filter-bar continue to read tableId unchanged)"
    - "When operator picks a dynamic-view, column pickers (metric / group-by / drill-down) source from columns_json; when columns_json is null, pickers are disabled with hint 'Run Preview in Dynamic Views to populate columns'"
    - "Mutual exclusion at picker level: choosing a table/view clears dynamicViewId; choosing a dynamic-view sets dynamicViewId + sets tableId from sourceTableId"
    - "Map widget config panel does NOT get the picker (usesDataSource: false → existing guard at ChartConfigPanel.tsx:220 unchanged)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.tsx"
      provides: "Three-optgroup picker + dynamicViews prop + columns_json sourcing for column pickers + dual-write tableId+dynamicViewId on Save"
      contains: "Dynamic Views"
    - path: "kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx"
      provides: "Optgroup render + selection writes both ids + columns_json source flip + hint when columns_json null"
      contains: "Dynamic Views"
    - path: "kinetica_bi/src/components/WidgetConfigModal.tsx"
      provides: "Pass-through of dynamicViews prop to ChartConfigPanel"
      contains: "dynamicViews"
  key_links:
    - from: "ChartConfigPanel dataSourceOptions"
      to: "dynamicViews prop"
      via: "third optgroup builder"
      pattern: "kind: \"dynamic\""
    - from: "ChartConfigPanel onSave"
      to: "widget.config"
      via: "dual-write { tableId, dynamicViewId }"
      pattern: "dynamicViewId"
    - from: "ChartConfigPanel column pickers (metric/group-by/drill-down)"
      to: "selectedSource.columnsJson"
      via: "source flip when kind === \"dynamic\""
      pattern: "columnsJson"
---

<objective>
Extend `ChartConfigPanel` "Data Source" picker from 2-optgroup (Tables / Views) to 3-optgroup (Tables / Views / Dynamic Views). When a dynamic-view is selected:
- Widget config persistence dual-writes BOTH `dynamicViewId: number` AND `tableId: sourceTableId` (research correction #3 lock — coexistence is mandatory so drill-down + filter-bar continue to work).
- Column pickers (metric / group-by / drill-down) source from `dv.columns_json` instead of source-table columns.
- If `columns_json` is null (Preview never ran), show inline hint "Run Preview in Dynamic Views to populate columns" and disable column pickers.
- Picker mutual exclusion at config-pick time: single-select; choosing a table/view clears dynamicViewId; choosing a dynamic-view sets dynamicViewId + sets tableId from sourceTableId.

Map widget config panel (usesDataSource: false at definitions/map.ts:26) is NOT affected — the existing `hasSources && chartDef.usesDataSource !== false` guard at ChartConfigPanel.tsx:220 correctly suppresses the picker for map widgets (Pitfall 8 lock from research).

Purpose: Closes DV-V16-12 (the picker-side contract for dv-binding). Plan 35-05 then reads `widget.config.dynamicViewId` in renderers.

Output: Extended ChartConfigPanel + WidgetConfigModal prop pass-through + comprehensive spec.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md
@.planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md
@kinetica_bi/src/components/charts/ChartConfigPanel.tsx
@kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx
@kinetica_bi/src/components/WidgetConfigModal.tsx
@kinetica_bi/src/api/client.ts

<interfaces>
<!-- Locked references from 35-RESEARCH.md §"Pattern 6" + §"Pitfall 8" + 35-CONTEXT.md §"ChartConfigPanel Data Source picker UX" -->

From kinetica_bi/src/components/charts/ChartConfigPanel.tsx (existing dataSourceOptions builder at lines 70-86):
```typescript
const dataSourceOptions = useMemo(() => {
  const opts: Array<
    | { label: string; value: string; kind: "table"; tableId: number }
    | { label: string; value: string; kind: "view"; tableId: number }
  > = [];
  if (tables) {
    for (const t of tables) {
      const full = t.schema ? `${t.schema}.${t.name}` : t.name;
      opts.push({ label: full, value: full, kind: "table", tableId: t.id });
    }
  }
  if (views) {
    for (const v of views) {
      if (v.status === "created") {
        opts.push({ label: `${v.view_name} (view)`, value: v.view_name, kind: "view", tableId: v.table_id });
      }
    }
  }
  return opts;
}, [tables, views]);
```

NEW Phase 35 dataSourceOptions union (35-RESEARCH.md §"Pattern 6"):
```typescript
type DataSourceOption =
  | { label: string; value: string; kind: "table"; tableId: number }
  | { label: string; value: string; kind: "view"; tableId: number }
  | { label: string; value: string; kind: "dynamic"; dynamicViewId: number; sourceTableId: number; columnsJson: { name: string; type: string }[] | null };
```

LOCKED widget config Save shape (35-CONTEXT.md §"Widget config persistence on Save" + research correction #3):
- `dynamicViewId: number` → `widget.config.dynamicViewId`
- `tableId: number` → `widget.config.tableId` (= sourceTableId; coexists with dynamicViewId so legacy drill-down + filter-bar work)
- `tableRef: string` → `widget.config.tableRef` (= source-table name; renderer prefers dynamicViewId path when present)
- Mutual exclusion: picker is single-select; choosing a non-dynamic source CLEARS dynamicViewId; choosing a dynamic-view SETS dynamicViewId + tableId from sourceTableId

LOCKED columns_json sourcing (35-CONTEXT.md §"columns_json consumption"):
- When picker `kind === "dynamic"`, column pickers source from `selectedSource.columnsJson`
- When columns_json is null → inline hint "Run Preview in Dynamic Views to populate columns" + disable pickers
- When `kind !== "dynamic"`, column pickers source from existing source-table `columns` (unchanged)

Pitfall 8 (35-RESEARCH.md:685-693): The `hasSources && chartDef.usesDataSource !== false` guard at ChartConfigPanel.tsx:220 must NOT be changed — it correctly suppresses the picker for map widgets. Extension targets ONLY the inner JSX inside that conditional.

Two JSX picker render sites (35-RESEARCH.md "Pattern 6" + research finding #11):
- Standard branch at ChartConfigPanel.tsx:356-386
- CustomConfigPanel branch at ChartConfigPanel.tsx:217-249 (lines 222-249 for the picker)
BOTH must get the third optgroup.

Existing column-pickers source (lines around 101-104, 122-133 — `allColumns`, `numericColumns`, `drillDownColumns`):
- These derive from the source-table's `columns` map (via `selectedSource.tableId` lookup)
- Phase 35: when `selectedSource.kind === "dynamic"`, derive from `selectedSource.columnsJson` instead

Toast taxonomy lock: `ToastKind = "permission" | "info" | "error"` — no "warning". (Not directly toasted here — the hint is inline text.)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend ChartConfigPanel — dynamicViews prop + three-optgroup picker + columns_json column sourcing + dual-write Save</name>
  <files>kinetica_bi/src/components/charts/ChartConfigPanel.tsx, kinetica_bi/src/components/WidgetConfigModal.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (FULL — dataSourceOptions builder at 70-86; CustomConfigPanel branch at 197-291 (picker at 222-249); standard branch at 293-540 (picker at 356-386); allColumns/numericColumns derivation at 101-133; onSave handlers at 275/513)
    - kinetica_bi/src/components/WidgetConfigModal.tsx (FULL — pass-through props for tables/views; verify mount of ChartConfigPanel)
    - kinetica_bi/src/components/charts/definitions/map.ts (line ~26 — `usesDataSource: false` lock; DO NOT change)
    - kinetica_bi/src/components/charts/registry.ts (lines ~99-107 — usesDataSource definitions; reference for understanding which widgets hit the picker)
    - kinetica_bi/src/api/client.ts (lines 770-927 — DynamicViewRow shape; columns_json type)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"ChartConfigPanel Data Source picker UX" verbatim; §"columns_json consumption")
    - .planning/phases/35-widget-binding-and-pipeline/35-RESEARCH.md (§"Pattern 6" + §"Pitfall 8")
  </read_first>
  <behavior>
    Implementation behaviors enforced by Task 2 spec coverage:

    - Three optgroups render in order Tables / Views / Dynamic Views when each list is non-empty.
    - Each optgroup is hidden when its array is empty (matches existing per-collection conditional at line 78).
    - Dynamic-view option labels are the bare `dv.name` (no parenthetical).
    - Dynamic-view option values use `dv:<id>` discriminator prefix (e.g., `dv:7`) so the value space never collides with `schema.table` or filter-view names.
    - Selecting `dv:7` writes BOTH `widget.config.tableId = sourceTableId` AND `widget.config.dynamicViewId = 7` on Save.
    - Selecting a non-dynamic option clears `widget.config.dynamicViewId` (deletes the key) and writes only `tableId`.
    - Column pickers (metric/group-by/drill-down) read `selectedSource.columnsJson` when `kind === "dynamic"`; read source-table `columns` map otherwise.
    - When `selectedSource.kind === "dynamic"` AND `columnsJson === null`, the column-picker dropdowns are disabled AND a hint text "Run Preview in Dynamic Views to populate columns" renders below them.
    - The map widget's config panel is NOT affected (its `usesDataSource: false` short-circuit at line 220 still suppresses the picker).
  </behavior>
  <action>
    **1. Extend `ChartConfigPanel.tsx` props signature with `dynamicViews`:**

    Locate the props type (likely `ChartConfigPanelProps` or inline). Add `dynamicViews?: DynamicViewRow[]`:

    ```typescript
    import { type DynamicViewRow } from "../../api/client";

    type ChartConfigPanelProps = {
      // ... existing props (widget, chartDef, tables, views, onSave, onCancel) ...
      dynamicViews?: DynamicViewRow[];                  // NEW Phase 35 (DV-V16-12)
    };
    ```

    Destructure with default empty array in the component body:

    ```typescript
    const ChartConfigPanel: React.FC<ChartConfigPanelProps> = ({
      // ... existing props ...
      dynamicViews = [],
    }) => {
      // ...
    };
    ```

    **2. Extend `dataSourceOptions` builder at lines 70-86 — add the dv kind:**

    ```typescript
    const dataSourceOptions = useMemo(() => {
      const opts: Array<
        | { label: string; value: string; kind: "table"; tableId: number }
        | { label: string; value: string; kind: "view"; tableId: number }
        | { label: string; value: string; kind: "dynamic"; dynamicViewId: number; sourceTableId: number; columnsJson: { name: string; type: string }[] | null }
      > = [];

      if (tables) {
        for (const t of tables) {
          const full = t.schema ? `${t.schema}.${t.name}` : t.name;
          opts.push({ label: full, value: full, kind: "table", tableId: t.id });
        }
      }
      if (views) {
        for (const v of views) {
          if (v.status === "created") {
            opts.push({ label: `${v.view_name} (view)`, value: v.view_name, kind: "view", tableId: v.table_id });
          }
        }
      }
      // NEW Phase 35 (DV-V16-12): third optgroup
      if (dynamicViews) {
        for (const dv of dynamicViews) {
          opts.push({
            label: dv.name,                                       // bare name — optgroup label provides context
            value: `dv:${dv.id}`,                                  // discriminator prefix avoids value-space collision
            kind: "dynamic",
            dynamicViewId: dv.id,
            sourceTableId: dv.source_table_id,
            columnsJson: dv.columns_json,                          // null when Preview never ran
          });
        }
      }
      return opts;
    }, [tables, views, dynamicViews]);
    ```

    **3. Identify `selectedSource` (the option that matches the current widget config) — extend its lookup to include dv binding:**

    Find the existing `selectedSource` derivation. It likely matches on `value`. Extend so that when `widget.config.dynamicViewId` is set, the selected source's value is `dv:<dynamicViewId>`:

    ```typescript
    const currentValue = useMemo(() => {
      const cfg = widget.config ?? {};
      if (typeof cfg.dynamicViewId === "number") {
        return `dv:${cfg.dynamicViewId}`;
      }
      return cfg.tableRef as string | undefined;                  // existing behavior
    }, [widget.config]);

    const selectedSource = useMemo(
      () => dataSourceOptions.find((o) => o.value === currentValue),
      [dataSourceOptions, currentValue],
    );
    ```

    **4. Update column pickers' source — flip when kind === "dynamic":**

    Locate the existing `allColumns` / `numericColumns` / `drillDownColumns` derivation (lines around 101-133). They likely derive from the source-table's `columns` map (via `tables.find(t => t.id === selectedSource?.tableId)`).

    Replace with branching:

    ```typescript
    const allColumns = useMemo(() => {
      if (selectedSource?.kind === "dynamic") {
        // Source columns from columns_json — populated by Preview-then-Save in Phase 34.
        // When null, return [] so the picker is empty (paired with the disabled+hint UX below).
        return selectedSource.columnsJson ?? [];
      }
      // Existing path: derive from source-table columns map.
      if (!selectedSource) return [];
      const tbl = tables?.find((t) => t.id === selectedSource.tableId);
      if (!tbl?.columns) return [];
      return Object.entries(tbl.columns).map(([name, type]) => ({ name, type: String(type) }));
    }, [selectedSource, tables]);

    // Apply the same kind-aware derivation to `numericColumns` and `drillDownColumns` filters — both
    // filter from `allColumns`, so no extra change needed if they already derive from `allColumns`.
    // If they currently re-iterate `tbl.columns`, switch them to filter `allColumns` instead.
    ```

    **5. Add column-pickers-disabled state when columns_json is null:**

    Compute a derived flag:

    ```typescript
    const dvColumnsMissing =
      selectedSource?.kind === "dynamic" && selectedSource.columnsJson === null;
    ```

    Pass this flag down to each column-picker dropdown to disable it AND render a hint text below the picker group:

    ```tsx
    {dvColumnsMissing && (
      <div className="config-hint config-hint-warning">
        Run Preview in Dynamic Views to populate columns
      </div>
    )}
    <select disabled={dvColumnsMissing} value={metricColumn} onChange={(e) => setMetricColumn(e.target.value)}>
      {/* existing options derived from allColumns */}
    </select>
    ```

    Apply `disabled={dvColumnsMissing}` to ALL column pickers (metric, group-by, drill-down — whatever the chart type renders).

    **6. Extend `handleSourceChange` (or whichever `onChange` handler the `<select>` uses) — mutual exclusion + dual-write:**

    Locate the existing onChange handler. It currently does something like `handleTableChange(value)` and sets the source. Extend to detect `dv:<id>` prefix:

    ```typescript
    const handleSourceChange = useCallback((value: string) => {
      if (value.startsWith("dv:")) {
        const dvId = parseInt(value.slice(3), 10);
        const dv = dynamicViews?.find((d) => d.id === dvId);
        if (!dv) return;
        // Dual-write: set dynamicViewId AND tableId from sourceTableId.
        // tableRef is left as the source-table's full name (renderer prefers dynamicViewId).
        const srcTable = tables?.find((t) => t.id === dv.source_table_id);
        const srcRef = srcTable ? (srcTable.schema ? `${srcTable.schema}.${srcTable.name}` : srcTable.name) : "";
        setLocalConfig((prev) => ({
          ...prev,
          dynamicViewId: dvId,
          tableId: dv.source_table_id,
          tableRef: srcRef,
        }));
      } else {
        // Clearing dynamicViewId on table/view pick (mutual exclusion at picker level).
        const opt = dataSourceOptions.find((o) => o.value === value && o.kind !== "dynamic") as
          | { kind: "table" | "view"; tableId: number }
          | undefined;
        if (!opt) return;
        setLocalConfig((prev) => {
          const next = { ...prev, tableId: opt.tableId, tableRef: value };
          // Delete the dynamicViewId key entirely so renderer's `cfg.dynamicViewId !== undefined` check fails.
          delete (next as Record<string, unknown>).dynamicViewId;
          return next;
        });
      }
    }, [dynamicViews, tables, dataSourceOptions]);
    ```

    **7. Extend `handleSave` (or wherever onSave fires) — ensure `dynamicViewId` propagates AND tableId stays:**

    Locate the existing Save handler. Verify it forwards the entire local config (including `dynamicViewId` if set). If it explicitly picks fields, add `dynamicViewId`:

    ```typescript
    const handleSave = useCallback(() => {
      const finalConfig: Record<string, unknown> = {
        ...existingFields,                       // sql, metricColumn, groupByColumn, etc.
        tableId: localConfig.tableId,
        tableRef: localConfig.tableRef,
      };
      if (typeof localConfig.dynamicViewId === "number") {
        finalConfig.dynamicViewId = localConfig.dynamicViewId;
      }
      onSave(finalConfig);
    }, [localConfig, /* other deps */]);
    ```

    **CRITICAL (research correction #3 lock):** `tableId` MUST be written even when `dynamicViewId` is set — it equals `sourceTableId`. This is what makes drill-down dispatch + filter-bar continue to work without rewrites. If a code reviewer asks "why both?" the answer is: the renderer prefers `dynamicViewId` for FROM-swap, but filter-bar + drill-down code paths (DashboardsPage.tsx:733-849; WidgetRenderer.tsx:242-248, 70-112) all key on `tableId`. Dropping it breaks those.

    **8. Extend the JSX `<select>` at lines 222-249 (CustomConfigPanel) AND 356-386 (standard) — add the Dynamic Views optgroup:**

    Inside BOTH `<select>` blocks, add the third optgroup right after the existing Views optgroup:

    ```tsx
    {dynamicViews && dynamicViews.length > 0 && (
      <optgroup label="Dynamic Views">
        {dynamicViews.map((dv) => (
          <option key={`dv-${dv.id}`} value={`dv:${dv.id}`}>
            {dv.name}
          </option>
        ))}
      </optgroup>
    )}
    ```

    Verify the outer `{hasSources && chartDef.usesDataSource !== false && (` guard at line 220 is UNCHANGED (Pitfall 8 lock — map widget exclusion).

    **9. Extend `WidgetConfigModal.tsx` — pass `dynamicViews` prop through to ChartConfigPanel:**

    Locate the existing `<ChartConfigPanel ...>` mount in the modal body. Add the `dynamicViews` prop:

    ```tsx
    // Modal props (extended in Plan 35-03; verify):
    type WidgetConfigModalProps = {
      widget: WidgetDto;
      tables: TableDto[];
      views: ViewRow[];
      dynamicViews?: DynamicViewRow[];              // already added by Plan 35-03 — confirm present
      onSave: (config: ChartConfig) => void;
      onClose: () => void;
    };

    const WidgetConfigModal: React.FC<WidgetConfigModalProps> = ({
      widget, tables, views, dynamicViews = [], onSave, onClose,
    }) => {
      return (
        <div className="modal-overlay">
          <ChartConfigPanel
            widget={widget}
            chartDef={chartDef}
            tables={tables}
            views={views}
            dynamicViews={dynamicViews}                  // NEW Phase 35 — forwarded from DashboardsPage
            onSave={onSave}
            onCancel={onClose}
          />
        </div>
      );
    };
    ```
  </action>
  <verify>
    <automated>cd kinetica_bi && npx tsc --noEmit && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "kind: \"dynamic\"" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
    - `grep -q "Dynamic Views" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` (optgroup label)
    - `grep -q "dv:\${dv.id}" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` OR `grep -q "\`dv:\${" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` (discriminator prefix)
    - `grep -q "dynamicViewId" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` (config write)
    - `grep -q "columnsJson" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` (column source flip)
    - `grep -q "Run Preview in Dynamic Views" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` (hint text)
    - `grep -q "dynamicViews" kinetica_bi/src/components/WidgetConfigModal.tsx`
    - `grep -c "optgroup" kinetica_bi/src/components/charts/ChartConfigPanel.tsx` returns ≥ 4 (existing 2 sites × 2 prior optgroups + new 2 optgroups; final count is 6, but minimum 4 ensures dynamic optgroups are added)
    - The map widget guard at line ~220 still reads `usesDataSource !== false` (regression check):
      `grep -q "usesDataSource !== false" kinetica_bi/src/components/charts/ChartConfigPanel.tsx`
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    - Three-optgroup picker rendered in BOTH CustomConfigPanel and standard branches
    - dataSourceOptions builder produces dv-kind entries
    - Save dual-writes `tableId` + `dynamicViewId` for dv-bound; clears `dynamicViewId` for table/view-bound
    - Column pickers flip source to `columnsJson` when kind === "dynamic"
    - Disabled state + hint text when columnsJson === null
    - WidgetConfigModal forwards `dynamicViews` prop
    - Map widget config panel unaffected (Pitfall 8 lock preserved)
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Extend ChartConfigPanel.spec.tsx with dynamic-view picker + columns_json + dual-write coverage</name>
  <files>kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx (FULL — existing structure for prop mocking, render harness, onSave assertions)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (just-modified file — pickup the picker JSX + handler shape)
    - .planning/phases/35-widget-binding-and-pipeline/35-CONTEXT.md (§"Test coverage scope" item 2)
  </read_first>
  <behavior>
    Spec coverage:

    - Test 1: Dynamic Views optgroup renders when `dynamicViews` is non-empty (use `findByRole("group", { name: /Dynamic Views/i })` or query the `<optgroup>` element by label).

    - Test 2: Dynamic Views optgroup is HIDDEN when `dynamicViews={[]}` (no optgroup with that label).

    - Test 3: All three optgroups render together when tables, views, and dynamicViews are all non-empty (Tables, Views, Dynamic Views).

    - Test 4: Selecting a dynamic-view (`fireEvent.change` with value `dv:7`) and clicking Save fires `onSave` with config containing BOTH `dynamicViewId: 7` AND `tableId: <sourceTableId>` AND `tableRef: <sourceTableFullName>`. NEITHER is missing.

    - Test 5: Selecting a plain table after having selected a dynamic-view CLEARS `dynamicViewId` in the next Save payload (mutual exclusion).

    - Test 6: When a dynamic-view with `columns_json = [{ name: "vendor", type: "TEXT" }, { name: "avg_fare", type: "DOUBLE" }]` is selected, the metric column picker renders options for `vendor` and `avg_fare` (NOT for the source-table's columns).

    - Test 7: When a dynamic-view with `columns_json = null` is selected, the column pickers are `disabled` AND the hint text "Run Preview in Dynamic Views to populate columns" is visible.

    - Test 8: Loading an existing widget with `widget.config = { dynamicViewId: 7, tableId: 4, tableRef: "demo.taxi" }` shows the dynamic-view option as the currently-selected source (the `<select>` element's value matches `dv:7`).

    - Test 9: Map widget config panel (widget with chartDef.usesDataSource === false) does NOT render the Dynamic Views optgroup — the entire picker is suppressed (verify via absence of any optgroup with label "Dynamic Views").
  </behavior>
  <action>
    Open `ChartConfigPanel.spec.tsx`. Add a new `describe` block "Phase 35 dynamic-view picker (DV-V16-12)" at the end of the file. Inside, write 9 `it` blocks per the behavior list.

    Mock `DynamicViewRow` fixtures at the top of the describe block:

    ```typescript
    const mockDynamicViews: DynamicViewRow[] = [
      {
        id: 7,
        dashboard_id: 1,
        source_table_id: 4,
        name: "Top vendors",
        template_sql: "SELECT vendor FROM {view}",
        max_records: 10000,
        columns_json: [
          { name: "vendor", type: "TEXT" },
          { name: "avg_fare", type: "DOUBLE" },
        ],
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
      {
        id: 8,
        dashboard_id: 1,
        source_table_id: 4,
        name: "Untested view",
        template_sql: "SELECT * FROM {view}",
        max_records: 10000,
        columns_json: null,                          // for Test 7
        created_at: "2026-05-15T00:00:00Z",
        updated_at: "2026-05-15T00:00:00Z",
      },
    ];

    const mockTables: TableDto[] = [
      { id: 4, schema: "demo", name: "taxi_trips", columns: { vendor: "TEXT", fare: "DOUBLE" } as any },
    ];
    ```

    Render the component with a typical aggregated widget config + the mock fixtures. For each test, use `@testing-library/react` queries on the modal/panel DOM to assert the locked behaviors.

    Pseudocode for the dual-write test (Test 4):

    ```typescript
    it("selecting a dynamic-view and clicking Save dual-writes dynamicViewId + tableId", async () => {
      const onSave = vi.fn();
      render(
        <ChartConfigPanel
          widget={mockAggregatedWidget}
          chartDef={mockAggregatedChartDef}
          tables={mockTables}
          views={[]}
          dynamicViews={mockDynamicViews}
          onSave={onSave}
          onCancel={vi.fn()}
        />
      );

      // Find the Data Source <select> and change to dv:7
      const sourceSelect = screen.getByLabelText(/data source/i);   // or whichever label the existing JSX uses
      fireEvent.change(sourceSelect, { target: { value: "dv:7" } });

      // Click Save
      fireEvent.click(screen.getByRole("button", { name: /save/i }));

      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      const config = onSave.mock.calls[0][0];
      expect(config.dynamicViewId).toBe(7);
      expect(config.tableId).toBe(4);                  // = sourceTableId from mockDynamicViews[0]
      expect(config.tableRef).toBe("demo.taxi_trips"); // source-table full name
    });
    ```

    For the disabled-pickers test (Test 7):

    ```typescript
    it("selecting a dv with null columns_json disables column pickers and shows hint", async () => {
      render(<ChartConfigPanel /* ... */ dynamicViews={mockDynamicViews} />);
      fireEvent.change(screen.getByLabelText(/data source/i), { target: { value: "dv:8" } });

      // Hint visible
      expect(screen.getByText(/Run Preview in Dynamic Views/i)).toBeInTheDocument();

      // Column picker(s) disabled
      const metricSelect = screen.getByLabelText(/metric/i);   // adapt to existing label
      expect(metricSelect).toBeDisabled();
    });
    ```

    For Test 9 (map widget exclusion):

    ```typescript
    it("map widget config (usesDataSource: false) does NOT render Dynamic Views optgroup", () => {
      const mapChartDef = { ...someMapChartDef, usesDataSource: false };
      render(<ChartConfigPanel chartDef={mapChartDef} /* ... */ dynamicViews={mockDynamicViews} />);
      // Optgroup absent
      expect(screen.queryByRole("group", { name: /Dynamic Views/i })).not.toBeInTheDocument();
    });
    ```

    Adapt selectors to match the existing component's actual aria-labels and JSX shape. Read the existing spec file for canonical queries (e.g., `getByDisplayValue`, `screen.getByText("Dynamic Views")` for optgroup label).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q "Phase 35 dynamic-view picker" kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx`
    - `grep -q "dynamicViewId" kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` (dual-write assertion)
    - `grep -q "Run Preview in Dynamic Views" kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` (Test 7)
    - `grep -q "columns_json: null" kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` (Test 7 fixture)
    - `grep -c "it(" kinetica_bi/src/components/charts/ChartConfigPanel.spec.tsx` returns a value at least 9 higher than the pre-edit count (9 new tests added)
    - `cd kinetica_bi && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx` exits 0
    - All previous ChartConfigPanel tests still pass (regression)
  </acceptance_criteria>
  <done>
    - 9 new spec tests covering optgroup render, hide-when-empty, dual-write Save, mutual exclusion, columns_json column source, disabled+hint when columns_json null, existing-config load, map exclusion
    - Regression-safe — existing tests still pass
    - tsc clean
  </done>
</task>

</tasks>

<verification>
- `cd kinetica_bi && npx vitest run src/components/charts/ChartConfigPanel.spec.tsx src/components/WidgetConfigModal.spec.tsx 2>/dev/null` passes (the second spec may not exist; the first is the load-bearing one)
- `cd kinetica_bi && npx tsc --noEmit` clean
- Map widget config panel is verified UNCHANGED (Pitfall 8 lock — `usesDataSource !== false` guard at line 220 preserved)
- `tableId` is always written alongside `dynamicViewId` (research correction #3 lock — drill-down + filter-bar compat)
</verification>

<success_criteria>
- ChartConfigPanel "Data Source" picker shows three optgroups (Tables / Views / Dynamic Views) when usesDataSource: true; each hidden when its array is empty
- Selecting a dynamic-view writes BOTH `dynamicViewId` AND `tableId = sourceTableId` to widget.config on Save (coexistence locked)
- Column pickers source from `columns_json` when dv-bound; from source-table columns otherwise
- When `columns_json === null`, column pickers are disabled AND hint "Run Preview in Dynamic Views to populate columns" renders
- Mutual exclusion at picker level: choosing a non-dynamic source clears `dynamicViewId`; choosing a dynamic-view sets both ids
- Map widget config panel unaffected
</success_criteria>

<output>
After completion, create `.planning/phases/35-widget-binding-and-pipeline/35-04-SUMMARY.md`.
</output>

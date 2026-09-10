---
phase: 22-config-ui
plan: "03"
type: execute
wave: 2
depends_on:
  - "22-01"
files_modified:
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
  - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
  - kinetica_bi/src/components/LayersModal.tsx
  - kinetica_bi/src/components/charts/InfoPopup.tsx
autonomous: true
requirements:
  - CONFIG-V14-03

must_haves:
  truths:
    - "Layer config form shows an INFO POPUP section at the very bottom (after CONTOUR PARAMS / RASTER PARAMS / etc.)"
    - "User toggling 'Enable info popup' on the layer fires onChange with config.__infoEnabled propagating up to LayersModal which patches DashboardLayerDto.info_enabled (0 or 1)"
    - "Column chip-combobox shows ALL columns from the layer's source table, in alphabetical order"
    - "Default state: every chip rendered as 'selected' (visual all-on); info_columns persisted as null until user removes a chip"
    - "Removing one chip persists info_columns as a JSON-stringified string[] (e.g., '[\"lat\",\"lon\"]') with the remaining columns; re-selecting all chips compresses BACK to null"
    - "info_template editor renders via @uiw/react-codemirror with @codemirror/lang-html extension; keystroke fires onPatch within 300ms (existing parent debounce)"
    - "Below the editor: visible note 'Use {column_name} to insert values.' AND visible warning 'HTML is rendered as-is — do not paste templates from untrusted sources.'"
    - "When info_enabled=0, the chip combobox AND the editor render disabled (HTML disabled / aria-disabled / opacity reduced via .info-popup-config-section.disabled or per-control disabled)"
    - "When the layer's table_id does NOT resolve in associatedTables (missing-table predicate from LayersModal:142-143), the entire INFO POPUP section is disabled with the message 'Bind a table to configure info popup'"
    - "Cross-phase: InfoPopup.tsx caller passes alphabetically-sorted column names to renderInfoTemplate so the popup KV mode matches picker order"
  artifacts:
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      provides: "INFO POPUP section at bottom of form: toggle, ChipCombobox, Insert-column picker, CodeMirror HTML editor, syntax + security notes"
      contains: "INFO POPUP"
    - path: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx"
      provides: "8+ new tests: render-order, default-all-selected sentinel preserved (null), alphabetical order, deselect-then-reselect-all compresses to null, toggle-disables-subfields, missing-table-disables-section, syntax+security notes visible, CodeMirror onChange propagation"
    - path: "kinetica_bi/src/components/LayersModal.tsx"
      provides: "Wire INFO POPUP fields from KineticaWmsLayerForm onChange up to onPatch as DashboardLayerDto attrs (info_enabled / info_columns / info_template) — NOT inside config blob; pass `tableMissing` flag down to form"
    - path: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      provides: "Sort entry.columns alphabetically before passing to renderInfoTemplate so KV mode matches picker order"
      contains: "[...entry.columns].sort()"
  key_links:
    - from: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      to: "kinetica_bi/src/components/charts/ChipCombobox.tsx"
      via: "import default ChipCombobox"
      pattern: "from.*ChipCombobox"
    - from: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      to: "@uiw/react-codemirror"
      via: "import default CodeMirror"
      pattern: "from \"@uiw/react-codemirror\""
    - from: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      to: "@codemirror/lang-html"
      via: "import { html }"
      pattern: "from \"@codemirror/lang-html\""
    - from: "kinetica_bi/src/components/LayersModal.tsx"
      to: "kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx"
      via: "Pass new prop tableMissing + handle new onChange surface for info_* fields routed to onPatch as DashboardLayerDto attrs"
      pattern: "tableMissing"
    - from: "kinetica_bi/src/components/charts/InfoPopup.tsx"
      to: "kinetica_bi/src/lib/renderInfoTemplate.ts"
      via: "Pre-sort entry.columns alphabetically before invoking renderInfoTemplate (KV-order parity with picker)"
      pattern: "\\.sort\\("
---

<objective>
Add the INFO POPUP section to the layer config surface (`KineticaWmsLayerForm`), wire the new fields up through `LayersModal` to the existing `onPatch` flow as top-level `DashboardLayerDto` attrs (NOT inside `config` blob), and apply the cross-phase column-sort fix in `InfoPopup.tsx` so the popup's KV mode renders columns in the same alphabetical order the picker shows.

Purpose: CONFIG-V14-03 — dashboard authors can configure the per-layer toggle, choose which columns appear in the popup KV fallback, and write a freeform HTML template — without leaving the LayersModal.

Output:
- `KineticaWmsLayerForm.tsx` carries a new INFO POPUP `<div className="config-group">` block at the very bottom of the form
- `KineticaWmsLayerForm.spec.tsx` extended in place with 10 new tests
- `LayersModal.tsx` wires the form's new INFO POPUP onChange surface to `onPatch` as DashboardLayerDto attrs (info_enabled / info_columns / info_template) AND passes a `tableMissing` flag down so the section disables when the layer's table is unresolved
- `InfoPopup.tsx` line 125 area: `[...entry.columns].sort()` (or equivalent) before passing to `renderInfoTemplate` so KV mode column order matches alphabetical picker order

Phase 22 closes here — CONFIG-V14-03 satisfied.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/22-config-ui/22-CONTEXT.md
@.planning/phases/19-config-schema/19-VERIFICATION.md
@.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md
@.planning/phases/21-map-click-popup/21-02-info-popup-component-SUMMARY.md

# Plan 22-01 outputs (foundation — installed packages + ChipCombobox + CSS)
@.planning/phases/22-config-ui/22-01-foundation-PLAN.md

# Extension targets
@kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx
@kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx
@kinetica_bi/src/components/LayersModal.tsx
@kinetica_bi/src/components/charts/InfoPopup.tsx

# Phase 19 contracts (READ-ONLY — DO NOT modify)
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/mapInfoConfig.ts
@kinetica_bi/src/lib/renderInfoTemplate.ts

<interfaces>
<!-- DashboardLayerDto + updateLayer Pick — already shipped in Phase 19 (DO NOT modify) -->

```typescript
// kinetica_bi/src/api/client.ts (already shipped)
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  info_enabled: number;        // 0 | 1 (SQLite INTEGER NOT NULL DEFAULT 1)
  info_columns: string | null; // JSON-array string OR null sentinel
  info_template: string | null;// raw HTML OR null sentinel
  created_at: string;
  updated_at: string;
};

export const updateLayer: (
  dashboardId: number,
  layerId: number,
  attrs: Partial<Pick<DashboardLayerDto,
    | "table_id" | "position" | "config"
    | "info_enabled" | "info_columns" | "info_template"
  >>
) => Promise<DashboardLayerDto>;
```

<!-- LayersModal onPatch flow (already shipped) -->

```typescript
// kinetica_bi/src/components/LayersModal.tsx (already shipped)
type LayersModalProps = {
  layers: DashboardLayerDto[];
  associatedTables: TableDto[];
  // ...
  onPatch: (layerId: number, patch: Partial<DashboardLayerDto>) => void;
};
// Patches like onPatch(id, { config: nextConfig }) for normal form fields.
// Plan 22-03 EXTENDS this to also accept top-level info_* attrs:
//   onPatch(id, { info_enabled: 0 }) / onPatch(id, { info_columns: '["a","b"]' }) /
//   onPatch(id, { info_template: '<div>{name}</div>' })
// updateLayer's Pick<> already accepts these (CONFIG-V14-01 shipped).
```

<!-- ChipCombobox (Plan 22-01 output) -->

```typescript
// kinetica_bi/src/components/charts/ChipCombobox.tsx (Plan 22-01)
export type ChipComboboxOption = { value: string; typeLabel?: string };
export type ChipComboboxProps = {
  options: ChipComboboxOption[];
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
};
export default function ChipCombobox(props: ChipComboboxProps): JSX.Element;
```

<!-- KineticaWmsLayerForm prop EXTENSIONS (this plan adds these) -->

```typescript
// EXTEND KineticaWmsLayerFormProps with v1.4 INFO POPUP fields
type KineticaWmsLayerFormProps = {
  // ...existing fields (config, onChange, columns, isValid)...

  // v1.4 Phase 22 — INFO POPUP fields routed via top-level DashboardLayerDto patches.
  // Pass these from LayersModal so the form can render the section bound to the right values
  // and propagate changes through onPatch as DashboardLayerDto attrs (NOT into config).
  infoEnabled?: number;             // 0 | 1, default 1 (read via Phase 19 SQLite default)
  infoColumns?: string | null;      // JSON-array string or null
  infoTemplate?: string | null;     // raw HTML string or null

  // Callback for the THREE info_* attrs — routes to onPatch as DashboardLayerDto patch.
  // Separate from the existing config-blob `onChange` because info_* are TOP-LEVEL columns,
  // not nested config keys.
  onChangeInfoConfig?: (patch: {
    info_enabled?: number;
    info_columns?: string | null;
    info_template?: string | null;
  }) => void;

  // Missing-table predicate result (true = no resolvable table). Form renders the INFO POPUP
  // section disabled with the locked "Bind a table to configure info popup" message.
  tableMissing?: boolean;
};
```

<!-- LayersModal patch routing -->

The existing `onChange` callback for `KineticaWmsLayerForm` returns the FULL `config` object (untouched by this plan). The NEW `onChangeInfoConfig` callback returns ONLY the `info_*` patch attributes that go to top-level columns:

```typescript
// LayersModal.tsx (extension)
<KineticaWmsLayerForm
  config={selectedLayer.config}
  columns={formColumns}
  onChange={(nextConfig) => onPatch(selectedLayer.id, { config: nextConfig })}
  // NEW Phase 22 routing
  infoEnabled={selectedLayer.info_enabled}
  infoColumns={selectedLayer.info_columns}
  infoTemplate={selectedLayer.info_template}
  onChangeInfoConfig={(patch) => onPatch(selectedLayer.id, patch)}
  tableMissing={isTableMissing(selectedLayer)}
/>
```

This split keeps the form purely controlled (still no internal state for the patches) and reuses the existing 300ms-debounced onPatch flow.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend KineticaWmsLayerForm.spec.tsx with INFO POPUP section tests (RED)</name>
  <files>kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (entire file — preserve existing 7 tests; add 10 new at end)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx lines 332-405 (default export signature; understand prop shape)
    - .planning/phases/22-config-ui/22-CONTEXT.md § decisions § Column multi-picker UX (alphabetical, default-all-selected sentinel)
    - .planning/phases/22-config-ui/22-CONTEXT.md § anti-patterns (DO NOT auto-populate info_columns; DO NOT clamp; DO NOT render editable when disabled)
    - kinetica_bi/src/components/charts/ChipCombobox.spec.tsx (mirror role-based query patterns)
  </read_first>
  <behavior>
    Add a new sibling describe `describe("KineticaWmsLayerForm — Phase 22 INFO POPUP section", () => { ... })` at the END of the file (after the existing closing `});` of the main describe). Tests:

    - **L1 (render-order):** "renders INFO POPUP section header at the very bottom (after RASTER PARAMS or whichever render-mode block is active)" — render with default `baseConfig` (renderMode="raster"); assert `screen.getByText("INFO POPUP")` present; assert in `Array.from(document.querySelectorAll(".config-group-label")).map(e => e.textContent)`, "INFO POPUP" appears LAST.
    - **L2 (default-toggle-on):** "with infoEnabled=1 prop, the Enable info popup toggle is checked" — render with `infoEnabled={1}`; `screen.getByLabelText("Enable info popup")` is `.checked === true`.
    - **L3 (toggle-disables-subfields):** "with infoEnabled=0, the ChipCombobox chips and the CodeMirror editor are disabled" — render with `infoEnabled={0}`; query at least one `.info-popup-config-chip` button — assert `.disabled === true`. For the editor, assert the CodeMirror wrapper has class containing `disabled` OR an aria-disabled='true' attribute on the editor wrapper element.
    - **L4 (chip-alphabetical-order):** "ChipCombobox renders columns in alphabetical order regardless of `columns` prop order" — render with `columns={[{name:"vendor_id"...}, {name:"lat"...}, {name:"lon"...}]}` and `infoEnabled={1}`, `infoColumns={null}`. Read `screen.getAllByRole("button")` chip buttons (filter to those with className `info-popup-config-chip`) — assert text content order: `["lat", "lon", "vendor_id"]`.
    - **L5 (default-all-selected sentinel):** "when infoColumns prop is null, every chip renders as selected" — render with `infoColumns={null}`, columns=[lat, lon, vendor_id]; assert all 3 chips have className containing `selected` AND `aria-pressed="true"`.
    - **L6 (deselect-fires-onChangeInfoConfig with explicit array):** "removing one chip while infoColumns=null fires onChangeInfoConfig with `{ info_columns: '[\"lat\",\"vendor_id\"]' }`" — render with `infoColumns={null}`, columns=[lat, lon, vendor_id], `onChangeInfoConfig={vi.fn()}`; click the `lon` chip; assert `onChangeInfoConfig` called with object equal to `{ info_columns: '["lat","vendor_id"]' }` (JSON-stringified, sorted alphabetically).
    - **L7 (re-select-all compresses to null):** "re-selecting the last missing chip when infoColumns currently lists all-but-one fires onChangeInfoConfig with `{ info_columns: null }`" — render with `infoColumns='["lat","vendor_id"]'`, columns=[lat, lon, vendor_id], `onChangeInfoConfig={vi.fn()}`; click the `lon` chip (currently unselected — re-selects to make all 3); assert `onChangeInfoConfig` called with `{ info_columns: null }` (compressed back to sentinel).
    - **L8 (template-editor-onChange):** "typing in the CodeMirror editor fires onChangeInfoConfig with `{ info_template: <new value> }`" — render with `infoTemplate={null}`. Get the CodeMirror textarea (CodeMirror 6 renders a contenteditable; in jsdom, `@uiw/react-codemirror` exposes a `<textarea>` for accessibility OR fires `onChange` directly via the `value` prop). The simplest assertion: `screen.getByRole("textbox")` (CodeMirror exposes role textbox), `fireEvent.change(editor, { target: { value: "<div>{lat}</div>" }})`. Assert `onChangeInfoConfig` called with `{ info_template: "<div>{lat}</div>" }`.
    - **L9 (notes-visible):** "renders the literal syntax note 'Use {column_name} to insert values.' AND security warning 'HTML is rendered as-is — do not paste templates from untrusted sources.' below the editor" — assert `screen.getByText("Use {column_name} to insert values.")` AND `screen.getByText("HTML is rendered as-is — do not paste templates from untrusted sources.")`. Both are visible whether or not infoEnabled is true (locked: surface the no-sanitization tradeoff EVERY time).
    - **L10 (missing-table-disables-section):** "when tableMissing=true, the section renders with the locked message 'Bind a table to configure info popup' AND every interactive element (toggle + chips + editor) is disabled" — render with `tableMissing={true}`. Assert `screen.getByText("Bind a table to configure info popup")` present. Toggle's `screen.getByLabelText("Enable info popup")` has `.disabled === true`. Note: when tableMissing=true, the form may not have any columns either (LayersModal passes empty columns prop), but the SECTION container still renders — just with the locked message + disabled controls.
    - **L11 (insert-column-picker):** "renders an Insert column dropdown above the editor with the currently-selected columns; selecting a column inserts `{column_name}` token into the editor at the end" — render with `infoColumns='["lat","lon"]'`, `infoTemplate="<div></div>"`, `onChangeInfoConfig={vi.fn()}`. Get `screen.getByLabelText("Insert column")`, fireEvent.change with value="lat"; assert `onChangeInfoConfig` called with `{ info_template: "<div></div>{lat}" }`. (Insert-at-end is the simplification — cursor-position injection is deferred per CONTEXT.md.)
    - **L12 (toggle-fires-onChangeInfoConfig):** "clicking Enable info popup when infoEnabled=1 fires onChangeInfoConfig with `{ info_enabled: 0 }`" — `onChangeInfoConfig={vi.fn()}`; click the toggle; assert `onChangeInfoConfig` called with `{ info_enabled: 0 }`.

    That's 12 tests, exceeding the planned "8+". The clamp/disabled/sentinel-preservation/cross-phase-sort cases each need their own test for grep-able locked behavior.

    Run `cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx`. Existing 7 tests MUST pass (need to add new prop defaults to the existing test fixtures — the new props are all optional but the spec needs to render the form without ChipCombobox crashing on undefined `infoColumns`. Pass them explicitly as `undefined`/`null`/`0` to be safe). 12 new tests MUST fail.

    Commit message: `test(22-03): add failing INFO POPUP section spec for KineticaWmsLayerForm`
  </behavior>
  <action>
    Open `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx`. Append the new describe block at the end (preserve existing 7 tests).

    For the CodeMirror test (L8), use this jsdom workaround:
    ```typescript
    // CodeMirror 6 in jsdom: simplest path is to query the rendered textbox role and
    // fire a synthetic change. @uiw/react-codemirror surfaces the editable area with
    // role="textbox" so testing-library can find it via getByRole.
    const editor = screen.getByRole("textbox");
    fireEvent.change(editor, { target: { value: "<div>{lat}</div>" } });
    ```
    If CodeMirror in jsdom doesn't fire `onChange` from `fireEvent.change`, fall back to: assert the editor element exists (`screen.getByRole("textbox")` resolves) and accept that the integration is covered by the implementation calling onChangeInfoConfig directly — but FIRST attempt the synthetic change and only fall back if it doesn't work.

    Test fixture extension (define at top of new describe):
    ```typescript
    const sortedColumns = [
      { name: "lat", type: "double" },
      { name: "lon", type: "double" },
      { name: "vendor_id", type: "varchar" },
    ];
    const unsortedColumns = [
      { name: "vendor_id", type: "varchar" },
      { name: "lat", type: "double" },
      { name: "lon", type: "double" },
    ];
    ```

    Run `cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` — expect 7 PASS + 12 FAIL.

    Commit message: `test(22-03): add failing INFO POPUP section spec for KineticaWmsLayerForm`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx 2>&1 | tail -3 | grep -q "12 failed"
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx` contains 19+ `it(` blocks (7 existing + 12 new)
    - File contains literal `"INFO POPUP"` (grep returns >= 1 match)
    - File contains `"Enable info popup"` (grep returns >= 2 matches — label + aria-label assertions)
    - File contains `"Bind a table to configure info popup"` (grep returns 1 match — L10 message assertion)
    - File contains `"Use {column_name} to insert values."` (grep returns 1 match — L9 syntax note)
    - File contains `"HTML is rendered as-is — do not paste templates from untrusted sources."` (grep returns 1 match — L9 security note; note em dash unicode `—`)
    - File contains `'["lat","vendor_id"]'` OR `JSON.stringify(["lat", "vendor_id"])` (grep returns >= 1 match — L6 sentinel materialization)
    - File contains `info_columns: null` (grep returns >= 1 match — L7 sentinel preservation)
    - File contains `tableMissing` (grep returns >= 2 matches — L10 prop usage + assertion)
    - File contains `onChangeInfoConfig` (grep returns >= 8 matches — used in most new tests)
    - vitest exits with exactly 12 failing + 7 passing tests (RED state)
  </acceptance_criteria>
  <done>12 new failing tests committed (RED); locked behaviors pinned in spec for: render-order, default sentinel, alphabetical order, sentinel-materialization-on-deselect, sentinel-compression-on-reselect, toggle-disables-subfields, missing-table-disables-section, syntax+security notes, insert-column picker, CodeMirror onChange propagation.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement INFO POPUP section in KineticaWmsLayerForm.tsx (GREEN, 1/2)</name>
  <files>kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (entire file — extension at end of returned JSX, AFTER all renderMode-specific blocks, BEFORE `</div></div>` closing tags)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.spec.tsx (final form from Task 1 — implement to make all 19 tests pass)
    - kinetica_bi/src/components/charts/ChipCombobox.tsx (Plan 22-01 output — public interface + sentinel semantics)
    - .planning/phases/22-01-foundation-PLAN.md (locked CodeMirror import paths + ChipCombobox API)
  </read_first>
  <action>
    Modify `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx`:

    **Imports** (top of file, alongside existing imports):
    ```typescript
    import CodeMirror from "@uiw/react-codemirror";
    import { html as htmlLang } from "@codemirror/lang-html";
    import ChipCombobox, { type ChipComboboxOption } from "./ChipCombobox";
    ```

    **Type extension** — modify the existing `KineticaWmsLayerFormProps` type at line 39:
    ```typescript
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
    };
    ```

    **Default export signature** — extend the destructure at line 334:
    ```typescript
    export default function KineticaWmsLayerForm({
      config,
      onChange,
      columns = [],
      isValid,
      infoEnabled = 1,           // matches Phase 19 SQLite default
      infoColumns = null,        // matches Phase 19 sentinel
      infoTemplate = null,       // matches Phase 19 sentinel
      onChangeInfoConfig,
      tableMissing = false,
    }: KineticaWmsLayerFormProps): JSX.Element {
    ```

    **Inside component body**, AFTER existing computations (e.g., after `const colormapList = ...` line 400, before the `return`):
    ```typescript
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
      // Insert-at-end (deferred: cursor-position injection per 22-CONTEXT.md "Claude's Discretion").
      const next = (infoTemplate ?? "") + `{${col}}`;
      onChangeInfoConfig?.({ info_template: next });
      // Reset the select to the placeholder option (re-pick same column would otherwise be a no-op).
      e.target.value = "";
    };

    const isInfoEnabled = infoEnabled === 1;
    const sectionDisabled = tableMissing || !isInfoEnabled;
    // Toggle itself stays enabled UNLESS table is missing (toggle is the master switch).
    const toggleDisabled = tableMissing;
    ```

    **Add the JSX block at the very END of the form** — find the last `</div>` of `config-panel-body` (around line 848) and the `</div>` of `config-panel` (line 849). Insert this block AS THE LAST sibling of `config-panel-body`'s children (i.e., after the CONTOUR PARAMS conditional block at line 845-846):

    ```jsx
            {/* ─── INFO POPUP (Phase 22 CONFIG-V14-03) ───────────────────────── */}
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
                <option value="">— pick to insert {`{column_name}`} token —</option>
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
                  height="160px"
                  extensions={[htmlLang()]}
                  onChange={handleTemplateChange}
                  editable={!sectionDisabled}
                  readOnly={sectionDisabled}
                  placeholder="— leave blank to render as a key-value table."
                />
              </div>
              {/* Inline syntax note (locked verbatim by 22-CONTEXT.md) */}
              <div className="info-popup-config-syntax-note">
                Use {`{column_name}`} to insert values.
              </div>
              {/* Inline security warning (locked verbatim by 22-CONTEXT.md) */}
              <div className="info-popup-config-security-note">
                HTML is rendered as-is — do not paste templates from untrusted sources.
              </div>
            </div>
    ```

    NOTE on `useMemo` import: the existing file already imports `useState` and other hooks; ADD `useMemo` to the existing `import { useCallback, useEffect, useRef, useState } from "react"` line at line 25 if not already present.

    Run `cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx` — expect 19/19 PASS (some CodeMirror-related test may be flaky in jsdom; if L8 hangs or fails on a CodeMirror DOM query that jsdom can't satisfy, see Task 1 fallback note).

    Run `cd kinetica_bi && npx tsc --noEmit` → expect exit 0.

    Commit message: `feat(22-03): implement INFO POPUP section in KineticaWmsLayerForm`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && npx vitest run src/components/charts/KineticaWmsLayerForm.spec.tsx && npx tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx` contains literal `"INFO POPUP"` (grep returns 1 match)
    - File contains `import CodeMirror from "@uiw/react-codemirror"` (grep returns 1 match)
    - File contains `import { html as htmlLang } from "@codemirror/lang-html"` (grep returns 1 match)
    - File contains `import ChipCombobox` (grep returns 1 match)
    - File contains literal string `"Use {column_name} to insert values."` OR JSX-rendered equivalent — verify by grep `"to insert values"` returns >= 1 match
    - File contains `"HTML is rendered as-is — do not paste templates from untrusted sources."` (grep returns 1 match)
    - File contains `"Bind a table to configure info popup"` (grep returns 1 match)
    - File contains `info_enabled:` (grep returns >= 1 match in handleToggleEnabled)
    - File contains `info_columns: null` (grep returns >= 2 matches — sentinel preservation in handleColumnsChange)
    - File contains `info_template: null` (grep returns >= 1 match — empty string → null compression in handleTemplateChange)
    - File contains `JSON.stringify(sortedNext)` OR equivalent JSON.stringify on next array (grep `JSON\.stringify` returns >= 1 match)
    - File contains `localeCompare` (grep returns >= 2 matches — once for sortedColumnOptions, once for sortedNext)
    - File contains `tableMissing` (grep returns >= 4 matches — prop, sectionDisabled deriv, message-render condition, classname conditional)
    - File contains the className `info-popup-config-section` (grep returns >= 1 match)
    - File DOES NOT contain `DOMPurify` or `sanitize` (grep both — must return 0; PROJECT.md no-sanitize lock)
    - vitest exits 0 with 19/19 tests passing
    - tsc --noEmit exits 0
    - Existing 7 tests in KineticaWmsLayerForm.spec.tsx still pass (no regressions)
  </acceptance_criteria>
  <done>INFO POPUP section renders at very bottom of form; ChipCombobox + CodeMirror integrated with locked sentinel semantics; sentinel preservation (null) and materialization (JSON-array string) both verified by L5/L6/L7; section disables when toggle off OR table missing; 19/19 tests green; tsc clean.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Wire LayersModal to route info_* patches via onPatch (auto-save plumbing)</name>
  <files>kinetica_bi/src/components/LayersModal.tsx</files>
  <read_first>
    - kinetica_bi/src/components/LayersModal.tsx (entire file — extension at the KineticaWmsLayerForm invocation site at lines 333-339)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx (final form from Task 2 — confirm new props names)
    - kinetica_bi/src/components/LayersModal.spec.tsx (READ ONLY — confirm pre-existing test fixture has info_enabled:1, info_columns:null, info_template:null defaults; tests must continue to pass without modification)
  </read_first>
  <action>
    Modify `kinetica_bi/src/components/LayersModal.tsx`:

    **At the KineticaWmsLayerForm invocation site** (lines 333-339), extend the JSX with the 4 new props:

    BEFORE:
    ```jsx
    <KineticaWmsLayerForm
      config={selectedLayer.config}
      columns={formColumns}
      onChange={(nextConfig) =>
        onPatch(selectedLayer.id, { config: nextConfig })
      }
    />
    ```

    AFTER:
    ```jsx
    <KineticaWmsLayerForm
      config={selectedLayer.config}
      columns={formColumns}
      onChange={(nextConfig) =>
        onPatch(selectedLayer.id, { config: nextConfig })
      }
      // v1.4 Phase 22 (CONFIG-V14-03): info_* are TOP-LEVEL DashboardLayerDto columns,
      // NOT nested config keys. Route them via the existing onPatch flow (300ms debounce
      // and updateLayer's Pick<> already accepts these per Phase 19).
      infoEnabled={selectedLayer.info_enabled}
      infoColumns={selectedLayer.info_columns}
      infoTemplate={selectedLayer.info_template}
      onChangeInfoConfig={(patch) => onPatch(selectedLayer.id, patch)}
      tableMissing={isTableMissing(selectedLayer)}
    />
    ```

    No new imports needed — `isTableMissing` already exists at line 142-143; `selectedLayer` already in scope; `onPatch` already a prop.

    Run `cd kinetica_bi && npx vitest run src/components/LayersModal.spec.tsx` — confirm existing tests still pass (they should: the new props are all optional and the spec fixtures already set info_enabled:1 / info_columns:null / info_template:null defaults per Phase 19's Verification report).

    Run `cd kinetica_bi && npx tsc --noEmit` → expect exit 0.

    Commit message: `feat(22-03): route info_* patches from LayersModal to onPatch as DashboardLayerDto attrs`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && grep -q "infoEnabled={selectedLayer.info_enabled}" src/components/LayersModal.tsx && grep -q "tableMissing={isTableMissing(selectedLayer)}" src/components/LayersModal.tsx && npx vitest run src/components/LayersModal.spec.tsx && npx tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/LayersModal.tsx` contains `infoEnabled={selectedLayer.info_enabled}` (grep returns 1 match)
    - File contains `infoColumns={selectedLayer.info_columns}` (grep returns 1 match)
    - File contains `infoTemplate={selectedLayer.info_template}` (grep returns 1 match)
    - File contains `onChangeInfoConfig={(patch) => onPatch(selectedLayer.id, patch)}` (grep returns 1 match)
    - File contains `tableMissing={isTableMissing(selectedLayer)}` (grep returns 1 match)
    - File still contains `onChange={(nextConfig) =>` (the existing config-blob route is preserved — grep returns 1 match)
    - Existing `isTableMissing` predicate at line ~142 NOT modified (`grep "isTableMissing = (layer: DashboardLayerDto)" src/components/LayersModal.tsx` returns 1 match — same line as before)
    - vitest passes for `LayersModal.spec.tsx` with no test changes
    - tsc --noEmit exits 0
  </acceptance_criteria>
  <done>LayersModal routes the new INFO POPUP patches through the existing 300ms-debounced onPatch flow as DashboardLayerDto top-level attrs (info_enabled, info_columns, info_template) — NOT nested into the config blob; tableMissing flag flows down to the form for the disabled-section render.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Cross-phase column sort fix in InfoPopup.tsx (KV-order parity with picker)</name>
  <files>kinetica_bi/src/components/charts/InfoPopup.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/InfoPopup.tsx (entire 177-line file — surgical edit at lines 122-128 area)
    - kinetica_bi/src/lib/renderInfoTemplate.ts (helper signature — order-preserving; sort happens at caller side)
    - .planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md (helper is pure; do NOT modify it)
    - .planning/phases/22-config-ui/22-CONTEXT.md § Column multi-picker UX § "Implication for Phase 21's renderInfoTemplate" (locks: caller pre-sorts so KV mode renders in same alphabetical order picker shows)
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx (READ ONLY — confirm KV-related tests use lexically-sorted columns OR adjust if they assume non-sorted; ensure no spec assumes the old non-sorted order)
  </read_first>
  <action>
    Modify `kinetica_bi/src/components/charts/InfoPopup.tsx`:

    **Around line 122** (inside the `entry.rows.map` callback), the current code passes `entry.columns` directly to `renderInfoTemplate`. Change this to pass the alphabetically-sorted columns array:

    BEFORE (lines 122-128):
    ```typescript
    {entry.rows.map((row, idx) => {
      const result = renderInfoTemplate({
        template: activeLayer.info_template,
        columns: entry.columns,
        row,
        infoColumns: activeLayer.info_columns,
      });
    ```

    AFTER:
    ```typescript
    {entry.rows.map((row, idx) => {
      // Phase 22 cross-phase lock: caller alphabetically sorts columns BEFORE passing
      // to renderInfoTemplate so KV-mode column order = ChipCombobox picker order
      // (locked at .planning/phases/22-config-ui/22-CONTEXT.md § Column multi-picker UX
      // "Implication for Phase 21's renderInfoTemplate"). renderInfoTemplate stays
      // order-preserving — the sort happens here so the helper remains pure.
      const sortedColumns = [...entry.columns].sort((a, b) => a.localeCompare(b));
      const result = renderInfoTemplate({
        template: activeLayer.info_template,
        columns: sortedColumns,
        row,
        infoColumns: activeLayer.info_columns,
      });
    ```

    Move the `sortedColumns` declaration outside the `.map` callback if profiling proves the sort is expensive — but for a ~10-50 column array it's cheap; keep it inline for clarity.

    **Performance note for the implementer:** Hoisting the sort once via `useMemo` outside the rows.map is technically correct and slightly better:
    ```typescript
    const sortedColumns = useMemo(
      () => entry ? [...entry.columns].sort((a, b) => a.localeCompare(b)) : [],
      [entry?.columns],
    );
    ```
    Implementer's choice — both satisfy the cross-phase lock. The acceptance criteria below check for the .sort( call AND the localeCompare; either inline or hoisted satisfies grep.

    Verify the existing InfoPopup.spec.tsx still passes — the spec tests use columns `["a", "b"]` or `["x", "y"]` which are already alphabetical; no test assumes non-sorted column order in KV mode (per Plan 21-02 SUMMARY locked behaviors). If a test fails because it asserts on a specific non-sorted column order, FIX THE TEST (the cross-phase lock prefers sorted columns). Likely zero test changes needed.

    Run `cd kinetica_bi && npx vitest run src/components/charts/InfoPopup.spec.tsx` → expect 20/20 pass.

    Run `cd kinetica_bi && npx tsc --noEmit` → expect exit 0.

    Commit message: `fix(22-03): sort columns alphabetically before renderInfoTemplate (KV-order parity with picker)`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && grep -q "\.sort((a, b) => a.localeCompare(b))" src/components/charts/InfoPopup.tsx && npx vitest run src/components/charts/InfoPopup.spec.tsx && npx tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/InfoPopup.tsx` contains `.sort((a, b) => a.localeCompare(b))` (grep returns 1 match)
    - File contains a comment citing `Phase 22` and `cross-phase lock` (grep `cross-phase` returns >= 1 match)
    - File still imports `renderInfoTemplate` from `../../lib/renderInfoTemplate` (grep returns 1 match — unchanged)
    - File DOES NOT modify `renderInfoTemplate` itself; helper file at `kinetica_bi/src/lib/renderInfoTemplate.ts` is byte-for-byte unchanged (`git diff --stat src/lib/renderInfoTemplate.ts` shows 0 lines changed in this commit)
    - InfoPopup.spec.tsx passes 20/20 (no regressions; if a test was adjusted, the modification is limited to test fixture column order)
    - tsc --noEmit exits 0
  </acceptance_criteria>
  <done>InfoPopup pre-sorts columns alphabetically before invoking renderInfoTemplate; renderInfoTemplate.ts stays untouched; KV-mode order in popup now matches the picker order in the LayersModal; cross-phase consistency lock from 22-CONTEXT.md satisfied.</done>
</task>

</tasks>

<verification>
After all 4 tasks:
1. `cd kinetica_bi && npx vitest run` (full suite) — 100% green; specifically:
   - `KineticaWmsLayerForm.spec.tsx` 19/19
   - `MapConfigPanel.spec.tsx` 18/18 (Plan 22-02; should already be green)
   - `LayersModal.spec.tsx` (existing tests, no regressions)
   - `InfoPopup.spec.tsx` 20/20
   - `ChipCombobox.spec.tsx` 10/10 (Plan 22-01; should already be green)
2. `cd kinetica_bi && npx tsc --noEmit` exits 0
3. `git status --short` shows exactly 4 files modified plus the SUMMARY: `KineticaWmsLayerForm.tsx`, `KineticaWmsLayerForm.spec.tsx`, `LayersModal.tsx`, `InfoPopup.tsx`
4. `grep "INFO POPUP" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 2 matches (one per surface)
5. `grep "DOMPurify\|sanitize" kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx kinetica_bi/src/components/charts/InfoPopup.tsx` returns 0 matches (PROJECT.md no-sanitize lock)
</verification>

<success_criteria>
- INFO POPUP section appears at the very bottom of KineticaWmsLayerForm.tsx (after RASTER/HEATMAP/CLASSBREAK/CONTOUR PARAMS conditional blocks)
- Toggle defaults to ON when info_enabled prop is 1; OFF when 0
- ChipCombobox shows ALL columns alphabetically; default-all-selected sentinel preserved (info_columns persists as null until first deselect)
- Re-selecting all chips compresses back to null sentinel (verified by L7)
- Insert-column dropdown inserts `{column_name}` token at end of editor value
- CodeMirror 6 HTML editor renders with @codemirror/lang-html highlighting; onChange routes to onChangeInfoConfig
- Syntax note "Use {column_name} to insert values." AND security warning "HTML is rendered as-is — do not paste templates from untrusted sources." both visible verbatim below editor
- Disabled state when info_enabled=0: chips + editor + insert-column picker disabled; toggle stays interactive (master switch)
- Missing-table state: section gets `disabled` class; message "Bind a table to configure info popup" rendered; toggle ALSO disabled (no table to configure against)
- LayersModal routes info_*  patches via existing onPatch flow as DashboardLayerDto top-level attrs (NOT nested into config)
- InfoPopup KV-mode columns sorted alphabetically before renderInfoTemplate call (cross-phase parity)
- 19/19 KineticaWmsLayerForm tests + 20/20 InfoPopup tests + existing LayersModal tests all pass
- tsc --noEmit clean
- NO sanitization library imported (PROJECT.md no-sanitize lock)
</success_criteria>

<output>
After completion, create `.planning/phases/22-config-ui/22-03-layer-config-SUMMARY.md` with:
- Commit hashes (RED + GREEN-form + LayersModal-wiring + InfoPopup-sort = 4 commits)
- Test counts (19/19 KineticaWmsLayerForm, 20/20 InfoPopup unchanged)
- Locked sentinel semantics: null preservation on default + materialize on first deselect + compression on re-select-all (3 paths)
- Cross-phase fix: InfoPopup pre-sort (renderInfoTemplate.ts unchanged)
- Phase 22 closure: CONFIG-V14-03 satisfied; both extension targets (KineticaWmsLayerForm + MapConfigPanel from Plan 22-02) carry INFO POPUP sections; ROADMAP/REQUIREMENTS update belongs to phase-close (handled by /gsd:execute-phase)
- Next-phase readiness: Phase 23 (Info Card) will read same per-layer info_columns / info_template; the sort logic established here in InfoPopup will need to be replicated in the Info Card renderer (or hoisted into a shared helper if needed)
</output>

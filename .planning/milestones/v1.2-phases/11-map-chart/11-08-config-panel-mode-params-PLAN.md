---
phase: 11-map-chart
plan: 08
type: execute
wave: 4
depends_on:
  - 11-07
files_modified:
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
  - kinetica_bi/src/lib/cardinalityProbe.ts
  - kinetica_bi/src/lib/cardinalityProbe.spec.ts
autonomous: true
requirements:
  - MAP-01
  - MAP-04
must_haves:
  truths:
    - "When renderMode=raster, MapConfigPanel renders RASTER PARAMS group with Point color, Point size, Point opacity controls"
    - "When renderMode=heatmap, MapConfigPanel renders HEATMAP PARAMS group with Colormap (filtered by capabilities.colormaps), Blur radius (Kinetica map units), Min/Max level"
    - "When renderMode=classbreak, MapConfigPanel renders CLASSBREAK PARAMS group with Break column, cardinality probe + warn/cap states, Break type radio, N-row builder, + Add break, × Remove break"
    - "When renderMode=contour, MapConfigPanel renders CONTOUR PARAMS group with Contour color, Smooth toggle, Bandwidth (Kinetica map units)"
    - "Switching renderMode swaps the visible param group only — does NOT clear other modes' configured params"
    - "Cardinality probe fires on cbColumn pick; result session-cached per ${tableId}:${cbColumn}; >100 → warn hint + toast; >256 → hard-cap hint + Add break disabled"
    - "Apply button is disabled when classbreak mode + classbreaks.length < 2 (with tooltip 'Add at least 2 break rows')"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "Mode-specific param groups appended at the PLACEHOLDER from 11-07 + classbreak builder + cardinality probe wiring"
      min_lines: 400
    - path: "kinetica_bi/src/lib/cardinalityProbe.ts"
      provides: "probeCardinality(tableRef, column, signal): Promise<number> + session cache"
      exports:
        - "probeCardinality"
        - "__resetCardinalityCacheForTest"
  key_links:
    - from: "MapConfigPanel.tsx classbreak builder"
      to: "src/lib/cardinalityProbe.ts"
      via: "named import; called on cbColumn change"
      pattern: "probeCardinality"
    - from: "MapConfigPanel.tsx heatmap colormap select"
      to: "useWmsCapabilitiesStore (capabilities.colormaps)"
      via: "selector — intersects with 8-entry catalog"
      pattern: "capabilities\\?\\.colormaps|colormaps"
---

<objective>
Append the four render-mode-specific param groups (raster, heatmap, classbreak, contour) to `MapConfigPanel.tsx` from 11-07, plus the classbreak N-row builder and the cardinality probe that gates the >256 hard-cap. This is the FINAL config-panel feature plan for Phase 11.

Splits from 11-07 because the shell (~200 LOC) + four param groups + classbreak builder + cardinality probe (~250 additional LOC) would exceed 50% context as one plan. With 11-07's shell shipped, this plan can ATOMICALLY add the four groups against a stable foundation.

Purpose: Deliver the rest of MAP-01 (full render-mode UX) + MAP-04 (point-size slider for raster). M-05 lock requires "Kinetica map units" labels on BLUR_RADIUS and CONTOUR_BANDWIDTH; M-06 lock requires the cardinality cap workflow; UI-SPEC.md locks every label string.

Output: The complete `MapConfigPanel.tsx` ready for end-to-end QA in 11-09.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/11-map-chart/11-CONTEXT.md
@.planning/phases/11-map-chart/11-RESEARCH.md
@.planning/phases/11-map-chart/11-UI-SPEC.md
@kinetica_bi/src/components/charts/MapConfigPanel.tsx
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/store/wmsCapabilities.ts
@kinetica_bi/src/store/toast.ts

<interfaces>
<!-- runSql signature (Phase 9 09-02) — used by cardinality probe -->
```typescript
export async function runSql<T>(sql: string, options?: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
```

<!-- toast store -->
```typescript
import { useToastStore } from "../store/toast";
useToastStore.getState().showToast(message, kind);
// kind: "success" | "error" | "info" | "permission" — confirm exact kinds in toast.ts
```

<!-- UI-SPEC.md "Microcopy / Labels" — exact strings (verbatim): -->
<!-- RASTER PARAMS section heading: "RASTER PARAMS" -->
<!-- Raster: POINTCOLOR: "Point color" -->
<!-- Raster: POINTSIZE: "Point size" -->
<!-- Raster: POINTOPACITY: "Point opacity" -->
<!-- HEATMAP PARAMS section heading: "HEATMAP PARAMS" -->
<!-- Heatmap: COLORMAP: "Colormap" -->
<!-- Heatmap: BLUR_RADIUS: "Blur radius (Kinetica map units)" — M-05 lock -->
<!-- Heatmap: MIN_LEVEL: "Min level" -->
<!-- Heatmap: MAX_LEVEL: "Max level" -->
<!-- CLASSBREAK PARAMS section heading: "CLASSBREAK PARAMS" -->
<!-- Classbreak: cbColumn: "Break column" -->
<!-- Classbreak: cbBreakType: "Break type" with radio options "Numerical" / "Categorical" -->
<!-- Classbreak: row label: "Break {n}" -->
<!-- Classbreak: per-row value input: "Value" -->
<!-- Classbreak: per-row color picker: "Color" -->
<!-- Classbreak: probe in flight: "Counting distinct values…" -->
<!-- Classbreak: warn copy (>100): "That's a lot of breakpoints" + "Consider switching to heatmap or a numerical range — categorical mode performs better with fewer than 100 distinct values." -->
<!-- Classbreak: hard-cap copy (>256): "Too many distinct values" + "Kinetica's classbreak mode supports up to 256 categories. Pick a column with fewer distinct values, or switch to a different render mode." -->
<!-- Classbreak: + Add break button -->
<!-- Classbreak: × Remove break {n} aria-label -->
<!-- Classbreak: Apply-disabled tooltip: "Add at least 2 break rows" -->
<!-- CONTOUR PARAMS section heading: "CONTOUR PARAMS" -->
<!-- Contour: CONTOUR_COLOR: "Contour color" -->
<!-- Contour: CONTOUR_SMOOTH: "Smooth contours" -->
<!-- Contour: CONTOUR_BANDWIDTH: "Bandwidth (Kinetica map units)" — M-05 lock -->

<!-- 8-entry colormap catalog (intersect with capabilities.colormaps) -->
<!-- ["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"] -->

<!-- Classbreak break shape (from wmsUrlBuilder.ts) -->
```typescript
type ClassbreakBreak = { value: string | number; color: string };
```

<!-- Apply button gating: ChartConfigPanel renders Apply/Cancel; this panel needs a way to signal
     "Apply should be disabled". CONTEXT.md "Decisions § Classbreak builder" says "Min 2 break rows
     enforced before save (Apply button disabled with tooltip)". The CustomConfigPanelProps shape
     may already include a setIsValid callback; if not, the panel must render an inline disabled
     message instead. Read ChartConfigPanel.tsx + registry.ts to confirm the available API.
     If no setIsValid exists, this plan adds one: extend CustomConfigPanelProps with
     isValid?: (valid: boolean) => void; ChartConfigPanel disables Apply if any panel called it
     with false. -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: TDD — cardinalityProbe helper + spec</name>
  <files>kinetica_bi/src/lib/cardinalityProbe.ts, kinetica_bi/src/lib/cardinalityProbe.spec.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (runSql with AbortSignal — Phase 9 09-02 contract; existing typed-error handling)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Classbreak full N-row builder" — cardinality probe behavior, session cache per ${tableId}:${cbColumn})
    - .planning/phases/11-map-chart/11-RESEARCH.md (M-06 lock — exact behavior at >100, >256)
    - kinetica_bi/src/store/filterStore.ts (escapeKineticaStringLiteral if column names need escaping — they DON'T per AP-3, identifiers are not user data, but document this)
  </read_first>
  <behavior>
    `probeCardinality(tableRef: string, column: string, signal?: AbortSignal): Promise<number>`:
    - Cache key = `${tableRef}:${column}`; module-scoped Map<string, number>
    - First call: runs `SELECT COUNT(DISTINCT ${column}) AS n FROM ${tableRef}` via runSql; parses and returns the count; caches
    - Subsequent calls with same key: returns cached value
    - On AbortError or runSql error: clears cache entry (so retry can happen) and re-throws
    - Column name is NOT user-input (it's already validated as an existing column name from the schema); SQL uses direct interpolation. Inline-comment: `// AP-3 NOTE: column is a schema-validated identifier, not user data; safe to interpolate. Do NOT use this pattern for user values — those go through escapeKineticaStringLiteral.`

    Tests (≥ 6):
    - `probeCardinality runs the right SQL` — assert runSql called with `SELECT COUNT(DISTINCT col) AS n FROM table`
    - `probeCardinality returns the parsed count`
    - `cache hit: second call with same (tableRef, column) does not invoke runSql`
    - `cache miss: different column triggers a second runSql call`
    - `aborted call: cache entry cleared so retry can re-fetch`
    - `passes signal through to runSql`
  </behavior>
  <action>
    Step 1 — write spec at `kinetica_bi/src/lib/cardinalityProbe.spec.ts` with the ≥6 cases. Use `vi.mock("../api/client", () => ({ runSql: vi.fn() }))`.

    Step 2 — vitest → RED.

    Step 3 — write `kinetica_bi/src/lib/cardinalityProbe.ts`:

    ```typescript
    // Phase 11: Classbreak column cardinality probe (M-06)
    // CONTEXT.md "Decisions § Classbreak" — session-cached per ${tableId}:${cbColumn}

    import { runSql } from "../api/client";

    const cache = new Map<string, number>();

    export function __resetCardinalityCacheForTest(): void {
      cache.clear();
    }

    type CardinalityResult = { data: { n?: number[] } } | { n?: number } | Record<string, unknown>;

    export async function probeCardinality(
      tableRef: string,
      column: string,
      signal?: AbortSignal
    ): Promise<number> {
      const cacheKey = `${tableRef}:${column}`;
      const cached = cache.get(cacheKey);
      if (cached !== undefined) return cached;

      // AP-3 NOTE: column is a schema-validated identifier, not user data; safe to interpolate.
      // Do NOT use this pattern for user values — those go through escapeKineticaStringLiteral.
      const sql = `SELECT COUNT(DISTINCT ${column}) AS n FROM ${tableRef}`;

      try {
        const result = await runSql<CardinalityResult>(sql, undefined, signal);
        // Defensive parse: Kinetica columnar shape OR row-major shape
        const r: any = result;
        const count = Number(r?.data?.n?.[0] ?? r?.n ?? r?.data?.[0]?.n);
        if (!Number.isFinite(count) || count < 0) {
          throw new Error(`probeCardinality: unparseable count from ${tableRef}.${column}`);
        }
        cache.set(cacheKey, count);
        return count;
      } catch (err) {
        // Clear cache so retry can re-fetch (do NOT cache failures)
        cache.delete(cacheKey);
        throw err;
      }
    }
    ```

    Step 4 — vitest → GREEN.

    Commit: `feat(11-08): cardinalityProbe with session cache`.
  </action>
  <acceptance_criteria>
    - File exists; exports `probeCardinality` and `__resetCardinalityCacheForTest`
    - ≥ 6 `it(` cases in spec
    - `cd kinetica_bi && npx vitest run src/lib/cardinalityProbe.spec.ts` exits 0
    - `grep "AP-3 NOTE" kinetica_bi/src/lib/cardinalityProbe.ts` returns 1 (anti-injection comment present)
    - `grep "COUNT(DISTINCT" kinetica_bi/src/lib/cardinalityProbe.ts` returns 1
    - `grep "cache.delete\|cache\\.clear" kinetica_bi/src/lib/cardinalityProbe.ts` returns ≥ 1 (failure path clears cache)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/cardinalityProbe.spec.ts</automated>
  </verify>
  <done>cardinalityProbe shipped + tested; the M-06 lock workflow has its data source.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: TDD — append spec cases for mode-specific param groups + classbreak builder</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (existing 11-07 spec — APPEND new describe blocks; do NOT modify existing tests)
    - .planning/phases/11-map-chart/11-UI-SPEC.md (every label and copy string for the four mode groups + classbreak builder)
    - .planning/phases/11-map-chart/11-CONTEXT.md ("Decisions § Render-mode config UX" — defaults, behaviors, classbreak workflow)
    - kinetica_bi/src/lib/cardinalityProbe.ts (Task 1 helper — mocked in these tests)
  </read_first>
  <behavior>
    Append new `describe` blocks (≥ 16 new tests):

    `describe("MapConfigPanel — RASTER PARAMS")`:
    - `renders only when draft.renderMode === "raster"`
    - `Point color label + color input present`
    - `Point size label + range input present (min=2, max=20)`
    - `Point opacity label + range input present (min=0, max=100)`

    `describe("MapConfigPanel — HEATMAP PARAMS")`:
    - `renders only when draft.renderMode === "heatmap"`
    - `Colormap dropdown lists intersection of 8-entry catalog and capabilities.colormaps`
    - `Blur radius label includes "(Kinetica map units)"` (M-05 lock)
    - `Min level + Max level inputs render`

    `describe("MapConfigPanel — CLASSBREAK PARAMS")`:
    - `renders only when draft.renderMode === "classbreak"`
    - `Break column dropdown filtered to numeric + low-cardinality string types`
    - `Break type radio shows "Numerical" / "Categorical"`
    - `picking a cbColumn fires probeCardinality` (mock returns 50 → no warn)
    - `cardinality > 100 triggers warn hint with locked copy "That's a lot of breakpoints"`
    - `cardinality > 100 fires informational toast "That's a lot of breakpoints — consider a heatmap or numerical range instead."`
    - `cardinality > 256 triggers hard-cap hint "Too many distinct values" + disables + Add break button`
    - `+ Add break button appends a new row to draft.classbreaks`
    - `× Remove break button removes that row from draft.classbreaks`
    - `with classbreaks.length < 2 and renderMode === "classbreak", isValid is called with false (or inline disabled message renders)`

    `describe("MapConfigPanel — CONTOUR PARAMS")`:
    - `renders only when draft.renderMode === "contour"`
    - `Contour color, Smooth contours toggle, "Bandwidth (Kinetica map units)" label all present`

    Run vitest → only the NEW tests fail (RED for new tests; existing 11-07 tests still pass).

    Commit: `test(11-08): add failing spec for mode-specific param groups`.
  </action>
  <action>
    Same as `<behavior>` instructions above — write the spec extensions, run vitest, confirm RED for new tests + GREEN for prior tests, commit.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` contains ≥ 16 NEW `it(` cases beyond what 11-07 shipped
    - File contains every locked copy string verbatim (test count for `grep` matches):
      - `grep -c "RASTER PARAMS\|HEATMAP PARAMS\|CLASSBREAK PARAMS\|CONTOUR PARAMS" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns ≥ 4
      - `grep -c "Blur radius (Kinetica map units)\|Bandwidth (Kinetica map units)" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns ≥ 2 (M-05 unit-label lock asserted)
      - `grep "That's a lot of breakpoints" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns ≥ 1
      - `grep "Too many distinct values" kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns ≥ 1
    - `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits NON-ZERO (new tests RED; existing tests still GREEN)
    - The 11-07 tests still appear and still pass when run in isolation (regression-free)
    - Commit message starts with `test(11-08):`
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx; test $? -ne 0 && echo "RED phase confirmed for new tests"</automated>
  </verify>
  <done>≥16 new failing tests committed against the existing GREEN 11-07 baseline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: GREEN — implement mode-specific param groups + classbreak builder + Apply gating</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.tsx, kinetica_bi/src/components/charts/registry.ts</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (existing 11-07 shell — APPEND at the PLACEHOLDER comment; do NOT modify existing pickers)
    - kinetica_bi/src/components/charts/registry.ts (CustomConfigPanelProps — confirm if isValid?: (valid: boolean) => void exists; if not, this plan adds it)
    - kinetica_bi/src/components/charts/ChartConfigPanel.tsx (Apply button — confirm how it could honor an isValid signal from a CustomConfigPanel; current state uses local validation — extend)
    - kinetica_bi/src/lib/cardinalityProbe.ts (Task 1 helper)
    - kinetica_bi/src/store/wmsCapabilities.ts (capabilities.colormaps)
    - kinetica_bi/src/store/toast.ts (showToast signature; confirm available kinds)
    - kinetica_bi/src/lib/columnTypes.ts (NUMERIC_TYPES + STRING_TYPES — for classbreak column filtering)
    - .planning/phases/11-map-chart/11-UI-SPEC.md (every label + copy string + classbreak row layout)
  </read_first>
  <action>
    Step 1 — Optionally extend `CustomConfigPanelProps` in `registry.ts`:
    ```typescript
    export type CustomConfigPanelProps = {
      // ... existing
      isValid?: (valid: boolean) => void; // Phase 11: panels can signal Apply-disable
    };
    ```
    AND modify `ChartConfigPanel.tsx` to track a `customPanelValid: boolean` state, pass `setCustomPanelValid` as `isValid` prop, and disable Apply when `customPanelValid === false`. This is a small targeted change; if the existing codebase's Apply gating uses different infrastructure (e.g. an inline error message pattern), use that pattern instead. DOCUMENT the choice in plan summary.

    Step 2 — In `MapConfigPanel.tsx`, REPLACE the `{/* PLACEHOLDER: 11-08 inserts ... */}` comment with FOUR conditional groups:

    ```tsx
    {(draft.renderMode as RenderMode) === "raster" && (
      <div className="config-group" role="group" aria-labelledby="map-raster-params-label">
        <label id="map-raster-params-label" className="config-group-label">RASTER PARAMS</label>
        <label className="config-color-field">
          Point color
          <div className="config-color-row">
            <input
              type="color"
              className="config-color-picker"
              value={`#${(draft.pointColor as string) || "FF3838"}`}
              onChange={(e) => setDraft({ ...draft, pointColor: e.target.value.replace("#", "").toUpperCase() })}
            />
            <input
              type="text"
              className="config-color-text"
              value={(draft.pointColor as string) || "FF3838"}
              onChange={(e) => setDraft({ ...draft, pointColor: e.target.value.toUpperCase() })}
            />
          </div>
        </label>
        <label className="config-range-field">
          Point size
          <input
            type="range" className="config-range" min={2} max={20} step={1}
            value={(draft.pointSize as number) ?? 4}
            onChange={(e) => setDraft({ ...draft, pointSize: Number(e.target.value) })}
          />
          <span className="config-range-value">{(draft.pointSize as number) ?? 4}</span>
        </label>
        <label className="config-range-field">
          Point opacity
          <input
            type="range" className="config-range" min={0} max={100} step={1}
            value={(draft.pointOpacity as number) ?? 100}
            onChange={(e) => setDraft({ ...draft, pointOpacity: Number(e.target.value) })}
          />
          <span className="config-range-value">{(draft.pointOpacity as number) ?? 100}%</span>
        </label>
      </div>
    )}

    {(draft.renderMode as RenderMode) === "heatmap" && (
      <div className="config-group" role="group" aria-labelledby="map-heatmap-params-label">
        <label id="map-heatmap-params-label" className="config-group-label">HEATMAP PARAMS</label>
        <label className="ds-field-label">
          Colormap
          <select
            className="ds-select"
            value={(draft.colormap as string) || "viridis"}
            onChange={(e) => setDraft({ ...draft, colormap: e.target.value })}
          >
            {(() => {
              const catalog = ["viridis", "plasma", "inferno", "magma", "cividis", "turbo", "jet", "hot"];
              const supported = capabilities?.colormaps;
              const list = supported && supported.length > 0
                ? catalog.filter((c) => supported.includes(c))
                : catalog;
              return list.map((c) => <option key={c} value={c}>{c}</option>);
            })()}
          </select>
        </label>
        <label className="config-range-field">
          Blur radius (Kinetica map units)
          <input
            type="range" className="config-range" min={0.1} max={50} step={0.1}
            value={(draft.blurRadius as number) ?? 5}
            onChange={(e) => setDraft({ ...draft, blurRadius: Number(e.target.value) })}
          />
          <span className="config-range-value">{(draft.blurRadius as number) ?? 5}</span>
        </label>
        <label className="ds-field-label">
          Min level
          <input
            type="number"
            value={(draft.minLevel as number | undefined) ?? ""}
            onChange={(e) => setDraft({ ...draft, minLevel: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label className="ds-field-label">
          Max level
          <input
            type="number"
            value={(draft.maxLevel as number | undefined) ?? ""}
            onChange={(e) => setDraft({ ...draft, maxLevel: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
      </div>
    )}

    {(draft.renderMode as RenderMode) === "classbreak" && (
      <ClassbreakParamsGroup
        draft={draft}
        setDraft={setDraft}
        columns={columns}
        tableRef={props.tableRef}
        isValid={props.isValid}
      />
    )}

    {(draft.renderMode as RenderMode) === "contour" && (
      <div className="config-group" role="group" aria-labelledby="map-contour-params-label">
        <label id="map-contour-params-label" className="config-group-label">CONTOUR PARAMS</label>
        <label className="config-color-field">
          Contour color
          <div className="config-color-row">
            <input
              type="color" className="config-color-picker"
              value={`#${(draft.contourColor as string) || "FF0000"}`}
              onChange={(e) => setDraft({ ...draft, contourColor: e.target.value.replace("#", "").toUpperCase() })}
            />
            <input
              type="text" className="config-color-text"
              value={(draft.contourColor as string) || "FF0000"}
              onChange={(e) => setDraft({ ...draft, contourColor: e.target.value.toUpperCase() })}
            />
          </div>
        </label>
        <label className="config-toggle">
          Smooth contours
          <input
            type="checkbox"
            checked={(draft.contourSmooth as boolean) ?? true}
            onChange={(e) => setDraft({ ...draft, contourSmooth: e.target.checked })}
          />
        </label>
        <label className="config-range-field">
          Bandwidth (Kinetica map units)
          <input
            type="range" className="config-range" min={0.1} max={100} step={0.1}
            value={(draft.contourBandwidth as number) ?? 10}
            onChange={(e) => setDraft({ ...draft, contourBandwidth: Number(e.target.value) })}
          />
          <span className="config-range-value">{(draft.contourBandwidth as number) ?? 10}</span>
        </label>
      </div>
    )}
    ```

    Step 3 — Implement the `ClassbreakParamsGroup` sub-component (defined above MapConfigPanel in the same file or in a sibling file; planner discretion). Behavior:

    - Filtered Break column dropdown (numeric or low-cardinality string types from columns, using `NUMERIC_TYPES` + `STRING_TYPES` from columnTypes.ts)
    - On cbColumn change: reset cardinality state to "loading"; call `probeCardinality(tableRef, cbColumn, signal)` via an `AbortController` ref; set `cardinality` state on resolve; on error set "error" state
    - State machine for cardinality:
      - null (no column picked)
      - { state: "loading" } → render hint "Counting distinct values…"
      - { state: "ok", count: number } → if count > 256 → render hard-cap hint + disable Add; if count > 100 → render warn hint + fire toast (once per probe); else no hint
      - { state: "error" } → render error hint
    - Break type radio: "Numerical" → cbBreakType="numerical"; "Categorical" → cbBreakType="categorical"
    - Classbreak rows mapper:
      ```tsx
      <div className="config-classbreak-rows">
        {(draft.classbreaks as ClassbreakBreak[] || []).map((b, i) => (
          <div key={i} className="config-classbreak-row">
            <span className="config-classbreak-row-label">Break {i + 1}</span>
            <input
              type="text" placeholder="Value"
              value={String(b.value)}
              onChange={(e) => updateBreak(i, { value: e.target.value })}
            />
            <input
              type="color"
              value={`#${b.color}`}
              onChange={(e) => updateBreak(i, { color: e.target.value.replace("#", "").toUpperCase() })}
            />
            <button
              type="button" className="ghost-sm ghost-danger"
              aria-label={`Remove break ${i + 1}`}
              onClick={() => removeBreak(i)}
            >×</button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="config-classbreak-add ghost-sm"
        disabled={cardinality?.state === "ok" && cardinality.count > 256}
        onClick={addBreak}
      >+ Add break</button>
      ```
    - Toast firing: use a `useRef<boolean>(false)` to ensure each probe-resolve fires the toast at most once (per cbColumn change cycle).

    - isValid signaling:
      ```tsx
      useEffect(() => {
        if (props.isValid) {
          const valid = (draft.classbreaks as ClassbreakBreak[] || []).length >= 2;
          props.isValid(valid);
        }
      }, [draft.classbreaks?.length]);
      ```

    Step 4 — Run `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → all (existing 11-07 + new 11-08) PASS.

    Step 5 — Run `cd kinetica_bi && npx vitest run` → full suite green.

    Commit: `feat(11-08): mode-specific param groups + classbreak builder + cardinality probe wiring`.
  </action>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapConfigPanel.tsx` ≥ 400 lines (was ≥200 from 11-07)
    - `grep -c "RASTER PARAMS\|HEATMAP PARAMS\|CLASSBREAK PARAMS\|CONTOUR PARAMS" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 4
    - `grep -c "Blur radius (Kinetica map units)\|Bandwidth (Kinetica map units)" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 2 (M-05 lock)
    - `grep "probeCardinality" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 1
    - `grep "Counting distinct values" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 1
    - `grep "That's a lot of breakpoints" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 1
    - `grep "Too many distinct values" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 1
    - `grep "+ Add break" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns ≥ 1
    - `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` exits 0 (all ≥28 cumulative tests pass)
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx && npx vitest run</automated>
  </verify>
  <done>All four render-mode param groups working in MapConfigPanel; classbreak builder + cardinality probe wired; M-05 unit labels and M-06 cardinality cap workflow honored; UI-SPEC.md copy verbatim throughout.</done>
</task>

</tasks>

<verification>
- cardinalityProbe with session cache + AP-3 NOTE comment.
- MapConfigPanel.tsx grew to include 4 conditional render-mode groups + classbreak builder.
- M-05 lock: every BLUR/BANDWIDTH label includes "(Kinetica map units)".
- M-06 lock: cardinality probe + warn at >100 + hard-cap at >256 + Add break disabled at hard-cap.
- Apply-disable signaling via isValid (or inline) when classbreak mode + < 2 break rows.
- All UI-SPEC.md copy strings appear verbatim in the source file.
- Full vitest suite green.
</verification>

<success_criteria>
- A user can configure all four render modes end-to-end through the UI.
- Classbreak workflow gracefully prevents users from picking high-cardinality columns.
- Heatmap colormap dropdown shows only colormaps the deployed Kinetica supports (intersected with the 8-entry catalog).
- 11-09 (integration checkpoint) can manually QA the full configure → render → filter cycle.
</success_criteria>

<output>
After completion, create `.planning/phases/11-map-chart/11-08-SUMMARY.md` summarizing:
- Final LOC of MapConfigPanel.tsx
- Whether ChartConfigPanel/CustomConfigPanelProps was extended with isValid (and how Apply-disable is wired) — or whether an inline-disabled-message pattern was used instead
- Total tests in MapConfigPanel.spec.tsx (11-07 + 11-08 cumulative)
- Confirmation that every UI-SPEC.md copy string appears verbatim
- Any default value tweaks (e.g. blurRadius default 5 may need adjustment after manual QA in 11-09)
</output>

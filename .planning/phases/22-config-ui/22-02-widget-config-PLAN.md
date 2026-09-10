---
phase: 22-config-ui
plan: "02"
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/components/charts/MapConfigPanel.tsx
  - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx
autonomous: true
requirements:
  - CONFIG-V14-04

must_haves:
  truths:
    - "Map widget config panel shows an INFO POPUP section at the very bottom (after LAYERS)"
    - "User toggling 'Enable info popup' fires onChange with config.infoEnabled set to the new boolean"
    - "User typing 999 into the radius input and blurring snaps the value to 200, fires onChange with infoRadiusPx=200, and shows inline error 'Must be 1–200' for ~3s"
    - "User typing 0 or -5 into the radius input and blurring snaps to 1, fires onChange with infoRadiusPx=1, shows inline error"
    - "User typing 50.7 into the radius input and blurring snaps to 51 (round-int), fires onChange with infoRadiusPx=51, shows inline error"
    - "When infoEnabled=false, the radius input renders disabled (HTML disabled attribute set + aria-disabled='true')"
    - "When infoEnabled is undefined in stored config, the toggle reads as ON (defaultInfoEnabled=true via getInfoEnabled helper)"
    - "When infoRadiusPx is undefined in stored config, the radius input shows '20' (defaultInfoRadiusPx=20 via getInfoRadiusPx helper)"
    - "INFO POPUP section has section-header label 'INFO POPUP' (uppercase string, exact match)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      provides: "INFO POPUP section at bottom of return JSX with toggle + radius input + clamp-on-blur logic"
      contains: "INFO POPUP"
    - path: "kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx"
      provides: "8 new tests covering INFO POPUP render, toggle propagation, clamp-on-blur cases (4), disabled state, default-fallback rendering"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapConfigPanel.tsx"
      to: "kinetica_bi/src/lib/mapInfoConfig.ts"
      via: "import { getInfoEnabled, getInfoRadiusPx } — UI reads defaults via these helpers"
      pattern: "from.*mapInfoConfig"
    - from: "MapConfigPanel.tsx INFO POPUP section"
      to: "onChange callback"
      via: "config.infoEnabled / config.infoRadiusPx fields written into next config object"
      pattern: "infoEnabled|infoRadiusPx"
---

<objective>
Add an INFO POPUP section at the bottom of `MapConfigPanel.tsx` containing a per-widget enable/disable toggle and a numeric `infoRadiusPx` input with clamp-on-blur (1-200, integer) + inline error feedback. Extend `MapConfigPanel.spec.tsx` in place with 8 new tests covering render order, toggle propagation, all clamp paths, disabled state, and default-fallback rendering.

Purpose: CONFIG-V14-04 — dashboard authors can toggle map-widget info popup and tune click radius without leaving the widget config panel. Persists via the existing `onChange(config)` flow (already debounced upstream).

Output:
- MapConfigPanel.tsx with new INFO POPUP `<div className="config-group">` block at the very bottom
- MapConfigPanel.spec.tsx extended in place (NOT a new spec file) with 8 new `it()` blocks
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

# Direct upstream — Phase 19 type + helper contracts
@kinetica_bi/src/lib/mapInfoConfig.ts
@kinetica_bi/src/lib/wmsUrlBuilder.ts

# Extension target — existing component (mirror config-group pattern at lines 56-118)
@kinetica_bi/src/components/charts/MapConfigPanel.tsx

# Extension target — existing spec (mirror render+fireEvent idioms; NOT a new spec file)
@kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx

<interfaces>
<!-- Phase 19 helpers — read defaults via these (do NOT duplicate the literals 'true' / '20') -->

```typescript
// kinetica_bi/src/lib/mapInfoConfig.ts (already shipped)
export const DEFAULT_INFO_ENABLED = true;
export const DEFAULT_INFO_RADIUS_PX = 20;
export function getInfoEnabled(config: Pick<MapWidgetConfig, "infoEnabled">): boolean;
export function getInfoRadiusPx(config: Pick<MapWidgetConfig, "infoRadiusPx">): number;
```

```typescript
// kinetica_bi/src/lib/wmsUrlBuilder.ts (already shipped — DO NOT modify)
export type MapWidgetConfig = {
  // ... pre-Phase 19 fields ...
  infoEnabled?: boolean;     // v1.4 Phase 19 (CONFIG-V14-02)
  infoRadiusPx?: number;     // v1.4 Phase 19 (CONFIG-V14-02)
};
```

```typescript
// kinetica_bi/src/components/charts/registry.ts — config panel prop shape
export type ConfigPanelProps = {
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
};
```

NOTE on prop typing: MapConfigPanel.tsx receives `config: Record<string, unknown>` (NOT `MapWidgetConfig` directly). When reading `infoEnabled` / `infoRadiusPx`, the executor MUST cast through `MapWidgetConfig` for the helper calls:
`getInfoEnabled({ infoEnabled: config.infoEnabled as boolean | undefined })`. The helper `Pick<>` types accept this shape.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend MapConfigPanel.spec.tsx with INFO POPUP section tests (RED)</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (entire file — extending in place; preserve existing 8 tests)
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (entire file — confirm current section order: TITLE → BASEMAP → LAYERS)
    - .planning/phases/22-config-ui/22-CONTEXT.md § Validation + save flow § "Radius numeric input: clamp on blur + inline error" (locked clamp rules)
    - kinetica_bi/src/lib/mapInfoConfig.ts (default values DEFAULT_INFO_ENABLED=true, DEFAULT_INFO_RADIUS_PX=20)
  </read_first>
  <behavior>
    Add 8 new tests inside the existing `describe("MapConfigPanel — Phase 12 shrunk surface", () => {})` block (or a new sibling describe `describe("MapConfigPanel — Phase 22 INFO POPUP section", ...)`). Test names + assertions:

    - **W1 (render-order):** "renders INFO POPUP section header at bottom (after LAYERS section)" — assert `screen.getByText("INFO POPUP")` present; assert in DOM the `INFO POPUP` heading appears AFTER the `LAYERS` heading (use `compareDocumentPosition` or `Array.from(document.querySelectorAll(".config-group-label")).map(e => e.textContent)` includes `["TITLE", "BASEMAP", "LAYERS", "INFO POPUP"]` in order).
    - **W2 (default-toggle-on):** "with no infoEnabled in config, the Enable info popup checkbox is checked (default true via getInfoEnabled)" — render `config={makeConfig()}` (no infoEnabled key); `screen.getByLabelText("Enable info popup")` is `.checked === true`.
    - **W3 (toggle-propagation):** "clicking Enable info popup toggle when ON fires onChange with infoEnabled=false" — render with `config={makeConfig({ infoEnabled: true })}`; click `screen.getByLabelText("Enable info popup")`; assert `onChange` called with object containing `{ infoEnabled: false }`.
    - **W4 (default-radius-20):** "with no infoRadiusPx in config, the radius input shows value '20'" — render `config={makeConfig()}`; `screen.getByLabelText("Click radius (px)")` (or aria-label) has `.value === "20"`.
    - **W5 (clamp-high):** "typing 999 into radius input and firing blur snaps to 200, fires onChange with infoRadiusPx=200, shows inline error 'Must be 1–200'" — `fireEvent.change(input, { target: { value: "999" }})`, then `fireEvent.blur(input)`; assert `onChange` called with `{ infoRadiusPx: 200 }` and `screen.getByText("Must be 1–200")` present.
    - **W6 (clamp-low):** "typing 0 into radius input and blurring snaps to 1, fires onChange with infoRadiusPx=1" — same pattern, value="0", expect `{ infoRadiusPx: 1 }`.
    - **W7 (clamp-negative):** "typing -5 into radius input and blurring snaps to 1, fires onChange with infoRadiusPx=1" — value="-5", expect `{ infoRadiusPx: 1 }`.
    - **W8 (clamp-noninteger):** "typing 50.7 into radius input and blurring snaps to 51 (round-int), fires onChange with infoRadiusPx=51" — value="50.7", expect `{ infoRadiusPx: 51 }`.
    - **W9 (no-clamp-during-typing):** "typing 999 into radius input does NOT call onChange (clamp-on-blur lock)" — `fireEvent.change(input, { target: { value: "999" }})`; assert `onChange` NOT called (ZERO calls). Then blurring fires it (covered in W5).
    - **W10 (disabled-radius):** "when infoEnabled=false, radius input is disabled (HTML disabled attribute set)" — render `config={makeConfig({ infoEnabled: false })}`; assert radius input has `.disabled === true` AND `aria-disabled="true"`.

    NOTE: that's 10 tests, not 8 — increased after enumerating the locked clamp cases. The plan target was "8 new tests"; expanding to 10 captures every clamp permutation explicitly (locked decisions deserve dedicated tests).

    **Step 1 (RED):** Write all 10 tests; run `npm test -- --run MapConfigPanel.spec.tsx` from `kinetica_bi/`. New tests MUST fail (component doesn't render INFO POPUP section yet); existing 8 tests MUST still pass.

    Commit message: `test(22-02): add failing INFO POPUP section spec for MapConfigPanel`
  </behavior>
  <action>
    Open `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx`. Add a new sibling `describe("MapConfigPanel — Phase 22 INFO POPUP section", () => { ... })` block at the END of the file (after the existing closing `});` of "Phase 12 shrunk surface").

    Use `vi.useFakeTimers()` in the inline-error tests if you need to assert auto-dismiss timing — but the spec only asserts the error STRING APPEARS after blur; the 3s auto-dismiss is implementation detail (not asserted). Keep tests synchronous where possible.

    Field labels (locked — implementation must match):
    - Toggle: `aria-label="Enable info popup"` and visible label text `"Enable info popup"`
    - Radius input: `aria-label="Click radius (px)"` and visible label text `"Click radius (px)"`
    - Inline error: exact text `"Must be 1–200"` (en dash, NOT hyphen)

    Run `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx`. Confirm 8 existing tests PASS, 10 new tests FAIL.

    Commit message: `test(22-02): add failing INFO POPUP section spec for MapConfigPanel`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx 2>&1 | grep -E "(passed|failed)" | tail -1 | grep -q "10 failed"
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` contains 18+ `it(` blocks total (8 existing + 10 new)
    - File contains `screen.getByText("INFO POPUP")` (grep returns >= 1 match)
    - File contains `"Enable info popup"` label string (grep returns >= 2 matches — label + aria-label)
    - File contains `"Click radius (px)"` label string (grep returns >= 2 matches)
    - File contains `"Must be 1–200"` (en dash) error string (grep returns >= 1 match — note en dash unicode `–` not `-`)
    - File contains `infoEnabled: false` (grep returns >= 1 match for W3 assertion)
    - File contains `infoRadiusPx: 200` (grep returns >= 1 match for W5)
    - File contains `infoRadiusPx: 1` (grep returns >= 1 match for W6)
    - File contains `infoRadiusPx: 51` (grep returns >= 1 match for W8)
    - vitest exits with exactly 10 failing tests + 8 passing tests (RED state — implementation absent)
  </acceptance_criteria>
  <done>10 new failing tests committed (RED); spec authoritatively pins all locked behaviors before implementation lands.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement INFO POPUP section in MapConfigPanel.tsx (GREEN)</name>
  <files>kinetica_bi/src/components/charts/MapConfigPanel.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (entire file — extension at bottom of return JSX, after LAYERS section closing `</div>`)
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (final form from Task 1 — implement to make all 18 tests pass)
    - kinetica_bi/src/lib/mapInfoConfig.ts (import getInfoEnabled, getInfoRadiusPx)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx lines 727-770 (existing `<input type="number" min max step>` idiom for HEATMAP min/max levels)
    - kinetica_bi/src/styles/global.css line 842-856 (.config-toggle pattern for checkbox label)
  </read_first>
  <action>
    Modify `MapConfigPanel.tsx`:

    **Imports** (top of file, after existing imports):
    ```typescript
    import { useState } from "react";
    import { getInfoEnabled, getInfoRadiusPx } from "../../lib/mapInfoConfig";
    import type { MapWidgetConfig } from "../../lib/wmsUrlBuilder";
    ```

    **Inside component body**, after the existing `toggleLayer` function and BEFORE `return`:
    ```typescript
    // ─── Phase 22 (CONFIG-V14-04) — INFO POPUP state ──────────────────────────
    // Read defaults via Phase 19 helpers — DO NOT duplicate the literals true / 20 here.
    // NOTE on prop typing: ConfigPanelProps gives us `config: Record<string, unknown>`.
    // The helpers' Pick<MapWidgetConfig, ...> types accept the cast cleanly.
    const widgetCfg = config as Partial<MapWidgetConfig>;
    const infoEnabled = getInfoEnabled({ infoEnabled: widgetCfg.infoEnabled });
    const infoRadiusPx = getInfoRadiusPx({ infoRadiusPx: widgetCfg.infoRadiusPx });

    // Local typing buffer — allows free typing (e.g., clearing the field) without immediately
    // clamping. Reset when stored config changes externally.
    const [radiusDraft, setRadiusDraft] = useState<string>(String(infoRadiusPx));
    const [radiusError, setRadiusError] = useState<string | null>(null);

    // Clamp-on-blur logic (locked: NO clamping while typing per 22-CONTEXT.md anti-pattern)
    const clampRadius = (raw: string): { value: number; clamped: boolean } => {
      const n = Number(raw);
      if (!Number.isFinite(n)) {
        return { value: 1, clamped: true }; // empty/NaN → snap to min
      }
      const rounded = Math.round(n);
      if (rounded < 1) return { value: 1, clamped: true };
      if (rounded > 200) return { value: 200, clamped: true };
      return { value: rounded, clamped: rounded !== n };
    };

    const handleRadiusBlur = () => {
      const { value, clamped } = clampRadius(radiusDraft);
      setRadiusDraft(String(value));
      if (clamped) {
        setRadiusError("Must be 1–200");
        setTimeout(() => setRadiusError(null), 3000);
      }
      if (value !== infoRadiusPx) {
        onChange({ ...config, infoRadiusPx: value });
      }
    };
    ```

    **At the very bottom of the returned JSX**, AFTER the closing `</div>` of the LAYERS `config-group` (line 116) and BEFORE the closing `</div>` of `config-panel` (line 117):
    ```jsx
          {/* ─── INFO POPUP (Phase 22 CONFIG-V14-04) ───────────────────────── */}
          <div className="config-group">
            <div className="config-group-label">INFO POPUP</div>
            <label className="config-toggle">
              <input
                type="checkbox"
                aria-label="Enable info popup"
                checked={infoEnabled}
                onChange={(e) =>
                  onChange({ ...config, infoEnabled: e.target.checked })
                }
              />
              Enable info popup
            </label>
            <label className="ds-field-label" htmlFor="map-info-radius-px">
              Click radius (px)
            </label>
            <input
              id="map-info-radius-px"
              className="ds-field"
              type="number"
              aria-label="Click radius (px)"
              min={1}
              max={200}
              step={1}
              value={radiusDraft}
              disabled={!infoEnabled}
              aria-disabled={!infoEnabled}
              onChange={(e) => setRadiusDraft(e.target.value)}
              onBlur={handleRadiusBlur}
            />
            {radiusError && (
              <div className="info-popup-config-inline-error" role="alert">
                {radiusError}
              </div>
            )}
          </div>
    ```

    Run `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx`. Confirm 18/18 tests PASS.

    Run `cd kinetica_bi && npx tsc --noEmit`. Confirm exit 0.

    Commit message: `feat(22-02): implement INFO POPUP section in MapConfigPanel`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx && npx tsc --noEmit
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/MapConfigPanel.tsx` contains the literal string `"INFO POPUP"` (grep returns 1 match — uppercase, no other variants)
    - File contains `import { getInfoEnabled, getInfoRadiusPx } from "../../lib/mapInfoConfig"` (grep returns 1 match)
    - File contains `aria-label="Enable info popup"` (grep returns 1 match)
    - File contains `aria-label="Click radius (px)"` (grep returns 1 match)
    - File contains `min={1}` AND `max={200}` AND `step={1}` for the radius input (grep each returns >= 1 match)
    - File contains `clampRadius` function (grep returns >= 2 matches — definition + call)
    - File contains `setTimeout(() => setRadiusError(null), 3000)` for auto-dismiss (grep returns 1 match)
    - File DOES NOT contain literal `true` or `20` as the FALLBACK for infoEnabled/infoRadiusPx — defaults come ONLY through `getInfoEnabled` / `getInfoRadiusPx` calls (grep `?? 20` returns 0 matches in the new INFO POPUP code section; allow `?? "20"` for radiusDraft seeding only if the executor uses an explicit fallback string)
    - vitest exits 0 with 18/18 tests passing (10 new + 8 existing)
    - `tsc --noEmit` exits 0
    - LAYERS section is unchanged — `git diff` shows no modifications inside the existing `{/* LAYERS */}` block
  </acceptance_criteria>
  <done>10 new tests green; LAYERS section untouched; INFO POPUP section appears at bottom of form (after LAYERS); clamp-on-blur path covered for high/low/negative/non-integer cases; defaults flow through Phase 19 helpers (no duplicated true/20 literals).</done>
</task>

</tasks>

<verification>
After both tasks:
1. `cd kinetica_bi && npx vitest run src/components/charts/MapConfigPanel.spec.tsx` → 18 passed
2. `cd kinetica_bi && npx tsc --noEmit` → exit 0
3. `grep -c '^  it(' kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx` returns >= 18
4. `grep "INFO POPUP" kinetica_bi/src/components/charts/MapConfigPanel.tsx` returns 1 match
5. Manual sanity: `grep -A 3 "config-group-label" kinetica_bi/src/components/charts/MapConfigPanel.tsx` shows TITLE, BASEMAP, LAYERS, INFO POPUP labels in that order
</verification>

<success_criteria>
- INFO POPUP section appears AT THE BOTTOM of MapConfigPanel.tsx (after LAYERS section, before `config-panel` closing tag)
- Toggle defaults to ON via `getInfoEnabled` (NOT a duplicated `true` literal)
- Radius input defaults to 20 via `getInfoRadiusPx` (NOT a duplicated `20` literal)
- Clamp-on-blur handles 4 cases verbatim: 999→200, 0→1, -5→1, 50.7→51
- Inline error "Must be 1–200" (en dash) shows on clamp, auto-dismisses after 3s via `setTimeout`
- During typing (onChange of input), NO call to outer `onChange` is made — only `setRadiusDraft` (PROVES the no-clamp-while-typing lock)
- Disabled state when `infoEnabled === false`: `disabled={true}` + `aria-disabled="true"` on the radius input (NOT hidden)
- All 18 spec tests pass
- `tsc --noEmit` clean
</success_criteria>

<output>
After completion, create `.planning/phases/22-config-ui/22-02-widget-config-SUMMARY.md` with:
- Commit hashes (RED + GREEN)
- Test count (10 new, 18 total in spec)
- Locked clamp paths (4 cases enumerated above)
- Default-flow assertion (Phase 19 helpers only — no literal duplicates)
- Note: This plan does NOT touch KineticaWmsLayerForm or LayersModal — those are Plan 22-03's surface
</output>

---
phase: 29-draw-and-shape
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/package.json
  - kinetica_bi/package-lock.json
  - kinetica_bi/src/lib/shapeDraw.ts
  - kinetica_bi/src/lib/shapeDraw.spec.ts
  - kinetica_bi/src/components/charts/MapChartRenderer.tsx
  - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
autonomous: true
requirements:
  - DRAW-V15-02
  - DRAW-V15-03
must_haves:
  truths:
    - "The Effect 6 singleclick handler short-circuits as its FIRST line when drawMode is bbox, lasso, or circle (V15-P-01 mode-guard locked by STATE.md as the FIRST code change of Phase 29)"
    - "Component-local drawMode state exists in MapChartRenderer, defaults to 'info' on mount, and updates a drawModeRef mirror so Effect 6 reads current mode imperatively without widening its deps array"
    - "Map viewport cursor reflects the current drawMode (default for Info, grab for Pan, crosshair for bbox/lasso/circle) and resets on unmount via the cleanup return"
    - "Font Awesome dependencies (@fortawesome/react-fontawesome ^3.3.1, @fortawesome/fontawesome-svg-core ^7.2.0, @fortawesome/free-solid-svg-icons ^7.2.0) are installed and present in package.json"
    - "DrawMode union ('pan' | 'info' | 'bbox' | 'lasso' | 'circle') is exported from src/lib/shapeDraw.ts so MapDrawToolbar (Plan 02) and downstream plans import a single source of truth"
  artifacts:
    - path: "kinetica_bi/src/lib/shapeDraw.ts"
      provides: "DrawMode union type; pure helpers (formatDistance, formatArea) for measurement formatting"
      exports: ["DrawMode", "formatDistance", "formatArea", "DRAW_MODES"]
    - path: "kinetica_bi/src/lib/shapeDraw.spec.ts"
      provides: "Unit tests for formatDistance/formatArea km/m switchover and bbox/circle/lasso edge cases"
    - path: "kinetica_bi/src/components/charts/MapChartRenderer.tsx"
      provides: "Mode-guard at top of Effect 6 handler; drawMode useState + drawModeRef mirror + previousModeRef + cursor useEffect"
      contains: "drawModeRef.current"
    - path: "kinetica_bi/package.json"
      provides: "Font Awesome dependencies pinned"
      contains: "@fortawesome/react-fontawesome"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx Effect 6 handler"
      to: "drawModeRef.current"
      via: "imperative ref read (NOT a closure over drawMode useState; NOT in Effect 6 deps array)"
      pattern: "if \\(mode !== ['\"]pan['\"] && mode !== ['\"]info['\"]\\) return"
    - from: "kinetica_bi/src/components/charts/MapChartRenderer.tsx cursor useEffect"
      to: "map.getViewport().style.cursor"
      via: "useEffect dep on [drawMode]; cleanup returns cursor to ''"
      pattern: "viewport\\.style\\.cursor"
---

<objective>
Make the FIRST code change of Phase 29: the Effect 6 mode-guard (V15-P-01 mitigation, locked as the FIRST line of any Phase 29 work by STATE.md). Also ship the supporting state machinery (`drawMode` useState + `drawModeRef` mirror + `previousModeRef` + cursor useEffect) and the foundational `lib/shapeDraw.ts` module that exports the `DrawMode` union + pure measurement formatters so downstream plans (02, 03, 04, 05) consume a single source of truth.

Purpose: Without the mode-guard, the v1.4 singleclick info-popup handler in Effect 6 fires DURING bbox/lasso/circle draws — opening a popup over the partially-drawn shape and racing the Draw interaction's drag state. V15-P-01 is the highest-impact pitfall in Phase 29; STATE.md and 29-CONTEXT.md lock this as the FIRST code change before any Draw interaction or VectorLayer code lands. The cursor effect and state machinery are pulled into this same plan because (a) Effect 6 needs `drawModeRef` to read mode without widening its deps array, and (b) future plans must NOT re-derive the state machinery — it ships here once and is reused.

Output: Font Awesome dependencies installed; `kinetica_bi/src/lib/shapeDraw.ts` exports `DrawMode` + `formatDistance` + `formatArea` + `DRAW_MODES`; `MapChartRenderer.tsx` carries `drawMode` useState (default `'info'`), `drawModeRef` (synced via sibling effect), `previousModeRef`, a cursor useEffect, and the mode-guard at the top of Effect 6's async `handler`. No Draw interactions, no VectorLayer, no toolbar JSX yet — those are downstream plans.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/29-draw-and-shape/29-CONTEXT.md
@.planning/phases/29-draw-and-shape/29-RESEARCH.md
@.planning/phases/29-draw-and-shape/29-UI-SPEC.md
@kinetica_bi/src/components/charts/MapChartRenderer.tsx
@kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx
@kinetica_bi/src/store/spatialFilterStore.ts
@kinetica_bi/src/store/toast.ts
@kinetica_bi/package.json

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from codebase. -->

From kinetica_bi/src/store/spatialFilterStore.ts:
```typescript
export type Shape = {
  id: string;
  type: "bbox" | "lasso" | "circle";  // Shape["type"] subset of DrawMode
  wkt: string;                         // EPSG:4326
  label: string;
  measurement: string;
  addedAt: number;
};
export const useSpatialFilterStore = create<State>(...);
// State fields: shapes, spatialFilterVersion, shapeCounter
// State actions: addShape, removeShape, clearAll, reset
```

From kinetica_bi/src/store/toast.ts:
```typescript
export type ToastKind = "permission" | "info" | "error";
// NOTE: NO 'warning' kind exists; Phase 29 uses 'info' for "Shape too small — try again"
export const useToastStore = create<ToastState>(...);
// showToast(message: string, kind?: ToastKind) => void
```

From kinetica_bi/src/components/charts/MapChartRenderer.tsx — current refs and state (relevant excerpt):
```typescript
const containerRef = useRef<HTMLDivElement>(null);
const mapRef = useRef<OlMap | null>(null);
const mountedRef = useRef<boolean>(true);
const sourceListenerCleanupRef = useRef<Map<number, () => void>>(new Map());
const overlayRef = useRef<Overlay | null>(null);
const infoQueryAbortRef = useRef<AbortController | null>(null);
// Effect 6 deps array (line 975): [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]
```

Effect 6 entry point (line ~829, async handler inside the useEffect):
```typescript
// CURRENT (before mode-guard):
const handler = async (event: { coordinate: [number, number] }) => {
  if (eligibleLayers.length === 0) return;
  if (!mountedRef.current) return;
  // ... rest of handler ...
};
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install Font Awesome dependencies and create lib/shapeDraw.ts foundation</name>
  <files>kinetica_bi/package.json, kinetica_bi/package-lock.json, kinetica_bi/src/lib/shapeDraw.ts, kinetica_bi/src/lib/shapeDraw.spec.ts</files>
  <read_first>
    - kinetica_bi/package.json (verify ol@^10.9.0 + zustand@^4.5.2 present; confirm no existing Font Awesome deps)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Icon library section — operator-locked exact versions)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Standard Stack table — Font Awesome version pinning verified 2026-05-12 via npm view)
    - .planning/phases/29-draw-and-shape/29-UI-SPEC.md (Measurement label typography — 1 decimal km/km², 0 decimals m/m²)
    - kinetica_bi/src/store/spatialFilterStore.ts (Shape["type"] union — bbox/lasso/circle)
    - kinetica_bi/src/lib/mapInfoConfig.ts (existing minimal-helper style pattern for pure lib modules)
  </read_first>
  <behavior>
    - Test: formatDistance(750) returns "750 m" (0 decimals; <1000 m switchover)
    - Test: formatDistance(999) returns "999 m"
    - Test: formatDistance(1000) returns "1.0 km" (km switchover at exactly 1000 m; 1 decimal)
    - Test: formatDistance(2500) returns "2.5 km"
    - Test: formatDistance(1234567) returns "1234.6 km" (no thousand separator; 1 decimal; verifies SI typography lock)
    - Test: formatDistance(0) returns "0 m" (degenerate but safe)
    - Test: formatArea(850) returns "850 m²" (0 decimals; superscript-2 character U+00B2)
    - Test: formatArea(999999) returns "999999 m²" (just below km² switchover)
    - Test: formatArea(1000000) returns "1.0 km²" (switchover at exactly 1_000_000 m²)
    - Test: formatArea(12400000) returns "12.4 km²"
    - Test: DRAW_MODES is the readonly tuple ['pan','info','bbox','lasso','circle'] in exact order (matches toolbar render order from UI-SPEC)
    - Test: DrawMode type is the union of those 5 string literals (compile-time check via `const m: DrawMode = 'bbox'` in spec)
  </behavior>
  <action>
Step 1 — Install Font Awesome dependencies. Run from `kinetica_bi/`:
```
cd kinetica_bi && npm install @fortawesome/react-fontawesome@^3.3.1 @fortawesome/fontawesome-svg-core@^7.2.0 @fortawesome/free-solid-svg-icons@^7.2.0
```
Confirm `package.json` `dependencies` block contains all three entries with caret-pinned versions matching above. Confirm `package-lock.json` updated. Commit both files together (the project ships node_modules but at minimum package.json + package-lock.json must be staged).

Step 2 — Create `kinetica_bi/src/lib/shapeDraw.spec.ts` FIRST (TDD red phase) with the exact tests listed in `<behavior>` above. Use vitest `describe`/`it`/`expect` matching existing spec style in `kinetica_bi/src/lib/mapInfoConfig.spec.ts`. Run `npm test -- shapeDraw` and confirm RED (file not found / import error).

Step 3 — Create `kinetica_bi/src/lib/shapeDraw.ts` with EXACTLY this content:
```typescript
/**
 * Phase 29 (DRAW-V15-02 + DRAW-V15-05): Pure helpers + types for the draw-and-shape phase.
 *
 * Why this module exists:
 *   - DrawMode is consumed by MapDrawToolbar (Plan 02), MapChartRenderer state machinery
 *     (Plan 01-05), and pure helper functions. Putting it in lib/shapeDraw.ts (not
 *     MapChartRenderer.tsx) keeps the toolbar component free of a circular import.
 *   - formatDistance / formatArea encode the km / m switchover locked by 29-UI-SPEC.md:
 *     <1 km: meters with 0 decimals; ≥1 km: kilometers with 1 decimal. Same rule for area.
 *   - Pure helpers (no OL imports) so they are unit-testable without mocking the OL Map.
 *     Effect 8's drawend pipeline (Plan 04) imports formatDistance/formatArea to build the
 *     measurement string passed to addShape.
 */

/** Locked tuple ordering — matches MapDrawToolbar render order (Pan / Info / Bbox / Lasso / Circle). */
export const DRAW_MODES = ["pan", "info", "bbox", "lasso", "circle"] as const;

/** Union of all five interaction modes for a map widget. Shape["type"] is the bbox/lasso/circle subset. */
export type DrawMode = (typeof DRAW_MODES)[number];

/**
 * Format a ground distance in meters per 29-UI-SPEC.md:
 *   - <1000 m → "{N} m" (0 decimals, Math.round)
 *   - ≥1000 m → "{N.N} km" (1 decimal via toFixed(1))
 * No thousand separator (SI typography lock).
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Format an area in square meters per 29-UI-SPEC.md:
 *   - <1_000_000 m² → "{N} m²" (0 decimals)
 *   - ≥1_000_000 m² → "{N.N} km²" (1 decimal)
 * Uses U+00B2 (²) literal.
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters < 1_000_000) return `${Math.round(sqMeters)} m²`;
  return `${(sqMeters / 1_000_000).toFixed(1)} km²`;
}
```

Step 4 — Run `npm test -- shapeDraw` → confirm GREEN. Run `npm run build` (or `npx tsc --noEmit`) from `kinetica_bi/` and confirm zero TS errors.

Step 5 — Commit: `feat(29-01): install Font Awesome deps + create lib/shapeDraw.ts (DrawMode + formatters)`.

NO TouchOf MapChartRenderer.tsx in this task — Task 2 handles that.
  </action>
  <verify>
    <automated>cd kinetica_bi && npm test -- shapeDraw --run 2>&1 | grep -E "(passed|failed)" | head -5</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `kinetica_bi/src/lib/shapeDraw.ts`
    - File exists: `kinetica_bi/src/lib/shapeDraw.spec.ts`
    - `grep -n "export const DRAW_MODES" kinetica_bi/src/lib/shapeDraw.ts` returns exactly 1 line
    - `grep -n "export type DrawMode" kinetica_bi/src/lib/shapeDraw.ts` returns exactly 1 line
    - `grep -n "export function formatDistance" kinetica_bi/src/lib/shapeDraw.ts` returns exactly 1 line
    - `grep -n "export function formatArea" kinetica_bi/src/lib/shapeDraw.ts` returns exactly 1 line
    - `grep -c "@fortawesome/react-fontawesome" kinetica_bi/package.json` returns at least 1
    - `grep -c "@fortawesome/fontawesome-svg-core" kinetica_bi/package.json` returns at least 1
    - `grep -c "@fortawesome/free-solid-svg-icons" kinetica_bi/package.json` returns at least 1
    - `cd kinetica_bi && npx vitest run src/lib/shapeDraw.spec.ts` exits 0 with all tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `grep -c "1 decimal\\|toFixed" kinetica_bi/src/lib/shapeDraw.ts` returns at least 2 (1 for distance km branch, 1 for area km² branch)
    - `grep "Math.round" kinetica_bi/src/lib/shapeDraw.ts` matches in both formatDistance and formatArea bodies
  </acceptance_criteria>
  <done>
    Font Awesome installed; lib/shapeDraw.ts ships with DrawMode + DRAW_MODES + formatDistance + formatArea, all unit-tested green. tsc clean. Plan 02 (MapDrawToolbar) and Plan 04 (drawend pipeline) can import from this file.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add drawMode state + drawModeRef mirror + previousModeRef + cursor useEffect to MapChartRenderer, then insert the Effect 6 mode-guard FIRST</name>
  <files>kinetica_bi/src/components/charts/MapChartRenderer.tsx, kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapChartRenderer.tsx (lines 396-460 for ref/state block; lines 820-975 for Effect 6 verbatim)
    - kinetica_bi/src/components/charts/MapChartRenderer.spec.tsx (existing test patterns — vi.mock setup, OL mocks, useFilterStore reset)
    - kinetica_bi/src/lib/shapeDraw.ts (just created in Task 1 — DrawMode type import)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Mode & selection behavior — default mode is Info, previousMode auto-restore)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Pattern 6: Effect 6 Mode-Guard + Pattern 7: Cursor + Mode State Machinery + Pitfall 2: Stale-Closure)
    - .planning/STATE.md (FIRST-CODE-CHANGE lock — mode-guard is the literal first change in Phase 29)
  </read_first>
  <behavior>
    - Test M1 (mode-guard short-circuit in bbox mode): When `drawMode === 'bbox'`, a simulated `singleclick` on the map does NOT call `infoQuery`. Assert `infoQuery` mock has 0 calls.
    - Test M2 (mode-guard short-circuit in lasso mode): Same as M1 but with `drawMode === 'lasso'`.
    - Test M3 (mode-guard short-circuit in circle mode): Same as M1 but with `drawMode === 'circle'`.
    - Test M4 (mode-guard PASSTHROUGH in info mode): When `drawMode === 'info'` (default), simulated singleclick DOES call `infoQuery` (existing v1.4 behavior preserved). Assert `infoQuery` called ≥1 time.
    - Test M5 (mode-guard PASSTHROUGH in pan mode): When `drawMode === 'pan'`, simulated singleclick STILL calls `infoQuery` (pan + info both pass-through per V15-P-01 lock: `mode !== 'pan' && mode !== 'info'`).
    - Test M6 (ref mirror): After component mount, `drawModeRef.current === 'info'` (default). After `setDrawMode('bbox')` triggers a re-render, the ref's next read is `'bbox'`. Use a test seam (e.g., expose ref via a data-attribute on a hidden test div, OR test indirectly via the M1-M5 click behavior).
    - Test M7 (cursor on info mode): After mount, `map.getViewport().style.cursor === ''` (default cursor). Use the OL mock's viewport getter.
    - Test M8 (cursor on bbox mode): After `setDrawMode('bbox')`, `map.getViewport().style.cursor === 'crosshair'`.
    - Test M9 (cursor on pan mode): After `setDrawMode('pan')`, `map.getViewport().style.cursor === 'grab'`.
    - Test M10 (cursor cleanup on unmount): After mount with `drawMode === 'bbox'`, unmount the component; assert the cleanup return resets `style.cursor = ''`.
    - Test M11 (previousModeRef tracks last non-draw mode): Starting at `info`, transition to `pan`, then to `bbox`; assert `previousModeRef.current === 'pan'` (Plan 04's ESC handler will use this to restore). NOTE: previousModeRef is updated ONLY when entering non-draw modes (Pan / Info); draw modes do NOT update it. This test may need a test seam exposing the ref.
    - Test M12 (Effect 6 deps unchanged): Read the Effect 6 deps array from the source (regex extraction or static assertion) and confirm it is exactly `[getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]` — NO `drawMode` in the deps (V15-P-01 stale-closure pitfall mitigation).
  </behavior>
  <action>
Step 1 — Add import at top of `MapChartRenderer.tsx` (after existing imports, before the Props type):
```typescript
import type { DrawMode } from "../../lib/shapeDraw";
```

Step 2 — In the ref/state block (currently lines 401-453, between `mountedRef` and `tileLoadError`/`errorOverlayDismissed`), add these declarations IMMEDIATELY AFTER the `mountedRef` line (currently line 439). The exact position is: AFTER `const mountedRef = useRef<boolean>(true);`, BEFORE the comment block for `popupContainerRef`:
```typescript
  // ── Phase 29 (DRAW-V15-02 + V15-P-01 mode-guard FIRST-CODE-CHANGE) ────────
  // Component-local mode state. NOT in useSpatialFilterStore (out-of-Phase-27 scope per 29-CONTEXT.md).
  // The ref mirror (drawModeRef) is what Effect 6's singleclick handler reads imperatively — so
  // we do NOT have to widen Effect 6's deps array (which would tear down/recreate the listener
  // on every mode change). See 29-RESEARCH.md Pattern 6 + Pitfall 2 for the stale-closure trap.
  const [drawMode, setDrawMode] = useState<DrawMode>("info");
  const drawModeRef = useRef<DrawMode>("info");
  // previousModeRef tracks the last non-draw mode so drawend / ESC can auto-restore (DRAW-V15-02).
  // Updated ONLY when drawMode transitions to a non-draw value (pan / info); draw modes leave it alone.
  const previousModeRef = useRef<DrawMode>("info");
```

Step 3 — Add a sibling Effect block AFTER Effect 1's cleanup return (around line 578) and BEFORE Effect 2 (line 584). This is the "mode-state-machinery" effect block. Use this exact code:
```typescript
  // ── Phase 29: drawModeRef mirror sync ────────────────────────────────────
  // Effect runs on every drawMode change; updates the ref so Effect 6's singleclick
  // handler can read the current mode without being in Effect 6's deps array.
  useEffect(() => {
    drawModeRef.current = drawMode;
  }, [drawMode]);

  // ── Phase 29: previousModeRef tracker ────────────────────────────────────
  // Captures the last non-draw mode (Pan / Info) so drawend (Plan 04) and ESC (Plan 04)
  // can auto-restore via setDrawMode(previousModeRef.current).
  useEffect(() => {
    if (drawMode === "bbox" || drawMode === "lasso" || drawMode === "circle") return;
    previousModeRef.current = drawMode;
  }, [drawMode]);

  // ── Phase 29 (V15-P-02): cursor management ──────────────────────────────
  // Single useEffect dep on drawMode. Cleanup return covers mode-change AND unmount paths.
  useEffect(() => {
    const viewport = mapRef.current?.getViewport();
    if (!viewport) return;
    const cursor =
      drawMode === "pan" ? "grab" :
      drawMode === "bbox" || drawMode === "lasso" || drawMode === "circle" ? "crosshair" :
      "";
    viewport.style.cursor = cursor;
    return () => {
      viewport.style.cursor = "";
    };
  }, [drawMode]);
```

Step 4 — Insert the V15-P-01 mode-guard as the FIRST line of Effect 6's async `handler` function. Current Effect 6 starts at line 824; the handler is defined at line 829. The new FIRST LINE of the handler body (after the opening `{`) must read:
```typescript
    const handler = async (event: { coordinate: [number, number] }) => {
      // PHASE 29 V15-P-01 MODE-GUARD — FIRST LINE (locked by STATE.md as the FIRST code change
      // of Phase 29). Reads drawModeRef imperatively to avoid stale closure WITHOUT widening
      // Effect 6's deps array (which would tear down/recreate the singleclick listener on every
      // mode change, racing the cleanup gate). See 29-RESEARCH.md Pattern 6 + Pitfall 2.
      const mode = drawModeRef.current;
      if (mode !== "pan" && mode !== "info") return;

      if (eligibleLayers.length === 0) return;
      // ... rest of handler unchanged (existing mountedRef guard at line 835 follows) ...
```

CRITICAL: the mode-guard MUST be the literal FIRST executable statement in the handler — BEFORE `if (eligibleLayers.length === 0) return;` (currently line 830). This is non-negotiable; STATE.md uses the word "FIRST" for ordering.

CRITICAL: do NOT add `drawMode` or `drawModeRef` to Effect 6's deps array (line 975). Effect 6 reads via `.current` imperatively — the deps stay exactly `[getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]`.

Step 5 — Update `MapChartRenderer.spec.tsx` with the M1-M12 test cases above. Existing test patterns to mirror: the file already has OL mocks (look for `vi.mock("ol/Map")` or similar) and a way to simulate `singleclick` (look for existing tests of Effect 6 — they fire mock click events). Add tests in a new `describe("Phase 29 drawMode + mode-guard (DRAW-V15-02 + V15-P-01)", ...)` block at the end of the file. The tests for cursor state and ref mirror may require exposing test seams (e.g., adding a `data-testid="draw-mode-current"` div near the top of the JSX that displays `drawMode` — acceptable and useful for downstream debugging).

If the existing spec patterns make exposing refs awkward, the M6 + M11 ref tests can be replaced with indirect behavioral tests (e.g., M6: change mode to bbox via the test seam, then fire a click — assert NO infoQuery call; this proves the ref read sees the new mode).

Step 6 — Run `npm test -- MapChartRenderer --run` → confirm ALL existing tests still pass + all new M1-M12 tests pass. Run `npx tsc --noEmit` → confirm 0 errors.

Step 7 — Commit: `feat(29-01): add drawMode state + drawModeRef mirror + cursor effect + V15-P-01 mode-guard in Effect 6 (FIRST-CODE-CHANGE)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx 2>&1 | tail -20</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'import type { DrawMode } from "../../lib/shapeDraw"' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'const \[drawMode, setDrawMode\] = useState<DrawMode>' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line with default `"info"`
    - `grep -n 'const drawModeRef = useRef<DrawMode>' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -n 'const previousModeRef = useRef<DrawMode>' kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns exactly 1 line
    - `grep -nB1 'drawModeRef.current = drawMode' kinetica_bi/src/components/charts/MapChartRenderer.tsx` shows the assignment inside a useEffect
    - `grep -nA2 'PHASE 29 V15-P-01 MODE-GUARD' kinetica_bi/src/components/charts/MapChartRenderer.tsx` shows the guard comment immediately followed by `const mode = drawModeRef.current` and `if (mode !== "pan" && mode !== "info") return`
    - `awk '/const handler = async \(event: \{ coordinate/,/^    };$/' kinetica_bi/src/components/charts/MapChartRenderer.tsx | head -10 | grep -c 'drawModeRef.current'` returns at least 1 (mode-guard is INSIDE the handler)
    - `grep -n '\], \[getInfoEnabled' kinetica_bi/src/components/charts/MapChartRenderer.tsx` confirms Effect 6 deps array unchanged — `drawMode` MUST NOT appear in the line `}, [getInfoEnabled(widgetConfig as MapWidgetConfig), eligibleLayers, tables, widgetConfig]`. Specifically: `grep -E '^\s*\}, \[getInfoEnabled.*\];' kinetica_bi/src/components/charts/MapChartRenderer.tsx | grep -v drawMode | wc -l` returns at least 1.
    - `grep -n "viewport.style.cursor" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 2 matches (set + cleanup reset)
    - `grep -n "crosshair\|grab" kinetica_bi/src/components/charts/MapChartRenderer.tsx` returns at least 2 matches
    - `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx` exits 0
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - All 12 new M1-M12 test names appear in spec output: `cd kinetica_bi && npx vitest run src/components/charts/MapChartRenderer.spec.tsx --reporter=verbose 2>&1 | grep -E "(M1|M2|M3|M4|M5|M6|M7|M8|M9|M10|M11|M12)" | wc -l` returns at least 12
  </acceptance_criteria>
  <done>
    MapChartRenderer.tsx carries Phase 29 mode state + ref mirror + cursor effect; Effect 6's async handler short-circuits FIRST on draw modes. Existing v1.4 info-popup tests still green. V15-P-01 pitfall closed at the source. Plans 02-05 can build on this foundation.
  </done>
</task>

</tasks>

<verification>
**Manual verification after Task 2 (optional but recommended):**
1. `cd kinetica_bi && npm run dev` — open a dashboard with a map widget
2. Open browser DevTools console; verify no new warnings/errors related to drawModeRef
3. Click on a map point in Info mode (default) — info popup still appears (regression check; v1.4 behavior preserved)
4. (Without a toolbar to switch modes yet, the mode-guard cannot be exercised live in this plan. Plan 02 adds the toolbar; Plan 04 wires Draw interactions. The unit tests M1-M12 prove behavior in isolation.)

**Automated verification:**
- `cd kinetica_bi && npm test -- --run` — full vitest suite green (no regressions)
- `cd kinetica_bi && npx tsc --noEmit` — zero TS errors
</verification>

<success_criteria>
1. Font Awesome dependencies installed and pinned in package.json + package-lock.json
2. `kinetica_bi/src/lib/shapeDraw.ts` exports `DrawMode`, `DRAW_MODES`, `formatDistance`, `formatArea` — all unit-tested green
3. `MapChartRenderer.tsx` carries: `drawMode` useState (default 'info'), `drawModeRef`, `previousModeRef`, drawModeRef-sync useEffect, previousModeRef-tracker useEffect, cursor useEffect
4. Effect 6's async handler short-circuits on its FIRST executable line when `drawModeRef.current` is `'bbox'`, `'lasso'`, or `'circle'` — V15-P-01 closed at the source
5. Effect 6's deps array is unchanged (`drawMode` NOT in deps — stale-closure pitfall avoided)
6. Full vitest suite green; tsc clean
7. All 12 new test cases (M1-M12) pass in MapChartRenderer.spec.tsx
</success_criteria>

<output>
After completion, create `.planning/phases/29-draw-and-shape/29-01-SUMMARY.md` documenting:
- Font Awesome versions installed
- Final shape of lib/shapeDraw.ts exports
- Exact line numbers in MapChartRenderer.tsx where state/refs/effects/mode-guard land (so Plans 02-05 can navigate without re-grepping)
- Any deviations from this plan (and why)
- Confirmation that Effect 6 deps stayed narrow
</output>

---
phase: 29-draw-and-shape
plan: 02
type: execute
wave: 2
depends_on:
  - 29-01
files_modified:
  - kinetica_bi/src/components/charts/MapDrawToolbar.tsx
  - kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - DRAW-V15-01
must_haves:
  truths:
    - "MapDrawToolbar renders a vertical column of 5 mutually-exclusive mode buttons (Pan / Info / Bbox / Lasso / Circle) plus a Trash 'Clear all' button that is visible only when shapesCount > 0"
    - "The currently active mode button receives the .is-active class (filled-accent background, dark icon) so it is visually unmistakable"
    - "Clicking a non-active mode button fires onModeChange(mode); clicking the already-active button is a no-op (does NOT call onModeChange)"
    - "Clicking the Trash button fires onClearAll(); the Trash button is hidden (not rendered) when shapesCount === 0"
    - "All 6 buttons carry aria-label per UI-SPEC.md; mode buttons carry aria-pressed reflecting active state; the toolbar is a React-rendered absolutely-positioned overlay with pointer-events: none on the container and pointer-events: auto on individual buttons (V15-P-17 anti-pattern lock)"
  artifacts:
    - path: "kinetica_bi/src/components/charts/MapDrawToolbar.tsx"
      provides: "React component exporting default MapDrawToolbar; props: { drawMode, onModeChange, shapesCount, onClearAll }"
      exports: ["default MapDrawToolbar"]
      min_lines: 60
    - path: "kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx"
      provides: "Vitest spec covering render, click events, active styling, trash visibility, aria"
      min_lines: 100
    - path: "kinetica_bi/src/styles/global.css"
      provides: "CSS classes .map-draw-toolbar, .map-draw-toolbar-btn, .map-draw-toolbar-btn.is-active, .map-draw-toolbar-divider"
      contains: ".map-draw-toolbar"
  key_links:
    - from: "kinetica_bi/src/components/charts/MapDrawToolbar.tsx"
      to: "kinetica_bi/src/lib/shapeDraw.ts (DrawMode + DRAW_MODES)"
      via: "ES module import"
      pattern: "import .* DrawMode .* from .*/lib/shapeDraw"
    - from: "kinetica_bi/src/components/charts/MapDrawToolbar.tsx"
      to: "@fortawesome/react-fontawesome FontAwesomeIcon"
      via: "Per-icon imports from @fortawesome/free-solid-svg-icons"
      pattern: "FontAwesomeIcon"
---

<objective>
Create the standalone `MapDrawToolbar.tsx` React overlay component plus comprehensive vitest coverage. This plan delivers the visual UI for Phase 29 in isolation — no integration with MapChartRenderer yet (Plan 03 wires it in). The toolbar is a pure presentational component that receives `{ drawMode, onModeChange, shapesCount, onClearAll }` and renders 5 mode buttons + 1 conditional Trash button using Font Awesome icons.

Purpose: Decoupling the toolbar from MapChartRenderer wiring lets us (a) develop and test the toolbar without spinning up the OL Map mock, (b) keep MapChartRenderer.tsx from growing past ~1300 lines (it's already 1040), and (c) parallelize with Plan 03's VectorLayer work if file conflict resolution allows. The component is stateless — all state lives in MapChartRenderer and is passed down.

Output: New file `MapDrawToolbar.tsx` (~80 lines) with default export, sibling spec file with ~12 tests, plus CSS class definitions appended to `global.css` (per UI-SPEC.md design system). No MapChartRenderer.tsx edits.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/29-draw-and-shape/29-CONTEXT.md
@.planning/phases/29-draw-and-shape/29-RESEARCH.md
@.planning/phases/29-draw-and-shape/29-UI-SPEC.md
@.planning/phases/29-draw-and-shape/29-01-mode-guard-and-foundation-PLAN.md
@kinetica_bi/src/lib/shapeDraw.ts
@kinetica_bi/src/components/charts/InfoPopup.tsx
@kinetica_bi/src/components/charts/InfoPopup.spec.tsx
@kinetica_bi/src/styles/global.css

<interfaces>
<!-- Key types and contracts the executor needs. Extracted from Plan 01 + UI-SPEC. -->

From kinetica_bi/src/lib/shapeDraw.ts (Plan 01):
```typescript
export const DRAW_MODES = ["pan", "info", "bbox", "lasso", "circle"] as const;
export type DrawMode = (typeof DRAW_MODES)[number];
```

Component contract (from 29-UI-SPEC.md):
```typescript
type Props = {
  drawMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  shapesCount: number;
  onClearAll: () => void;
};
```

Font Awesome icon imports (29-CONTEXT.md locked names):
```typescript
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faHand,         // Pan
  faCircleInfo,   // Info
  faVectorSquare, // Bbox
  faDrawPolygon,  // Lasso
  faCircle,       // Circle
  faTrash,        // Clear all
} from '@fortawesome/free-solid-svg-icons';
```

aria-labels (29-UI-SPEC.md Copywriting Contract — EXACT strings):
- Pan → "Pan"
- Info → "Info"
- Bbox → "Draw bounding box"
- Lasso → "Draw lasso"
- Circle → "Draw circle"
- Trash → "Clear all shapes"

CSS classes (29-UI-SPEC.md Component Inventory):
- `.map-draw-toolbar` — container; pointer-events: none; absolutely positioned; flex-col
- `.map-draw-toolbar-btn` — button base; pointer-events: auto; 36×36px
- `.map-draw-toolbar-btn.is-active` — active state (accent fill, dark icon)
- `.map-draw-toolbar-divider` — visual separator before Trash (1px border-top, 4px margin)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write MapDrawToolbar.spec.tsx with failing tests (RED phase)</name>
  <files>kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx</files>
  <read_first>
    - .planning/phases/29-draw-and-shape/29-UI-SPEC.md (Component Inventory: full structure + CSS contract; Copywriting Contract: exact aria-label strings; Interaction Contract: trash visibility, mode transitions, re-click no-op)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Toolbar layout & visuals: Font Awesome icon names per mode, active styling, pointer-events lock)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Pattern 8: MapDrawToolbar Component — verbatim code reference)
    - kinetica_bi/src/components/charts/InfoPopup.spec.tsx (existing component spec pattern — vi.mock, render, fireEvent, getByRole, getByLabelText)
    - kinetica_bi/src/lib/shapeDraw.ts (DrawMode type + DRAW_MODES tuple — already shipped by Plan 01)
  </read_first>
  <behavior>
    Test list (~12 tests):
    - T1 (renders all 5 mode buttons): `render(<MapDrawToolbar drawMode="info" onModeChange={vi.fn()} shapesCount={0} onClearAll={vi.fn()} />)` produces buttons with aria-label "Pan", "Info", "Draw bounding box", "Draw lasso", "Draw circle". Assert via `getByLabelText` × 5.
    - T2 (Trash hidden when shapesCount=0): `queryByLabelText("Clear all shapes")` returns null.
    - T3 (Trash visible when shapesCount=1): re-render with `shapesCount={1}`; `getByLabelText("Clear all shapes")` returns the button element.
    - T4 (Trash still visible when shapesCount=5): re-render with `shapesCount={5}`; trash element exists.
    - T5 (active mode = info → Info button has is-active class): With `drawMode="info"`, `getByLabelText("Info").className` contains `is-active`. None of the other 4 buttons have `is-active`.
    - T6 (active mode = bbox → Bbox button has is-active): With `drawMode="bbox"`, only the "Draw bounding box" button has `is-active`. The Info / Pan / Lasso / Circle buttons do NOT.
    - T7 (clicking non-active mode fires onModeChange with that mode): With `drawMode="info"`, `fireEvent.click(getByLabelText("Draw bounding box"))` → `onModeChange` mock was called once with argument `"bbox"`.
    - T8 (clicking already-active mode is a no-op): With `drawMode="bbox"`, `fireEvent.click(getByLabelText("Draw bounding box"))` → `onModeChange` mock was NOT called (0 calls). This is the CONTEXT.md re-click lock.
    - T9 (clicking Trash fires onClearAll): With `shapesCount={2}`, `fireEvent.click(getByLabelText("Clear all shapes"))` → `onClearAll` mock called exactly once.
    - T10 (aria-pressed reflects active state): With `drawMode="bbox"`, `getByLabelText("Draw bounding box").getAttribute("aria-pressed") === "true"`; all other mode buttons have `aria-pressed === "false"`. Trash button does NOT have aria-pressed (it's not a toggle).
    - T11 (toolbar container has correct role and aria-label): `getByRole("toolbar", { name: /Drawing tools/i })` finds the container.
    - T12 (button order: Pan, Info, Bbox, Lasso, Circle, then Trash): Inspect `container.querySelectorAll('.map-draw-toolbar-btn')` — first 5 buttons in DOM order must have aria-labels matching `["Pan", "Info", "Draw bounding box", "Draw lasso", "Draw circle"]`. When `shapesCount > 0`, the 6th button is Trash.

    File structure mirrors `InfoPopup.spec.tsx` (existing pattern). Use `@testing-library/react` + `@testing-library/user-event` + `vitest`. Import the component as `import MapDrawToolbar from "./MapDrawToolbar";`.
  </behavior>
  <action>
Create `kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx` with the following structure. Write it BEFORE the component exists so the import statement initially fails (RED phase).

```typescript
/**
 * Phase 29 (DRAW-V15-01): MapDrawToolbar spec — covers render, click, active state,
 * trash visibility, aria. Component is created in Task 2. This spec is the contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import MapDrawToolbar from "./MapDrawToolbar";
import type { DrawMode } from "../../lib/shapeDraw";

describe("MapDrawToolbar (DRAW-V15-01)", () => {
  beforeEach(() => { cleanup(); });

  function renderToolbar(overrides: Partial<{ drawMode: DrawMode; shapesCount: number }> = {}) {
    const onModeChange = vi.fn();
    const onClearAll = vi.fn();
    const utils = render(
      <MapDrawToolbar
        drawMode={overrides.drawMode ?? "info"}
        onModeChange={onModeChange}
        shapesCount={overrides.shapesCount ?? 0}
        onClearAll={onClearAll}
      />
    );
    return { ...utils, onModeChange, onClearAll };
  }

  it("T1: renders all 5 mode buttons with exact aria-labels", () => {
    renderToolbar();
    expect(screen.getByLabelText("Pan")).toBeInTheDocument();
    expect(screen.getByLabelText("Info")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw bounding box")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw lasso")).toBeInTheDocument();
    expect(screen.getByLabelText("Draw circle")).toBeInTheDocument();
  });

  it("T2: Trash hidden when shapesCount === 0", () => {
    renderToolbar({ shapesCount: 0 });
    expect(screen.queryByLabelText("Clear all shapes")).toBeNull();
  });

  it("T3: Trash visible when shapesCount === 1", () => {
    renderToolbar({ shapesCount: 1 });
    expect(screen.getByLabelText("Clear all shapes")).toBeInTheDocument();
  });

  it("T4: Trash visible when shapesCount === 5", () => {
    renderToolbar({ shapesCount: 5 });
    expect(screen.getByLabelText("Clear all shapes")).toBeInTheDocument();
  });

  it("T5: active mode = info → Info button has is-active; others do not", () => {
    renderToolbar({ drawMode: "info" });
    expect(screen.getByLabelText("Info").className).toContain("is-active");
    expect(screen.getByLabelText("Pan").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw bounding box").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw lasso").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw circle").className).not.toContain("is-active");
  });

  it("T6: active mode = bbox → only Bbox has is-active", () => {
    renderToolbar({ drawMode: "bbox" });
    expect(screen.getByLabelText("Draw bounding box").className).toContain("is-active");
    expect(screen.getByLabelText("Pan").className).not.toContain("is-active");
    expect(screen.getByLabelText("Info").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw lasso").className).not.toContain("is-active");
    expect(screen.getByLabelText("Draw circle").className).not.toContain("is-active");
  });

  it("T7: clicking non-active mode fires onModeChange with that mode", () => {
    const { onModeChange } = renderToolbar({ drawMode: "info" });
    fireEvent.click(screen.getByLabelText("Draw bounding box"));
    expect(onModeChange).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith("bbox");
  });

  it("T8: clicking already-active mode is a no-op (CONTEXT.md re-click lock)", () => {
    const { onModeChange } = renderToolbar({ drawMode: "bbox" });
    fireEvent.click(screen.getByLabelText("Draw bounding box"));
    expect(onModeChange).not.toHaveBeenCalled();
  });

  it("T9: clicking Trash fires onClearAll", () => {
    const { onClearAll } = renderToolbar({ shapesCount: 2 });
    fireEvent.click(screen.getByLabelText("Clear all shapes"));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("T10: aria-pressed reflects active state", () => {
    renderToolbar({ drawMode: "bbox" });
    expect(screen.getByLabelText("Draw bounding box").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Info").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Pan").getAttribute("aria-pressed")).toBe("false");
  });

  it("T11: toolbar container has role=toolbar with aria-label", () => {
    renderToolbar();
    expect(screen.getByRole("toolbar", { name: /Drawing tools/i })).toBeInTheDocument();
  });

  it("T12: button order is Pan, Info, Bbox, Lasso, Circle, [Trash]", () => {
    const { container } = renderToolbar({ shapesCount: 1 });
    const buttons = container.querySelectorAll("button");
    const labels = Array.from(buttons).map((b) => b.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Pan",
      "Info",
      "Draw bounding box",
      "Draw lasso",
      "Draw circle",
      "Clear all shapes",
    ]);
  });
});
```

Run `cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx` → confirm it fails with "Cannot find module './MapDrawToolbar'" (RED). Commit AFTER Task 2 (single feat commit covers both).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx 2>&1 | grep -E "(Cannot find module|FAIL)" | head -3</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx`
    - `grep -c "it(\"T" kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx` returns at least 12
    - `grep -c "Pan\\|Info\\|Draw bounding box\\|Draw lasso\\|Draw circle\\|Clear all shapes" kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx` returns at least 6
    - `grep "T11: toolbar container has role=toolbar" kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx` matches
    - Running vitest before Task 2 returns a module-not-found error for `./MapDrawToolbar` (confirms RED phase)
  </acceptance_criteria>
  <done>
    Spec file in place with 12 tests covering DRAW-V15-01 contract; tests currently RED. Task 2 implements the component to make them GREEN.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement MapDrawToolbar.tsx + add CSS classes to global.css (GREEN phase)</name>
  <files>kinetica_bi/src/components/charts/MapDrawToolbar.tsx, kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapDrawToolbar.spec.tsx (Task 1 output — the contract the implementation must satisfy)
    - .planning/phases/29-draw-and-shape/29-UI-SPEC.md (Component Inventory + Color + Spacing + Typography + Accessibility sections — full visual contract)
    - .planning/phases/29-draw-and-shape/29-CONTEXT.md (Toolbar layout & visuals — operator-locked icon names + pointer-events lock)
    - .planning/phases/29-draw-and-shape/29-RESEARCH.md (Pattern 8 — verbatim component code reference; Pattern includes CSS positioning hints)
    - kinetica_bi/src/lib/shapeDraw.ts (DrawMode + DRAW_MODES — already shipped by Plan 01)
    - kinetica_bi/src/styles/global.css (existing CSS structure — find `.widget-map` section around line 1496 to append new classes)
  </read_first>
  <behavior>
    Implementation must make all 12 tests from Task 1 pass. No additional behaviors beyond the spec.
  </behavior>
  <action>
Step 1 — Create `kinetica_bi/src/components/charts/MapDrawToolbar.tsx` with this EXACT content:

```typescript
/**
 * Phase 29 (DRAW-V15-01): MapDrawToolbar — React-rendered absolutely-positioned overlay
 * with 5 mutually-exclusive mode buttons (Pan / Info / Bbox / Lasso / Circle) and a
 * conditional Trash "Clear all" button.
 *
 * Anti-pattern lock (29-CONTEXT.md / STATE.md): NEVER subclass ol/control/Control.
 * Root-cause family of GAP-24-01-A / GAP-24-02-A. This is a pure React component;
 * positioning is via CSS, pointer-events: none on container + pointer-events: auto
 * on buttons (V15-P-17 mitigation).
 *
 * Stateless — receives drawMode + shapesCount via props; emits onModeChange + onClearAll.
 * All state lives in MapChartRenderer (Plans 01 + 03).
 *
 * Re-click already-active button = no-op (29-CONTEXT.md operator lock).
 */
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHand,
  faCircleInfo,
  faVectorSquare,
  faDrawPolygon,
  faCircle,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import type { DrawMode } from "../../lib/shapeDraw";

type Props = {
  drawMode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  shapesCount: number;
  onClearAll: () => void;
};

// Render order locked by 29-UI-SPEC.md Component Inventory.
const MODE_BUTTONS: Array<{ mode: DrawMode; icon: IconDefinition; label: string }> = [
  { mode: "pan",    icon: faHand,         label: "Pan" },
  { mode: "info",   icon: faCircleInfo,   label: "Info" },
  { mode: "bbox",   icon: faVectorSquare, label: "Draw bounding box" },
  { mode: "lasso",  icon: faDrawPolygon,  label: "Draw lasso" },
  { mode: "circle", icon: faCircle,       label: "Draw circle" },
];

export default function MapDrawToolbar({ drawMode, onModeChange, shapesCount, onClearAll }: Props) {
  return (
    <div className="map-draw-toolbar" role="toolbar" aria-label="Drawing tools">
      {MODE_BUTTONS.map(({ mode, icon, label }) => {
        const isActive = drawMode === mode;
        return (
          <button
            key={mode}
            type="button"
            className={`map-draw-toolbar-btn${isActive ? " is-active" : ""}`}
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => {
              // 29-CONTEXT.md re-click lock: clicking the already-active mode is a no-op.
              if (isActive) return;
              onModeChange(mode);
            }}
          >
            <FontAwesomeIcon icon={icon} />
          </button>
        );
      })}
      {shapesCount > 0 && (
        <>
          <div className="map-draw-toolbar-divider" aria-hidden="true" />
          <button
            type="button"
            className="map-draw-toolbar-btn map-draw-toolbar-trash"
            aria-label="Clear all shapes"
            onClick={onClearAll}
          >
            <FontAwesomeIcon icon={faTrash} />
          </button>
        </>
      )}
    </div>
  );
}
```

Step 2 — Append the CSS class block to `kinetica_bi/src/styles/global.css`. Find the existing `.widget-map-toolbar` section (around line 1530) and APPEND immediately after it (before `.widget-map-empty` at line 1556). Use this EXACT block:

```css
/* ============================================================
   Phase 29 (DRAW-V15-01): MapDrawToolbar
   - Absolutely-positioned React overlay, sits inside .widget-map sibling to .widget-map-canvas.
   - pointer-events: none on container; pointer-events: auto on individual buttons
     (V15-P-17 lock: prevents accidental OL event swallowing in gaps between buttons).
   - Vertical column of 36×36 icon buttons; visually abuts the OL zoom control (top-left).
   ============================================================ */
.map-draw-toolbar {
  position: absolute;
  /* Below the OL zoom control's two stacked buttons (~0.5em + 2 * (1.375em + 1px)).
     Hard-coded value can be refined in a follow-up pass per 29-RESEARCH.md Open Question 1. */
  top: 3.25em;
  left: 0.5em;
  display: flex;
  flex-direction: column;
  gap: 0;
  pointer-events: none;
  z-index: 1001;
}

.map-draw-toolbar-btn {
  pointer-events: auto;
  width: 36px;
  height: 36px;
  min-width: 36px;
  min-height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(11, 18, 36, 0.85);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 0;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
  padding: 0;
  font-size: 14px;
}

.map-draw-toolbar-btn:first-child {
  border-radius: 8px 8px 0 0;
}

.map-draw-toolbar-btn:last-child {
  border-radius: 0 0 8px 8px;
}

.map-draw-toolbar-btn.is-active {
  background: var(--accent);
  color: #0b1224;
  border-color: var(--accent);
}

.map-draw-toolbar-btn:hover:not(.is-active) {
  border-color: var(--accent);
  color: var(--accent);
  background: rgba(11, 18, 36, 0.95);
}

.map-draw-toolbar-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.map-draw-toolbar-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 4px;
  pointer-events: none;
}
```

Step 3 — Run `cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx` → confirm all 12 tests pass (GREEN).

Step 4 — Run `npx tsc --noEmit` → confirm 0 TS errors.

Step 5 — Commit: `feat(29-02): MapDrawToolbar component + CSS (DRAW-V15-01)`.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx 2>&1 | tail -10</automated>
  </verify>
  <acceptance_criteria>
    - File exists: `kinetica_bi/src/components/charts/MapDrawToolbar.tsx`
    - `grep -n "export default function MapDrawToolbar" kinetica_bi/src/components/charts/MapDrawToolbar.tsx` returns exactly 1 line
    - `grep -n "FontAwesomeIcon" kinetica_bi/src/components/charts/MapDrawToolbar.tsx` returns at least 2 matches (mode buttons + trash)
    - `grep -nE "(faHand|faCircleInfo|faVectorSquare|faDrawPolygon|faCircle|faTrash)" kinetica_bi/src/components/charts/MapDrawToolbar.tsx | wc -l` returns at least 6 (one for each icon)
    - `grep -n 'role="toolbar"' kinetica_bi/src/components/charts/MapDrawToolbar.tsx` returns exactly 1 line
    - `grep -nE "aria-label=\"(Pan|Info|Draw bounding box|Draw lasso|Draw circle|Clear all shapes)\"" kinetica_bi/src/components/charts/MapDrawToolbar.tsx | wc -l` returns at least 6
    - `grep -n "if (isActive) return" kinetica_bi/src/components/charts/MapDrawToolbar.tsx` returns at least 1 line (re-click no-op)
    - `grep -n "shapesCount > 0" kinetica_bi/src/components/charts/MapDrawToolbar.tsx` returns at least 1 line (trash conditional render)
    - `grep -n ".map-draw-toolbar {" kinetica_bi/src/styles/global.css` returns at least 1 line
    - `grep -n ".map-draw-toolbar-btn" kinetica_bi/src/styles/global.css` returns at least 3 matches (base, is-active, hover or focus)
    - `grep -n "pointer-events: none" kinetica_bi/src/styles/global.css | grep "map-draw-toolbar"` returns at least 1 (V15-P-17 lock present)
    - `grep -n "pointer-events: auto" kinetica_bi/src/styles/global.css | grep -i "draw-toolbar"` returns at least 1
    - `cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx` exits 0 with 12/12 tests passing
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
    - `cd kinetica_bi && npx vitest run` (full suite) exits 0 (no regressions in any prior test)
  </acceptance_criteria>
  <done>
    MapDrawToolbar component shipped with vitest spec all-green; CSS classes appended to global.css. Component is stateless and ready to be mounted by MapChartRenderer in Plan 03. No production wiring yet — Plan 03 imports and renders this component.
  </done>
</task>

</tasks>

<verification>
**Automated verification:**
- `cd kinetica_bi && npx vitest run src/components/charts/MapDrawToolbar.spec.tsx` — 12/12 passing
- `cd kinetica_bi && npx vitest run` — full suite green (no regressions)
- `cd kinetica_bi && npx tsc --noEmit` — 0 errors

**Manual verification (optional; full visual check happens after Plan 03 wires it in):**
- Open Storybook or a sandbox if available; render `<MapDrawToolbar drawMode="bbox" onModeChange={console.log} shapesCount={0} onClearAll={console.log} />` and confirm icons render. Not required for this plan — Plan 03 brings it into a real dashboard.
</verification>

<success_criteria>
1. `MapDrawToolbar.tsx` exists with default export matching the contract in 29-UI-SPEC.md
2. All 12 tests in `MapDrawToolbar.spec.tsx` pass green
3. CSS classes `.map-draw-toolbar`, `.map-draw-toolbar-btn`, `.map-draw-toolbar-btn.is-active`, `.map-draw-toolbar-divider` exist in global.css with pointer-events: none / auto split (V15-P-17 lock)
4. Component uses Font Awesome per-icon imports (faHand, faCircleInfo, faVectorSquare, faDrawPolygon, faCircle, faTrash)
5. Re-click on active mode is a no-op (CONTEXT.md re-click lock); Trash hidden when shapesCount === 0
6. aria-labels exactly match UI-SPEC strings; mode buttons carry aria-pressed
7. Full vitest suite green; tsc clean
</success_criteria>

<output>
After completion, create `.planning/phases/29-draw-and-shape/29-02-SUMMARY.md` documenting:
- Final component shape (props, render order, conditional Trash)
- CSS class names + the EXACT `top: 3.25em` value used (so Plan 03 can verify visual seam with OL zoom control during integration)
- Confirmation that all 12 spec tests pass
- Any deviations from this plan (especially any CSS tweaks made for visual continuity)
</output>

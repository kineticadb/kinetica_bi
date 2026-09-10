---
phase: 22-config-ui
plan: "01"
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/package.json
  - kinetica_bi/package-lock.json
  - kinetica_bi/src/components/charts/ChipCombobox.tsx
  - kinetica_bi/src/components/charts/ChipCombobox.spec.tsx
  - kinetica_bi/src/styles/global.css
autonomous: true
requirements:
  - CONFIG-V14-03

must_haves:
  truths:
    - "@uiw/react-codemirror and @codemirror/lang-html are installed and importable"
    - "ChipCombobox component renders all options as chips with selected state, fires onChange with next selected[] array"
    - ".info-popup-config-* CSS classes exist in global.css for the new INFO POPUP section"
  artifacts:
    - path: "kinetica_bi/package.json"
      provides: "Dependency declarations for @uiw/react-codemirror + @codemirror/lang-html"
      contains: "@uiw/react-codemirror"
    - path: "kinetica_bi/src/components/charts/ChipCombobox.tsx"
      provides: "Custom chip-combobox component with all-options-as-chips display + click-to-toggle"
      exports: ["default"]
    - path: "kinetica_bi/src/components/charts/ChipCombobox.spec.tsx"
      provides: "vitest spec covering render-all-chips, selected-state, click-toggle, alphabetical order, optional-types, disabled-state"
    - path: "kinetica_bi/src/styles/global.css"
      provides: ".info-popup-config-* CSS classes (chips, editor wrapper, inline error, disabled-section state)"
      contains: ".info-popup-config-section"
  key_links:
    - from: "kinetica_bi/src/components/charts/ChipCombobox.tsx"
      to: "kinetica_bi/src/styles/global.css"
      via: "className strings .info-popup-config-chip / .info-popup-config-chip.selected / .info-popup-config-chips"
      pattern: "info-popup-config-chip"
---

<objective>
Lock library + custom-component foundation for Phase 22 INFO POPUP sections — install CodeMirror 6 React wrapper + HTML language pack, build a custom `ChipCombobox` component (no library — bundle target favored vs. ~12-30 KB headless lib costs), and add `.info-popup-config-*` CSS class scaffolding so Plans 22-02 and 22-03 import ready-made primitives.

Purpose: Prevent Plan 22-03 from blocking on package-install permission prompts mid-flow; lock the chip-combobox decision before component code lands; centralize CSS so both layer + widget INFO POPUP sections share a single source of truth.

Output:
- `package.json` carrying `@uiw/react-codemirror` + `@codemirror/lang-html` (locked exact import paths in plan-text)
- `kinetica_bi/src/components/charts/ChipCombobox.tsx` reusable component + spec
- `.info-popup-config-*` CSS appended to `kinetica_bi/src/styles/global.css`
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/22-config-ui/22-CONTEXT.md

# Existing CSS pattern reference (mirror naming + variables)
@kinetica_bi/src/styles/global.css

# Existing package.json (extension target — append to dependencies)
@kinetica_bi/package.json

<interfaces>
<!-- ChipCombobox public interface — locked here so Plans 22-02/03 implement against this contract -->

```typescript
// kinetica_bi/src/components/charts/ChipCombobox.tsx
export type ChipComboboxOption = {
  /** Stable key — column name. */
  value: string;
  /** Optional secondary label rendered in the dropdown only (NOT on the chip itself). e.g. "DOUBLE" for type display. */
  typeLabel?: string;
};

export type ChipComboboxProps = {
  /** All available options (already sorted alphabetically by caller). */
  options: ChipComboboxOption[];
  /**
   * Currently selected values. When `null`, treat as the "all-selected" sentinel —
   * every chip renders selected; the caller's onChange receives an explicit
   * `string[]` only the first time the user deselects.
   */
  selected: string[] | null;
  /** Caller is responsible for converting to the persisted JSON shape. */
  onChange: (next: string[] | null) => void;
  /** Disabled state — all chips non-interactive, aria-disabled='true'. */
  disabled?: boolean;
  /** A11y label for the chip group container (e.g., "Info popup columns"). */
  ariaLabel?: string;
};

export default function ChipCombobox(props: ChipComboboxProps): JSX.Element;
```

`null` semantics: if `selected === null` AND user clicks a chip to deselect it, `onChange` fires with `(allOptionValues except clicked)`. If `selected === string[]` AND user clicks a chip to select it back, the caller decides whether to compress to `null` when the result equals all options (Plan 22-03 owns this — see its "info_columns sentinel preservation" task).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install CodeMirror 6 React wrapper + HTML language pack</name>
  <files>kinetica_bi/package.json, kinetica_bi/package-lock.json</files>
  <read_first>
    - kinetica_bi/package.json (current dependencies — confirm only `clsx`, `ol`, `react`, `react-dom`, `react-grid-layout`, `recharts`, `zustand`)
    - .planning/phases/22-config-ui/22-CONTEXT.md § Implementation Decisions § HTML template editor UX (CodeMirror 6 lock; bundle ~50 KB gzip)
  </read_first>
  <action>
    Run from the `kinetica_bi/` directory (NOT the repo root — package.json lives in `kinetica_bi/`):

    ```
    cd kinetica_bi && npm install @uiw/react-codemirror@^4.25.9 @codemirror/lang-html@^6.4.9
    ```

    These two packages are the LOCKED choice for the `info_template` editor:
    - `@uiw/react-codemirror` v4.x — the canonical React wrapper around CodeMirror 6. Provides controlled `value` + `onChange` + `extensions` API. Pulls in `@codemirror/state`, `@codemirror/view`, `@codemirror/commands`, `codemirror` as transitive deps.
    - `@codemirror/lang-html` v6.x — HTML syntax highlighting + bracket matching extension; imported as `import { html } from "@codemirror/lang-html"` and added to `extensions={[html()]}`.

    Total bundle impact: ~50-60 KB gzip (within CONTEXT.md target of <500 KB Monaco alternative).

    DO NOT install Monaco (`monaco-editor`, `@monaco-editor/react`) — explicitly rejected per 22-CONTEXT.md.
    DO NOT install any chip-combobox library (e.g., `react-select`, `@headlessui/react`, `cmdk`) — Plan locks to a custom build (see Task 2).

    After install, verify `package.json` `dependencies` block contains BOTH new keys with semver-prefixed versions, and verify `package-lock.json` was updated (`git diff --stat kinetica_bi/package-lock.json` should show > 0 lines changed).

    Commit message: `feat(22-01): install CodeMirror 6 React wrapper + HTML language pack`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && grep -q '"@uiw/react-codemirror"' package.json && grep -q '"@codemirror/lang-html"' package.json && test -d node_modules/@uiw/react-codemirror && test -d node_modules/@codemirror/lang-html
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/package.json` `dependencies` block contains `"@uiw/react-codemirror"` (grep returns 1 match)
    - `kinetica_bi/package.json` `dependencies` block contains `"@codemirror/lang-html"` (grep returns 1 match)
    - `kinetica_bi/node_modules/@uiw/react-codemirror/` directory exists
    - `kinetica_bi/node_modules/@codemirror/lang-html/` directory exists
    - `kinetica_bi/package-lock.json` is modified (`git diff --quiet kinetica_bi/package-lock.json` exits non-zero)
    - NO `monaco-editor`, `@monaco-editor/react`, `react-select`, `@headlessui/react`, or `cmdk` appears in `package.json` (grep these strings — must return 0 matches)
  </acceptance_criteria>
  <done>Both packages resolvable via `import CodeMirror from "@uiw/react-codemirror"` and `import { html } from "@codemirror/lang-html"` from any TS file under `kinetica_bi/src/`.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Build ChipCombobox component + spec (custom, no library)</name>
  <files>kinetica_bi/src/components/charts/ChipCombobox.tsx, kinetica_bi/src/components/charts/ChipCombobox.spec.tsx</files>
  <read_first>
    - kinetica_bi/src/components/charts/MapConfigPanel.tsx (mirror config-group / className idioms)
    - kinetica_bi/src/components/charts/KineticaWmsLayerForm.tsx lines 195-250 (existing pattern: dropdown-with-rows shape)
    - kinetica_bi/src/components/charts/MapConfigPanel.spec.tsx (mirror render+fireEvent test idiom)
    - kinetica_bi/src/styles/global.css lines 805-870 (.config-panel, .config-group, .ds-select tokens for visual parity)
  </read_first>
  <behavior>
    Spec contract — write FIRST, implementation must satisfy:
    - C1: renders ALL options as chip buttons with className `info-popup-config-chip` (one per option)
    - C2: when `selected === null`, EVERY chip has the `selected` className (visually all chips are present)
    - C3: when `selected === ["a", "b"]` and options are `[a, b, c]`, only `a` and `b` chips have `selected` className
    - C4: clicking a selected chip in `selected === null` state calls `onChange` with `(allOptions except clicked)` as a `string[]` (NOT null). E.g., options `[a, b, c]`, selected null, click `b` → `onChange(["a", "c"])`
    - C5: clicking an unselected chip when `selected === ["a"]` calls `onChange(["a", clicked])` preserving order
    - C6: clicking a selected chip when `selected === ["a", "b"]` calls `onChange` with the array minus that chip — e.g., click `a` → `onChange(["b"])`
    - C7: when `disabled === true`, every chip has `aria-disabled="true"` and `disabled` attribute set; clicking a chip does NOT call `onChange`
    - C8: when `options[i].typeLabel` is set, it renders inside the dropdown (a separate `<select>` "Insert column" picker — NOT on the chip itself); chips render only `option.value`
    - Wait — typeLabel is for OPTIONS dropdowns (Plan 22-03 Insert-column picker), NOT chips. ChipCombobox renders chips only. typeLabel is exposed on the type for future dropdown reuse but ChipCombobox itself does NOT render typeLabel anywhere — chip text is `option.value` ONLY. Drop C8 if not needed; replace with: "C8: chips render only `option.value` text (NOT typeLabel)"
    - C9: container has `aria-label={ariaLabel}` when `ariaLabel` prop set; falls back to `Selectable chips` when absent
    - C10: chip order in DOM matches `options` array order (caller sorts)
  </behavior>
  <action>
    **Step 1 (RED): Write `ChipCombobox.spec.tsx` first** with 10 tests (C1–C10 above). All tests render `<ChipCombobox options=... selected=... onChange={vi.fn()} />` and assert via `screen.getAllByRole("button")`, `fireEvent.click`, `expect(onChange).toHaveBeenCalledWith(...)`. No store mocks needed — this is a fully-controlled pure component.

    Test fixture:
    ```typescript
    const sampleOptions = [
      { value: "lat" }, { value: "lon" }, { value: "vendor_id", typeLabel: "VARCHAR" }
    ];
    ```

    Run `npm test -- --run ChipCombobox.spec.tsx` from `kinetica_bi/` — must FAIL (file doesn't exist yet).

    Commit message: `test(22-01): add failing spec for ChipCombobox`

    **Step 2 (GREEN): Write `ChipCombobox.tsx`** matching the locked interface in `<interfaces>` block above:

    ```typescript
    /**
     * Phase 22 (CONFIG-V14-03) — Custom chip-combobox for the layer info-popup column picker.
     *
     * Why custom (not a library): bundle target was <20 KB gzip per 22-CONTEXT.md; smallest
     * mainstream React combobox libraries (react-select v5: ~30KB, @headlessui/react Combobox:
     * ~12KB but requires Tailwind ergonomics, cmdk: ~7KB but command-palette UX), so a 50-line
     * custom build that matches existing config-group styling wins on bundle + visual parity.
     *
     * `null` selected sentinel: when caller passes selected=null, ALL chips render as selected
     * (visually communicates "all columns are included by default"). The very first deselect
     * fires onChange with the explicit string[] of remaining options. The caller (Plan 22-03
     * KineticaWmsLayerForm) is responsible for compressing back to null when the user re-selects
     * everything — that policy is NOT in this component.
     */
    import { useMemo } from "react";

    export type ChipComboboxOption = { value: string; typeLabel?: string };
    export type ChipComboboxProps = {
      options: ChipComboboxOption[];
      selected: string[] | null;
      onChange: (next: string[] | null) => void;
      disabled?: boolean;
      ariaLabel?: string;
    };

    export default function ChipCombobox({
      options, selected, onChange, disabled = false, ariaLabel,
    }: ChipComboboxProps): JSX.Element {
      const selectedSet = useMemo(
        () => (selected === null ? new Set(options.map((o) => o.value)) : new Set(selected)),
        [selected, options],
      );

      const handleClick = (value: string) => {
        if (disabled) return;
        // Materialize from null sentinel on first deselect:
        const baseline = selected === null ? options.map((o) => o.value) : selected;
        if (selectedSet.has(value)) {
          onChange(baseline.filter((v) => v !== value));
        } else {
          onChange([...baseline, value]);
        }
      };

      return (
        <div
          className="info-popup-config-chips"
          role="group"
          aria-label={ariaLabel ?? "Selectable chips"}
        >
          {options.map((opt) => {
            const isSelected = selectedSet.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                className={`info-popup-config-chip${isSelected ? " selected" : ""}`}
                onClick={() => handleClick(opt.value)}
                disabled={disabled}
                aria-disabled={disabled}
                aria-pressed={isSelected}
              >
                {opt.value}
              </button>
            );
          })}
        </div>
      );
    }
    ```

    Run `npm test -- --run ChipCombobox.spec.tsx` — must PASS (10/10).

    Commit message: `feat(22-01): add ChipCombobox custom component`
  </action>
  <verify>
    <automated>
      cd kinetica_bi && npx vitest run src/components/charts/ChipCombobox.spec.tsx
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/components/charts/ChipCombobox.tsx` exists and exports `default`, `ChipComboboxOption`, `ChipComboboxProps`
    - `kinetica_bi/src/components/charts/ChipCombobox.spec.tsx` exists with at least 10 `it(` blocks (grep `'  it('` returns >= 10)
    - `npx vitest run src/components/charts/ChipCombobox.spec.tsx` exits 0 with all tests green
    - Component renders chips with className containing `info-popup-config-chip`
    - `grep "import.*react-select\|import.*@headlessui\|import.*cmdk" kinetica_bi/src/components/charts/ChipCombobox.tsx` returns 0 lines (no library imports)
    - `wc -l kinetica_bi/src/components/charts/ChipCombobox.tsx` < 100 (custom-implementation budget per CONTEXT.md)
  </acceptance_criteria>
  <done>10 spec tests green; ChipCombobox importable from `../charts/ChipCombobox` by Plan 22-03; null-sentinel materialization-on-first-deselect contract verified by C4.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Add .info-popup-config-* CSS classes to global.css</name>
  <files>kinetica_bi/src/styles/global.css</files>
  <read_first>
    - kinetica_bi/src/styles/global.css lines 805-880 (.config-panel, .config-group, .config-toggle, .ds-select tokens)
    - kinetica_bi/src/styles/global.css lines 1980-2003 (existing .info-popup-* classes from Phase 21 — namespace continuity)
    - .planning/phases/22-config-ui/22-CONTEXT.md § Validation + save flow § "Disable sub-fields when toggle is off" (CSS variable reuse via existing tokens)
  </read_first>
  <action>
    Append a new block to `kinetica_bi/src/styles/global.css` AFTER the existing `.info-popup-*` block (which ends around line 2003). The new block ADDS classes — does NOT modify any existing selectors. Class namespace: `.info-popup-config-*` (parity with `.info-popup-*` from Phase 21).

    Insert this exact block at end of file:

    ```css
    /* ─── Phase 22 (CONFIG-V14-03/04) — INFO POPUP config section ──────────── */

    /* Section disabled state (missing-table predicate from LayersModal:142-143) */
    .info-popup-config-section.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    .info-popup-config-section-message {
      font-size: 13px;
      color: var(--muted);
      font-style: italic;
      padding: 8px 0;
    }

    /* Chip container — flex-wrap row of chip buttons */
    .info-popup-config-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 0;
    }

    /* Individual chip (deselected state — the default 'click to add') */
    .info-popup-config-chip {
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 4px 12px;
      font-size: 13px;
      color: var(--muted);
      cursor: pointer;
      font-family: inherit;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .info-popup-config-chip:hover:not(:disabled) {
      border-color: var(--accent);
      color: var(--text);
    }

    /* Selected state — solid accent fill, dark text */
    .info-popup-config-chip.selected {
      background: var(--accent);
      border-color: var(--accent);
      color: #0b1224;
      font-weight: 500;
    }

    .info-popup-config-chip:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* CodeMirror wrapper — min-height + border parity with .ds-field input */
    .info-popup-config-editor {
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
      background: #0b1224;
    }

    .info-popup-config-editor.disabled {
      opacity: 0.5;
      pointer-events: none;
    }

    /* Inline syntax note + security warning (verbatim copy in Plan 22-03) */
    .info-popup-config-syntax-note {
      font-size: 12px;
      color: var(--muted);
      margin-top: 4px;
      line-height: 1.4;
    }

    .info-popup-config-security-note {
      font-size: 12px;
      color: #f59e0b;
      margin-top: 2px;
      line-height: 1.4;
    }

    /* Inline error for radius clamp (auto-dismiss after ~3s; Plan 22-02 owns the timer) */
    .info-popup-config-inline-error {
      font-size: 12px;
      color: #ef4444;
      margin-top: 4px;
    }

    /* "Insert column" picker dropdown above the editor */
    .info-popup-config-insert-column {
      margin-bottom: 8px;
    }
    ```

    Commit message: `feat(22-01): add .info-popup-config-* CSS classes`
  </action>
  <verify>
    <automated>
      grep -c "^\.info-popup-config-" kinetica_bi/src/styles/global.css | awk '{ if ($1 >= 9) exit 0; else exit 1 }'
    </automated>
  </verify>
  <acceptance_criteria>
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-section` selector (grep returns 1 match)
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-chip` selector (grep returns 1 match)
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-chip.selected` selector (grep returns 1 match)
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-editor` selector
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-syntax-note` selector
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-security-note` selector
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-inline-error` selector
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-insert-column` selector
    - `kinetica_bi/src/styles/global.css` contains `.info-popup-config-section-message` selector
    - File line count increased by 60-80 lines vs prior commit
    - All new selectors use existing CSS custom properties (`var(--accent)`, `var(--border)`, `var(--muted)`, `var(--text)`) — no new color literals introduced beyond chip-selected text `#0b1224` and warning `#f59e0b` / error `#ef4444` (matches existing pattern at lines 239, 248, 729)
  </acceptance_criteria>
  <done>9+ new `.info-popup-config-*` selectors present in global.css; Plans 22-02 and 22-03 reference them by class name only (no inline styles needed).</done>
</task>

</tasks>

<verification>
After all 3 tasks complete:
1. `cd kinetica_bi && npx tsc --noEmit` exits 0 (CodeMirror types resolved)
2. `cd kinetica_bi && npx vitest run src/components/charts/ChipCombobox.spec.tsx` exits 0 (10/10 green)
3. `grep -c "^\.info-popup-config-" kinetica_bi/src/styles/global.css` returns >= 9
4. `git status` shows package.json + package-lock.json + ChipCombobox.tsx + ChipCombobox.spec.tsx + global.css modified — exactly 5 files
</verification>

<success_criteria>
- @uiw/react-codemirror + @codemirror/lang-html installed and importable
- ChipCombobox.tsx public interface matches `<interfaces>` block (default export + ChipComboboxOption + ChipComboboxProps types)
- ChipCombobox spec covers all 10 behavior cases (C1-C10) with tests green
- Custom implementation budget: ChipCombobox.tsx < 100 lines (no library imports)
- `.info-popup-config-*` CSS namespace established with 9+ selectors using existing CSS variables
- No Monaco / react-select / headlessui / cmdk dependencies (anti-pattern guard)
</success_criteria>

<output>
After completion, create `.planning/phases/22-config-ui/22-01-foundation-SUMMARY.md` with:
- Commits log (3 commits expected: install + spec + impl + CSS — Tasks 2's RED+GREEN may merge into 1)
- Bundle-size note (CodeMirror gzipped contribution; ChipCombobox custom LOC count)
- Locked decisions: chip combobox = custom (rejected libraries listed); CodeMirror 6 = `@uiw/react-codemirror` v4.x with `@codemirror/lang-html` v6.x
- Next phase readiness: Plan 22-02 imports nothing from this plan (independent); Plan 22-03 imports `ChipCombobox` from `./ChipCombobox` and CodeMirror from `@uiw/react-codemirror`
</output>

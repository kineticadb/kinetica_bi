---
phase: 21-map-click-popup
plan: 01
type: tdd
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/renderInfoTemplate.ts
  - kinetica_bi/src/lib/renderInfoTemplate.spec.ts
autonomous: true
requirements:
  - POPUP-V14-04
must_haves:
  truths:
    - "renderInfoTemplate returns mode='template' with substituted HTML when template is non-null"
    - "renderInfoTemplate returns mode='kv' with column-value pairs when template is null"
    - "Token substitution uses {column_name} syntax (literal substitution only — no expressions, no escaping)"
    - "info_columns JSON-array string parses successfully and selects only those columns for kv mode"
    - "Malformed info_columns JSON falls back to all response columns without throwing"
    - "Phase 23 Info Card can import the same helper without React/UI deps"
  artifacts:
    - path: "kinetica_bi/src/lib/renderInfoTemplate.ts"
      provides: "Pure helper returning discriminated-union render result"
      exports: ["renderInfoTemplate", "RenderResult"]
      contains: "export function renderInfoTemplate"
      min_lines: 35
    - path: "kinetica_bi/src/lib/renderInfoTemplate.spec.ts"
      provides: "Vitest spec covering template substitution, kv fallback, info_columns parsing, parse-error fallback"
      contains: "describe(\"renderInfoTemplate\""
      min_lines: 80
  key_links:
    - from: "kinetica_bi/src/lib/renderInfoTemplate.ts"
      to: "row[columnName] substitution"
      via: "regex /\\{(\\w+)\\}/g replace"
      pattern: "replace\\(/\\\\\\{\\(\\\\w\\+\\)\\\\\\}/g"
    - from: "kinetica_bi/src/lib/renderInfoTemplate.ts"
      to: "info_columns parse fallback"
      via: "try/catch on JSON.parse"
      pattern: "try.*JSON\\.parse.*catch"
---

<objective>
Create a pure, framework-agnostic `renderInfoTemplate` helper that converts a Kinetica info-query row into one of two render modes: a substituted HTML template string (when `info_template` is configured) or a column-value pair list (when no template is set). This helper is the SHARED rendering primitive consumed by both the Phase 21 popup AND the Phase 23 Info Card — extracting it now (Phase 21 Wave 1) means Phase 23 imports the same function with zero refactor.

Purpose: Lock the template-substitution syntax (`{column_name}`) and the `info_columns` JSON-parse fallback path BEFORE any React component depends on it. Pure helper isolates the policy decisions (no sanitization per PROJECT.md Key Decision; lenient JSON parse with all-columns fallback) from the UI integration that follows in Plan 21-02.

Output:
- `kinetica_bi/src/lib/renderInfoTemplate.ts` — pure function, zero React/UI/network imports
- `kinetica_bi/src/lib/renderInfoTemplate.spec.ts` — vitest spec covering all branches
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/21-map-click-popup/21-CONTEXT.md
@.planning/phases/21-map-click-popup/21-RESEARCH.md
@kinetica_bi/src/api/client.ts
@kinetica_bi/src/lib/mapInfoConfig.ts

<interfaces>
<!-- Existing types the helper consumes / mirrors. Executor uses these directly — no codebase exploration needed. -->

From kinetica_bi/src/api/client.ts (Phase 19 — already shipped):
```typescript
export type DashboardLayerDto = {
  id: number;
  dashboard_id: number;
  table_id: number;
  layer_type: LayerType;
  position: number;
  config: Record<string, unknown>;
  // v1.4 Phase 19 (CONFIG-V14-01/02): info popup config columns
  info_enabled: number;          // 0 or 1 (SQLite INTEGER)
  info_columns: string | null;   // JSON-array string e.g. '["lon","lat"]', or null
  info_template: string | null;  // raw HTML template string, or null
  created_at: string;
  updated_at: string;
};
```

The Phase 18 endpoint (POST /api/info/query) returns rows + columns:
```typescript
// kinetica_bi/server/src/index.ts:762-764 (response shape)
{ rows: Record<string, unknown>[], columns: string[], hasMore: boolean, page: number }
```

LOCKED decision (PROJECT.md Key Decision, repeated in CONTEXT.md):
- HTML template: NO sanitization. Dashboard authors are privileged users (analogous to saved SQL queries). Inline comment in renderInfoTemplate.ts MUST cite this lock.

LOCKED decision (CONTEXT.md § Template rendering):
- Token syntax: `{column_name}` (Tableau/Grafana convention). Literal substitution only. NO expressions, NO escaping, NO logic.
- Substitution: `String(row[columnName] ?? "")` — null/undefined coerce to empty string.

LOCKED decision (CONTEXT.md § Template rendering, key-value fallback):
- info_columns is the RAW JSON-array string from DashboardLayerDto (`'["lon","lat"]'`).
- Parse with try/catch; on parse error or non-array result, fall back to all response columns.
- When info_columns is null, use all response columns.
</interfaces>
</context>

<behavior>
<!-- Test expectations made explicit before implementation (TDD: write failing tests first). -->

The spec MUST cover at minimum these test cases:

Template mode:
- Test T1: template="<b>{name}</b> at {city}", row={name:"Alice", city:"SF"} → mode="template", html="<b>Alice</b> at SF"
- Test T2: template with token referencing missing column ("{ghost}"), row has no "ghost" key → "" substituted (empty string, not "undefined" / "null")
- Test T3: template with token referencing column whose value is null → "" substituted
- Test T4: template with no tokens (plain HTML) → returned verbatim, no replacements
- Test T5: template with multiple occurrences of same token "{x}{x}" → both substituted independently
- Test T6: template="" (empty string) is treated as "configured template" → mode="template", html=""
  Rationale: caller passes `template: layer.info_template ?? null`. The null branch is the kv-fallback trigger; an explicit empty-string template is the author's choice and renders as an empty HTML node.
  (NOTE: if reviewer prefers empty-string-as-null fallback, document the deviation in summary; current contract treats `""` as template mode.)

Key-value mode:
- Test KV1: template=null, columns=["a","b"], row={a:1, b:"x"}, infoColumns=null → mode="kv", pairs=[{col:"a",value:1},{col:"b",value:"x"}]
- Test KV2: template=null, columns=["a","b","c"], infoColumns='["a","c"]' → pairs covers a + c only, in info_columns order
- Test KV3: template=null, infoColumns='["unknown"]' (not in response columns) → pairs=[{col:"unknown", value: undefined}] — substring still attempts row lookup; documents lenient behavior
- Test KV4: template=null, infoColumns='not valid json{{' (parse error) → falls back to all response columns; does NOT throw
- Test KV5: template=null, infoColumns='[]' (empty array, valid JSON) → empty array result is treated as parse-fail equivalent (locked: "if (Array.isArray(parsed) && parsed.length > 0) cols = parsed" — empty array falls back to all columns)
- Test KV6: template=null, infoColumns='{"not":"array"}' (valid JSON, wrong shape) → falls back to all response columns
- Test KV7: row contains nested object → pairs.value preserves the object (no string coercion in kv mode; caller renders)
</behavior>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Write renderInfoTemplate helper + spec (RED → GREEN)</name>
  <files>kinetica_bi/src/lib/renderInfoTemplate.ts, kinetica_bi/src/lib/renderInfoTemplate.spec.ts</files>
  <read_first>
    - .planning/phases/21-map-click-popup/21-CONTEXT.md (§ Template rendering — LOCKED token syntax + no-sanitize policy)
    - .planning/phases/21-map-click-popup/21-RESEARCH.md (§ Pattern 4 — discriminated-union signature; § Pitfall 4 documents EPSG-vs-info concerns NOT relevant here, just for sibling context)
    - kinetica_bi/src/lib/mapInfoConfig.ts (sibling pure helper from Phase 19 — mirror its zero-runtime-deps structure: only `import type` for shared types; module header docstring citing locked decisions)
    - kinetica_bi/src/api/client.ts:446-466 (DashboardLayerDto.info_columns / info_template field types so the helper signature accepts the raw values verbatim)
  </read_first>
  <behavior>
    See &lt;behavior&gt; block above for the full T1-T6 + KV1-KV7 test list.

    Test grouping (suggested):
    - describe("renderInfoTemplate", () => {
        describe("template mode", () => { /* T1-T6 */ });
        describe("kv mode", () => { /* KV1-KV7 */ });
      });

    All tests use Vitest's `it.each` where parameterization makes sense (e.g., the 6 template-mode cases parameterize over template/row pairs).

    Spec MUST include the following grep-anchor regression tag in a comment at the top:
    ```
    // POPUP-V14-04 — shared template-rendering helper (Phase 21 popup + Phase 23 Info Card)
    ```
  </behavior>
  <action>
    RED first: write `kinetica_bi/src/lib/renderInfoTemplate.spec.ts` with all T1-T6 + KV1-KV7 cases; run `cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts` and confirm RED (file/function not found).

    GREEN: create `kinetica_bi/src/lib/renderInfoTemplate.ts` with the EXACT signature below.

    File header docstring (verbatim — adapt only the v1.4 Phase comment):
    ```typescript
    /**
     * Phase 21 (POPUP-V14-04) — shared info-popup template rendering helper.
     *
     * CONSUMERS:
     *   - Phase 21 InfoPopup.tsx (kinetica_bi/src/components/charts/InfoPopup.tsx) — map click popup body.
     *   - Phase 23 Info Card renderer — info-card chart type.
     * Both use this single helper so the popup and the Info Card render IDENTICALLY for the
     * same (template, row, info_columns) tuple. Locked at .planning/STATE.md § "Key v1.4
     * Architecture Decisions" — "Both Phase 21 (popup) and Phase 23 (Info Card) must use the
     * same shared `renderInfoTemplate` helper so rendering is consistent."
     *
     * NO HTML SANITIZATION — locked at .planning/PROJECT.md § "Current Milestone: v1.4 Map
     * Info Popup" Key Decision: "Dashboard authors are privileged users (analogous to saved
     * SQL queries). Risk documented in PROJECT.md Key Decisions." DO NOT add a sanitizer
     * library (DOMPurify, sanitize-html, etc.). The caller will pass the returned `html`
     * string straight to React's `dangerouslySetInnerHTML`.
     *
     * Token substitution syntax: {column_name} — Tableau/Grafana convention. Literal
     * substitution only. No expressions, no escaping, no logic. Locked at
     * .planning/phases/21-map-click-popup/21-CONTEXT.md § Template rendering.
     *
     * info_columns lenient parse: when the JSON parse fails OR the parsed value is not a
     * non-empty array, the helper falls back to using all response columns (the `columns`
     * arg). This matches the Phase 19 schema lock: info_columns is a free-form TEXT field
     * with no DB-level shape validation.
     */
    ```

    Type definitions (export both):
    ```typescript
    export type RenderResult =
      | { mode: "template"; html: string }
      | { mode: "kv"; pairs: { col: string; value: unknown }[] };

    export type RenderInfoTemplateArgs = {
      /** Raw `info_template` from DashboardLayerDto. null → kv-mode fallback. */
      template: string | null;
      /** Response columns from POST /api/info/query response. Used as kv-mode fallback when info_columns is null/invalid. */
      columns: string[];
      /** A single row from POST /api/info/query response (Record<string, unknown>). */
      row: Record<string, unknown>;
      /** Raw `info_columns` JSON-array string from DashboardLayerDto. null → all-columns kv-mode. */
      infoColumns?: string | null;
    };
    ```

    Function body:
    ```typescript
    export function renderInfoTemplate(args: RenderInfoTemplateArgs): RenderResult {
      // Template mode: non-null template (including empty string — author's choice) takes the
      // template branch. Caller maps null→"" before calling if they want "no template" to
      // mean kv-mode; this helper treats null as the kv-mode discriminator.
      if (args.template !== null) {
        const html = args.template.replace(/\{(\w+)\}/g, (_match, col: string) => {
          const v = args.row[col];
          // null and undefined both coerce to empty string (most user-facing rendering
          // wants "Alice" at "" rather than "Alice" at "null").
          return v === null || v === undefined ? "" : String(v);
        });
        return { mode: "template", html };
      }

      // kv mode: resolve column list — info_columns array (when valid + non-empty), else
      // fall back to all response columns.
      let cols: string[] = args.columns;
      if (args.infoColumns) {
        try {
          const parsed = JSON.parse(args.infoColumns) as unknown;
          if (Array.isArray(parsed) && parsed.length > 0 &&
              parsed.every((c) => typeof c === "string")) {
            cols = parsed as string[];
          }
          // Empty array, non-array, mixed-type array → fall through to args.columns (locked).
        } catch {
          // JSON parse error → fall through to args.columns (locked).
        }
      }

      return {
        mode: "kv",
        pairs: cols.map((col) => ({ col, value: args.row[col] })),
      };
    }
    ```

    GREEN check: rerun `cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts` and confirm all 13 tests pass.

    Type check: `cd kinetica_bi && npx tsc --noEmit` — must exit 0.

    REFACTOR (optional): if the regex needs hardening for unicode column names, use `[\w$]+` instead of `\w+`. Current locked syntax is ASCII column names only — defer hardening unless a test reveals breakage.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts && npx tsc --noEmit</automated>
  </verify>
  <acceptance_criteria>
    - File `kinetica_bi/src/lib/renderInfoTemplate.ts` exists
    - File `kinetica_bi/src/lib/renderInfoTemplate.spec.ts` exists
    - `grep -c "export function renderInfoTemplate" kinetica_bi/src/lib/renderInfoTemplate.ts` returns `1`
    - `grep -c "export type RenderResult" kinetica_bi/src/lib/renderInfoTemplate.ts` returns `1`
    - `grep -c "export type RenderInfoTemplateArgs" kinetica_bi/src/lib/renderInfoTemplate.ts` returns `1`
    - `grep -c 'mode: "template"' kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1`
    - `grep -c 'mode: "kv"' kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1`
    - `grep -c '/\\\\{(\\\\w+)\\\\}/g' kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1` (token regex present)
    - `grep -c "JSON.parse" kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1` (info_columns parse path)
    - `grep -c "} catch" kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1` (parse-error fallback)
    - `grep -c "Dashboard authors are privileged users" kinetica_bi/src/lib/renderInfoTemplate.ts` returns at least `1` (no-sanitize lock cited inline per locked decision)
    - `grep -c "POPUP-V14-04" kinetica_bi/src/lib/renderInfoTemplate.spec.ts` returns at least `1` (regression tag present)
    - Spec contains at least 13 `it(` invocations (T1-T6 + KV1-KV7): `grep -c "it(" kinetica_bi/src/lib/renderInfoTemplate.spec.ts` returns ≥ `13`
    - Helper imports zero React/zustand/network code: `grep -E "^import.*react|^import.*zustand|^import.*api/client" kinetica_bi/src/lib/renderInfoTemplate.ts` returns no matches
    - `cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts` exits 0 with all tests green
    - `cd kinetica_bi && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>
    Pure helper shipped. Phase 21 Plan 02 (InfoPopup.tsx) and Phase 23 (Info Card) can import `renderInfoTemplate` and `RenderResult` directly. Token syntax + no-sanitize + lenient-parse policies are locked in code with inline comments citing the originating decisions.
  </done>
</task>

</tasks>

<verification>
1. `cd kinetica_bi && npx vitest run src/lib/renderInfoTemplate.spec.ts` — all 13 tests green.
2. `cd kinetica_bi && npx tsc --noEmit` — exit 0.
3. Helper file is &lt; 80 lines (pure, focused). Spec file is ≥ 80 lines (covers 13 cases + describe/imports).
4. No new dependencies in `kinetica_bi/package.json`.
</verification>

<success_criteria>
- `renderInfoTemplate` returns `mode: "template"` with `{column_name}` substitutions when template is non-null
- `renderInfoTemplate` returns `mode: "kv"` with column-value pairs when template is null
- Malformed `info_columns` JSON falls back to all response columns without throwing
- Phase 23 Info Card can import the same helper without React/UI/network deps
- File-level docstring cites both PROJECT.md no-sanitize lock and STATE.md shared-helper lock verbatim
</success_criteria>

<output>
After completion, create `.planning/phases/21-map-click-popup/21-01-render-info-template-SUMMARY.md` documenting:
- Locked behaviors with line numbers (token regex, parse fallback, empty-template treatment)
- Test counts (13 expected; report actual)
- Any deviations (e.g., if executor refactored regex or added unicode support)
- Note that Plan 02 InfoPopup.tsx and Phase 23 Info Card both import this module
</output>

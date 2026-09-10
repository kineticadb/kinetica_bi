---
phase: 13-spikes-and-endpoint
plan: 02
type: execute
wave: 2
depends_on:
  - 13-01
files_modified:
  - kinetica_bi/server/src/lib/viewNaming.ts
  - kinetica_bi/server/src/lib/whereClause.ts
  - kinetica_bi/server/tests/lib.viewNaming.spec.ts
  - kinetica_bi/server/tests/lib.whereClause.spec.ts
autonomous: true
requirements:
  - VIEW-V13-03
  - VIEW-V13-06
must_haves:
  truths:
    - "A pure function `buildFilterViewName({ username, sessionId, dashboardId, tableId })` returns deterministic strings of shape `_kbi_filt_u<sanitizedUserId>_d<dashId>_t<tableId>_s<sessionShort>`"
    - "OIDC usernames with dots, at-signs, and pipes (e.g. `john.doe@kinetica.com`, `auth0|abc123`) sanitize to alphanumeric+underscore strings of max 32 chars before interpolation"
    - "A pure function `buildServerWhereClause(filters)` accepts the v1.2 `ActiveFilter[]` shape and emits a SQL-safe WHERE-clause string with single quotes doubled for string literals"
    - "Both modules export pure functions only — no Express, kinetica.ts, or db imports — so they are unit-testable in isolation"
  artifacts:
    - path: "kinetica_bi/server/src/lib/viewNaming.ts"
      provides: "sanitizeForViewName(username), buildFilterViewName(args) — view-name composition"
      exports: ["sanitizeForViewName", "buildFilterViewName"]
    - path: "kinetica_bi/server/src/lib/whereClause.ts"
      provides: "ActiveFilter type, escapeKineticaStringLiteral(val), buildServerWhereClause(filters) — WHERE-clause composition with SQL-safe escaping"
      exports: ["ActiveFilter", "escapeKineticaStringLiteral", "buildServerWhereClause"]
    - path: "kinetica_bi/server/tests/lib.viewNaming.spec.ts"
      provides: "Unit tests for sanitizeForViewName + buildFilterViewName"
      contains: "describe(\"sanitizeForViewName\"|describe(\"buildFilterViewName\""
    - path: "kinetica_bi/server/tests/lib.whereClause.spec.ts"
      provides: "Unit tests for escapeKineticaStringLiteral + buildServerWhereClause"
      contains: "describe(\"escapeKineticaStringLiteral\"|describe(\"buildServerWhereClause\""
  key_links:
    - from: "kinetica_bi/server/src/lib/viewNaming.ts"
      to: "kinetica_bi/server/src/index.ts (Plan 13-03 endpoint handler)"
      via: "import { buildFilterViewName } from './lib/viewNaming'"
      pattern: "buildFilterViewName"
    - from: "kinetica_bi/server/src/lib/whereClause.ts"
      to: "kinetica_bi/server/src/index.ts (Plan 13-03 endpoint handler)"
      via: "import { buildServerWhereClause } from './lib/whereClause'"
      pattern: "buildServerWhereClause"
    - from: "kinetica_bi/server/src/lib/whereClause.ts ActiveFilter type"
      to: "kinetica_bi/src/store/filterStore.ts ActiveFilter type"
      via: "byte-for-byte field-shape parity (column, value, dataType, sourceWidgetId?, addedAt) — server type lives separately to avoid frontend imports"
      pattern: "column.*value.*dataType.*addedAt"
---

<objective>
Build the two pure utility modules the Phase 13 endpoint depends on: (1) view-name composition (`viewNaming.ts`) implementing the locked `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` shape with OIDC-username sanitization (V13-P-08), and (2) server-side WHERE-clause builder (`whereClause.ts`) ported from the v1.2 client-side `escapeKineticaStringLiteral` / `buildEqualityFilter` helpers slated for deletion in Phase 15.

Purpose: Isolate the two pieces of novel logic in Phase 13 (everything else is pre-existing helpers — `kineticaSql`, `asyncHandler`, `requireConfig`, `errorMiddleware`). Pure modules with unit tests means Plan 13-03 can compose them without retesting the underlying logic; Phase 15 can also reuse `whereClause.ts` if a future client-side preview ever needs it.

Output: Two `kinetica_bi/server/src/lib/*.ts` files (NEW directory `server/src/lib/`), each with focused vitest specs. No Express, db, or kinetica.ts imports — pure functions only.

Why split from Plan 13-03: Plan 13-03 is the integration plan (route handler + supertest); these utilities are pure and have a clean public API. Splitting prevents Plan 13-03 from containing both "compose helpers" and "wire and test endpoint" — which would push past the 2-3 task limit. The two modules also have different dependency contexts (no Express vs Express + db + auth + kinetica).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/13-spikes-and-endpoint/13-CONTEXT.md
@.planning/phases/13-spikes-and-endpoint/13-RESEARCH.md
@.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md
@kinetica_bi/src/store/filterStore.ts
@kinetica_bi/server/tests/setup.ts

<interfaces>
<!-- Existing v1.2 client-side ActiveFilter type — server-side type matches field-for-field -->
<!-- Source: kinetica_bi/src/store/filterStore.ts lines 14-20 -->

```typescript
// Client-side (v1.2)
export type ActiveFilter = {
  column: string;
  value: string | number | boolean | Date | null;
  dataType: "string" | "number" | "boolean" | "datetime" | "null";
  sourceWidgetId?: number;
  addedAt: number;
};
```

<!-- Existing v1.2 client-side WHERE builders (slated for DELETION in Phase 15) -->
<!-- Source: kinetica_bi/src/store/filterStore.ts (search for `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause`) -->
<!-- The semantics in Phase 13 server module MUST match these exactly so v1.2 chip selections produce identical SQL. -->

```typescript
// v1.2 client-side (REFERENCE — server module MUST match these escape semantics)
export const escapeKineticaStringLiteral = (val: string): string => val.replace(/'/g, "''");

export const buildEqualityFilter = (filter: ActiveFilter): string => {
  if (filter.dataType === "string")  return `${filter.column} = '${escapeKineticaStringLiteral(String(filter.value))}'`;
  if (filter.dataType === "number")  return `${filter.column} = ${Number(filter.value)}`;
  if (filter.dataType === "null")    return `${filter.column} IS NULL`;
  if (filter.dataType === "boolean") return `${filter.column} = ${Boolean(filter.value)}`;
  return `${filter.column} = '${escapeKineticaStringLiteral(String(filter.value))}'`; // datetime
};
```

<!-- Existing test setup — fixture for the new specs -->
<!-- Source: kinetica_bi/server/tests/setup.ts -->
- vitest setupFiles entry; sets process.env defaults; restores mocks beforeEach.
- The new specs require ZERO env stubbing (pure functions; no fetch, no db, no auth).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create lib/viewNaming.ts with sanitizeForViewName + buildFilterViewName + spec</name>
  <files>kinetica_bi/server/src/lib/viewNaming.ts, kinetica_bi/server/tests/lib.viewNaming.spec.ts</files>
  <read_first>
    - .planning/phases/13-spikes-and-endpoint/13-CONTEXT.md (decisions § "View-name details" — locked shape, sessionShort = first 8 hex chars, sanitization rules, 32-char username truncation)
    - .planning/phases/13-spikes-and-endpoint/13-RESEARCH.md (§ "Pattern 2: OIDC userId Sanitization" — example transformations; § "Common Pitfalls > Pitfall 4" — V13-P-08)
    - .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md (S4 outcome — determines whether buildFilterViewName accepts an optional `schema` parameter for qualified output)
    - kinetica_bi/server/src/auth.ts (lines 26-38 — AuthedRequest.user shape; for understanding what `username` and `sid` look like in real callers — but viewNaming.ts itself does NOT import AuthedRequest)
    - kinetica_bi/server/tests/setup.ts (vitest setup conventions; new spec follows these implicitly via vitest config)
  </read_first>
  <behavior>
    - sanitizeForViewName("alice") returns "alice"
    - sanitizeForViewName("john.doe@kinetica.com") returns "john_doe_kinetica_com"
    - sanitizeForViewName("auth0|abc123def456") returns "auth0_abc123def456"
    - sanitizeForViewName("a".repeat(50)) returns a 32-char string (truncation)
    - sanitizeForViewName("user-name with spaces!") returns "user_name_with_spaces_"
    - sanitizeForViewName("") returns ""
    - sanitizeForViewName("123abc") returns "123abc" (digits and existing alphanumerics preserved)
    - buildFilterViewName({ username: "alice", sessionId: "abcd1234ef567890...", dashboardId: 42, tableId: 7 }) returns "_kbi_filt_ualice_d42_t7_sabcd1234"
    - buildFilterViewName({ username: "john.doe@kinetica.com", sessionId: "1aef8b3c0000000000", dashboardId: 1, tableId: 1 }) returns "_kbi_filt_ujohn_doe_kinetica_com_d1_t1_s1aef8b3c"
    - buildFilterViewName uses session.slice(0, 8) for sessionShort (first 8 hex chars)
    - buildFilterViewName output length is always under 200 chars even with worst-case inputs (32-char sanitized username + 9-digit numeric IDs + 8-char session)
    - If S4 spike result indicates qualified-required: buildFilterViewName accepts an optional `schema?: string` parameter and prefixes it (e.g. "ki_home._kbi_filt_..."). If S4 indicates unqualified is fine: schema parameter is omitted from signature.
    - Function is deterministic — same input always produces same output (no Date.now, no random)
    - Function is pure — no side effects, no console.log, no env reads
  </behavior>
  <action>
    Step 1 (RED): Read `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` to confirm S4 outcome:
      - If S4 says "Both work" or "Only unqualified works" → buildFilterViewName signature has NO `schema` param.
      - If S4 says "Only qualified works" → buildFilterViewName signature has REQUIRED `schema: string` param; spec test asserts qualified output.
      - If S4 says "Both fail" → still build the function with NO schema param (charts ship; map defers); MAP-V13-* moves to post-v1.3 backlog.

    Step 2 (RED): Create `kinetica_bi/server/tests/lib.viewNaming.spec.ts` with the test cases from <behavior> above. Use vitest `describe` + `it` + `expect`. Import from `../src/lib/viewNaming`. The file does NOT exist yet — tests MUST fail with module-not-found. Run `cd kinetica_bi/server && npx vitest run lib.viewNaming.spec.ts` to confirm RED.

    Step 3 (GREEN): Create directory `kinetica_bi/server/src/lib/` if it does not exist (`mkdir -p kinetica_bi/server/src/lib`).

    Step 4 (GREEN): Create `kinetica_bi/server/src/lib/viewNaming.ts` with the following EXACT API surface:

    ```typescript
    /**
     * View-name composition for transient Kinetica materialized views.
     *
     * Locked shape (CONTEXT.md decisions § View-name details):
     *   _kbi_filt_u<sanitizedUserId>_d<dashId>_t<tableId>_s<sessionShort>
     *
     * - sanitizedUserId: alphanumeric+underscore, max 32 chars (per V13-P-08)
     * - sessionShort: first 8 hex chars of sessionId
     * - Total length stays well under Kinetica's 200-char identifier limit
     *
     * Pure module — zero imports beyond the Node stdlib (none used here).
     * No Express, db, or kinetica.ts dependencies — keeps the unit-test surface minimal.
     */

    export function sanitizeForViewName(username: string): string {
      return username.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
    }

    export type FilterViewNameArgs = {
      username: string;
      sessionId: string;
      dashboardId: number;
      tableId: number;
      // schema?: string;  // ADD ONLY IF SPIKE-V13-04 says qualified-required
    };

    export function buildFilterViewName(args: FilterViewNameArgs): string {
      const u = sanitizeForViewName(args.username);
      const s = args.sessionId.slice(0, 8);
      const base = `_kbi_filt_u${u}_d${args.dashboardId}_t${args.tableId}_s${s}`;
      // If args.schema is present (S4 qualified-required path): return `${args.schema}.${base}`;
      return base;
    }
    ```

    The commented `schema` lines are flipped on/off based on the S4 spike outcome (read in Step 1). Document the choice with an inline comment: `// S4 outcome: <PASS-both / PASS-qualified-only / PASS-unqualified-only / FAIL>`.

    Step 5 (GREEN): Run `cd kinetica_bi/server && npx vitest run lib.viewNaming.spec.ts`. All tests pass. If S4 was qualified-required, the spec includes a test asserting `buildFilterViewName({ ..., schema: "ki_home" })` returns `"ki_home._kbi_filt_..."`.

    DO NOT add any other functions, classes, or exports. DO NOT import from `auth.ts`, `db.ts`, `kinetica.ts`, or any frontend module. The module is intentionally minimal.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/lib/viewNaming.ts` exists
    - File exports exactly two symbols: `sanitizeForViewName` (function) and `buildFilterViewName` (function); also exports `FilterViewNameArgs` (type)
    - File contains zero imports (pure module): `grep -c "^import" kinetica_bi/server/src/lib/viewNaming.ts` returns 0
    - File contains the exact regex `/[^a-zA-Z0-9_]/g` for sanitization (no alternative regex)
    - File contains `.slice(0, 32)` for username truncation
    - File contains `.slice(0, 8)` for sessionShort
    - File contains the literal substring `_kbi_filt_u` (the view-name prefix)
    - File contains an inline comment documenting the S4 outcome (string contains `// S4 outcome:` or `// SPIKE-V13-04`)
    - File `kinetica_bi/server/tests/lib.viewNaming.spec.ts` exists
    - Spec file contains `describe("sanitizeForViewName"` AND `describe("buildFilterViewName"` test groups (or `describe(sanitizeForViewName.name,` equivalent)
    - Spec includes test for OIDC username sanitization: contains literal string `john.doe@kinetica.com` AND expected output `john_doe_kinetica_com`
    - Spec includes test for pipe sanitization: contains literal string `auth0|` (and expected output `auth0_`)
    - Spec includes test for truncation: contains literal `repeat(50)` or equivalent showing 50→32-char truncation
    - Spec includes test for buildFilterViewName composition: at least one test asserts the literal string `_kbi_filt_u` appears in the output
    - `cd kinetica_bi/server && npx vitest run lib.viewNaming.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0 (no TypeScript errors)
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run lib.viewNaming.spec.ts && npx tsc --noEmit</automated>
  </verify>
  <done>viewNaming.ts module exists with the locked API surface; all behavior cases pass in the spec; tsc clean; module has zero non-stdlib imports; S4 spike outcome documented inline.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Create lib/whereClause.ts with ActiveFilter + escapeKineticaStringLiteral + buildServerWhereClause + spec</name>
  <files>kinetica_bi/server/src/lib/whereClause.ts, kinetica_bi/server/tests/lib.whereClause.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/filterStore.ts (lines 14-20: ActiveFilter type — server type must match field-for-field; lines containing `escapeKineticaStringLiteral`, `buildEqualityFilter`, `buildWhereClause` — verbatim escape semantics to port)
    - .planning/phases/13-spikes-and-endpoint/13-RESEARCH.md (§ "Pattern 3: Server-Side WHERE Clause Builder" — exact reference implementation; § "Don't Hand-Roll" — note that we're porting, not rewriting)
    - .planning/phases/13-spikes-and-endpoint/13-CONTEXT.md (canonical_refs — `kinetica_bi/src/store/filterStore.ts` is the source-of-truth for ActiveFilter shape)
    - kinetica_bi/server/tests/setup.ts (vitest setup conventions)
  </read_first>
  <behavior>
    - escapeKineticaStringLiteral("hello") returns "hello"
    - escapeKineticaStringLiteral("O'Brien") returns "O''Brien" (single quote doubled)
    - escapeKineticaStringLiteral("'; DROP TABLE--") returns "''; DROP TABLE--" (leading single-quote doubled; rest preserved)
    - escapeKineticaStringLiteral("") returns ""
    - escapeKineticaStringLiteral("a''b") returns "a''''b" (already-escaped quotes get re-escaped — symmetric with v1.2)
    - buildServerWhereClause([]) returns "1=1" (empty fallback — Phase 15 should not call this with empty filters; documented invariant)
    - buildServerWhereClause([{ column: "zone", value: "East Village", dataType: "string", addedAt: 0 }]) returns "zone = 'East Village'"
    - buildServerWhereClause([{ column: "name", value: "O'Brien", dataType: "string", addedAt: 0 }]) returns "name = 'O''Brien'"
    - buildServerWhereClause([{ column: "fare", value: 12.5, dataType: "number", addedAt: 0 }]) returns "fare = 12.5"
    - buildServerWhereClause([{ column: "tip", value: "0", dataType: "number", addedAt: 0 }]) returns "tip = 0" (Number(\"0\") coercion)
    - buildServerWhereClause([{ column: "status", value: null, dataType: "null", addedAt: 0 }]) returns "status IS NULL"
    - buildServerWhereClause([{ column: "active", value: true, dataType: "boolean", addedAt: 0 }]) returns "active = true"
    - buildServerWhereClause([{ column: "ts", value: "2026-05-06T10:00:00Z", dataType: "datetime", addedAt: 0 }]) returns "ts = '2026-05-06T10:00:00Z'"
    - buildServerWhereClause with two filters joins them with " AND ": "col1 = 'a' AND col2 = 5"
    - buildServerWhereClause with three filters joins them with " AND ": "col1 = 'a' AND col2 = 5 AND col3 IS NULL"
    - Function is pure — no side effects, no env reads
  </behavior>
  <action>
    Step 1 (RED): Create `kinetica_bi/server/tests/lib.whereClause.spec.ts` with all behavior cases above. Import from `../src/lib/whereClause`. Run `cd kinetica_bi/server && npx vitest run lib.whereClause.spec.ts` — confirm RED (module not found).

    Step 2 (GREEN): Create `kinetica_bi/server/src/lib/whereClause.ts` with this EXACT API surface:

    ```typescript
    /**
     * Server-side WHERE clause builder for transient materialized views.
     *
     * Ported byte-for-byte from v1.2 client-side filterStore.ts (escapeKineticaStringLiteral,
     * buildEqualityFilter). The client-side functions are slated for DELETION in Phase 15
     * (FILT-V13-05); this module is the server-side replacement that lives BEFORE the
     * deletion happens — both can coexist briefly during the v1.3 transition.
     *
     * Pure module — zero imports beyond the Node stdlib (none used here).
     */

    export type ActiveFilter = {
      column: string;
      value: string | number | boolean | Date | null;
      dataType: "string" | "number" | "boolean" | "datetime" | "null";
      sourceWidgetId?: number;
      addedAt: number;
    };

    export function escapeKineticaStringLiteral(val: string): string {
      return val.replace(/'/g, "''");
    }

    export function buildServerWhereClause(filters: ActiveFilter[]): string {
      if (filters.length === 0) return "1=1";
      return filters
        .map((f) => {
          if (f.dataType === "string") {
            return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
          }
          if (f.dataType === "number") {
            return `${f.column} = ${Number(f.value)}`;
          }
          if (f.dataType === "null") {
            return `${f.column} IS NULL`;
          }
          if (f.dataType === "boolean") {
            return `${f.column} = ${Boolean(f.value)}`;
          }
          // datetime — treat as string literal
          return `${f.column} = '${escapeKineticaStringLiteral(String(f.value))}'`;
        })
        .join(" AND ");
    }
    ```

    Step 3 (GREEN): Run `cd kinetica_bi/server && npx vitest run lib.whereClause.spec.ts`. All tests pass.

    Step 4 (REFACTOR — only if needed): If the spec reveals a v1.2 edge case the action missed, fix the implementation and re-run. Do NOT add features beyond <behavior>. Specifically: do NOT add operators other than equality (`=`, `IS NULL`); v1.2 was equality-only and Phase 13 ports that semantics verbatim. Inequality / range operators are deferred to v2.

    Note: The `column` field is interpolated DIRECTLY into the SQL without escaping — same as v1.2. Column names come from server-side table metadata (`getTable(tableId).columns`), NOT user input — so injection risk is bounded by table-creation routes (which are admin-only). Document this trust boundary in the file header comment if not already implied.

    DO NOT add quoting around the `column` identifier (no `"col"` — Kinetica uses bare identifiers). DO NOT add arrays/IN clauses; v1.2 did not support them. DO NOT add a `LIKE` operator.
  </action>
  <acceptance_criteria>
    - File `kinetica_bi/server/src/lib/whereClause.ts` exists
    - File exports exactly: `ActiveFilter` (type), `escapeKineticaStringLiteral` (function), `buildServerWhereClause` (function)
    - File contains zero imports: `grep -c "^import" kinetica_bi/server/src/lib/whereClause.ts` returns 0
    - File's `escapeKineticaStringLiteral` body is the literal `return val.replace(/'/g, "''");` (matches v1.2 exactly)
    - File's `buildServerWhereClause` returns the literal string `"1=1"` for the empty-filters fallback
    - File contains the literal substring ` AND ` (the join separator with surrounding spaces)
    - File `kinetica_bi/server/tests/lib.whereClause.spec.ts` exists
    - Spec file contains `describe("escapeKineticaStringLiteral"` AND `describe("buildServerWhereClause"` (or function-name equivalents)
    - Spec includes the O'Brien test case: contains literal `O'Brien` (input) AND `O''Brien` (expected)
    - Spec includes a test for null dataType: contains literal `IS NULL`
    - Spec includes a test for two-filter AND: contains literal ` AND ` and asserts on a 2-element filter array
    - Spec includes a test for boolean dataType
    - Spec includes a test for datetime dataType
    - `cd kinetica_bi/server && npx vitest run lib.whereClause.spec.ts` exits 0
    - `cd kinetica_bi/server && npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <verify>
    <automated>cd kinetica_bi/server && npx vitest run lib.whereClause.spec.ts && npx tsc --noEmit</automated>
  </verify>
  <done>whereClause.ts module exists with the locked API surface; all behavior cases pass; equality semantics match v1.2 client-side byte-for-byte; tsc clean; module has zero non-stdlib imports.</done>
</task>

</tasks>

<verification>
- Both modules exist in `kinetica_bi/server/src/lib/` with zero non-stdlib imports
- Both spec files pass `vitest` and `tsc --noEmit`
- Plan 13-03 can `import { buildFilterViewName } from "./lib/viewNaming"` and `import { buildServerWhereClause, type ActiveFilter } from "./lib/whereClause"` without circular-import or type-resolution issues
- Full backend test suite stays green: `cd kinetica_bi/server && npm test` returns exit 0 (no regressions from new module additions)
</verification>

<success_criteria>
- `cd kinetica_bi/server && npx vitest run lib.viewNaming.spec.ts lib.whereClause.spec.ts` exits 0
- `cd kinetica_bi/server && npx tsc --noEmit` exits 0
- `cd kinetica_bi/server && npm test` exits 0 (full suite, no regressions)
- Both new modules have zero imports (`grep -c "^import" ...` returns 0 for both)
- API surface is minimal: each module exports exactly the symbols listed in `must_haves.artifacts`
- S4 spike outcome is documented in viewNaming.ts as an inline comment
</success_criteria>

<output>
After completion, create `.planning/phases/13-spikes-and-endpoint/13-02-SUMMARY.md` summarizing:
- Both modules' final API surface (exports, signatures)
- The S4 outcome reflected in viewNaming.ts (qualified vs unqualified)
- Confirmation that whereClause.ts matches v1.2 client-side semantics byte-for-byte
- Test coverage count (number of test cases per spec)
- Plan 13-03 readiness — both modules are importable and tested
</output>
</content>
</invoke>
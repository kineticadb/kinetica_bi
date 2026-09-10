---
phase: 33-dynamic-view-store
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/src/lib/dynamicViewName.ts
  - kinetica_bi/src/lib/dynamicViewName.spec.ts
  - kinetica_bi/src/store/dynamicViewStore.ts
  - kinetica_bi/src/store/dynamicViewStore.spec.ts
autonomous: true
requirements:
  - DV-V16-06
must_haves:
  truths:
    - "`buildDynamicViewName({ userId, dashboardId, dynamicViewId })` returns `_kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>` — byte-parity with the server helper at `kinetica_bi/server/src/lib/dynamicViewName.ts`."
    - "`useDynamicViewStore` exports state shape `{ views: Record<number, DynamicViewEntry>, dynamicViewVersion: number }` with initial value `{ views: {}, dynamicViewVersion: 0 }`."
    - "`DynamicViewEntry` shape is `{ viewName: string, status: 'materialized' | 'over_threshold' | 'pending' | 'error', expiresAt?: number, error?: string, reason?: 'no_filter' | 'exceeds_max_records' }` — `viewName` always populated (never empty/null on pending/error/over_threshold)."
    - "`setView(id, payload)` writes the entry verbatim and ALWAYS bumps `dynamicViewVersion` (even on byte-identical payload)."
    - "`markPending(id, viewName)` on absent entry creates `{ viewName, status: 'pending' }`; on existing entry overwrites status to `'pending'`, strips `expiresAt`/`error`/`reason`, keeps `viewName` unchanged. ALWAYS bumps version (including markPending-over-pending)."
    - "`setError(id, error: string)` preserves prior `viewName`, sets `status: 'error'`, populates `error`, strips `expiresAt` and `reason`. ALWAYS bumps version. On absent entry creates placeholder `{ viewName: '', status: 'error', error }`."
    - "`clearView(id)` on existing entry removes the per-id key and bumps version. On non-existent id it is a STRICT NO-OP — no version bump, state reference preserved (assertable via `===`)."
    - "`reset()` hard-sets state to `{ views: {}, dynamicViewVersion: 0 }` — version goes to 0, NOT an increment."
    - "Reference stability — mutating entry A leaves entry B's object identity intact (PITFALL C-02 / S-02 carry-forward)."
    - "Store file lives under `src/store/` so the Zustand reset shim (`kinetica_bi/__mocks__/zustand.ts`) auto-applies between specs."
  artifacts:
    - path: "kinetica_bi/src/lib/dynamicViewName.ts"
      provides: "Pure helper `buildDynamicViewName` + `DynamicViewNameArgs` type — byte-parity with the server helper at `kinetica_bi/server/src/lib/dynamicViewName.ts`"
      contains: "export function buildDynamicViewName"
      min_lines: 15
    - path: "kinetica_bi/src/lib/dynamicViewName.spec.ts"
      provides: "Round-trip identity coverage for the pure helper"
      min_lines: 20
    - path: "kinetica_bi/src/store/dynamicViewStore.ts"
      provides: "Zustand slice `useDynamicViewStore` with 5 actions (setView, markPending, setError, clearView, reset)"
      contains: "export const useDynamicViewStore"
      min_lines: 80
    - path: "kinetica_bi/src/store/dynamicViewStore.spec.ts"
      provides: "Vitest coverage: store actions, version monotonicity, no-op rules, reference stability, empty-state reads, error-state shape"
      min_lines: 150
  key_links:
    - from: "kinetica_bi/src/lib/dynamicViewName.ts"
      to: "kinetica_bi/server/src/lib/dynamicViewName.ts"
      via: "byte-parity output for identical { userId, dashboardId, dynamicViewId } inputs"
      pattern: "_kbi_dv_u.*_d.*_"
    - from: "kinetica_bi/src/store/dynamicViewStore.ts"
      to: "kinetica_bi/__mocks__/zustand.ts"
      via: "store file lives under src/store/ so the Zustand reset shim auto-resets between specs"
      pattern: "src/store/dynamicViewStore\\.ts"
---

<objective>
Ship the foundation pieces for Phase 33: (1) a pure frontend helper `buildDynamicViewName` that mirrors the server helper byte-for-byte, and (2) the `useDynamicViewStore` Zustand slice with all 5 actions (setView, markPending, setError, clearView, reset), each obeying the locked semantics from `33-CONTEXT.md § Action contract` verbatim.

Purpose: These are the dependency-free building blocks every other Phase 33 plan consumes. Plan 33-02 (server drop endpoint) is independent. Plan 33-03 (client helpers + lifecycle wiring) imports `useDynamicViewStore` and `buildDynamicViewName` from this plan.

Output: 4 new files (helper + spec, store + spec) — all dormant in Phase 33 (no production consumer until Plan 33-03 wires lifecycle reset; first reader is Phase 35 renderer).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/33-dynamic-view-store/33-CONTEXT.md
@.planning/phases/32-dynamic-view-foundation/32-CONTEXT.md

<interfaces>
<!-- Existing server helper this plan must byte-parity. Executor should copy the structure verbatim. -->

From `kinetica_bi/server/src/lib/dynamicViewName.ts` (existing, byte-parity target):
```typescript
import { sanitizeForViewName } from "./viewNaming";

export type DynamicViewNameArgs = {
  userId: string;
  dashboardId: number;
  dynamicViewId: number;
};

export function buildDynamicViewName(args: DynamicViewNameArgs): string {
  const u = sanitizeForViewName(args.userId);
  return `_kbi_dv_u${u}_d${args.dashboardId}_${args.dynamicViewId}`;
}
```

From `kinetica_bi/server/src/lib/viewNaming.ts` (the sanitizer the server helper imports — frontend must reproduce its behavior). Read the actual file to extract `sanitizeForViewName`'s body verbatim; do NOT guess. The function lives at `kinetica_bi/server/src/lib/viewNaming.ts` and performs `[^a-zA-Z0-9_]` -> `_` replacement + `.slice(0, 32)`.

Required store contract (locked verbatim by `33-CONTEXT.md § Action contract`):
```typescript
export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
export type DynamicViewReason = "no_filter" | "exceeds_max_records";

export type DynamicViewEntry = {
  viewName: string;          // ALWAYS populated from markPending forward — never empty/null on non-error entries
  status: DynamicViewStatus;
  expiresAt?: number;        // ONLY present when status === "materialized"
  error?: string;            // present when status === "error"
  reason?: DynamicViewReason; // present when status === "over_threshold"
};

export type DynamicViewState = {
  views: Record<number, DynamicViewEntry>;
  dynamicViewVersion: number;
  setView: (id: number, payload: {
    viewName: string;
    status: DynamicViewStatus;
    expiresAt?: number;
    error?: string;
    reason?: DynamicViewReason;
  }) => void;
  markPending: (id: number, viewName: string) => void;
  setError: (id: number, error: string) => void;
  clearView: (id: number) => void;
  reset: () => void;
};
```

Pattern templates (mirror at action-by-action level):
- `kinetica_bi/src/store/filterViewStore.ts` lines 59-96 — `setView` reference-stable per-key update + `markMaterializing` placeholder-on-missing (template for `markPending`).
- `kinetica_bi/src/store/spatialFilterStore.ts` lines 98-127 — no-op rules (strict reference preservation on no-change) + `reset()` hard-set to initial (NOT increment).
- `kinetica_bi/src/store/infoSelectionStore.ts` lines 174-181 — `setError` preserves-prior-fields pattern.
- `kinetica_bi/src/store/filterViewStore.spec.ts` — spec organization for stores with placeholder-on-missing pattern.
- `kinetica_bi/src/store/spatialFilterStore.spec.ts` — spec organization for stores with several mutations + no-op rules. CLOSEST style match for this store.

Test infra notes:
- `kinetica_bi/__mocks__/zustand.ts` + `kinetica_bi/src/test/setup.ts` — the Zustand reset shim auto-applies to ANY store file under `src/store/*.ts`. NEW store MUST live under `src/store/` (NOT `src/state/`) for this coverage.
- No spec-side `beforeEach` reset boilerplate needed — shim handles it.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure helper `kinetica_bi/src/lib/dynamicViewName.ts` + spec (byte-parity with server)</name>
  <files>kinetica_bi/src/lib/dynamicViewName.ts, kinetica_bi/src/lib/dynamicViewName.spec.ts</files>
  <read_first>
    - kinetica_bi/server/src/lib/dynamicViewName.ts (read in full — this is the byte-parity source of truth; copy the function body verbatim)
    - kinetica_bi/server/src/lib/viewNaming.ts (read in full — extract `sanitizeForViewName` body verbatim; the frontend helper must reproduce it, NOT call it via server-side import)
    - kinetica_bi/server/tests/lib.dynamicViewName.spec.ts (read in full — copy the input/output round-trip pairs into the frontend spec for direct parity verification)
    - kinetica_bi/src/lib/mapInfoConfig.ts (read first 30 lines — established pure-lib mirror pattern used by v1.4)
    - kinetica_bi/src/lib/spatialTargets.ts (read first 30 lines — same pattern used by v1.5)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md § "viewName resolution" (locked decision: byte-parity with server)
  </read_first>
  <behavior>
    - Test 1: `buildDynamicViewName({ userId: "alice", dashboardId: 5, dynamicViewId: 7 })` returns exactly `_kbi_dv_ualice_d5_7`.
    - Test 2: Special characters in userId are sanitized to `_` via `[^a-zA-Z0-9_]` replacement. E.g., `buildDynamicViewName({ userId: "john.doe@kinetica.com", dashboardId: 1, dynamicViewId: 2 })` returns `_kbi_dv_ujohn_doe_kinetica_com_d1_2`.
    - Test 3: userId longer than 32 chars is truncated to 32 chars (matches server `slice(0, 32)`). E.g., a 50-char userId produces a sanitized prefix of exactly 32 chars between `_kbi_dv_u` and `_d<dashboardId>`.
    - Test 4: Round-trip parity — at least 3 test cases pulled from `kinetica_bi/server/tests/lib.dynamicViewName.spec.ts` produce identical strings when called with the frontend helper.
    - Test 5: Deterministic — calling the helper twice with the same args returns the exact same string (no Date.now, no random).
  </behavior>
  <action>
    1. Create `kinetica_bi/src/lib/dynamicViewName.ts`. Mirror the server helper structure but inline `sanitizeForViewName` (do NOT import from server-side). Final file contents (concrete, do not paraphrase):

    ```typescript
    /**
     * Phase 33 (DV-V16-06): pure helper — frontend mirror of the server's deterministic
     * dynamic-view name composer. Byte-parity with `kinetica_bi/server/src/lib/dynamicViewName.ts`.
     *
     * Shape (locked by 32-CONTEXT.md § D7):
     *   _kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>
     *
     * Pure / deterministic: same input always produces the same output.
     * No Date.now, no random, no environment reads.
     *
     * Established pure-lib mirror pattern (v1.4 mapInfoConfig.ts, v1.5 spatialTargets.ts):
     * when server and frontend need identical pure helpers, each side gets its own
     * `lib/X.ts` file. Sanitization rule is inlined (NOT imported from server) so the
     * frontend file is dependency-free.
     */

    export type DynamicViewNameArgs = {
      userId: string;
      dashboardId: number;
      dynamicViewId: number;
    };

    /**
     * Sanitize a userId for safe inclusion in a Kinetica identifier.
     * Mirrors server-side `sanitizeForViewName`: replaces every non-alphanumeric-or-underscore
     * char with `_`, then truncates to 32 chars (V13-P-08 length budget).
     */
    function sanitizeForViewName(userId: string): string {
      return userId.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 32);
    }

    export function buildDynamicViewName(args: DynamicViewNameArgs): string {
      const u = sanitizeForViewName(args.userId);
      return `_kbi_dv_u${u}_d${args.dashboardId}_${args.dynamicViewId}`;
    }
    ```

    2. BEFORE writing the helper body, re-read `kinetica_bi/server/src/lib/viewNaming.ts` and confirm the actual `sanitizeForViewName` body. If server uses a different regex or different truncation length, MATCH IT VERBATIM (this is the byte-parity contract). Update the inline function body to match.

    3. Create `kinetica_bi/src/lib/dynamicViewName.spec.ts`. Mirror the structure of `kinetica_bi/src/lib/spatialTargets.spec.ts` (single describe block, focused `it` blocks). Required tests:

    ```typescript
    import { describe, it, expect } from "vitest";
    import { buildDynamicViewName } from "./dynamicViewName";

    describe("buildDynamicViewName", () => {
      it("composes simple alphanumeric inputs", () => {
        expect(buildDynamicViewName({ userId: "alice", dashboardId: 5, dynamicViewId: 7 }))
          .toBe("_kbi_dv_ualice_d5_7");
      });

      it("sanitizes non-alphanumeric chars in userId to underscore", () => {
        expect(buildDynamicViewName({ userId: "john.doe@kinetica.com", dashboardId: 1, dynamicViewId: 2 }))
          .toBe("_kbi_dv_ujohn_doe_kinetica_com_d1_2");
      });

      it("truncates userId to 32 chars (V13-P-08 length budget)", () => {
        const longId = "a".repeat(50);
        const result = buildDynamicViewName({ userId: longId, dashboardId: 1, dynamicViewId: 2 });
        // Between `_kbi_dv_u` (9 chars) and `_d1_2` the sanitized userId must be exactly 32 chars.
        expect(result).toBe(`_kbi_dv_u${"a".repeat(32)}_d1_2`);
      });

      it("is deterministic — same input always produces the same output", () => {
        const args = { userId: "alice", dashboardId: 5, dynamicViewId: 7 };
        expect(buildDynamicViewName(args)).toBe(buildDynamicViewName(args));
      });

      it("byte-parity with server: round-trip pairs from server spec", () => {
        // Pull at least 3 input/output pairs from kinetica_bi/server/tests/lib.dynamicViewName.spec.ts.
        // The frontend helper MUST produce identical strings for each pair (this is the parity contract).
        // Replace these placeholders with the actual server-spec pairs after reading that file.
        expect(buildDynamicViewName({ userId: "alice", dashboardId: 5, dynamicViewId: 7 }))
          .toBe("_kbi_dv_ualice_d5_7");
        // Add 2 more pairs.
      });
    });
    ```

    4. Run the spec — confirm all tests pass. If the server spec uses different inputs/outputs, update the frontend spec to match those exact cases (parity contract).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/lib/dynamicViewName.spec.ts --reporter=verbose 2>&1 | tail -20</automated>
  </verify>
  <done>
    Helper file exists and exports `buildDynamicViewName` + `DynamicViewNameArgs`. Spec runs green with at least 5 tests covering simple input, special-char sanitization, 32-char truncation, determinism, and server byte-parity (3+ round-trip pairs from the server spec).
  </done>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/lib/dynamicViewName.ts` exits 0.
    - `test -f kinetica_bi/src/lib/dynamicViewName.spec.ts` exits 0.
    - `grep -nE "export function buildDynamicViewName" kinetica_bi/src/lib/dynamicViewName.ts` returns exactly 1 line.
    - `grep -nE "export type DynamicViewNameArgs" kinetica_bi/src/lib/dynamicViewName.ts` returns exactly 1 line.
    - `grep -nE "_kbi_dv_u" kinetica_bi/src/lib/dynamicViewName.ts` returns at least 1 line.
    - `grep -nE "replace\(/.\^a-zA-Z0-9_./g" kinetica_bi/src/lib/dynamicViewName.ts` returns at least 1 line (sanitizer regex present).
    - `grep -nE "slice\(0, 32\)" kinetica_bi/src/lib/dynamicViewName.ts` returns at least 1 line (32-char truncation present).
    - The frontend helper does NOT import anything from `kinetica_bi/server/` (parity is by duplication, not cross-tree import): `grep -nE "from .*server/" kinetica_bi/src/lib/dynamicViewName.ts` returns 0 lines.
    - `cd kinetica_bi && npx vitest run src/lib/dynamicViewName.spec.ts` exits 0 with at least 5 passing tests.
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Zustand store `kinetica_bi/src/store/dynamicViewStore.ts` + comprehensive spec</name>
  <files>kinetica_bi/src/store/dynamicViewStore.ts, kinetica_bi/src/store/dynamicViewStore.spec.ts</files>
  <read_first>
    - kinetica_bi/src/store/filterViewStore.ts (read in full — PRIMARY TEMPLATE for placeholder-on-missing + reference-stable per-key updates + internal-only reset())
    - kinetica_bi/src/store/spatialFilterStore.ts (read in full — TEMPLATE for no-op rules + reset-to-zero semantics)
    - kinetica_bi/src/store/infoSelectionStore.ts (read lines 174-200 — `setError` preserves-prior-fields pattern)
    - kinetica_bi/src/store/spatialFilterStore.spec.ts (read in full — CLOSEST SPEC STYLE MATCH; mirror its describe/it structure)
    - kinetica_bi/src/store/filterViewStore.spec.ts (read first 100 lines — pattern for placeholder-on-missing + version-monotonicity assertions)
    - kinetica_bi/__mocks__/zustand.ts (read in full — confirm shim auto-applies to src/store/*.ts; explains why no beforeEach reset boilerplate is needed)
    - .planning/phases/33-dynamic-view-store/33-CONTEXT.md (THE PRIMARY SPEC — § "Store shape", § "Action contract", § "dynamicViewVersion semantics", § "Test coverage")
  </read_first>
  <behavior>
    Store actions (locked verbatim from CONTEXT.md):
    - Test 1: Initial state — `{ views: {}, dynamicViewVersion: 0 }`.
    - Test 2: `setView(id, payload)` writes entry verbatim, bumps version from 0 to 1.
    - Test 3: `setView` with byte-identical payload over an existing entry STILL bumps version (locked rule: every setView bumps).
    - Test 4: `markPending(id, "viewname")` on absent entry creates `{ viewName: "viewname", status: "pending" }`, bumps version.
    - Test 5: `markPending(id, "newname")` on existing entry overwrites status to `"pending"`, strips `expiresAt`/`error`/`reason`, KEEPS the original `viewName` (the new viewName arg overwrites it; see CONTEXT.md "keep `viewName` unchanged" wording — but the action signature is `markPending(id, viewName)` meaning caller always supplies viewName, and CONTEXT.md says "If entry exists: overwrite status to 'pending', strip expiresAt/error/reason, keep viewName unchanged" — this means the STORED viewName from the existing entry is preserved when the new arg differs; treat caller's viewName as authoritative for the absent-entry case only). EXECUTOR: re-read CONTEXT.md § "Action contract" markPending bullet (line 56) — the locked behavior is "keep viewName unchanged" when entry exists. So `markPending(id, anyArg)` on existing entry keeps `prev.viewName` regardless of the new arg.
    - Test 6: `markPending` called twice in a row (both with entry already pending) — version increments by 2 (locked rule: always bumps, even markPending-over-pending).
    - Test 7: `setError(id, "msg")` on entry with status `"pending"` and `viewName: "foo"` produces `{ viewName: "foo", status: "error", error: "msg" }` (NO `expiresAt`, NO `reason`). Bumps version.
    - Test 8: `setError(id, "msg2")` over an entry that already has `error: "msg1"` STILL bumps version (locked rule).
    - Test 9: `setError(id, "msg")` on absent entry creates placeholder `{ viewName: "", status: "error", error: "msg" }`. Bumps version. (Defensive fallback; caller should always have called markPending first.)
    - Test 10: `clearView(id)` on existing entry removes the key, bumps version.
    - Test 11: `clearView(id)` on non-existent id — STRICT NO-OP. Version unchanged. State reference preserved (`useDynamicViewStore.getState() === useDynamicViewStore.getState()` after the no-op call — assert via reference equality of the views object).
    - Test 12: Version monotonicity — chain of 5 mutations (setView, markPending, setError, clearView, setView) produces `dynamicViewVersion === 5`.
    - Test 13: `reset()` hard-sets state to `{ views: {}, dynamicViewVersion: 0 }` AFTER several mutations have bumped version to N > 0. Version goes to 0, NOT N+1.
    - Test 14: Reference stability — `setView(id=1, ...)` followed by `setView(id=2, ...)` — the entry object for id=1 keeps its object identity after the id=2 mutation (PITFALL C-02 / S-02 carry-forward).
    - Test 15: Empty-state read — `useDynamicViewStore.getState().views[999]` returns `undefined` cleanly (no crash).
    - Test 16: Error-state shape after `markPending(1, "v") → setError(1, "msg")` — entry is exactly `{ viewName: "v", status: "error", error: "msg" }` (no expiresAt, no reason fields present — assert via `Object.keys(entry).sort()`).
    - Test 17: setView REPLACE semantics — `setView(1, { viewName: "a", status: "materialized", expiresAt: 100 }) → setView(1, { viewName: "b", status: "over_threshold", reason: "no_filter" })` produces an entry with NO `expiresAt` field (REPLACE, not merge).
  </behavior>
  <action>
    1. Create `kinetica_bi/src/store/dynamicViewStore.ts`. Mirror `filterViewStore.ts` + `spatialFilterStore.ts` patterns. Concrete file body (executor: type this verbatim and adapt only where re-reading CONTEXT.md reveals a divergence):

    ```typescript
    /**
     * Phase 33 (DV-V16-06): per-dynamic_view_id materialization state.
     *
     * Session-only Zustand slice holding the dashboard's current dynamic-view materialization
     * state (one entry per dynamic_view_id, dashboard-scoped via the caller passing dynamic_view_id
     * keys produced by Phase 32 server endpoints). Ships dormant in Phase 33 — Phase 34 management
     * modal is first writer at create/edit/preview; Phase 35 renderer is first reader at FROM-swap.
     *
     * `dynamicViewVersion` mirrors the `filterVersion` / `spatialFilterVersion` pattern — it is the
     * dep-array signal Phase 35 AggregatedWidgetRenderer reads alongside `filterVersion` to trigger
     * cascading re-materialize. Increments on every successful mutation (rules below).
     *
     * Status union (locked by ROADMAP success criterion 1, extended this phase):
     *   "materialized" | "over_threshold" | "pending" | "error"
     *
     * No "stale" status — TTL-expired entries are derived client-side from `expiresAt + Date.now()`
     * by Phase 35 renderers, not stored.
     *
     * Entry shape (locked by 33-CONTEXT.md § "Store shape"):
     *   { viewName: string, status, expiresAt?, error?, reason? }
     *
     * viewName invariant: always populated (deterministic via buildDynamicViewName from markPending
     * forward). Never empty/null on pending/over_threshold/error entries (except the defensive
     * setError-on-absent fallback — see action body below).
     *
     * dynamicViewVersion semantics (locked by 33-CONTEXT.md § "dynamicViewVersion semantics"):
     *   - setView: always +1 (even byte-identical payload)
     *   - markPending: always +1 (even markPending-over-pending)
     *   - setError: always +1 (even setError-over-already-error)
     *   - clearView(existing): +1
     *   - clearView(non-existent): NO-OP (no version bump, state reference preserved)
     *   - reset(): hard-set to 0 — NOT an increment (mirrors spatialFilterStore.reset)
     *
     * LIFECYCLE — 6-store reset block extended by Plan 33-03 (DV-V16-07):
     *   Order: filterViewStore → filterStore → infoSelectionStore → lastInfoClickContextStore →
     *   spatialFilterStore → dynamicViewStore (6th). Wired at App.tsx UNAUTHORIZED + DashboardsPage.tsx
     *   DashboardOpen cleanup. DROP loop is callsite-resident (Plan 33-03 wiring) — NOT inside this store.
     *
     * Test infra: Zustand reset shim at kinetica_bi/__mocks__/zustand.ts auto-applies via
     * vi.mock("zustand") in src/test/setup.ts. File MUST live under src/store/ for shim coverage.
     *
     * Reference stability lock (PITFALL C-02 / S-02 carry-forward): `views: { ...state.views, [id]: nextEntry }`
     * produces a new top-level object but other keys keep object identity. Phase 35 selector consumers
     * scope to `s.views[id]`.
     */

    import { create } from "zustand";

    export type DynamicViewStatus = "materialized" | "over_threshold" | "pending" | "error";
    export type DynamicViewReason = "no_filter" | "exceeds_max_records";

    export type DynamicViewEntry = {
      viewName: string;
      status: DynamicViewStatus;
      expiresAt?: number;
      error?: string;
      reason?: DynamicViewReason;
    };

    export type DynamicViewState = {
      views: Record<number, DynamicViewEntry>;
      dynamicViewVersion: number;
      setView: (id: number, payload: {
        viewName: string;
        status: DynamicViewStatus;
        expiresAt?: number;
        error?: string;
        reason?: DynamicViewReason;
      }) => void;
      markPending: (id: number, viewName: string) => void;
      setError: (id: number, error: string) => void;
      clearView: (id: number) => void;
      reset: () => void;
    };

    export const useDynamicViewStore = create<DynamicViewState>((set) => ({
      views: {},
      dynamicViewVersion: 0,

      // REPLACE semantics — caller passes full payload; store writes verbatim. ALWAYS bumps version
      // (even on byte-identical payload — mirrors filterViewStore.setView at filterViewStore.ts:59-73
      // and the 33-CONTEXT.md § "dynamicViewVersion semantics" first bullet).
      setView: (id, payload) =>
        set((s) => {
          const nextEntry: DynamicViewEntry = {
            viewName: payload.viewName,
            status: payload.status,
            // Only spread the optional fields that are present in the payload — REPLACE means a payload
            // without expiresAt MUST produce an entry without expiresAt (not a merge with prior entry).
            ...(payload.expiresAt !== undefined ? { expiresAt: payload.expiresAt } : {}),
            ...(payload.error !== undefined ? { error: payload.error } : {}),
            ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
          };
          return {
            views: { ...s.views, [id]: nextEntry },
            dynamicViewVersion: s.dynamicViewVersion + 1,
          };
        }),

      // Placeholder write before materializeDynamicView call. If entry exists: overwrite status to
      // "pending", strip expiresAt/error/reason, KEEP existing viewName unchanged (locked 33-CONTEXT.md
      // § "Action contract" markPending bullet — preserves prior cached name for retry without re-fetch).
      // If entry absent: create placeholder { viewName: <caller-arg>, status: "pending" }.
      // ALWAYS bumps version (locked rule — overlapping triggers signal abort+retry; Phase 35 dedupes
      // via AbortController).
      markPending: (id, viewName) =>
        set((s) => {
          const prev = s.views[id];
          const nextEntry: DynamicViewEntry = prev
            ? { viewName: prev.viewName, status: "pending" } // KEEP prev.viewName; strip expiresAt/error/reason
            : { viewName, status: "pending" };               // create placeholder with caller-supplied name
          return {
            views: { ...s.views, [id]: nextEntry },
            dynamicViewVersion: s.dynamicViewVersion + 1,
          };
        }),

      // Error transition. Preserves prior viewName (append-fail UX lock — Phase 35 can retry without
      // re-fetching the deterministic name). Sets status: "error", populates error, strips expiresAt
      // and reason. If entry absent: creates defensive placeholder { viewName: "", status: "error", error }.
      // ALWAYS bumps version (locked rule — even setError-over-already-error).
      setError: (id, error) =>
        set((s) => {
          const prev = s.views[id];
          const nextEntry: DynamicViewEntry = prev
            ? { viewName: prev.viewName, status: "error", error }
            : { viewName: "", status: "error", error };
          return {
            views: { ...s.views, [id]: nextEntry },
            dynamicViewVersion: s.dynamicViewVersion + 1,
          };
        }),

      // DELETE-KEY semantics. Removes the per-id entry on existing; STRICT NO-OP on non-existent
      // (state reference preserved — mirrors filterViewStore.clearView at filterViewStore.ts:75-81
      // and spatialFilterStore.removeShape no-op rule). Bumps version only on successful removal.
      clearView: (id) =>
        set((s) => {
          if (!(id in s.views)) return s; // strict no-op — preserve state reference
          const next = { ...s.views };
          delete next[id];
          return {
            views: next,
            dynamicViewVersion: s.dynamicViewVersion + 1,
          };
        }),

      // Internal-only — Plan 33-03 wires reset() into the canonical 6-store reset block at App.tsx
      // UNAUTHORIZED and DashboardsPage.tsx DashboardOpen cleanup. Hard-set to initial state; NOT an
      // increment (mirrors spatialFilterStore.reset at spatialFilterStore.ts:126-127).
      reset: () => set({ views: {}, dynamicViewVersion: 0 }),
    }));
    ```

    2. Create `kinetica_bi/src/store/dynamicViewStore.spec.ts`. Mirror `spatialFilterStore.spec.ts` structure (single top-level describe per action group or grouped per-action — pick the existing style). Required tests cover ALL behaviors in `<behavior>` above. Concrete scaffolding:

    ```typescript
    import { describe, it, expect } from "vitest";
    import { useDynamicViewStore } from "./dynamicViewStore";

    // No beforeEach reset — Zustand reset shim handles it (src/test/setup.ts).

    describe("useDynamicViewStore — initial state", () => {
      it("starts with empty views and version 0", () => {
        const s = useDynamicViewStore.getState();
        expect(s.views).toEqual({});
        expect(s.dynamicViewVersion).toBe(0);
      });

      it("reading an unknown id returns undefined cleanly", () => {
        expect(useDynamicViewStore.getState().views[999]).toBeUndefined();
      });
    });

    describe("setView", () => {
      it("writes entry verbatim and bumps version", () => {
        useDynamicViewStore.getState().setView(1, {
          viewName: "_kbi_dv_ualice_d1_1",
          status: "materialized",
          expiresAt: 1000,
        });
        const s = useDynamicViewStore.getState();
        expect(s.views[1]).toEqual({
          viewName: "_kbi_dv_ualice_d1_1",
          status: "materialized",
          expiresAt: 1000,
        });
        expect(s.dynamicViewVersion).toBe(1);
      });

      it("ALWAYS bumps version on byte-identical payload (locked rule)", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
        useDynamicViewStore.getState().setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
        expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
      });

      it("REPLACE semantics — payload without expiresAt produces entry without expiresAt", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "a", status: "materialized", expiresAt: 100 });
        useDynamicViewStore.getState().setView(1, { viewName: "b", status: "over_threshold", reason: "no_filter" });
        const e = useDynamicViewStore.getState().views[1];
        expect(e).toEqual({ viewName: "b", status: "over_threshold", reason: "no_filter" });
        expect("expiresAt" in e).toBe(false);
      });
    });

    describe("markPending", () => {
      it("creates placeholder { viewName, status: 'pending' } on absent entry", () => {
        useDynamicViewStore.getState().markPending(1, "_kbi_dv_ualice_d1_1");
        const e = useDynamicViewStore.getState().views[1];
        expect(e).toEqual({ viewName: "_kbi_dv_ualice_d1_1", status: "pending" });
        expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(1);
      });

      it("on existing entry: status → pending, KEEPS prev viewName, strips expiresAt/error/reason", () => {
        useDynamicViewStore.getState().setView(1, {
          viewName: "_kbi_dv_a", status: "materialized", expiresAt: 1000,
        });
        useDynamicViewStore.getState().markPending(1, "different_name_should_be_ignored");
        const e = useDynamicViewStore.getState().views[1];
        // CONTEXT.md § "Action contract" markPending bullet: "keep viewName unchanged" when entry exists.
        expect(e.viewName).toBe("_kbi_dv_a");
        expect(e.status).toBe("pending");
        expect("expiresAt" in e).toBe(false);
        expect("error" in e).toBe(false);
        expect("reason" in e).toBe(false);
      });

      it("ALWAYS bumps version on markPending-over-pending (locked rule)", () => {
        useDynamicViewStore.getState().markPending(1, "v");
        useDynamicViewStore.getState().markPending(1, "v");
        expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
      });
    });

    describe("setError", () => {
      it("preserves prior viewName, sets status='error', populates error, strips expiresAt/reason", () => {
        useDynamicViewStore.getState().setView(1, {
          viewName: "_kbi_dv_a", status: "materialized", expiresAt: 1000,
        });
        useDynamicViewStore.getState().setError(1, "Network down");
        const e = useDynamicViewStore.getState().views[1];
        expect(e).toEqual({ viewName: "_kbi_dv_a", status: "error", error: "Network down" });
        expect("expiresAt" in e).toBe(false);
        expect("reason" in e).toBe(false);
      });

      it("ALWAYS bumps version on setError-over-already-error (locked rule)", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "v", status: "error", error: "msg1" });
        useDynamicViewStore.getState().setError(1, "msg2");
        expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(2);
      });

      it("on absent entry: creates defensive placeholder { viewName: '', status: 'error', error }", () => {
        useDynamicViewStore.getState().setError(99, "msg");
        expect(useDynamicViewStore.getState().views[99]).toEqual({
          viewName: "", status: "error", error: "msg",
        });
      });
    });

    describe("clearView", () => {
      it("removes existing entry and bumps version", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
        const versionBefore = useDynamicViewStore.getState().dynamicViewVersion;
        useDynamicViewStore.getState().clearView(1);
        const s = useDynamicViewStore.getState();
        expect(s.views[1]).toBeUndefined();
        expect(s.dynamicViewVersion).toBe(versionBefore + 1);
      });

      it("STRICT NO-OP on non-existent id — no version bump, state reference preserved", () => {
        const before = useDynamicViewStore.getState();
        useDynamicViewStore.getState().clearView(999);
        const after = useDynamicViewStore.getState();
        expect(after.views).toBe(before.views); // reference equality — state preserved
        expect(after.dynamicViewVersion).toBe(before.dynamicViewVersion);
      });
    });

    describe("version monotonicity", () => {
      it("five mutations produce version === 5", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "v1", status: "materialized", expiresAt: 1 });
        useDynamicViewStore.getState().markPending(2, "v2");
        useDynamicViewStore.getState().setError(3, "msg");
        useDynamicViewStore.getState().clearView(1);
        useDynamicViewStore.getState().setView(4, { viewName: "v4", status: "over_threshold", reason: "no_filter" });
        expect(useDynamicViewStore.getState().dynamicViewVersion).toBe(5);
      });
    });

    describe("reset", () => {
      it("hard-sets state to { views: {}, dynamicViewVersion: 0 } — NOT an increment", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "v", status: "materialized", expiresAt: 1 });
        useDynamicViewStore.getState().setView(2, { viewName: "v", status: "materialized", expiresAt: 1 });
        useDynamicViewStore.getState().reset();
        const s = useDynamicViewStore.getState();
        expect(s.views).toEqual({});
        expect(s.dynamicViewVersion).toBe(0); // hard-set to 0, NOT 3 (would be an increment)
      });
    });

    describe("reference stability (PITFALL C-02 / S-02)", () => {
      it("mutating entry A leaves entry B's object identity intact", () => {
        useDynamicViewStore.getState().setView(1, { viewName: "a", status: "materialized", expiresAt: 1 });
        useDynamicViewStore.getState().setView(2, { viewName: "b", status: "materialized", expiresAt: 2 });
        const entryAFirst = useDynamicViewStore.getState().views[1];
        useDynamicViewStore.getState().setView(2, { viewName: "b2", status: "materialized", expiresAt: 22 });
        const entryAAfter = useDynamicViewStore.getState().views[1];
        expect(entryAAfter).toBe(entryAFirst); // SAME object reference
      });
    });

    describe("error-state shape (success criterion 4)", () => {
      it("after markPending → setError: entry has exactly { viewName, status, error } — no expiresAt/reason", () => {
        useDynamicViewStore.getState().markPending(1, "v");
        useDynamicViewStore.getState().setError(1, "msg");
        const e = useDynamicViewStore.getState().views[1];
        expect(Object.keys(e).sort()).toEqual(["error", "status", "viewName"]);
        expect(e).toEqual({ viewName: "v", status: "error", error: "msg" });
      });
    });
    ```

    3. Run the spec — iterate until all tests pass. Minimum 17 tests across the describe blocks.

    4. CRITICAL: `markPending` semantics — re-read `33-CONTEXT.md` line 56 to confirm the locked behavior. The CONTEXT.md says: "If entry exists: overwrite status to 'pending', strip expiresAt/error/reason, keep viewName unchanged. If entry absent: create placeholder { viewName, status: 'pending' }." This is unambiguous: when entry exists, the new `viewName` arg is IGNORED and prev.viewName wins. This may feel counterintuitive but it is the locked semantic — do NOT change it.
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/store/dynamicViewStore.spec.ts --reporter=verbose 2>&1 | tail -50</automated>
  </verify>
  <done>
    Store file exports `useDynamicViewStore` + types `DynamicViewStatus`, `DynamicViewReason`, `DynamicViewEntry`, `DynamicViewState`. Spec runs green with ≥ 17 tests covering all 17 behaviors enumerated above. Full frontend tsc clean. No regressions on existing specs.
  </done>
  <acceptance_criteria>
    - `test -f kinetica_bi/src/store/dynamicViewStore.ts` exits 0.
    - `test -f kinetica_bi/src/store/dynamicViewStore.spec.ts` exits 0.
    - `grep -nE "export const useDynamicViewStore" kinetica_bi/src/store/dynamicViewStore.ts` returns exactly 1 line.
    - `grep -nE "export type DynamicViewStatus" kinetica_bi/src/store/dynamicViewStore.ts` returns exactly 1 line.
    - `grep -nE "export type DynamicViewReason" kinetica_bi/src/store/dynamicViewStore.ts` returns exactly 1 line.
    - `grep -nE "export type DynamicViewEntry" kinetica_bi/src/store/dynamicViewStore.ts` returns exactly 1 line.
    - `grep -nE "\"materialized\".*\"over_threshold\".*\"pending\".*\"error\"|materialized.*over_threshold.*pending.*error" kinetica_bi/src/store/dynamicViewStore.ts` returns at least 1 line (full status union present).
    - `grep -nE "\"no_filter\".*\"exceeds_max_records\"|no_filter.*exceeds_max_records" kinetica_bi/src/store/dynamicViewStore.ts` returns at least 1 line (reason union present).
    - `grep -nE "setView:|markPending:|setError:|clearView:|reset:" kinetica_bi/src/store/dynamicViewStore.ts | wc -l` returns at least 5 (all 5 actions present).
    - `grep -nE "if \\(!\\(id in s\\.views\\)\\) return s" kinetica_bi/src/store/dynamicViewStore.ts` returns at least 1 line (clearView no-op guard present).
    - `grep -nE "set\\(\\{ views: \\{\\}, dynamicViewVersion: 0 \\}\\)" kinetica_bi/src/store/dynamicViewStore.ts` returns at least 1 line (reset hard-set, NOT increment).
    - `grep -nE "dynamicViewVersion: s\\.dynamicViewVersion \\+ 1" kinetica_bi/src/store/dynamicViewStore.ts | wc -l` returns at least 4 (one bump per non-noop action: setView, markPending, setError, clearView-existing).
    - `cd kinetica_bi && npx vitest run src/store/dynamicViewStore.spec.ts` exits 0 with at least 17 passing tests.
    - `cd kinetica_bi && npx vitest run src/store/` exits 0 (all existing store specs still green — no regression).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
  </acceptance_criteria>
</task>

</tasks>

<verification>
After both tasks complete, run the targeted vitest scope + tsc:

```bash
cd kinetica_bi && npx vitest run src/lib/dynamicViewName.spec.ts src/store/dynamicViewStore.spec.ts --reporter=verbose 2>&1 | tail -40
cd kinetica_bi && npx tsc --noEmit
cd kinetica_bi && npx vitest run src/store/ 2>&1 | tail -20
```

Expected: at least 22 new passing tests (5 helper + 17 store). All existing store specs still green. No type errors.
</verification>

<success_criteria>
- `kinetica_bi/src/lib/dynamicViewName.ts` exports `buildDynamicViewName({ userId, dashboardId, dynamicViewId })` producing `_kbi_dv_u<sanitizedUserId>_d<dashboardId>_<dynamicViewId>` with byte-parity to the server helper.
- `kinetica_bi/src/store/dynamicViewStore.ts` exports `useDynamicViewStore` with the 5 locked actions obeying the 33-CONTEXT.md semantics verbatim.
- `dynamicViewVersion` increments on every successful mutation; `reset()` hard-sets to 0; `clearView(non-existent)` is a strict no-op.
- Spec coverage: ≥ 22 new passing tests across both files; full frontend suite still green; tsc clean.
- Plan ships dormant — no production consumer added in this plan (Plan 33-03 wires App.tsx + DashboardsPage.tsx).
</success_criteria>

<output>
After completion, create `.planning/phases/33-dynamic-view-store/33-01-SUMMARY.md` documenting:
- Final exported types and the verbatim sanitization regex used (so future executors can compare against the server version).
- Test counts per describe block.
- Any decisions made under Claude's discretion (e.g., exported type names — `DynamicViewStatus`, `DynamicViewReason`, `DynamicViewEntry`; spec-organization style — match `spatialFilterStore.spec.ts`).
- Hand-off pointers for Plan 33-03: which exports to import (`useDynamicViewStore`, `buildDynamicViewName`) and the entry-shape contract Phase 35 renderers will read.
</output>

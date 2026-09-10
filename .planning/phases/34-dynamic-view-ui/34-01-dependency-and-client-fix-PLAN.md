---
phase: 34-dynamic-view-ui
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - kinetica_bi/package.json
  - kinetica_bi/package-lock.json
  - kinetica_bi/src/api/client.ts
  - kinetica_bi/src/api/client.spec.ts
autonomous: true
requirements:
  - DV-V16-09
  - DV-V16-10
must_haves:
  truths:
    - "@codemirror/lang-sql v6.10.x is installed under kinetica_bi/ — node_modules and package-lock.json reflect it."
    - "throwForStatus preserves the server's extracted error message in its generic (non-401/403/502) throw path, so 400 responses with `{ error: \"...\" }` bodies surface the verbatim server message in the thrown Error."
    - "client.spec.ts has at least one test that asserts the verbatim server error message on a 400 response (not a false-positive toMatchObject regex)."
    - "All existing client.spec.ts tests still pass after the fix."
  artifacts:
    - path: "kinetica_bi/package.json"
      provides: "@codemirror/lang-sql dependency (^6.10.0)"
      contains: "@codemirror/lang-sql"
    - path: "kinetica_bi/src/api/client.ts"
      provides: "throwForStatus that preserves server error messages on non-401/403/502 status codes"
      contains: "throw new Error(message)"
    - path: "kinetica_bi/src/api/client.spec.ts"
      provides: "Regression test asserting verbatim server 400 message is preserved"
      contains: "Dynamic view template must contain"
  key_links:
    - from: "kinetica_bi/src/api/client.ts:throwForStatus"
      to: "Error.message"
      via: "throw new Error(message)"
      pattern: "throw new Error\\(message\\)"
---

<objective>
Foundation plan for Phase 34. Two surgical, independent changes that unblock the modal:

1. **Add `@codemirror/lang-sql@^6.10.0`** to `kinetica_bi/package.json`. The new modal's CodeMirror editor (Plan 34-03) needs SQL syntax highlighting. Version pinned to sibling-major of existing `@codemirror/lang-html@^6.4.11` (verified via npm registry on 2026-05-14; latest stable is 6.10.0).

2. **Fix `client.ts:throwForStatus`** to preserve the server's extracted error message in its generic (non-401/403/502) throw path. Currently the function reads `body.error` into `message` then THROWS `new Error(\`${fallbackMessage}: ${response.status}\`)` — discarding the extracted message. This means operator-facing 400 errors like `"Dynamic view template must contain a {view} token."` (the verbatim string from `kinetica_bi/server/src/lib/dynamicViewSql.ts:38`) become `"Failed to create dynamic view: 400"` — useless. Plan 34-03's modal MUST surface verbatim server errors per locked CONTEXT.md decision; that contract requires this fix.

Also: **fix the existing false-positive test** at `client.spec.ts:453-463` ("propagates server 400") — its current `toMatchObject({ message: /template_sql must contain/ })` assertion passes vacuously (vitest's `toMatchObject` with a regex on a non-matching property is a known false-positive surface). Replace with explicit string-equal assertion, and add a parallel test for the dynamic-view-template error string.

Purpose: Unblock Plan 34-02 (needs to be able to install lang-sql for transitive build sanity even though it doesn't directly import yet) and Plan 34-03 (needs both the lang-sql import + the throwForStatus fix). Both 34-02 and 34-03 are Wave 2-eligible because of this plan.

Output: New dependency installed; throwForStatus preserves server error messages on 400 (and any other non-401/403/502 status); two new regression tests in client.spec.ts.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/34-dynamic-view-ui/34-CONTEXT.md
@.planning/phases/34-dynamic-view-ui/34-RESEARCH.md

<interfaces>
<!-- Current throwForStatus shape (BUG to fix) - from kinetica_bi/src/api/client.ts:62-80 -->
```typescript
const throwForStatus = async (response: Response, fallbackMessage: string): Promise<never> => {
  let message = fallbackMessage;
  try {
    const body = await response.clone().json();
    if (body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string") {
      message = (body as { error: string }).error;     // extracts message
    }
  } catch {
    const text = await response.text().catch(() => "");
    if (text) message = `${fallbackMessage}: ${text}`;
  }
  if (response.status === 401) throw new ReauthRequiredError(message);
  if (response.status === 403) throw new PermissionError(message);
  if (response.status === 502) throw new UpstreamError(message);
  throw new Error(`${fallbackMessage}: ${response.status}`);   // BUG: discards extracted message
};
```

<!-- Current buggy test - from kinetica_bi/src/api/client.spec.ts:453-463 -->
```typescript
it("propagates server 400 (template missing {view} token) via throwForStatus", async () => {
  fetchSpy.mockResolvedValueOnce(
    new Response(JSON.stringify({ error: "template_sql must contain {view} token." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    })
  );
  await expect(
    createDynamicView(5, { source_table_id: 2, name: "x", template_sql: "SELECT 1", max_records: 100 })
  ).rejects.toMatchObject({ message: /template_sql must contain/ });  // VACUOUSLY PASSES even though actual message is "Failed to create dynamic view: 400"
});
```

<!-- Verified server error string - from kinetica_bi/server/src/lib/dynamicViewSql.ts:38 -->
The server's MissingViewTokenError.message reads exactly:
  "Dynamic view template must contain a {view} token."
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Install @codemirror/lang-sql dependency</name>
  <files>kinetica_bi/package.json, kinetica_bi/package-lock.json</files>
  <read_first>
    - kinetica_bi/package.json (to verify current @codemirror/lang-html version + dependency layout)
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (sections "New Dependency to Add" and "Standard Stack" for version pinning rationale)
  </read_first>
  <action>
Run `cd kinetica_bi && npm install @codemirror/lang-sql@^6.10.0 --save` to add the dependency.

Verify after install:
1. `kinetica_bi/package.json` "dependencies" section contains `"@codemirror/lang-sql": "^6.10.0"` (or the exact resolved version from npm; ^6.10.x is acceptable).
2. `kinetica_bi/package-lock.json` updated.
3. `kinetica_bi/node_modules/@codemirror/lang-sql/` directory exists.

DO NOT run any wider `npm install` or upgrade unrelated packages. Use the targeted form with `--save` to write to dependencies (not devDependencies). The sibling `@codemirror/lang-html` already lives in `"dependencies"`.

Do NOT modify any other files in this task. The import of `sql()` happens in Plan 34-03 (in DynamicViewsModal.tsx); this task just makes the package available.
  </action>
  <verify>
    <automated>cd kinetica_bi && node -e "const p = require('./package.json'); if (!p.dependencies['@codemirror/lang-sql']) { console.error('lang-sql missing'); process.exit(1); } if (!p.dependencies['@codemirror/lang-sql'].startsWith('^6.')) { console.error('wrong major'); process.exit(1); } console.log('ok:', p.dependencies['@codemirror/lang-sql']);"</automated>
  </verify>
  <acceptance_criteria>
    - `cd kinetica_bi && node -e "console.log(require('@codemirror/lang-sql').sql)"` prints `[Function: sql]` (or similar function reference — not undefined).
    - `grep -q '"@codemirror/lang-sql"' kinetica_bi/package.json` exits 0.
    - `grep -q '"@codemirror/lang-sql"' kinetica_bi/package-lock.json` exits 0.
    - No other package.json dependencies changed (verifiable by `cd kinetica_bi && git diff package.json` showing only the added @codemirror/lang-sql line; sibling @codemirror/lang-html version unchanged).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0 (no type regressions introduced by the new dependency).
  </acceptance_criteria>
  <done>
    @codemirror/lang-sql installed at ^6.10.0; package.json + package-lock.json updated; node_modules populated; existing tsc still clean.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Fix throwForStatus to preserve server error messages + replace buggy test + add regression tests</name>
  <files>kinetica_bi/src/api/client.ts, kinetica_bi/src/api/client.spec.ts</files>
  <read_first>
    - kinetica_bi/src/api/client.ts (lines 1-130 — error classes, throwForStatus, apiFetch)
    - kinetica_bi/src/api/client.spec.ts (lines 350-470 — existing dynamic-view describe blocks, focus on the buggy "propagates server 400" test at lines 453-463)
    - kinetica_bi/server/src/lib/dynamicViewSql.ts (lines 1-50 — to confirm the verbatim error string `"Dynamic view template must contain a {view} token."`)
    - .planning/phases/34-dynamic-view-ui/34-RESEARCH.md (section "Pitfall 1: 400 error message is swallowed by throwForStatus" — full rationale, locked fix)
    - .planning/phases/34-dynamic-view-ui/34-CONTEXT.md (section "{view} validation timing: server-only" — confirms operator-facing surfacing of the verbatim message is locked-in)
  </read_first>
  <behavior>
    - Test 1 (RED first): A 400 response with body `{ error: "Dynamic view template must contain a {view} token." }` thrown by `createDynamicView` produces an `Error` whose `.message` is EXACTLY `"Dynamic view template must contain a {view} token."` (not `"Failed to create dynamic view: 400"`). Asserted via `.rejects.toThrow(new Error("Dynamic view template must contain a {view} token."))` or via `try/catch` + `expect(err.message).toBe("...")` for byte-exact match (NOT `toMatchObject` with regex — that's the false-positive surface to avoid).
    - Test 2 (regression): A 500 response with a non-JSON text body (e.g., raw string "Internal error") produces an Error whose `.message` includes both the fallback and the text — preserving the existing `${fallbackMessage}: ${text}` behavior for that branch.
    - Test 3 (regression): A 400 response with NO JSON body and no text falls back to `fallbackMessage` (not the empty-string concat) — proves the `let message = fallbackMessage` default holds when the server gives nothing usable.
    - Test 4 (regression for the previewDynamicView path): A 400 response on `previewDynamicView` with body `{ error: "Dynamic view template must contain a {view} token." }` produces an Error whose `.message` matches the verbatim server string. (Mirror Test 1 for the preview helper since CONTEXT locks "Preview panel for Preview errors".)
    - Test 5: Replace/repair the existing buggy test at lines 453-463 (the regex toMatchObject false-positive). Use `try/catch + expect(err.message).toBe(...)` for byte-exact assertion.
    - Existing 401/403/502 tests at lines 85-129 / 227-244 / 293-313 etc. continue to pass — `ReauthRequiredError` / `PermissionError` / `UpstreamError` instances still get the server-extracted message via their constructors.
  </behavior>
  <action>
**Step 1: Write failing tests FIRST (RED).**

In `kinetica_bi/src/api/client.spec.ts`:

a. REPLACE the existing buggy test at lines 453-463 (in the `describe("createDynamicView")` block) with a byte-exact assertion:

```typescript
it("propagates server 400 with verbatim server error message (DV-V16-09)", async () => {
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ error: "Dynamic view template must contain a {view} token." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ),
  );
  let actualMessage = "<no-error>";
  try {
    await createDynamicView(
      5,
      { source_table_id: 2, name: "x", template_sql: "SELECT 1", max_records: 100 },
    );
  } catch (e) {
    actualMessage = (e as Error).message;
  }
  // Byte-exact — NOT toMatchObject regex (vitest false-positive surface).
  expect(actualMessage).toBe("Dynamic view template must contain a {view} token.");
});
```

b. ADD a parallel regression test in the `describe("previewDynamicView")` block (find it near line 561+; add as a new `it(...)` adjacent to the existing 502 test):

```typescript
it("propagates server 400 with verbatim server error message (DV-V16-10)", async () => {
  fetchSpy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ error: "Dynamic view template must contain a {view} token." }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    ),
  );
  let actualMessage = "<no-error>";
  try {
    await previewDynamicView({
      template_sql: "SELECT 1",
      source_table_id: 2,
      dashboard_id: 5,
    });
  } catch (e) {
    actualMessage = (e as Error).message;
  }
  expect(actualMessage).toBe("Dynamic view template must contain a {view} token.");
});
```

c. ADD a generic regression test inside a NEW `describe("throwForStatus generic 4xx/5xx", () => { ... })` block at the bottom of the file (after all the existing describe blocks). The intent is to lock-in the preservation behavior for the generic non-401/403/502 path independent of any specific helper. Use `runSql` as a vehicle (already in the file and uses throwForStatus):

```typescript
describe("throwForStatus generic 4xx/5xx error preservation", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, "fetch"); });
  afterEach(() => { fetchSpy.mockRestore(); });

  it("preserves server-provided error message verbatim on 400 (non-401/403/502)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Bad request from server" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    let actualMessage = "<no-error>";
    try { await runSql("SELECT 1"); } catch (e) { actualMessage = (e as Error).message; }
    expect(actualMessage).toBe("Bad request from server");
  });

  it("falls back to '${fallbackMessage}: ${text}' when body is text (not JSON)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Internal text error", {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      }),
    );
    let actualMessage = "<no-error>";
    try { await runSql("SELECT 1"); } catch (e) { actualMessage = (e as Error).message; }
    expect(actualMessage).toBe("SQL request failed: Internal text error");
  });

  it("falls back to fallbackMessage alone when body is empty + no JSON parse", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", { status: 418 }),
    );
    let actualMessage = "<no-error>";
    try { await runSql("SELECT 1"); } catch (e) { actualMessage = (e as Error).message; }
    expect(actualMessage).toBe("SQL request failed");
  });
});
```

Make sure `previewDynamicView` is imported alongside other imports at the top of client.spec.ts (it likely already is from existing tests — verify before editing).

Run vitest. Tests c.a / c.b / c.c.first / c.c.third should FAIL with current message `"Failed to create dynamic view: 400"` / `"Failed to preview dynamic view: 400"` / `"SQL request failed: 400"` / `"SQL request failed: 418"`. Test c.c.second should already PASS (text branch already preserves the message).

**Step 2: Apply the throwForStatus fix (GREEN).**

In `kinetica_bi/src/api/client.ts:79`, replace:

```typescript
throw new Error(`${fallbackMessage}: ${response.status}`);
```

With:

```typescript
// Preserve server-extracted message when present (Phase 34 DV-V16-09 / DV-V16-10).
// When the body had { error: "..." } JSON, `message` is the server's verbatim string.
// When the body was text, `message` is "${fallbackMessage}: ${text}" (see catch block above).
// When neither, `message` is the fallback. This keeps existing 4xx/5xx callers backward-compatible
// while letting Phase 34's DynamicViewsModal surface verbatim {view}-token errors.
throw new Error(message);
```

DO NOT modify lines 76/77/78 (the 401/403/502 branches) — they already use `message` via their error class constructors.

Re-run vitest. All new tests should now PASS. All existing 40 tests should also still PASS — the existing 401/403/502 tests already exercise `message`; the 502 tests at lines 107-116 / 400-407 / 597-606 / 681-688 all use JSON bodies with `error: "..."` and assert `.rejects.toBeInstanceOf(UpstreamError)` (instance check unaffected by message preservation); the existing `runSql` tests don't test the generic 4xx fallthrough.

Final state:
- 40 existing tests pass (some may now have stricter expectations but only the "propagates server 400" test was buggy and is being explicitly replaced).
- 4 new tests pass.
- Total: 44 tests in client.spec.ts.

**Step 3: Verify tsc.**

`cd kinetica_bi && npx tsc --noEmit` exits 0.

**Step 4: Verify the rest of the codebase still passes.**

`cd kinetica_bi && npx vitest run` exits 0 (full frontend suite green; baseline was 775/775 at Phase 31 close; this fix should not regress any).
  </action>
  <verify>
    <automated>cd kinetica_bi && npx vitest run src/api/client.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - `cd kinetica_bi && npx vitest run src/api/client.spec.ts` exits 0 with 44+ tests passing (40 original + at least 4 new).
    - `grep -q "throw new Error(message);" kinetica_bi/src/api/client.ts` exits 0 (the fix is in place).
    - `grep -c 'Dynamic view template must contain a {view} token.' kinetica_bi/src/api/client.spec.ts` returns >= 2 (verbatim string used in both createDynamicView and previewDynamicView tests).
    - `grep -q "toBe(\"Dynamic view template must contain" kinetica_bi/src/api/client.spec.ts` exits 0 (byte-exact assertion, not regex toMatchObject).
    - `cd kinetica_bi && npx tsc --noEmit` exits 0.
    - `cd kinetica_bi && npx vitest run` exits 0 (full suite green — no regressions to other specs).
    - `grep -q "throw new Error(.${'fallbackMessage'}.: .${'response.status'}.)" kinetica_bi/src/api/client.ts` returns no matches (old buggy line gone).
  </acceptance_criteria>
  <done>
    throwForStatus preserves server error messages on the generic 4xx/5xx throw; buggy existing test replaced with byte-exact assertion; new regression tests added for createDynamicView, previewDynamicView, and a generic runSql 400 path; full frontend vitest + tsc green.
  </done>
</task>

</tasks>

<verification>
After both tasks:
1. `cd kinetica_bi && npx vitest run` exits 0 (full suite).
2. `cd kinetica_bi && npx tsc --noEmit` exits 0.
3. `cd kinetica_bi && node -e "console.log(typeof require('@codemirror/lang-sql').sql)"` prints `function`.
4. `grep -q "throw new Error(message);" kinetica_bi/src/api/client.ts` succeeds.
5. `grep -q '"@codemirror/lang-sql"' kinetica_bi/package.json` succeeds.
</verification>

<success_criteria>
- @codemirror/lang-sql installed at ^6.10.0 and resolvable from kinetica_bi/.
- throwForStatus preserves server-extracted error messages on non-401/403/502 status codes.
- Existing buggy test (toMatchObject regex false-positive) replaced with byte-exact assertion.
- Two new regression tests assert the verbatim CONTEXT.md-required `"Dynamic view template must contain a {view} token."` is surfaced.
- Generic regression tests lock-in the preservation behavior for the new throwForStatus contract.
- Full frontend vitest + tsc remain green.
</success_criteria>

<output>
After completion, create `.planning/phases/34-dynamic-view-ui/34-01-SUMMARY.md` capturing:
- Confirmed @codemirror/lang-sql version installed (exact resolved version from package-lock.json).
- Diff summary of the throwForStatus fix (one-line change).
- Total test count before/after in client.spec.ts.
- Confirmation that no other client.ts behavior changed (instance-check tests for 401/403/502 still green).
</output>

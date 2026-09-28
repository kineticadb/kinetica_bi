# Phase 126: Datasets UI, Access Gating & Operator Verification — Research

**Researched:** 2026-09-28
**Domain:** `packages/web` React UI over four already-shipped server routes; client-side RBAC gating; CSS token discipline
**Confidence:** HIGH for everything answered with FILE:LINE below. Two items are explicitly flagged LOW/uncertain in § "Open Questions".

> Every claim in this document was read out of source in this working tree on 2026-09-28, not
> copied from a planning doc. Where a planning doc and source disagreed, source won and the
> disagreement is recorded (see § "CORRECTIONS TO UPSTREAM DOCS" — there is one, and it changes
> scope).

---

<user_constraints>
## User Constraints (from 126-CONTEXT.md)

### Locked Decisions

**Permission gating — REQUIREMENT AMENDMENT**

- The UI gates on `datasets:manage` AND `dashboards:manage_access` — matching the server exactly.
- SSYNC-V125-19's single-permission wording is **amended**, not reinterpreted. Amend the text in
  `.planning/REQUIREMENTS.md` **in its own commit**, stating that the double-gate shipped in
  Phase 124/125.
- Controls are **ABSENT, not disabled**, for a user lacking either permission.
- Precedent: `packages/web/src/components/DashboardsPage.tsx:130-132`.
- `DatasetsPage.tsx` does NO client-side permission gating today — it renders "Permission denied"
  reactively from a server 403 (`:171-174`, `:431-434`). **The reactive path stays as a backstop;
  the absence gate is new work.**

**Flow shape**

- One per-table modal, staged in place: check → report → apply → history.
- Mirror `ColumnFormatEditorModal` / `CustomMetricsEditorModal`, which `DatasetsPage.tsx` already
  opens per table at `:279` and `:285`. Same entry-point shape, same open/close wiring.
- One entry point per Datasets row, not two.

**Impact report presentation**

- Full list, breaking findings first. No progressive disclosure, no summary-counts-first view.
- Ordering is locked from Phase 124: by severity, then by column. Do not re-sort by dashboard.
- "The cap is 20 findings and the report says so when it truncates; render that verbatim."
  **→ SEE § "CORRECTIONS TO UPSTREAM DOCS". No such cap exists. This bullet is void.**

**Apply confirmation**

- A single Apply button, always enabled. Clicking Apply IS the explicit confirmation.
- No second confirm dialog, no type-the-table-name guard (SSYNC-V125-15).

**Stale refusal (HTTP 409)**

- Render `SCHEMA_APPLY_STALE_MESSAGE` verbatim, plus a **Re-check** button that re-runs the check
  in place so the operator lands on a fresh report without reopening the modal.
- Do NOT auto-re-check silently.

**Sync history**

- Row shows timestamp · actor · counts.
- Expanding a row reveals the full changeset and the impact report as it stood at that moment.
- Delete per row with NO confirm dialog.
- Cap notice above the list, shown **only when `droppedCount > 0`** — "Showing the 20 most recent.
  N older entries were dropped." **Read `cap` from the response, never hardcode 20.**

**Verbatim strings — non-negotiable**

- Six strings approved at Phase 125's blocking checkpoint 2026-09-28, pinned in `125-04-SUMMARY.md`.
  Render verbatim; do not paraphrase, re-case, or re-punctuate.
- `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` is UNREACHABLE over HTTP. **Do NOT build a UI branch for it.**
- `SCHEMA_APPLY_TEXT_WIDTH_GAP` must be rendered after an apply, **unconditionally** (ROADMAP
  criterion 6).

**Operator verification checkpoint (criterion 5) — all four cases**

1. All four column drift cases — add, drop, rename, retype.
2. Drop the whole table — confirm table-not-found rather than error/stale columns.
3. Apply, then verify the config panels offer the live columns (SSYNC-V125-13's second clause).
4. History survives a server restart.

Expect `table_missing` on most registered tables: five of the nine have been dropped from Kinetica.
That is correct behaviour, not a defect.

### Claude's Discretion

- Exact modal width, spacing, and stage transitions.
- Loading and empty states within the modal.
- How the expanded history detail is laid out.
- Whether the apply result uses the existing toast store or renders in the modal.

### Deferred Ideas (OUT OF SCOPE)

- **Conditional text-gap warning** — showing `SCHEMA_APPLY_TEXT_WIDTH_GAP` only when the table
  actually had a `text` column. Offered and declined.
- **Relaxing the server's double permission gate** so SSYNC-V125-19's original wording holds.
  Considered and rejected — reopens the RBAC exposure Phase 124's plan checker found.
- **Correcting the two stale `foreign_keys` PRAGMA comments** in `db.ts` (`:231`, `:583`).
  Documentation-only; out of scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **SSYNC-V125-01** | From the Datasets page, an operator can check a single registered table for schema changes against live Kinetica, on demand — no background polling and no added round-trip on dashboard load | § Q5 (the `checkTableSchema` caller shape + where it goes in `client.ts`); § Q3 (staged-modal test pattern); § "Verified acceptance-criterion anchors" gives a *pre-run* baseline of 0 for `setInterval(` tree-wide, so the no-polling criterion can actually discriminate |
| **SSYNC-V125-18** | An operator can view a table's sync history from Datasets and clear entries they have finished acting on | § Q5 (`GET /sync-history` → `TableSyncHistory`, `DELETE …/:entryId` → 204); § "Server contracts as shipped" (`cap` / `droppedCount` semantics, incl. the deliberate non-decrement of `droppedCount`) |
| **SSYNC-V125-19** | Checking, applying and clearing history require the same permission that governs dataset management today; a user without it cannot reach them in the UI or through the API | § Q4 (the three-combination absence-gate idiom, with the exact existing probe at `DashboardsPage.exportimport.spec.tsx:202-215`); § "The amendment" — the requirement text itself must change, in its own commit |

**API-side half of SSYNC-V125-19 is already closed** by `routes.schema-apply.spec.ts`'s three
`GATE-` tests (`125-04-SUMMARY.md`) plus the schema-check route's own gate tests. This phase owns
only the UI half plus the requirement-text amendment.
</phase_requirements>

---

## Summary

Everything the server needs to do is done. Four routes exist, their bodies are fully specified, and
five of the six operator-facing strings arrive over the wire in a `message` field — so "render
verbatim" is mostly "render `response.message`", not "mirror a constant". **No `packages/server`
change is required.** The one exception (`SCHEMA_APPLY_TEXT_WIDTH_GAP`) can be mirrored in
`packages/web` and guarded by an executable cross-package parity test that I prototyped and ran
successfully (§ Q6) — so even that does not force a server edit.

The two things that will actually bite are both CSS/test-infrastructure, not feature logic.
First: **`global.css` is on theme-guard's hex ALLOWLIST** (`theme-guard.spec.ts:57`), and the guard
*only ever asserts hex IS present* for allowlisted files — so any new severity colour written into
`global.css` passes every automated gate unconditionally, in both themes, forever. This is not "the
guard misses `rgba()`"; it is a total exemption. The in-tree proof is `.view-status-created
{ color: #22c55e }` (`global.css:1818-1821`), a three-state badge set whose colours are hardcoded
and identical in light mode. Second: the existing `.error` class is `color: #ef4444`
(`global.css:1098-1100`) — also unthemed. The correct pattern to copy is `.login-error`
(`global.css:2163-2170`), which uses `color-mix(in srgb, var(--danger) 12%, transparent)` for the
fill and `var(--danger)` for the text, and therefore re-skins in both themes and under a
re-branded palette.

The third finding is a scope correction: **the impact report has no 20-finding cap and no
truncation message.** `126-CONTEXT.md:63` says otherwise. It does not exist in source (§
CORRECTIONS). Planning a "render the truncation notice verbatim" task would produce a task with
nothing to render.

**Primary recommendation:** Build one new component `SchemaSyncModal.tsx` opened from
`TableDetail`'s existing actions bar (`DatasetsPage.tsx:224-236`, the literal precedent CONTEXT
points at), append four callers to the end of `api/client.ts`, add the severity/report/history CSS
to `global.css` using the `.login-error` `color-mix` pattern (never `#hex`, never a raw `rgba()`
literal), and treat every colour decision as unverifiable-by-gate — route it to the human-verify
checkpoint alongside a hand-run audit.

---

## CORRECTIONS TO UPSTREAM DOCS

**These override the documents they correct. Both were verified against source, twice.**

### 1. There is NO 20-finding cap on the impact report. `126-CONTEXT.md:63` is wrong.

`126-CONTEXT.md:63` states: *"The cap is 20 findings and the report says so when it truncates;
render that verbatim."*

**Evidence it does not exist:**

- `buildImpactReport`'s return (`packages/server/src/lib/schemaImpact.ts:424-431`) is
  `{ v, table, tableId, outcome, sections, advisorySummary, knownGaps }`. There is no cap field,
  no truncation flag, and no truncation message.
- `schemaImpact.ts` contains no `.slice(`, no `MAX_`, no `CAP`, no `truncat`, no `limit` — grepped
  case-insensitively across `schemaImpact.ts`, `columnRefs.ts`, `columnTypeClass.ts` and
  `schemaApply.ts`. The only `.slice(` hits in `columnRefs.ts` (`:306`, `:989`, `:1203`) are
  `lines.slice(0, -1)` offset arithmetic for free-SQL match positions.
- Section assembly (`schemaImpact.ts:410-422`) pushes **every** column into its severity bucket and
  sorts; nothing is dropped.

**Where the 20 actually comes from:** `SYNC_HISTORY_CAP = 20` (`packages/server/src/db.ts:698`) —
the **sync-history entry** cap, surfaced as `TableSyncHistory.cap`. `124-CONTEXT.md:79` also uses
"across 20 findings" rhetorically ("Finding-only risks the pattern going unnoticed across 20
findings"), which is the most likely source of the conflation.

**Planner action:** drop the truncation-notice bullet. The report is rendered in full, which is
what the "full list, breaking findings first" decision already says. The **sync-history** cap
notice (`126-CONTEXT.md:84-86`) is real and stays exactly as written.

### 2. "The UI imports the constant" (ROADMAP criterion 6) is not literally achievable.

ROADMAP Phase 126 criterion 6 says *"The UI imports the constant and renders it verbatim."* There
are no cross-package imports in this repo and `packages/web` has no path alias to
`packages/server`. Confirmed: `SCHEMA_APPLY_TEXT_WIDTH_GAP` appears in exactly **two** files
tree-wide — `packages/server/src/lib/schemaApply.ts:146` and
`packages/server/tests/lib.schemaApply.spec.ts` (`:13`, `:259`, `:266`, `:267`). Zero hits in
`packages/web`. It is also **never referenced in `packages/server/src/index.ts`**, so it reaches no
response body.

The criterion's *intent* — the text is rendered verbatim and cannot silently drift from the
server's — is achievable and is answered in § Q6 with a prototyped, executed guard. Say so in the
plan rather than writing "imports" into a task that cannot compile.

---

## Server contracts as shipped (read from source 2026-09-28)

All four routes carry the same AND-gate. Verified in `packages/server/src/index.ts`:

| Route | Line | `requireConfig`? | Gate |
|---|---|---|---|
| `GET /api/tables/:id/schema-check` | `:2497-2501` | yes | `DATASETS_MANAGE` + `DASHBOARDS_MANAGE_ACCESS` |
| `POST /api/tables/:id/schema-apply` | `:2574-2578` | yes | same |
| `GET /api/tables/:id/sync-history` | `:2661-2665` | **no** | same |
| `DELETE /api/tables/:id/sync-history/:entryId` | `:2679-2683` | **no** | same |

### `GET /schema-check` → `SchemaCheckResponse`

`SchemaCheckResult` (`packages/server/src/lib/schemaDiff.ts:150-161`) plus an optional `impact`
(`schemaImpact.ts:146`):

```ts
type SchemaCheckResult =
  | { outcome: "diff"; table: string; hasChanges: boolean;
      added: AddedColumn[]; removed: RemovedColumn[]; retyped: RetypedColumn[];
      live: ColumnFingerprintMap }
  | { outcome: "baseline_required"; table: string; message: string; live: ColumnFingerprintMap }
  | { outcome: "table_missing"; table: string; message: string };

type SchemaCheckResponse = SchemaCheckResult & { impact?: ImpactReport };
```

**Four UI states the modal must handle, and only four:**

| Outcome | HTTP | Carries `live`? | Carries `impact`? | Apply possible? | What to render |
|---|---|---|---|---|---|
| `diff`, `hasChanges: true` | 200 | yes | **yes** (`index.ts:2537-2544`) | yes | the full report |
| `diff`, `hasChanges: false` | 200 | yes | **yes** (route attaches to any `diff`), with `impact.outcome === "no_changes"` | yes, but pointless (server answers `no_changes`) | "no changes" state |
| `baseline_required` | 200 | yes | **no** | yes → `kind: "baseline"` | `message` verbatim + Apply |
| `table_missing` | 200 | **no** | no | **no — nothing to echo back** | `message` verbatim; Apply must be absent/disabled |

The `impact`-key absence is load-bearing and documented as such at `index.ts:2533-2536`: *"Its
ABSENCE is what tells Phase 126 'not yet run / not applicable'."* Do not default it to an empty
report.

`ImpactReport.sections` is **always exactly three, always in order `breaking`, `changed`,
`harmless`** (`schemaImpact.ts:135-137`, assembled at `:414-422` from
`severityOrder = ["breaking","changed","harmless"]`, columns sorted byte-ascending within each).
**The UI renders `sections` in array order and performs no sorting.** That is the whole of
"breaking findings first, then by column."

`ImpactRecord.displayLabel` (`schemaImpact.ts:96-97`) is fully composed server-side **including the
noun** — `impactNaming.ts:195/204/220/236` produce e.g. `widget "Foo" on dashboard "Bar"`,
`map layer 7 (no name)`, `column-format rule for "…"`. The client renders `displayLabel` verbatim
and needs **no** record-kind→noun map. Likewise `ImpactColumn.summary`,
`ImpactReference.certainty`, `ImpactAdvisory.message`, `ImpactRecord.staleDrillDownType.message`
and `ImpactReport.knownGaps[]` are all "rendered VERBATIM" per their own doc-comments.

`knownGaps` is currently `[COLUMNS_JSON_TYPE_GAP]` — one element (`schemaImpact.ts:431`). Render
the array, not `knownGaps[0]`.

### `POST /schema-apply`

Request body: `{ live: ColumnFingerprintMap }` — the map the check already handed back, echoed
unchanged. **An empty object is 400 before any Kinetica call** (`index.ts:2586-2601`); the route
comment at `:2584-2588` explains why (an empty map would wipe `tables.columns`).

Status map (`index.ts:2604-2646`, and `125-04-SUMMARY.md` § 2):

| Code | When | Body |
|---|---|---|
| 200 | `outcome: "applied"` (`kind: "baseline"` \| `"diff"`) | full `SchemaApplyResult` |
| 200 | `outcome: "no_changes"` | `{ outcome, table, tableId, message }` |
| 400 | `live` absent/not-an-object/array/empty | `{ error: string }` |
| 403 | missing either permission | `{ error, code: "PERMISSION_DENIED", permission }` (`rbac.ts:65`) |
| 404 | unknown table **row** | `{ error: "Table not found." }` |
| **409** | `outcome: "stale"` | `{ outcome:"stale", table, tableId, message }` |
| **409** | `outcome: "table_missing"` (Kinetica dropped it) | `{ ...tableMissingResult(qualified), tableId }` |
| 502 | `/show/table` unreachable / unreadable / no readable columns | `{ error }` |

The applied arm (`schemaApply.ts:369-381`) returns `kind`, `recorded: true`, `historyId`,
`droppedThisApply`, `columns` (the new `tables.columns` map, echoed so the caller need not re-read),
`changeset`, `message`.

### `GET /sync-history` → `TableSyncHistory`

`packages/server/src/db.ts:753-762` (shape reproduced in `125-04-SUMMARY.md` § 5); `cap` is
`SYNC_HISTORY_CAP` (`db.ts:698` = 20) and is returned at `db.ts:859`. Empty table returns
`{ entries: [], droppedCount: 0, lastDroppedTs: null, cap: 20 }`.

`droppedCount` is **deliberately not decremented** by a per-entry delete (`index.ts:2674-2677`):
it records what the *cap* removed, a different fact from how many entries remain. So the cap
notice can stay visible after the operator clears rows. That is intended, and the notice wording
locked in CONTEXT is consistent with it.

### `DELETE /sync-history/:entryId`

204, empty body. 404 for an unknown entry **or an entry belonging to a different table**
(`index.ts:2691-2695`) — the table id in the path is checked against `entry.table_id`.

---

## Answers to the six open questions

### Q1 — Severity colours

**There is no `.badge` or `.severity-*` class, but there ARE four text-colour utility classes
already, and they are the right starting point.**

`packages/web/src/styles/global.css`:

| Class | Line | Declaration |
|---|---|---|
| `.text-danger` | `:150-152` | `color: var(--danger)` |
| `.text-warning` | `:153-155` | `color: var(--warning)` |
| `.text-muted` | `:156-158` | `color: var(--muted)` |
| `.text-accent` | `:159-161` | `color: var(--accent-text)` |

theme-guard's own failure message names them explicitly as the sanctioned alternative to hex
(`theme-guard.spec.ts:118-121`). `--danger` is `#fb7185` dark / `#e11d48` light (`:20`, `:130`);
`--warning` is `#f59e0b` / `#d97706` (`:21`, `:131`). Both flip per theme. `--success` is
`var(--accent)` in dark (`:22`) and *inherits* `--accent` in light (`:132` is a comment, not a
declaration) — so it is the brand violet in both modes and is **not** a distinct green.

**Recommendation for the three severities:** map `breaking → --danger`, `changed → --warning`,
`harmless → --muted`. Three distinct hues in both themes, zero new tokens, zero risk of a
brand-violet "success" reading as an accent control. Do **not** reach for `--success`.

**What other components do to distinguish states — and which precedent to copy.**

Two families exist, and they are not equally good:

| Precedent | Line | Technique | Verdict |
|---|---|---|---|
| `.login-error` | `:2163-2170` | `background: color-mix(in srgb, var(--danger) 12%, transparent)`; `border: 1px solid color-mix(in srgb, var(--danger) 40%, transparent)`; `color: var(--danger)` | **COPY THIS.** Token-driven, re-skins with both themes and with a re-branded `--danger`. |
| `.filter-bar-chip` | `:1480-1496` | accent-tinted via `color-mix` (comment at `:1485` states the intent: "re-skins with a re-branded `--accent`") | Good, same family |
| `.filter-panel-rail-badge` / `--empty` | `:1664-1682` | `background: var(--accent)` / transparent + `var(--border)` + `var(--muted)` | Good, token-only |
| `.view-status-pending/-created/-error` | `:1809-1823` | raw `rgba(245,158,11,.15)` + `#f59e0b`, `rgba(34,197,94,.15)` + `#22c55e`, `rgba(239,68,68,.15)` + `#ef4444` | **DO NOT COPY.** Hardcoded, identical in light mode. |
| `.layer-row-badge.error` | `:2993-2999` | `rgba(239,68,68,0.12)` + `#fecaca` text | **DO NOT COPY.** `#fecaca` is a pale pink — illegible on a light background. |
| `.error` | `:1098-1100` | `color: #ef4444` | Unthemed. Existing, widely used; not worth fixing here, but do not extend it. |

**The theme-guard finding that changes how this must be planned.**

`global.css` is entry `:57` of theme-guard's hex `ALLOWLIST`. For an allowlisted file the test body
(`theme-guard.spec.ts:107-114`) asserts `hasHex === true` and **returns** — it never checks for
absence. So:

> **Any hardcoded hex written into `global.css` passes `npx vitest run src/styles/theme-guard.spec.ts`
> unconditionally, and always will.** `.view-status-created { color: #22c55e }` is the standing
> in-tree proof.

This is already recorded as a project finding (`.planning/ROADMAP.md:232`; `PROJECT.md:63`,
`:650`), where the compensating control was *"a hand-run hex+rgba audit run three times
independently — executor, orchestrator, verifier — all 0 — plus separate light/dark operator
checks."* **Reuse that control.** It is the only thing that works.

The **structural** guard (layer 2) *does* cover `global.css` (`theme-guard.spec.ts:176-178` adds
`GLOBAL_CSS_PATH` to `allFiles`, and `:181-184` asserts it is in the set). So `padding: 12px` in a
new rule WILL fail. Use `var(--space-*)` / `var(--radius-*)` / `var(--text-*)`; `0`, `1px` and `2px`
are permitted (`:139`).

**What IS automatically verifiable here** (pre-run baselines in § "Verified acceptance-criterion
anchors"): "the new `.tsx` component contains zero `#hex`" — the new component is under
`src/components/`, is **not** allowlisted, and so the hex guard genuinely applies to it. Also
provable: "the new `global.css` block contains no `#` character and no `rgba(` literal", asserted
on the **added lines of the diff** (`git diff --unified=0 … | grep '^+[^+]'`), not on the whole
file — the whole file has hundreds of pre-existing hits and such a grep could never discriminate
(CLAUDE.md § "Writing verifiable acceptance criteria").

**What is NOT automatically verifiable:** that the three severities read as distinct and legible in
both themes. Route to `checkpoint:human-verify`. Do not dress it in a grep.

---

### Q2 — `api/client.ts` error handling, and how a 409 surfaces

**Read: `packages/web/src/api/client.ts:29-118`.**

Three error classes with a literal `status` field:

```ts
export class ReauthRequiredError extends Error { readonly status = 401 as const; … }  // :29-36
export class PermissionError    extends Error { readonly status = 403 as const; … }  // :38-45
export class UpstreamError      extends Error { readonly status = 502 as const; … }  // :47-54
```

`apiFetch` (`:58-93`) adds `credentials: "include"`, peeks 401 bodies for `code:"REAUTH_REQUIRED"`
(→ `UNAUTHORIZED_EVENT`) and 403 bodies for `code:"PERMISSION_DENIED"` (→ a `"permission"` toast
plus a 200ms-debounced `PERMISSION_DENIED_EVENT`). The server's 403 body carries exactly that shape
(`packages/server/src/rbac.ts:65`), so the reactive backstop works on all four new routes with no
extra wiring.

`throwForStatus` (`:97-118`) reads `{ error: string }` from the body, then:

```ts
if (response.status === 401) throw new ReauthRequiredError(message);   // :111
if (response.status === 403) throw new PermissionError(message);       // :112
if (response.status === 502) throw new UpstreamError(message);         // :113
throw new Error(message);                                             // :118
```

> **Answer to the direct question: a 409 is NOT distinguishable from a 400, 404 or 500 by any
> existing mechanism.** It falls to the bare `throw new Error(message)` at `:118`. The plain `Error`
> carries **no** status code, and the body's `outcome` field is discarded entirely — only the
> `error` key is read, and the 409 stale body has no `error` key (it has `outcome`, `table`,
> `tableId`, `message`). So a naive caller would surface `"Failed to apply schema"` and lose the
> approved stale text. **The stale flow is unbuildable on `throwForStatus` alone.**

`error.kind === "permission"` comes from `useApiQuery`, not from the client:
`packages/web/src/hooks/useApiQuery.ts:5-8` declares
`ApiQueryError = { kind: "permission" | "reauth" | "upstream" | "other"; message: string }` and
`:36-53` maps the three error classes onto it, defaulting everything else — including 409 — to
`kind: "other"`. **It does not generalise to 409.** It is also mount-scoped (`:27-62`, an effect
over `deps`), so it is the wrong tool for a button-triggered mutation anyway; the existing
modals use bare promises with local state (`DatasetsPage.tsx:309-316`,
`CustomMetricsEditorModal.spec.tsx` T3).

**Two precedents in the same file for returning a union instead of throwing:**

| Precedent | Line | Shape |
|---|---|---|
| `assignRole` / `revokeRole` / `updateRolePermissions` / `createRole` / `deleteRole` | `:1594-1668` | reads the body regardless of `.ok`, returns `{ ok: true } \| { ok: false, error }` |
| `materializeDynamicView` + `MaterializeDynamicViewResponse` | `:1293-1296`, `:1421-1435` | server puts a `status` discriminator in a **200** body; client just types the union |

**Recommendation for `applyTableSchema`:** handle 409 explicitly *before* `throwForStatus`, parse
the body, and return it as part of the union — so 401/403/502 keep their existing classes and 400/
404 still throw, while stale/table_missing become ordinary return values the modal branches on:

```ts
const response = await apiFetch(`${API_BASE}/api/tables/${tableId}/schema-apply`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ live }),
});
// 409 is the server's REFUSAL, not a failure: `stale` and `table_missing` are modelled
// outcomes carrying operator-facing `message` text that throwForStatus() would discard
// (client.ts:118 throws a bare Error and reads only a `{ error }` key, which a 409 body
// does not have). Parse it as a result, not an error.
if (response.status === 409) {
  return (await response.json()) as SchemaApplyResult;   // outcome: "stale" | "table_missing"
}
if (!response.ok) await throwForStatus(response, "Failed to apply the schema");
return (await response.json()) as SchemaApplyResult;     // "applied" | "no_changes"
```

The whole apply surface then becomes one discriminated union on `outcome`, which is exactly what
the server already models. **Do not add a fourth error class** — `outcome` already discriminates,
and a `ConflictError` would need unwrapping back into the same union.

---

### Q3 — Testing a staged modal in jsdom

**The established pattern (three specs agree):**

`CustomMetricsEditorModal.spec.tsx:23-39` and `ColumnFormatEditorModal.spec.tsx:32-46` both do:

```tsx
vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, listCustomMetrics: vi.fn(), createCustomMetric: vi.fn(), /* … */ };
});
const mockedClient = clientModule as unknown as {
  listCustomMetrics: ReturnType<typeof vi.fn>; /* … */
};
```

`...actual` spread so `API_BASE`, the error classes and every un-stubbed caller stay real; only the
named functions become spies. `beforeEach` sets a default `mockResolvedValue` for each
(`CustomMetricsEditorModal.spec.tsx:80-89`), individual tests override. A `renderModal()` helper
(`:70-77`) returns `{ ...utils, onClose }`.

`DatasetsPage.spec.tsx:7-14` shows the complementary **stub-the-child** pattern for page-level
wiring tests — render a `<div data-testid="cfe-modal-stub" />` and capture props on
`globalThis.__lastCFEProps`. Use this for the DatasetsPage/TableDetail gate tests so they do not
pull the whole staged modal in; use the real component for the staged-flow tests.

**Async idiom — the correct form, and what the flake actually was.**

The root cause is fully documented in `.planning/v123-flake-investigation-notes.md` and
`MILESTONES.md:48`. It was **two** one-line defects, not contamination:

1. RTL's `asyncUtilTimeout` defaulted to 1000ms against vitest's 5000ms `testTimeout`.
   **Already fixed globally** — `packages/web/src/test/setup.ts:66` is
   `configure({ asyncUtilTimeout: 5000 })`. New specs inherit it; do not re-`configure` per file.
2. A synchronous `getBy*` asserting on content from a **later React commit** than the
   `await findBy*` immediately before it had waited for. `asyncUtilTimeout` cannot help a query
   that never awaits. **~105 such sites remain across 12 spec files** (`PROJECT.md:529`) — fix
   opportunistically, never introduce a new one.

The separate fake-timer leak is also already fixed globally: `setup.ts:52-63` runs
`vi.useRealTimers()` in a `afterEach`, with the reasoning inline.

**Rules for the new staged specs:**

- Every stage transition is a new React commit driven by a resolved promise. Assert each stage with
  `await screen.findByText(…)` / `await screen.findByRole(…)`, never a bare `getBy*`.
- Use `getBy*` **only** for something asserted to be present in the *same* commit you already
  awaited — e.g. `await findByRole("button",{name:/apply/i})` then
  `getByText(/breaking/i)` is only safe if both land together. When in doubt, `findBy*`.
- Use `await waitFor(() => expect(queryBy…).toBeNull())` for disappearance, not a bare
  `expect(queryBy…).toBeNull()` right after a click.
- `userEvent.click` is already `await`ed throughout the suite (`DashboardsPage.exportimport.spec.tsx:172`);
  keep that.
- **Do not use fake timers.** Nothing in this feature needs them, and the one thing that would
  (the toast's 5000ms auto-dismiss, `store/toast.ts:29-31`) is avoidable by rendering the apply
  result in the modal — see the recommendation under Q4/Discretion below.

---

### Q4 — The absence gate, tested

**The exact idiom already exists.** `packages/web/src/components/DashboardsPage.exportimport.spec.tsx`:

- `:136-143` — a spec-local helper, with a comment repeating `seedAuthStore.ts`'s own ordering
  warning:
  ```ts
  const seedPermissions = (permissions: string[]) =>
    useAuthStore.setState({
      status: "authenticated",
      user: { username: "testcustom", roles: ["custom"], permissions },
    });
  ```
  It is **spec-local, not exported** (grepped tree-wide: one definition, one file). The planner can
  either copy it or promote it into `src/test/seedAuthStore.ts` — promoting is cleaner and is a
  1-function diff.
- `:188-193` — both permissions → control present.
- `:195-200` — neither → `queryByRole(...)` is `toBeNull()`.
- `:202-208` — **AND-gate probe A**: one permission alone → gated control null, *and* the
  ungated sibling still present. That second assertion is what makes the probe discriminate: it
  proves the render reached the point where the button would have appeared.
- `:210-215` — **AND-gate probe B**: the other permission alone.

**Mirror all four cases for Phase 126**, with the sibling-still-present assertion pinned to a
control that is definitely ungated. In `TableDetail` that is `Format columns` or `Custom metrics`
(`DatasetsPage.tsx:226-231`); in the list row it is `View`/`Edit`.

**Seeding helpers** (`packages/web/src/test/seedAuthStore.ts`):

| Helper | Line | Carries `DATASETS_MANAGE`? | `DASHBOARDS_MANAGE_ACCESS`? |
|---|---|---|---|
| `seedDesignerStore` | `:20-40` | yes (`:35`) | yes (`:36`) — **the both-permissions case** |
| `seedAnalystStore` | `:47-56` | no | no — the neither case |
| `seedAdminStore` | `:63-72` | yes (all of `Object.values(PERMISSIONS)`) | yes |
| `seedUserAdminStore` | `:80-96` | no | no |

`hasPermission` is a plain set membership with **no admin short-circuit**
(`packages/web/src/store/auth.ts:87`), so `seedAdminStore` works only because it enumerates
everything. And because `vi.mock("zustand")` (`setup.ts:50`) resets stores between tests, an
**unseeded** test is already the "no permissions" case — useful, but prefer an explicit
`seedAnalystStore()` so the intent is readable.

**Gate code to write**, mirroring `DashboardsPage.tsx:126-132` including its explanatory comment:

```tsx
const hasPermission = useAuthStore((s) => s.hasPermission);
// Mirrors all four schema-sync routes' OWN gate exactly — index.ts:2500-2501, :2577-2578,
// :2664-2665, :2682-2683 each spread requirePermission(DATASETS_MANAGE) AND
// requirePermission(DASHBOARDS_MANAGE_ACCESS). An AND, so the control is hidden rather than
// offered to someone the server will refuse.
const canSchemaSync =
  hasPermission(PERMISSIONS.DATASETS_MANAGE) &&
  hasPermission(PERMISSIONS.DASHBOARDS_MANAGE_ACCESS);
```

`PERMISSIONS.DATASETS_MANAGE` = `"datasets:manage"` (`lib/permissions.ts:26`);
`PERMISSIONS.DASHBOARDS_MANAGE_ACCESS` = `"dashboards:manage_access"` (`:27`). Use the constants,
never raw strings — `seedAuthStore.ts:8-9` states the reason (a catalog rename then fails at
compile time).

**Existing specs that must keep passing:** `DatasetsPage.spec.tsx` never seeds the auth store at
all (verified — no `seedAuthStore` import). Its six tests exercise `Format columns`, which must
therefore stay **ungated**. Gating it would redden all six. `DatasetsPage.urlsync.spec.tsx`
(290 lines) likewise.

---

### Q5 — Where the four route callers belong in `client.ts`

**Append to the end of the file** (`packages/web/src/api/client.ts` is 1767 lines; the last section
is `// --- Custom Metrics (Phase 99 v1.19 METRIC-V119-01/02) ---` at `:1712`). The file is organised
as flat `// --- <Domain> ---` sections in roughly phase order; a new
`// --- Schema Sync (v1.25 Phase 126 — SSYNC-V125-01/-18/-19) ---` section at the bottom matches
the convention and minimises conflict surface.

**What the wrapper does, concretely:**

- **Base URL:** `API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000"` (`:7`). Every
  caller template-literals it in.
- **Auth headers:** none. Auth is a cookie — `apiFetch` forces `credentials: "include"` (`:59`).
  Do not add an `Authorization` header.
- **JSON parsing:** manual per caller. Two conventions exist and BOTH are in use:
  - `{ data: T }` envelope — `listTables` (`:506-513`), `fetchKineticaColumns` (`:553-561`),
    `listCustomMetrics` (`:1724-1729`). These do `const json = await response.json(); return json.data`.
  - **bare body** — `getTableById` (`:515-521`), `createCustomMetric` (`:1731-1744`),
    `materializeDynamicView` (`:1421-1435`). These do `return response.json() as Promise<T>`.

  **The four new routes all return a BARE body** — verified at `index.ts:2530`, `:2544`, `:2644`,
  `:2646`, `:2669`. No `{ data: … }` envelope. Use the bare-body form.
- **POST with a body:** `headers: { "Content-Type": "application/json" }` + `JSON.stringify(...)`
  — `createCustomMetric` (`:1735-1739`).
- **DELETE returning 204:** `deleteCustomMetric` (`:1762-1767`) is the closest precedent:
  `if (!response.ok) await throwForStatus(...)` and nothing else — no `.json()` on a 204 body.
  (Several older callers use the belt-and-braces `!response.ok && response.status !== 204` form at
  `:360`, `:389`, `:616`, `:623`, `:683`, `:809`; `deleteCustomMetric`'s simpler form is correct
  because `204` is already `ok`.)

**The four callers, signatures matching the surrounding style** (`tableId` first, like every other
per-table caller):

```ts
checkTableSchema(tableId: number): Promise<SchemaCheckResponse>            // GET  :2497
applyTableSchema(tableId: number, live: ColumnFingerprintMap): Promise<SchemaApplyResult>  // POST :2574 — 409 handled, see Q2
listTableSyncHistory(tableId: number): Promise<TableSyncHistory>          // GET  :2661
deleteTableSyncHistoryEntry(tableId: number, entryId: number): Promise<void>  // DELETE :2679
```

**Types must be re-declared in `client.ts`, not imported.** There are no cross-package imports.
This is already how every DTO in the file works (`TableDto` at `:496-504` mirrors the server's
`Table`; `ImportReportDto` at `:417-439`; `MaterializeDynamicViewResponse` at `:1293-1296`). No
parity guard is conventional for DTO *types* — TypeScript types are erased and a shape mismatch
surfaces at runtime, which is the same risk the other ~30 DTOs already carry. Do **not** invent a
new guard for them; do guard the one *string* (Q6).

---

### Q6 — Rendering the six verbatim strings

**Five of six need no mirroring at all. They arrive in `message`.**

Confirmed at `packages/server/src/lib/schemaApply.ts`:

| Constant | Source line | Reaches the web how |
|---|---|---|
| `SCHEMA_APPLY_STALE_MESSAGE` | `:60` | `message` of the `stale` arm (`:300`) → **409 body** |
| `SCHEMA_APPLY_BASELINE_MESSAGE` | `:217` | `message` of the `applied`/`baseline` arm (`:379-380`) → **200 body** |
| `SCHEMA_APPLY_NO_CHANGES_MESSAGE` | `:222` | `message` of the `no_changes` arm (`:326`) → **200 body** |
| `schemaApplyDiffMessage(c)` | `:229` | `message` of the `applied`/`diff` arm (`:379-380`) → **200 body** |
| `SCHEMA_APPLY_TABLE_MISSING_MESSAGE` | `:226` | **unreachable** — `applySchemaSync`'s `table_missing` arm (`:288`) is guarded by the route's own 404 at `index.ts:2582`. Per CONTEXT: **no UI branch.** |
| `SCHEMA_APPLY_TEXT_WIDTH_GAP` | `:146` | **NOTHING. Must be mirrored.** |

Separately, the check route's two 200-outcome messages also arrive over the wire and are rendered
verbatim the same way: `tableMissingResult(...).message` (`schemaDiff.ts:163-169`) and
`baselineRequiredResult(...).message` (`:171-182`). And the 409 `table_missing` apply body reuses
`tableMissingResult`'s text by object spread (`index.ts:2622`) so the check and the apply cannot
drift — so the modal can render `body.message` in both places without a branch.

**The one real mirror, and how to guard it.**

`SCHEMA_APPLY_TEXT_WIDTH_GAP` appears in exactly two files, both under `packages/server` (grepped
tree-wide, listed in § CORRECTIONS #2). It is referenced nowhere in `index.ts`. ROADMAP criterion 6
requires the UI to render it after an apply, unconditionally. **So a `packages/web` mirror is
unavoidable** — and Phase 125's verifier already had to close exactly this shape of unguarded
mirror (`WEB_EXCLUDED_DRILLDOWN_TYPES`, closed in `cc30404`).

**The guard: a web spec reading the server source and reassembling the constant. I built this and
ran it — it works.** Static-source assertions via `readFileSync` are an established pattern in this
suite (`theme-guard.spec.ts:27`, `WidgetFilterBadge.spec.tsx:3`/`:128`,
`DashboardsPage.panel.spec.tsx:520`, `LayersLegendPanel.spec.tsx:249`/`:487`/`:543`,
`WidgetRenderer.spec.tsx:4013+`), and paths resolve against `process.cwd()` = `packages/web`
(`theme-guard.spec.ts:15-18`).

The server constant is a three-segment `+`-concatenation, so a naive substring match fails. The
working extractor (executed 2026-09-28 from `packages/web`, output verified byte-for-byte against
`schemaApply.ts:146-149`, 257 chars, 3 segments):

```ts
// MIRROR-PARITY: the web copy of SCHEMA_APPLY_TEXT_WIDTH_GAP must equal the server's, which
// reaches no response body (index.ts references it nowhere) and cannot be imported across
// packages. Re-assembles the server's 3-segment string concatenation and compares.
const src = readFileSync(resolve(process.cwd(), "../server/src/lib/schemaApply.ts"), "utf-8");
const m = src.match(/export const SCHEMA_APPLY_TEXT_WIDTH_GAP\s*=\s*([\s\S]*?);\n/);
expect(m).not.toBeNull();
const segments = [...m![1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`));
expect(segments.length).toBe(3);                    // guards the extractor itself
expect(segments.join("")).toBe(SCHEMA_APPLY_TEXT_WIDTH_GAP);   // the web mirror
```

`expect(segments.length).toBe(3)` is not decoration: without it, a regex that matched zero segments
would join to `""` and the parity assertion would compare `""` to the mirror — a guard that cannot
fail. Include it.

Notes: test-only (`node:fs` never enters the Vite bundle); no `packages/server` change; reddens if
either side is edited alone — which is the whole point.

**Rendering rule for the modal:** every one of the five wire-borne strings is `response.message`.
Never re-derive, never template. The only client-side string literals in this feature should be
control labels ("Check for changes", "Apply", "Re-check", "Close", "Delete"), section headings, and
the sync-history cap notice whose wording CONTEXT locks — and that one must interpolate `cap` and
`droppedCount` from the response.

---

## Architecture

### Where the entry point goes — a decision the planner must make explicitly

`126-CONTEXT.md:54-56` says to mirror the modals `DatasetsPage.tsx` "already opens per table at
`:279` and `:285`", then says "One entry point per Datasets row".

**Those point at two different places, and the source resolves it:**
`:279` and `:285` are inside **`TableDetail`** (declared at `DatasetsPage.tsx:214`), which is the
screen you reach by clicking **View** on a list row. The buttons that open them are in
`TableDetail`'s `ChartCard actions` at `:226-231`. The **list row**'s own actions are `View` /
`Edit` / `Delete` at `:194-204`.

| Option | Pros | Cons |
|---|---|---|
| **A — `TableDetail` actions bar** (`:224-236`), a third `ghost-sm` next to `Format columns` / `Custom metrics` | Literally the cited precedent. Table already in scope. Same open/close wiring. Nothing else changes. | One extra click to reach it |
| B — a 4th button in the list row (`:194-204`) | One click from the list | Deviates from the cited precedent; four buttons per row |

**Recommendation: A.** Note that B is *not* blocked by CSS — `.ds-actions` is the `auto` track of
`grid-template-columns: 2fr 1fr 1fr 1.5fr auto` (`global.css:914-921`) and is a flex row with
`white-space: nowrap` on children (`:953-965`), so a fourth button fits without a grid change. The
argument for A is precedent-fidelity, not layout. **Have the planner state the choice and its
reason** — this is the one place where CONTEXT is genuinely ambiguous, and silently picking B would
be reinterpreting locked wording (the failure mode recorded in
`.planning/…/dont-reinterpret-explicit-requirement-wording.md`).

Either way the gate goes in the component that renders the button. `TableDetail` is an inner
component of `DatasetsPage.tsx` and can call `useAuthStore` directly — no prop drilling.

### Modal chrome — reuse, invent nothing

`ColumnFormatEditorModal.tsx:262-304` and `CustomMetricsEditorModal.tsx:273-314` are structurally
identical:

```tsx
<div className="modal-overlay" onClick={handleCloseRequest}>
  <div className="modal-content <feature>-modal" onClick={(e) => e.stopPropagation()}>
    <div className="modal-header">
      <div className="modal-title">Title — {table.name}</div>
      <button className="ghost-sm" onClick={handleCloseRequest}>Close</button>
    </div>
    <div className="<feature>-body"> … </div>
  </div>
</div>
```

Verified present in `global.css`: `.modal-overlay` `:825`, `.modal-content` `:834`,
`.modal-header` `:849`, `.modal-title` `:857`, `.modal-body` `:863`, `.modal-section-title` `:868`,
`.modal-section-title-spaced` `:877`. **`.modal-left` / `.modal-right` are NOT top-level classes** —
the two modals use them only as a co-class alongside their own (`col-format-editor-left`,
`custom-metrics-editor-left`); the actual sizing lives in per-feature classes
(`.layers-modal-left` `:2845`, `.dynamic-views-modal-left` `:3614`). Neither
`ColumnFormatEditorModal` nor `CustomMetricsEditorModal` has its own `.css` file — their feature
classes live in `global.css`. Follow that.

**Buttons** — per CLAUDE.md, verified against `global.css`: `.btn-primary` `:1067`, `.btn-sm`
`:1089`, `.ghost-sm` `:966`, `.ghost-danger` `:981`, `.ds-actions` `:953`. `CustomMetricsEditorModal.tsx:451`
uses `btn-primary btn-sm` next to a `ghost-sm ghost-danger` at `:442` — the canonical pair. Apply /
Re-check should be `btn-primary btn-sm`; per-row history Delete should be `ghost-sm ghost-danger`.

**Form/structure** — `.ds-field` `:1024`, `.ds-field-label` `:1030`, `.ds-select` `:1036`,
`.config-group` `:1303`, `.config-group-label` `:1309`, `.config-hint` `:1319` (muted small text —
good for the known-gaps and text-width caveat), `.data-table` `:568` (used by
`DatasetsPage.tsx:260-275` for the column list; reusable for the changeset table),
`.muted` `:1094`.

### Stage machine

Four stages, driven by one `useState` union in the modal. Nothing needs a store.

```
idle ──Check──▶ checking ──▶ report(SchemaCheckResponse)
                                │
                                ├─ outcome "table_missing"  → message verbatim, no Apply
                                ├─ outcome "baseline_required" → message verbatim + Apply
                                └─ outcome "diff" → impact sections + Apply
                                        │
                                        Apply
                                        ▼
                                   applying ──▶ result(SchemaApplyResult)
                                        ├─ "applied"     → message + TEXT_WIDTH_GAP caveat
                                        ├─ "no_changes"  → message
                                        ├─ "stale"(409)  → message verbatim + [Re-check] → checking
                                        └─ "table_missing"(409) → message verbatim
```

History is an independent read (`listTableSyncHistory`) that can be loaded on open or on a tab
switch — Claude's discretion. Re-fetch it after a successful apply so the new entry appears.

**On the discretionary "toast vs in-modal" choice — two concrete arguments for in-modal**, so the
planner decides on evidence rather than taste:

1. `store/toast.ts:29-31` auto-dismisses after **5000ms**. `SCHEMA_APPLY_TEXT_WIDTH_GAP` is a
   257-character, three-clause caveat; a 5-second window is not enough to read it, and criterion 6
   exists precisely because the operator could not see this limitation.
2. `store/toast.ts:20-23` suppresses a duplicate `kind::message` within a 5000ms window. Two
   applies in quick succession would silently show only one result.

Also: an in-modal result needs no timer handling in specs (§ Q3).

---

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Ordering the impact report (severity, then column) | A client-side sort | Render `report.sections` in array order | Server fixes the order at `schemaImpact.ts:414-422`; a client sort would be a second, divergable implementation of a locked decision |
| Naming a widget/layer/metric in a finding | Compose `kind + title + dashboard` on the client | Render `record.displayLabel` | Fully composed incl. noun, collisions and fallbacks at `impactNaming.ts:191-238`; re-deriving loses the advisory coupling |
| Explaining a change or a certainty tier | Client prose | `column.summary`, `reference.certainty`, `advisory.message`, `record.staleDrillDownType.message` | All carry "rendered VERBATIM" doc-comments; the certainty prose is the *mechanism* that keeps "confirmed" out of heuristic findings (`schemaImpact.ts:153-177`) |
| The history cap notice number | Hardcode `20` | `history.cap` | `db.ts:753-762` comment: "Echoed so the UI never hardcodes the number" |
| Classifying a column type for display | Re-run `normalizeType`/`classifyFingerprint` on the client | `column.storedType`/`liveType`/`storedClass`/`liveClass` | The server already renders both; a second classifier is exactly the divergence `125-02-SUMMARY.md` gap 3 warns about |
| Distinguishing a 409 | A status-carrying error class hierarchy | Return the server's own `outcome` union | The server already models it; see Q2 |
| Severity colours | New tokens, or `--success` | `.text-danger` / `.text-warning` / `.text-muted` + the `.login-error` `color-mix` fill pattern | `--success` is `var(--accent)` (`global.css:22`), not a green |

---

## Common Pitfalls

### P1 — Writing hex (or a raw `rgba()`) into `global.css` and believing theme-guard covers it
`global.css` is ALLOWLIST entry `theme-guard.spec.ts:57`; for allowlisted files the test asserts
hex IS present and returns (`:107-114`). **Zero protection.** Standing proof in-tree:
`.view-status-created { color: #22c55e }` (`:1818-1821`), `.layer-row-badge.error { color: #fecaca }`
(`:2997-2999`), `.error { color: #ef4444 }` (`:1098-1100`) — all unthemed, all green.
*Avoid:* every new colour goes through `var(--token)` or `color-mix(in srgb, var(--token) N%, transparent)`.
*Detect:* diff-anchored grep on added lines + the three-pass hand audit + the operator's light/dark check.

### P2 — Inventing a class name
No build check resolves a `className` to real CSS (CLAUDE.md § UI Conventions). An invented class
renders as unstyled browser chrome and passes `tsc`, `vitest` and `theme-guard`. This exact
mechanism produced seven heatmap defects and four v1.24 import defects.
*Avoid:* grep `global.css` before naming anything; every class the component uses is either in the
verified table above or added to `global.css` in the same commit.
*Detect:* for each new `className` literal in the component, assert it appears in `global.css`.
That IS mechanically checkable and would have caught the heatmap class.

### P3 — Losing the 409 body
`throwForStatus` discards everything but a `{ error }` key (`client.ts:97-118`), and the 409 stale
body has no `error` key. A caller that routes 409 through it loses the approved refusal text
entirely and shows a generic fallback.
*Warning sign:* the stale path renders "Failed to apply the schema" instead of the Kinetica text.

### P4 — Treating `diff` + `hasChanges: false` as an error, or defaulting a missing `impact`
`impact` is attached **only** to a `diff` outcome (`index.ts:2533-2536`), and its absence is the
signal for "not applicable". `baseline_required` and `table_missing` carry no `impact` key at all.
*Avoid:* branch on `outcome` first, then on `impact !== undefined`. Never `impact ?? emptyReport`.

### P5 — Rendering `knownGaps[0]`
`knownGaps` is a `string[]` (`schemaImpact.ts:141`) that happens to have one element today
(`:431`). A future gap silently disappears if indexed.

### P6 — A sync `getBy*` after an `await findBy*`
One of the two root causes of the v1.22/v1.23 suite non-determinism; ~105 sites remain
(`PROJECT.md:529`). A staged modal is the highest-risk shape for it because every stage is a
distinct commit.

### P7 — Gating `Format columns` or `Custom metrics`
`DatasetsPage.spec.tsx` never seeds the auth store; six tests in it and the whole of
`DatasetsPage.urlsync.spec.tsx` would redden. Only the new control is gated.

### P8 — A self-falsifying acceptance criterion
Running total across v1.25 is **6**, across Phases 115-118 roughly 28-32. The dominant cause is a
plan mandating a doc comment containing the very token its own grep counts. The structural fix
recorded in `ROADMAP.md:129`: **anchor prohibition greps to ADDED or CODE lines, never whole
files** — `git diff --unified=0 … | grep '^+[^+]'`, or `--numstat`. Note `grep -c '^-'` on a diff
matches the diff's own `--- a/path` header and is *unsatisfiable*; the correct form is
`grep -c '^-[^-]'` (`ROADMAP.md:156`).

### P9 — Assuming five of nine tables check cleanly
Five of the nine registered tables have been dropped from Kinetica (`ROADMAP.md:129`), so a live
check returns `table_missing`. That is correct behaviour and CONTEXT says so; do not let the
checkpoint record it as a defect.

---

## Verified acceptance-criterion anchors

**Every count below was RUN in this working tree on 2026-09-28, before any Phase 126 code exists.**
Per CLAUDE.md, a criterion that already passes proves nothing.

| Candidate anchor | Scope | Pre-work count | Usable? |
|---|---|---|---|
| `schema-check` | `packages/web/src` | **0** | yes |
| `schema-apply` | `packages/web/src` | **0** | yes |
| `sync-history` | `packages/web/src` | **0** | yes |
| `SchemaSyncModal` | `packages/web/src` | **0** | yes |
| `checkTableSchema` | `packages/web/src` | **0** | yes |
| `applyTableSchema` | `packages/web/src` | **0** | yes |
| `listTableSyncHistory` | `packages/web/src` | **0** | yes |
| `deleteTableSyncHistoryEntry` | `packages/web/src` | **0** | yes |
| `canSchemaSync` | `packages/web/src` | **0** | yes |
| `SCHEMA_APPLY_TEXT_WIDTH_GAP` | `packages/web/src` | **0** | yes |
| `severity-breaking` | `packages/web/src` | **0** | yes |
| `impact-severity` | `packages/web/src` | **0** | yes |
| `setInterval` (bare token) | `packages/web/src`, non-spec | **3** | **NO** — all three are `setIntervalState` in `charts/TimelineRenderer.tsx:260`, `:379`, `:421` |
| `setInterval[[:space:]]*\(` (`grep -rnE`) | `packages/web/src`, non-spec | **0** | **yes** — this is the correct form for criterion 2 |
| `window.setInterval` | `packages/web/src` | **0** | yes |

**Current gate baselines** (run 2026-09-28): `npx vitest run src/styles/theme-guard.spec.ts` →
**152 passed (152)**, 1 file. ROADMAP records the full web suite at 181 files / 4100 tests. Adding
one new `.tsx` under `src/components/` adds exactly **two** theme-guard tests (one per describe
block), so the expected post-work theme-guard figure is **154**, not 152 — a plan asserting "152/152
still green" would be asserting the wrong number.

**Requirements that are NOT automatically verifiable — route to `checkpoint:human-verify`:**

- The three severities read as visually distinct and legible in **both** themes.
- The impact report "names the right widgets, layers, metrics and formatting rules and misses none"
  against a real Kinetica table. The failure mode is a *confidently incomplete list*, which every
  gate reads as a pass (ROADMAP criterion 5; v1.24's equivalent found four defects, one whose
  signature was a comparison PASSING).
- Config panels offer the live columns after an apply (SSYNC-V125-13's second clause — proven in
  Phase 125 only by a hardcoded mirror, never an execution).
- History survives a server restart.

The honest automatable *structural precondition* for the polling criterion is: the feature files
contain no `setInterval(`/`window.setInterval`, and `checkTableSchema` appears only inside a click
handler — not inside any `useEffect`. Both are greppable; neither proves "a dashboard load issues
no schema-check request", which needs the human check.

---

## Does anything force a `packages/server` change?

**No.** Stated explicitly because rule 5 asks for it, and because the answer was not obvious before
checking:

- All four routes exist, are gated correctly, and return everything the UI needs.
- Five of the six approved strings arrive in `message`; the sixth is mirrorable with a
  test-only guard that touches no server file (§ Q6, prototyped and executed).
- The impact report is already ordered, named, and prose-complete for verbatim rendering.
- `cap` and `droppedCount` are already returned.
- The 403 body already carries `code: "PERMISSION_DENIED"`, so the existing reactive backstop
  (`client.ts:78-90`) works on the new routes with no wiring.

**One thing a planner might mistake for a server need, and should not:** ROADMAP criterion 6's
"the UI imports the constant". It cannot import it, and the *tempting* fix — adding
`SCHEMA_APPLY_TEXT_WIDTH_GAP` to the apply response body — WOULD be a server change. Per CONTEXT's
"Nothing in this phase invents server behaviour" and the zero-diff constraint, **mirror + guard
instead**. If the operator later prefers it on the wire, that is a deliberate scope decision, not
a research finding.

---

## Open Questions

1. **Entry point: `TableDetail` actions bar vs. the list row.**
   - What we know: `126-CONTEXT.md:54-56` cites `:279`/`:285`, which are inside `TableDetail`;
     the same paragraph says "per Datasets row". Both are buildable; `.ds-actions` accommodates a
     fourth button without a CSS change.
   - What's unclear: which the operator meant.
   - Recommendation: go with `TableDetail` (the literal precedent) and state the reasoning in the
     plan. Cheap to move later; a wrong silent pick is the recorded failure mode.

2. **Whether the sync-history read should be a modal tab or always-visible.**
   - Explicitly Claude's discretion (`126-CONTEXT.md:121-124`). No constraint found in source.
   - Recommendation: a tab/stage within the same modal — one entry point per table is locked, and
     the "durable worklist" framing (`126-CONTEXT.md:211-213`) implies it is read independently of
     a check run, so it must be reachable without first running a check.

3. **`SCHEMA_APPLY_TEXT_WIDTH_GAP` placement after a `no_changes` apply.**
   - Criterion 6 says "After an apply, the UI renders [it] as a caveat alongside the result",
     unconditionally. A `no_changes` outcome wrote nothing, so the caveat arguably does not apply —
     but the criterion's whole point is that it must not be conditional on detection.
   - **Uncertain.** I could not find a source that settles it. Recommendation: render it on the
     `applied` outcome only, and have the planner surface the choice at the plan-check — rendering
     a "what an apply did to your text columns" caveat after an apply that did nothing is the more
     confusing of the two readings, but this is a judgement, not a finding.

4. **Whether `seedPermissions` should be promoted into `src/test/seedAuthStore.ts`.**
   - It is currently spec-local (`DashboardsPage.exportimport.spec.tsx:139-143`, one definition
     tree-wide). Phase 126 needs it in at least one more file.
   - Recommendation: promote it, carrying the ordering comment verbatim. Low risk, removes a
     copy-paste. Planner's call.

---

## Sources

### Primary — source read in this working tree, 2026-09-28 (HIGH)

- `packages/server/src/index.ts` `:2490-2700` — all four route handlers, gates, status map
- `packages/server/src/lib/schemaApply.ts` `:53-63`, `:140-150`, `:200-232`, `:280-382` — the six strings, the result union, the message assignments
- `packages/server/src/lib/schemaImpact.ts` `:57-146`, `:148-191`, `:400-432` — `ImpactReport`/`ImpactColumn`/`ImpactRecord`/`ImpactReference`, `certaintyProse`, `COLUMNS_JSON_TYPE_GAP`, section assembly
- `packages/server/src/lib/schemaDiff.ts` `:150-199` — `SchemaCheckResult`, `tableMissingResult`, `baselineRequiredResult`
- `packages/server/src/lib/impactNaming.ts` `:26-53`, `:55-74`, `:185-239` — `ImpactAdvisory`, the noun maps, `displayLabel` composition
- `packages/server/src/lib/columnTypeClass.ts` `:89`, `:154-186` — `ImpactSeverity`, severity rules
- `packages/server/src/db.ts` `:698`, `:753-762`, `:829`, `:859` — `SYNC_HISTORY_CAP`, `TableSyncHistory`, `cap` echo
- `packages/server/src/rbac.ts` `:12`, `:65` — the 403 body shape
- `packages/server/tests/lib.columnTypeClass.spec.ts` `:17-43` — the `MIRROR-PARITY` precedent
- `packages/web/src/api/client.ts` `:7`, `:29-54`, `:58-118`, `:496-561`, `:1293-1296`, `:1421-1435`, `:1594-1668`, `:1704-1767`
- `packages/web/src/hooks/useApiQuery.ts` (whole file, 66 lines)
- `packages/web/src/components/DatasetsPage.tsx` (whole file, 511 lines)
- `packages/web/src/components/DashboardsPage.tsx` `:124-136`
- `packages/web/src/components/ColumnFormatEditorModal.tsx` `:262-304`, `:361-433`
- `packages/web/src/components/CustomMetricsEditorModal.tsx` `:273-314`, `:366-455`
- `packages/web/src/components/DashboardsPage.exportimport.spec.tsx` `:136-143`, `:188-215`
- `packages/web/src/components/DatasetsPage.spec.tsx` (whole file, 150 lines)
- `packages/web/src/components/CustomMetricsEditorModal.spec.tsx` `:1-90`
- `packages/web/src/components/ColumnFormatEditorModal.spec.tsx` `:1-80`
- `packages/web/src/styles/global.css` `:1-45`, `:110-161`, `:568-586`, `:825-880`, `:908-1110`, `:1303-1330`, `:1660-1690`, `:1796-1830`, `:2155-2180`, `:2279-2292`, `:2985-3010`
- `packages/web/src/styles/theme-guard.spec.ts` (whole file, 224 lines)
- `packages/web/src/test/setup.ts` (whole file, 66 lines)
- `packages/web/src/test/seedAuthStore.ts` (whole file, 96 lines)
- `packages/web/src/store/auth.ts` `:27`, `:87`
- `packages/web/src/store/toast.ts` (whole file, 34 lines)
- `packages/web/src/lib/permissions.ts` (whole file, 31 lines)
- `packages/web/src/lib/columnTypes.ts` `:29-38`, `:78`
- `packages/web/vitest.config.ts` (whole file)

### Commands executed (HIGH)

- `npx vitest run src/styles/theme-guard.spec.ts` → 152/152 passed, 2.08s
- `node -e '<mirror-parity extractor>'` from `packages/web` → reassembled `SCHEMA_APPLY_TEXT_WIDTH_GAP`, 257 chars, 3 segments, byte-identical to `schemaApply.ts:146-149`
- ~15 scoped `grep -rn` baselines over `packages/web/src` (table in § "Verified acceptance-criterion anchors")

### Secondary — planning docs, cross-checked against source (MEDIUM→HIGH where confirmed)

- `.planning/phases/125-apply-sync-history/125-04-SUMMARY.md` — route contracts and the six strings; **every claim I used from it was re-verified against source and all held**
- `.planning/phases/125-apply-sync-history/125-02-SUMMARY.md` `:236-270` — the three carried gaps (text→string over-inclusion; un-probed BOOLEAN marker; precedence divergence). Gaps 2 and 3 are things the **operator checkpoint can close** and worth adding to its script.
- `.planning/phases/125-apply-sync-history/125-03-SUMMARY.md` `:190-215` — the `CORRECTION` block
- `.planning/ROADMAP.md` `:129`, `:156`, `:158-174`, `:232`
- `.planning/PROJECT.md` `:63`, `:529`, `:650`; `.planning/MILESTONES.md:48`;
  `.planning/v123-flake-investigation-notes.md`
- `./CLAUDE.md` — UI conventions and the acceptance-criteria discipline

### Disputed (LOW → resolved against source)

- `.planning/phases/126-datasets-ui-access-gating/126-CONTEXT.md:63` — the "20-finding cap /
  truncation notice". **Not supported by source; see § CORRECTIONS #1.**
- `.planning/ROADMAP.md` Phase 126 criterion 6 — "the UI imports the constant". **Not achievable
  literally; see § CORRECTIONS #2.**

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|---|---|---|
| Server contracts (routes, bodies, status codes, gates) | **HIGH** | Read from `index.ts`, `schemaApply.ts`, `schemaDiff.ts`, `schemaImpact.ts`, `db.ts` directly; cross-checked against `125-04-SUMMARY.md`, no divergence |
| `client.ts` error model / 409 behaviour (Q2) | **HIGH** | `throwForStatus` read line by line; the 409→bare-`Error` path is unambiguous at `:111-118` |
| CSS / severity options (Q1) | **HIGH** for what exists and what the guard does (both grepped and the guard executed); **MEDIUM** for "`--danger`/`--warning`/`--muted` will read as distinct in both themes" — that is a design judgement no test can settle |
| Test patterns (Q3, Q4) | **HIGH** | Three modal specs plus the AND-gate probe read in full; the two flake root causes traced to their in-tree fixes at `setup.ts:52-66` |
| The `SCHEMA_APPLY_TEXT_WIDTH_GAP` mirror guard (Q6) | **HIGH** | Prototyped and **executed**, output verified against source |
| The "no 20-finding cap" correction | **HIGH** | Negative claim verified four ways: return-shape read, case-insensitive grep for `truncat\|cap\|limit\|more` across four lib files, `.slice(` audit, and tracing where the real 20 lives (`db.ts:698`) |
| Entry-point placement | **MEDIUM** | Source resolves where the precedent *is*; it does not resolve what the operator *meant*. Flagged as Open Question 1. |
| Criterion-6 placement after `no_changes` | **LOW** | No source settles it. Flagged as Open Question 3 and explicitly not presented as a finding. |

**Research date:** 2026-09-28
**Valid until:** stable — this is an internal codebase with no external dependency churn. Re-verify
only if `packages/server/src/index.ts`, `schemaApply.ts`, `schemaImpact.ts` or
`packages/web/src/styles/theme-guard.spec.ts` change.

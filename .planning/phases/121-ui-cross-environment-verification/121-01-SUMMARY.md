---
phase: 121-ui-cross-environment-verification
plan: 01
subsystem: api
tags: [fetch, blob, url-createobjecturl, dashboard-export, dashboard-import, dto]

# Dependency graph
requires:
  - phase: 119-export
    provides: "GET /api/dashboards/:id/export (Content-Type application/json, attachment header, no exposedHeaders)"
  - phase: 120-import
    provides: "POST /api/dashboards/import (plain JSON body, ImportReport shape, 400/413/422 error contract)"
provides:
  - "downloadDashboardExport(dashboard) — apiFetch -> blob -> URL.createObjectURL -> synthetic <a download> click -> revokeObjectURL"
  - "exportFileNameForClient(dashboard) — byte-for-byte mirror of server exportFileName's slug rule"
  - "importDashboardFile(file) — client-side JSON pre-check + JSON-body POST, returns ImportReportDto"
  - "ImportReportDto + TableResolutionDto/MetricResolutionDto/MetricConflictDto/StrippedReferenceDto types"
affects: ["121-02", "121-03", "121-04"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "blob: URL + synthetic <a download> click for browser downloads (no precedent existed in this codebase before this plan) — origin-agnostic, works identically cross-origin (dev) and same-origin (nginx)"
    - "Client-side filename derivation instead of reading Content-Disposition, because CORS exposedHeaders is not configured and the header is invisible to cross-origin fetch"

key-files:
  created:
    - packages/web/src/api/client.dashboard-export-import.spec.ts
  modified:
    - packages/web/src/api/client.ts

key-decisions:
  - "Filename is derived client-side from DashboardDto.id/.name, never from a response header — the server's Content-Disposition header is invisible to cross-origin fetch (no CORS exposedHeaders), and fixing that is explicitly out of scope for this phase (filed as a FINDING below)."
  - "importDashboardFile does a throwaway JSON.parse client-side purely to fail fast on a non-JSON file before any network call; the server (validateImportFile) remains the sole source of truth for structural validation."
  - "P5 mutation probe's original fixture ('{\"schemaVersion\":1}') could not discriminate a wasteful re-stringify from sending the file verbatim, because JS string `toBe` is value equality and the round-trip happened to be byte-identical for that fixture. Strengthened the fixture to include whitespace a round trip normalizes away, per CLAUDE.md's non-discriminating-criterion rule — did not weaken the probe."

requirements-completed: []  # Deliberately empty — DXIM-V124-01/-03 are ALREADY marked Complete in
  # REQUIREMENTS.md (Phases 119/120). Per this phase's own CONTEXT.md and CRITICAL WARNING #10, this
  # plan does NOT touch requirement status either way; Plan 121-04 owns the operator round-trip
  # outcome and is the only plan authorized to REOPEN them on failure.

# Metrics
duration: ~35min
completed: 2026-09-17
---

# Phase 121 Plan 01: Dashboard Export/Import Client API Summary

**Added `downloadDashboardExport`/`exportFileNameForClient`/`importDashboardFile` + the `ImportReportDto` family to `client.ts` — the entire client-side contract surface Plans 02/03 build the dashboard UI on top of, with zero server diff.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 completed
- **Files modified:** 2 (1 modified, 1 created)

## Accomplishments

- `downloadDashboardExport` triggers a browser download via `apiFetch` → `.blob()` → `URL.createObjectURL` → synthetic `<a download>` click → `revokeObjectURL` — one code path that works identically in dev (cross-origin API) and behind nginx (same-origin), with no dependency on reading a response header.
- `exportFileNameForClient` is a byte-for-byte mirror of the server's `exportFileName` slug algorithm, proven against three cases (normal name, empty name, heavy punctuation) plus the load-bearing `EXPDL-nocd` test that asserts the correct filename even when `headers.get` returns `null` for every name.
- `importDashboardFile` reads the chosen `File`'s text, fails fast client-side with a clear message on non-JSON content (before any network call), then POSTs the raw text verbatim as `application/json` to `/api/dashboards/import` and returns the server's `data` object typed as `ImportReportDto`.
- `ImportReportDto` + `TableResolutionDto` / `MetricResolutionDto` / `MetricConflictDto` / `StrippedReferenceDto` mirror the server's `ImportReport` faithfully — `MetricConflictDto.message` is carried verbatim, ready for Plan 03's report UI to render without summarizing.
- 15 new unit tests (8 `EXPDL-`, 7 `IMPCLI-`), all green; 6/6 mutation probes fired and reverted, confirming every test that claims to guard a specific line of behavior actually does.

## Task Commits

Each task was committed atomically:

1. **Task 1: ImportReportDto types + exportFileNameForClient + downloadDashboardExport** - `6a0064b` (feat)
2. **Task 2: importDashboardFile — client-side JSON pre-check + JSON-body POST** - `0f7c790` (feat)
3. **Task 3: Mutation probes + full web gates** - `f69fc70` (test — strengthened one fixture; `client.ts` itself carries zero net diff from this task)

## Files Created/Modified

- `packages/web/src/api/client.ts` - Added `TableResolutionDto`, `MetricResolutionDto`, `MetricConflictDto`, `StrippedReferenceDto`, `ImportReportDto`, `exportFileNameForClient`, `downloadDashboardExport`, `importDashboardFile`, placed immediately after `listDashboards` (end of the dashboard CRUD section).
- `packages/web/src/api/client.dashboard-export-import.spec.ts` - New spec file: 15 tests (8 `EXPDL-`, 7 `IMPCLI-`) covering the slug rule, the download mechanism (including the CORS-invisibility case and 404/403 error paths), and the import POST (including the non-JSON pre-check and 400/413/403/422 error paths).

## Decisions Made

- Filename derivation stays entirely client-side; no `exposedHeaders` CORS change was made or considered in scope (constraint #2 in the plan). This is recorded as a FINDING for a future phase below, not fixed here.
- `importDashboardFile` sends `fileText` verbatim (identity) rather than `JSON.stringify(JSON.parse(fileText))`, avoiding a redundant parse/stringify round trip on a 1 MB-capped payload — proven by the (strengthened) `IMPCLI-post` test and mutation probe P5.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking / non-discriminating criterion] Rephrased two `client.ts` comments to avoid literally containing "Content-Disposition"**
- **Found during:** Task 1, verifying acceptance criterion A6 (`grep -rci "content-disposition" src/api/client.ts` must read 0)
- **Issue:** The plan's own action text instructed writing a comment naming the `Content-Disposition` header to explain WHY the filename is derived client-side. `grep -rci` (case-insensitive) counts that explanatory prose exactly the same as a real header read, so following the plan's suggested wording literally would have made A6 read 2, not 0 — a self-tripped criterion, the exact pattern CLAUDE.md's "Writing verifiable acceptance criteria" section warns about.
- **Fix:** Kept the full explanation (why the header can't be read cross-origin, the CORS `exposedHeaders` gap, the `index.ts:140-145` reference) but described the header descriptively ("its attachment response header") instead of by its literal name. No functional code changed — this is a documentation-wording adjustment, not a weakening of the guard's real purpose (which is confirmed by the discriminating `EXPDL-nocd` test regardless of A6's wording).
- **Files modified:** `packages/web/src/api/client.ts` (comment text only)
- **Verification:** `grep -rci "content-disposition" src/api/client.ts` → 0; `EXPDL-nocd` test passes.
- **Committed in:** `6a0064b` (Task 1 commit)

**2. [Rule 1 - Non-discriminating test / mutation probe P5] Strengthened the `IMPCLI-post` fixture**
- **Found during:** Task 3, running mutation probe P5 (`body: fileText` → `body: JSON.stringify(JSON.parse(fileText))`)
- **Issue:** With the original minified fixture (`'{"schemaVersion":1}'`), the mutation did NOT redden `IMPCLI-post`. `JSON.stringify(JSON.parse(x))` happened to be byte-identical to `x` for that single-key object, and JS `toBe` on primitive strings is value equality, not reference identity — there is no way for a primitive string comparison to distinguish "the same content, sent verbatim" from "the same content, re-serialized," when the content genuinely doesn't change under round-trip. The plan itself flagged this exact risk ("P5 deserves a note... if the executor judges the identity assertion too brittle... say so... do NOT silently drop the probe").
- **Fix:** Changed the fixture to `'{ "schemaVersion": 1, "note": "kept as-is" }'` (with whitespace a `JSON.parse`+`JSON.stringify` round trip normalizes away). Re-ran all 6 probes against the strengthened test: P5 now reddens `IMPCLI-post` as intended; the other 5 probes were unaffected and still redden their originally-targeted tests.
- **Files modified:** `packages/web/src/api/client.dashboard-export-import.spec.ts`
- **Verification:** All 15 tests pass on correct `client.ts`; P5 mutation reddens `IMPCLI-post` and only that test; `client.ts` confirmed byte-identical to HEAD after every probe's revert (`git diff --exit-code`).
- **Committed in:** `f69fc70` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 non-discriminating acceptance criterion reworded without weakening its real guard, 1 mutation probe strengthened without weakening the probe).
**Impact on plan:** Both are documentation/test-fixture adjustments; zero change to `downloadDashboardExport`/`importDashboardFile`/`exportFileNameForClient`'s actual behavior versus what the plan specified. No scope creep.

## Mutation Probe Table (6/6, per CLAUDE.md's verifiable-acceptance-criteria rule)

| # | Mutation | Must redden | Result |
|---|---|---|---|
| P1 | Drop `.replace(/^-+\|-+$/g, "")` in `exportFileNameForClient` | `EXPDL-slug-punct:` | ✅ Reddened `EXPDL-slug-punct` only. Reverted, byte-identical. |
| P2 | Drop `\|\| "export"` fallback in `exportFileNameForClient` | `EXPDL-slug-empty:` | ✅ Reddened `EXPDL-slug-empty` only. Reverted, byte-identical. |
| P3 | `a.download = response.headers.get("content-disposition") ?? ""` instead of the helper | `EXPDL-anchor:` AND `EXPDL-nocd:` | ✅ Reddened both. Reverted, byte-identical. |
| P4 | Delete `if (!response.ok) await throwForStatus(...)` in `downloadDashboardExport` | `EXPDL-404:` and `EXPDL-403:` | ✅ Reddened both. Reverted, byte-identical. |
| P5 | `body: fileText` → `body: JSON.stringify(JSON.parse(fileText))` | `IMPCLI-post:` | ⚠️ Did NOT redden with the original fixture (byte-identical round trip for that specific input; `toBe` on primitives is value equality, so nothing could discriminate). **Strengthened the fixture** (whitespace a round trip normalizes away) — re-ran: reddened `IMPCLI-post` only. Reverted, byte-identical. |
| P6 | Delete the `try { JSON.parse(fileText) } catch { throw ... }` pre-check | `IMPCLI-nonjson:` | ✅ Reddened `IMPCLI-nonjson` only. Reverted, byte-identical. |

**5/6 fired clean on the first attempt; 1/6 (P5) required strengthening its test — documented above, consistent with the ~1-in-13-probes rate CLAUDE.md's own record shows across Phases 115-120.**

## Recorded FINDING (not fixed in this phase — filed for a future phase)

**`Content-Disposition` is invisible to cross-origin client JS.** `cors()` at `packages/server/src/index.ts:140-145` configures `{ origin: corsOrigins.length ? corsOrigins : true, credentials: true }` with no `exposedHeaders` option. By the Fetch spec, a cross-origin response only exposes a small default allow-list of headers to client JS unless the server explicitly lists more via `Access-Control-Expose-Headers` — `Content-Disposition` is not on that default list. In dev (SPA `:5173` → API `:4000`, genuinely cross-origin, no Vite proxy), `response.headers.get("content-disposition")` returns `null`. This plan works around it entirely by deriving the filename client-side (`exportFileNameForClient`) rather than reading the header in either environment — no CORS change was made, per the plan's explicit constraint. A future phase could add `exposedHeaders: ["Content-Disposition"]` to make the server-computed filename authoritative cross-origin as well; not required for this phase or the milestone's success criteria.

## Confirmed Gate Numbers

- `cd packages/web && npx tsc --noEmit` → clean, zero output.
- `cd packages/web && npx vitest run` → **177 files, 4040 tests, 0 failed** (baseline was 176 files / 4025 tests; +1 file / +15 tests exactly matches the new spec). One transient failure in `ColumnFormatEditorModal.spec.tsx` appeared on the FIRST full-suite run of this session; confirmed a pre-existing parallel-scheduling flake (untouched by this plan) — it passed in isolation and on an immediate second full-suite run (177/177, 4040/4040, 0 failed).
- `cd packages/web && npx vitest run src/styles/theme-guard.spec.ts` → **150 tests, unchanged** — this plan added no `.tsx` under `src/components/`.
- `git diff --numstat HEAD -- packages/server` → empty.
- `git status --porcelain packages/web/src/styles/global.css` → empty.
- `grep -rci "content-disposition" packages/web/src/api/client.ts` → 0.

## Issues Encountered

None beyond the two deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `downloadDashboardExport`, `importDashboardFile`, `exportFileNameForClient`, and the full `ImportReportDto` family are exported from `client.ts` and ready for Plan 02/03 to wire into `DashboardsPage.tsx` (export button, import button + file picker, import report modal) with no further API work.
- No blockers. `packages/server` carries zero diff — this plan is confirmed web-only as required.
- Per critical warning #10 and CLAUDE.md's own instruction: no DXIM requirement has been marked complete by this plan; `requirements-completed` above records this plan's contribution toward DXIM-V124-01/-03, but Plan 04 (the operator UAT + outcome recording) owns actual requirement closure, including reopening any of DXIM-V124-01/-03/-10 if the cross-environment round trip fails.

## Self-Check: PASSED

- FOUND: `packages/web/src/api/client.ts`
- FOUND: `packages/web/src/api/client.dashboard-export-import.spec.ts`
- FOUND: `.planning/phases/121-ui-cross-environment-verification/121-01-SUMMARY.md`
- FOUND commit: `6a0064b` (Task 1)
- FOUND commit: `0f7c790` (Task 2)
- FOUND commit: `f69fc70` (Task 3)

---
*Phase: 121-ui-cross-environment-verification*
*Completed: 2026-09-17*

# Phase 69: Verification + Live UAT - Context

**Gathered:** 2026-06-17
**Status:** Ready for planning
**Type:** Milestone-closing verification (mirrors v1.11 P61 / v1.12 P64).

<domain>
## Phase Boundary

Prove v1.13 (Calendar Heatmap) is DONE: automated gates green + a BLOCKING live operator
walk-through + a compiled verification record. Closes VERIFY-V113-01 and the pending
anchor clause of CALUX-V113-03.

Scope expanded beyond the original Phase 69 sketch to cover everything added in the inserted
phases 68.1 (wrapped/strip layout + on-widget controls) and 68.2 (per-group gap-fill,
anchor-agnostic weeks, week×hour punchcard), plus the fixes made directly during live review.

Requirements: VERIFY-V113-01 (primary); CALUX-V113-03 anchor clause (close-out).

</domain>

<decisions>
## Implementation Decisions

### Automated gates (Success Criterion 1)
- Frontend vitest 100% from `packages/web` (currently 2373 passing, 104 files — includes all
  calendar specs + the 68.2 regression suites).
- web `tsc --noEmit` clean; server `tsc --noEmit` clean.
- Server vitest SET-BASED gate ⊆ TD-V16-TEST-ISOLATION: the set of failing server files must be
  IDENTICAL to the Phase 64 baseline (no NEW server regressions). v1.13 was frontend-only — no
  server source changed — so this should hold trivially; verify and record the baseline match.
- Re-assert the locked invariants via the existing CI gates: theme-guard (no raw hex in
  CalendarRenderer/CalendarConfigPanel) + static grep (CalendarRenderer imports no
  `materializeFilter`/`dropFilterView`/`fromSwap`).

### Live UAT — FULL MATRIX (operator decision: be thorough; live review found many issues)
**Plan split (clarified):** the UAT-authoring plan AUTHORS `69-UAT.md` autonomously
(`autonomous: true` — it only writes a doc); the BLOCKING operator attestation lives in the
verification-record plan as a `checkpoint:human-verify` task (`autonomous: false`). This mirrors
the P61/P64 pattern — do NOT put the human-blocking gate on the authoring plan.

Author `69-UAT.md` covering, with operator attestation (collected at the record-plan checkpoint):
- **All 8 domain×subdomain combos render correctly:** year×month, year×week, year×day,
  month×day, month×week, week×day, week×hour, day×hour — per-group gap-fill (in-range grey,
  out-of-range blank), correct anchor alignment (week combos column-clean), week×hour punchcard
  (7 day-rows × 24 hour-cols), year×day horizontal scroll reveals data.
- **Both bindings:** table-bound AND dv-bound.
- **Both layout modes:** Wrap (default, mini-calendar blocks) AND Continuous strip (h-scroll).
- **On-widget controls:** toggle "Show domain/subdomain controls" ON → 2 viewer dropdowns appear,
  switch combos live (re-fetch, dependent gating, 8 valid combos), selection is view-local
  (resets on reload, does not persist to saved config); default OFF → no controls, static grid.
- **Drill + chip + WMS (the original SC2-4):**
  - Table-bound: cell click filters the dashboard (bar/pie/records on same table) to the slice;
    removable chip with HUMAN-READABLE date range (e.g. "Mar 2 – Mar 8, 2026", not raw ISO);
    chip clears back to unfiltered.
  - dv-bound: dv-isolated drill — same-dv widgets update; source-table + other-dv unaffected.
  - WMS map on the same table/dv updates tiles after a cell click.
  - "Respond to dashboard filters" toggle ON demonstrates CAL-V113-05 filter-aware re-fetch
    (another widget's filter narrows the calendar); default OFF keeps the full grid.
- Empty/grey cells are non-interactive (no drill).

### Week-anchor disposition (CALUX-V113-03 close-out)
- The week anchor is now **inferred from the data** (`inferWeekAnchorDow`) — the calendar is
  anchor-agnostic, so correctness no longer depends on the live spike. CALUX-V113-03 is
  functionally COMPLETE.
- Phase 69 re-attempts the live Kinetica `DATE_TRUNC('week')` spike BEST-EFFORT only; if still
  auth-blocked (REAUTH_REQUIRED, `.env` security-prohibited — as in Phase 65-02 / 68.2-02),
  record NOT-RUN and note the empirical inference makes the anchor moot. Then mark CALUX-V113-03
  COMPLETE (do not block milestone close on the spike).

### Chat-fixes — verify-in-place, record (no backfilled plans)
These v1.13 fixes were made directly during live review (committed to master, unit-tested):
- `344c274` fix(68.1): inline calendar config toggles via config-toggle layout
- `4f4ef7c` fix(68.2): format-agnostic bucket-key lookup in gapFillCalendar (all-grey fix)
- `90c8f3b` fix(68.2): anchor-agnostic week handling (infer Kinetica week anchor from data)
- `0a9d9f8` fix(68.2): week×hour 7-day × 24-hour punchcard
- `a0b23d2` docs: restore ROADMAP.md truncated by 891546f
The verification record lists them as covered (automated gates + a UAT checklist line each).
Do NOT backfill PLAN/SUMMARY docs — they're shipped and tested.

### Deferred → v2 backlog (do NOT block v1.13)
Record these as v2/backlog (alongside CALX-V2-*), explicitly out of scope for v1.13 close:
- **year×day auto-scroll-to-data** — a year-of-days strip is ~52 weeks wide; data can sit
  off-screen (confirmed working, just requires horizontal scroll). Nice-to-have: auto-scroll to
  the first populated column.
- **"Ignore own filter but respond to others"** — needs a second materialized view excluding the
  calendar's own filter (new infra). Today's toggle is whole-hog (full data vs filter-aware).
- **Live week-anchor confirmation** — the empirical inference covers correctness; recording the
  actual Kinetica anchor remains a nice-to-have if creds become available.

### Verification record + close-out
- Compile `69-VERIFICATION.md` (status: passed | human_needed | gaps_found).
- Tick VERIFY-V113-01 and CALUX-V113-03; mark ROADMAP Phase 69 complete.
- Milestone close (`/gsd:complete-milestone`) is a SEPARATE step after Phase 69 verification.

### Claude's Discretion
- Exact UAT checklist phrasing / ordering.
- Whether gates run via one script or step-by-step.
- VERIFICATION.md status if the operator can't complete the live walk in-session (use
  `human_needed` and await attestation, mirroring P61/P64).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope + criteria
- `.planning/ROADMAP.md` §"Phase 69" — the 4 original Success Criteria + plan sketch (69-01 gates,
  69-02 UAT, 69-03 record).
- `.planning/REQUIREMENTS.md` — VERIFY-V113-01 (the UAT requirement) + CALUX-V113-03 (anchor
  close-out) + the milestone test-gate invariants (line 14).
- `.planning/STATE.md` §"Roadmap Evolution" (68.1 + 68.2 entries — what the UAT must now cover)
  and §"v1.13 Locked Decisions".

### Verification precedents (mirror these)
- v1.12 Phase 64 (`.planning/phases/64-*`) — the gates + live-UAT + record structure; the server
  set-based gate baseline (failing files to match).
- v1.11 Phase 61 — live-walk + human_needed attestation pattern.

### What's being verified (the shipped calendar)
- `packages/web/src/components/charts/CalendarRenderer.tsx`, `CalendarConfigPanel.tsx`
- `packages/web/src/lib/calendarBin.ts`, `buildCalendarSql.ts`, `calendarGapFill.ts`,
  `calendarLayout.ts`, `calendarBuckets.ts`, `calendarColorScale.ts`, `estimateCalendarCells.ts`
- `packages/web/src/components/charts/WidgetRenderer.tsx` (calendar branch) + MapChartRenderer
  (WMS propagation).

### Spike (best-effort)
- `.planning/phases/68.2-*/68.2-02-SPIKE.md` — prior NOT-RUN record + the probe to re-attempt.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Existing automated gates (vitest, tsc, theme-guard, static-grep) — Phase 69 runs them, doesn't
  build new ones.
- Phase 64 / 61 UAT + VERIFICATION doc structure to mirror.

### Established Patterns
- Live-UAT phases produce a UAT checklist, await operator attestation, then compile a
  VERIFICATION.md and tick the requirement. `human_needed` status while awaiting the live walk.
- Server set-based gate: compare failing server test files to the Phase 64 baseline; identical =
  pass (TD-V16-TEST-ISOLATION).

### Integration Points / ⚠ notes
- v1.13 is FRONTEND-ONLY — server source untouched, so the server gate should match baseline
  with zero new regressions; still verify explicitly.
- VERIFICATION.md MUST be written to the REPO-ROOT `.planning/phases/69-verification-live-uat/`
  (NOT packages/web/.planning — the verifier has strayed there before).
- The live walk is BLOCKING and operator-driven; the orchestrator can run gates but the human
  must attest the UAT.

</code_context>

<specifics>
## Specific Ideas

- The live review iteration (checkbox layout → week×day phantom columns → all-grey format →
  anchor-agnostic weeks → week×hour punchcard) IS Phase 69's UAT doing its job early. The formal
  walk should confirm all of it is now correct in one pass.
- Full-matrix UAT specifically because the bug density across combos was high.

</specifics>

<deferred>
## Deferred Ideas

(These are the milestone's deferred items, recorded for v2/backlog — NOT Phase 69 work.)
- year×day auto-scroll-to-data.
- "Ignore own filter but respond to others" (needs a second materialized view).
- Live Kinetica week-anchor confirmation (inference covers correctness).

</deferred>

---

*Phase: 69-verification-live-uat*
*Context gathered: 2026-06-17*

---
phase: 23-info-card
plan: 04
subsystem: docs
tags: [docs, planning, requirements, key-decisions, info-card, pure-consumer, in-widget-dropdown]

# Dependency graph
requires:
  - phase: 23-info-card
    provides: "Plan 23-01 shared <InfoSelectionView />, Plan 23-02 useLastInfoClickContextStore sibling slice, Plan 23-03 info-card renderer wired to relaxed shared-fetch path"
provides:
  - "STATE.md Key v1.4 Architecture Decisions block: 'Info Card / popup co-fetch via shared <InfoSelectionView />' supersedes pre-Phase-23 pure-consumer lock"
  - "PROJECT.md Key Decisions table: new v1.4 row documenting Phase 23 relaxation with rationale + ✓ Shipped v1.4 Phase 23 outcome"
  - "REQUIREMENTS.md CARD-V14-02 reworded for 'in-widget layer dropdown' clarity with explicit cross-reference to relaxed lock + Pitfall 2 short-circuit"
  - "REQUIREMENTS.md footer dated 2026-05-09 with Phase 23 completion note"
  - "Cross-doc consistency: zero orphan 'Info Card pure consumer / never call POST' wording survives in PROJECT.md / STATE.md / REQUIREMENTS.md"
affects: [phase-24-verification, future-v1.4-phases, future-milestones]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decision-relaxation pattern: when a previously-locked architectural decision needs to evolve mid-milestone, add a NEW Key Decisions row documenting the relaxation (with cross-reference) rather than editing the original; STATE.md decision wording is updated in place but PROJECT.md preserves history via additive rows"
    - "Cross-doc consistency check via grep: all three planning docs (PROJECT.md / STATE.md / REQUIREMENTS.md) must agree on relaxation language; orphan stale wording is a verification trap surfaced by the verification block at end of plan"

key-files:
  created: []
  modified:
    - ".planning/STATE.md (line 79: Info Card decision wording relaxed)"
    - ".planning/PROJECT.md (line 204 inserted: new v1.4 Key Decisions row; line 207: footer updated)"
    - ".planning/REQUIREMENTS.md (line 57: CARD-V14-02 reworded; line 146: footer updated)"

key-decisions:
  - "Decision-relaxation pattern: STATE.md updates the Key v1.4 Architecture Decisions bullet wording in place (single source of truth for current state); PROJECT.md preserves decision history by ADDING a new Key Decisions row referencing the Phase 23 relaxation rather than editing the prior pure-consumer position"
  - "Pure-consumer lock narrowing — relaxation explicitly does NOT extend to bar/line/pie/scatter/table/records/bignumber/map widget types: only popup + card via shared <InfoSelectionView /> can fetch info-queries; XWIDGET-V2-01 stays deferred"
  - "MapChartRenderer click handler remains SOLE multi-layer fan-out entry AND SOLE writer of useLastInfoClickContextStore; relaxation only opens single-layer dropdown-switch + Load-more on-demand fetches via shared view"

patterns-established:
  - "Phase docs-relax-* plan pattern: when runtime behavior diverges from a previously-locked decision, ship a docs-only plan in the same phase to align the three planning artifacts (PROJECT.md / STATE.md / REQUIREMENTS.md) before the phase closes — prevents future-phase verification traps from stale lock language"

requirements-completed: [CARD-V14-02]

# Metrics
duration: 2 min
completed: 2026-05-09
---

# Phase 23 Plan 04: Docs — Relax Pure-Consumer Lock Summary

**Three planning docs (PROJECT.md / STATE.md / REQUIREMENTS.md) aligned with the Phase 23 relaxation: Info Card and popup both fetch via shared `<InfoSelectionView />`; pre-Phase-23 "never call POST /api/info/query" lock language eliminated across all three files.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-09T21:55:45Z
- **Completed:** 2026-05-09T21:57:41Z
- **Tasks:** 3
- **Files modified:** 3 (planning docs only)

## Accomplishments

- STATE.md "Info Card is a pure consumer" decision wording (line 79) replaced with the relaxed wording that explicitly references the new sibling `useLastInfoClickContextStore` slice and the canonical narrowing (only popup + card via shared view can fetch info-queries)
- PROJECT.md Key Decisions table gains a new v1.4 row (after the HTML-template-policy row) documenting the relaxation with rationale and `✓ Shipped v1.4 Phase 23` outcome; PROJECT.md footer updated to 2026-05-09 with full Phase 23 completion summary
- REQUIREMENTS.md CARD-V14-02 reworded from "a dropdown in the widget config" to "an in-widget layer dropdown (sticky header band of the card body — NOT a widget config panel dropdown)" with explicit cross-reference to the relaxed lock + `useLastInfoClickContextStore` replay + Pitfall 2 short-circuit (when `context === null`, switch updates focus only and does NOT fetch); REQUIREMENTS.md footer updated to 2026-05-09
- Cross-doc grep confirms zero orphan "Info Card pure consumer" / "never call POST" wording survives across the three files
- Phase 23 documentation closed; Phase 24 verification will exercise the runtime behavior end-to-end without tripping on stale wording

## Task Commits

Each task was committed atomically:

1. **Task 1: Update STATE.md "Info Card is a pure consumer" decision wording (line 79)** — `1e6c936` (docs)
2. **Task 2: Add new v1.4 Key Decisions row to PROJECT.md after HTML-template-policy row + update footer** — `a219995` (docs)
3. **Task 3: Reword REQUIREMENTS.md CARD-V14-02 to "in-widget layer dropdown" + update footer** — `6644d31` (docs)

**Plan metadata:** _pending_ (final docs commit captures SUMMARY.md, STATE.md, ROADMAP.md, REQUIREMENTS.md frontmatter changes)

## Files Created/Modified

- `.planning/STATE.md` — Line 79 (Key v1.4 Architecture Decisions): "Info Card is a pure consumer" replaced with "Info Card / popup co-fetch via shared `<InfoSelectionView />` (relaxed Phase 23 2026-05-09)" plus full explanatory text referencing `useLastInfoClickContextStore`, click-handler-as-sole-fan-out narrowing, and XWIDGET-V2-01 deferral
- `.planning/PROJECT.md` — Line 204 inserted (Key Decisions table): new v1.4 row "Info Card / popup co-fetch via shared `<InfoSelectionView />` (Phase 23 relaxation)" with full rationale column + `✓ Shipped v1.4 Phase 23` outcome column. Line 207 (footer): updated from 2026-05-08 / Phase 21 to 2026-05-09 / Phase 23 completion summary
- `.planning/REQUIREMENTS.md` — Line 57 (CARD-V14-02): wording fully replaced; cross-references PROJECT.md Key Decisions row and locks Pitfall 2 short-circuit. Line 146 (footer): updated from 2026-05-07 v1.4-roadmap-creation to 2026-05-09 Phase-23-complete

## Decisions Made

- **Decision-relaxation pattern (locked here):** STATE.md edits the existing decision bullet in place because it's the canonical source of truth for *current* architecture; PROJECT.md preserves decision history additively by APPENDING a new row referencing the Phase 23 relaxation rather than editing or removing the pre-existing pure-consumer wording. Future phases needing to evolve a locked decision should follow the same pattern.
- **Narrowing scope of relaxation (locked here):** the relaxation is scoped strictly to popup + card surfaces sharing `<InfoSelectionView />`. Bar / line / pie / scatter / table / records / bignumber / map widget types still cannot fetch info-queries (XWIDGET-V2-01 deferred). The MapChartRenderer click handler remains the SOLE multi-layer fan-out entry AND the SOLE writer of `useLastInfoClickContextStore`. This narrowing is repeated verbatim across all three docs to prevent any single doc from drifting into "all widgets can subscribe-to-fetch."

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking — informational, no fix needed] Task 3 Steps 2 & 3 were already-applied on disk**
- **Found during:** Task 3 (REQUIREMENTS.md edits)
- **Issue:** Plan instructed to (Step 2) flip `[ ]` to `[x]` for CARD-V14-01..04 in the requirement list, and (Step 3) change `Pending` to `Complete` in the Traceability table for the same four rows. On disk inspection at task start, all four checkboxes were already `[x]` and all four Traceability rows already said `Complete`. Likely an artifact of a prior `gsd-tools requirements mark-complete` invocation during Plans 23-01..03 metadata commits. STATE.md plan progress counter (16/17 plans complete before this plan) is consistent with that hypothesis.
- **Fix:** No code change — verified state matches plan's intended end-state via grep (all 4 checkboxes ticked, all 4 Traceability rows Complete). Steps 1 (CARD-V14-02 wording rework) and 4 (footer update) executed as planned. Documented in commit message that Steps 2/3 were no-ops on disk.
- **Files modified:** `.planning/REQUIREMENTS.md` (only line 57 + line 146 — Steps 1 + 4)
- **Verification:** All Task 3 acceptance criteria pass via grep checks (4× "CARD-V14-* Complete" in Traceability, 4× ticked checkboxes, 0× unticked checkboxes, 0× stale "a dropdown in the widget config" wording, 1× new "in-widget layer dropdown" wording, 1× useLastInfoClickContextStore cross-reference, 1× footer dated 2026-05-09)
- **Committed in:** 6644d31 (Task 3 commit)

---

**Total deviations:** 1 informational (Rule 3 — blocking would have applied if state mismatched plan; in this case state already matched, so no fix was needed)
**Impact on plan:** Zero scope creep; plan's intended end-state achieved; on-disk-vs-plan consistency confirmed and documented for traceability.

## Issues Encountered

None — purely-additive doc edits with surgical scope. All three target diffs landed exactly as written; cross-doc consistency check (grep for orphan stale wording) returned zero matches as expected.

## User Setup Required

None — documentation-only plan; no external service configuration involved.

## Next Phase Readiness

Phase 23 is functionally and documentation-complete:

- **Runtime:** Plans 23-01..03 shipped the shared `<InfoSelectionView />`, `useLastInfoClickContextStore`, and info-card renderer (16/17 plans complete entering this plan; 17/17 after this plan).
- **Docs:** All three planning artifacts (PROJECT.md / STATE.md / REQUIREMENTS.md) are now consistent with the runtime: card and popup co-fetch via shared view; other widget types cannot.
- **CARD-V14-01..04:** All four requirements checked and marked Complete in both the requirement list and the Traceability table.
- **Cross-doc lock:** Zero orphan stale "Info Card pure consumer / never call POST" wording survives — Phase 24 verification will not trip on contradictory lock language.

**Ready for:** Phase 24 (verification — VERIFY-V14-01) to exercise the end-to-end click → popup → dropdown-switch → Load-more → card-mirror flow under the relaxed model.

**No blockers or concerns.**

---
*Phase: 23-info-card*
*Completed: 2026-05-09*

## Self-Check: PASSED

- Files modified exist: `.planning/STATE.md`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/phases/23-info-card/23-04-docs-relax-pure-consumer-SUMMARY.md`
- Task commits exist: `1e6c936` (Task 1 STATE), `a219995` (Task 2 PROJECT), `6644d31` (Task 3 REQUIREMENTS)

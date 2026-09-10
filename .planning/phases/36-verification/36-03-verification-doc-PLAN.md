---
phase: 36-verification
plan: 03
type: execute
wave: 2
depends_on:
  - 36-01
  - 36-02
files_modified:
  - .planning/phases/36-verification/36-VERIFICATION.md
autonomous: true
requirements:
  - VERIFY-V16-01

must_haves:
  truths:
    - "36-VERIFICATION.md exists with PASS/FAIL/DEFERRED rows for ROADMAP Phase 36 success criteria 1, 2, and 3 — each row carries file:line evidence (criterion 1) or command exit codes (criterion 2) or self-reference (criterion 3)."
    - "36-VERIFICATION.md contains a per-phase PASS/FAIL/DEFERRED table covering Phases 32, 33, 34, 35, and 36 — rows transcribed verbatim from 36-01-AUDIT-NOTES.md."
    - "36-VERIFICATION.md YAML front-matter sets `status: passed` if gate_status from 36-02 is green AND every PASS/FAIL/DEFERRED row is non-FAIL; sets `status: failed` if gate_status is red OR any criterion row is FAIL."
    - "36-VERIFICATION.md includes a 'Scope Caveat' section reproducing the v1.5 Phase 31 pragmatic-close language so the source-only / live-UAT-skipped pattern is explicit."
    - "36-VERIFICATION.md includes a 'Carry-over to v1.7' section listing any DEFERRED items + any tech-debt still open (TD-V14-WKB-SPIKE from v1.4 + map-only-dashboard spatial trigger gap from v1.5 + anything new surfaced in this cycle)."
    - "36-VERIFICATION.md cites the test-gate exit codes from 36-02-TEST-RESULTS.md verbatim in success criterion 2's evidence cell."
    - "36-VERIFICATION.md does NOT modify any source under kinetica_bi/src/ or kinetica_bi/server/src/."
    - "The phase marker for Phase 36 is updated in ROADMAP.md (`- [x] 36: verification` under v1.6) AND the corresponding requirement VERIFY-V16-01 in REQUIREMENTS.md flips from `[ ]` to `[x]` if status is passed."
  artifacts:
    - path: ".planning/phases/36-verification/36-VERIFICATION.md"
      provides: "Final v1.6 verification document with PASS/FAIL/DEFERRED rows for Phase 36 success criteria 1-3 + per-phase rollup for Phases 32-35 + scope caveat + carry-over"
      contains: "PASS / FAIL / DEFERRED"
    - path: ".planning/REQUIREMENTS.md"
      provides: "VERIFY-V16-01 marker flipped to [x] (only if status is passed)"
      contains: "[x] **VERIFY-V16-01**"
  key_links:
    - from: "36-01-AUDIT-NOTES.md per-criterion matrix"
      to: "36-VERIFICATION.md PASS/FAIL/DEFERRED rows"
      via: "transcription with verbatim criterion text"
      pattern: "status: (PASS|FAIL|DEFERRED)"
    - from: "36-02-TEST-RESULTS.md exit codes + counter lines"
      to: "36-VERIFICATION.md success criterion 2 evidence"
      via: "command-by-command rollup"
      pattern: "exit_code: 0"
    - from: "36-VERIFICATION.md status flag"
      to: ".planning/ROADMAP.md Phase 36 marker + .planning/REQUIREMENTS.md VERIFY-V16-01 marker"
      via: "checkbox flip from [ ] to [x] iff status passed"
      pattern: "[x] (Phase 36|VERIFY-V16-01)"
---

<objective>
Compile the final `.planning/phases/36-verification/36-VERIFICATION.md` from the Plan 36-01 audit matrix and the Plan 36-02 test-gate results. This is the terminal artifact for the v1.6 milestone — it determines whether v1.6 ships passed, tech-debt, or red-gated.

Purpose: VERIFY-V16-01 explicitly requires a `36-VERIFICATION.md` documenting PASS / FAIL / DEFERRED per success criterion across all five v1.6 phases. The doc adopts the source-only pragmatic-close pattern established by v1.4 Phase 24 (UAT-heavy) and v1.5 Phase 31 (source-only attestation): inspectable items PASS, items requiring live UAT may be marked DEFERRED with a precedent reference, automated test gates are reported with exit codes.

Output:
  - `.planning/phases/36-verification/36-VERIFICATION.md` — final verification document with YAML front-matter (`status: passed` / `failed` / `pending`), scope caveat, three PASS/FAIL/DEFERRED rows for Phase 36 success criteria, per-phase rollup tables for Phases 32-35, carry-over to v1.7, sign-off line.
  - `.planning/REQUIREMENTS.md` VERIFY-V16-01 marker flipped from `[ ]` to `[x]` if status is `passed`.
  - `.planning/ROADMAP.md` Phase 36 plans list updated to reflect completion.

No production code is modified.
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/24-verification/24-VERIFICATION.md
@.planning/phases/31-verification/31-VERIFICATION.md
@.planning/phases/36-verification/36-01-AUDIT-NOTES.md
@.planning/phases/36-verification/36-02-TEST-RESULTS.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Compile 36-VERIFICATION.md from audit notes + test results</name>
  <files>.planning/phases/36-verification/36-VERIFICATION.md</files>
  <read_first>
    - .planning/phases/36-verification/36-01-AUDIT-NOTES.md (Plan 36-01 output — source-audit matrix; transcribe verbatim)
    - .planning/phases/36-verification/36-02-TEST-RESULTS.md (Plan 36-02 output — test-gate exit codes; transcribe verbatim; CHECK `gate_status:` header)
    - .planning/phases/31-verification/31-VERIFICATION.md (v1.5 source-only attestation — adopt scope-caveat language verbatim where appropriate, swap v1.5/v1.6 references)
    - .planning/phases/24-verification/24-VERIFICATION.md (v1.4 pragmatic-close template — section structure reference)
    - .planning/ROADMAP.md (Phase 36 success criteria 1, 2, 3 verbatim wording + Phases 32-35 success criteria + carry-over context)
    - .planning/REQUIREMENTS.md (VERIFY-V16-01 row to flip on `passed`)
  </read_first>
  <action>
    Read 36-01-AUDIT-NOTES.md and 36-02-TEST-RESULTS.md first. Extract:
      - From 36-01: per-phase criterion rows (status + evidence + rationale) and end-to-end scenarios.
      - From 36-02: the `gate_status:` value (green or red) + each command's exit_code + counter lines.

    Pre-check the gate: if 36-02 `gate_status: red`, the final `status:` in 36-VERIFICATION.md front-matter MUST be `failed` and success criterion 2's row MUST be FAIL. Do NOT manufacture a passed status against a red gate.

    Create `.planning/phases/36-verification/36-VERIFICATION.md` with this structure:

    ```markdown
    ---
    phase: 36-verification
    verified: <today YYYY-MM-DD>
    verifier: gsd-executor + operator decision (live UAT skipped per v1.5 Phase 31 precedent)
    status: <passed|failed>
    score: "<N> ROADMAP Phase 36 success criteria + <M> per-phase criteria (32+33+34+35) — see Per-Phase Rollup"
    gate_summary:
      frontend_vitest_exit: <0 or N>
      frontend_tsc_exit: <0 or N>
      server_vitest_password_exit: <0 or N>
      server_vitest_oidc_exit: <0 or N>
      server_tsc_exit: <0 or N>
    inherits_precedent_from: ["v1.4 Phase 24 pragmatic-close", "v1.5 Phase 31 source-only"]
    ---

    # Phase 36 Verification — v1.6 Dynamic Views

    ## Scope Caveat

    **This verification is source-only with automated test-gate proof.** Live operator UAT is explicitly skipped per the v1.5 Phase 31 precedent — the operator has been exercising the v1.6 build interactively throughout the development cycle (post-VERIFY bug fixes have already landed under Phases 32-35 SUMMARY trails) and each surfaced gap has been closed inline.

    Source-only attestation covers: code-review of must-haves against the implemented codebase + automated test-suite execution. Production-only behaviours (live Kinetica SQL against the v1.6 dynamic-view CREATE/DROP path under load, multi-tab session interaction, WMS tile invalidation timing on cascade re-materialize) are NOT live-exercised in this cycle. Any production-only bug surfaces in the gap-closure cycle (Phase 36.x) or in v1.7.

    ## Phase 36 — Success Criteria (verbatim from ROADMAP)

    | # | Criterion | Status | Evidence |
    |---|-----------|--------|----------|
    | 1 | Operator (or source-only audit) confirms: create → preview → save → applies filter → dynamic view materializes → widget renders filtered data; raise filter threshold → dynamic view drops → widget shows over-threshold empty state; clear filters → dynamic view drops; lifecycle reset on logout / dashboard switch drops all materialized dynamic views. | <PASS/FAIL/DEFERRED> | Source-only audit (Plan 36-01) confirms all five operator scenarios are implemented end-to-end. See "End-to-End Scenarios" rollup below transcribed from 36-01-AUDIT-NOTES.md. |
    | 2 | Frontend vitest green; tsc clean; new server supertest coverage for Phase 32 endpoints green in both auth modes. | <PASS/FAIL> | Plan 36-02 test gate: frontend vitest exit=<N> (<NNN passed>); frontend tsc exit=<N> (<clean/N diagnostics>); server vitest AUTH_MODE=password exit=<N> (<NNN passed>); server vitest AUTH_MODE=oidc exit=<N> (<NNN passed>); server tsc exit=<N> (<clean/N diagnostics>). Phase 32 specs (routes.dynamic-view, routes.dynamic-view-crud, routes.dynamic-view-drop, db.dynamicViewsMigration, lib.dynamicViewSql, lib.dynamicViewName, lib.materializedView) each green. Full breakdown: `36-02-TEST-RESULTS.md`. |
    | 3 | Verification document `36-VERIFICATION.md` produced with PASS / FAIL / DEFERRED per success criterion across all five v1.6 phases. | PASS | This document. See "Per-Phase Rollup" below. |

    ## Per-Phase Rollup

    Transcribed verbatim from `.planning/phases/36-verification/36-01-AUDIT-NOTES.md`. Criterion text taken from ROADMAP.md Phases 32-35 "Success Criteria" blocks.

    ### Phase 32 — dynamic-view-foundation

    | Criterion | Text | Status | Evidence |
    |-----------|------|--------|----------|
    | 32.1 | <verbatim from 36-01 criterion_id 32.1 text> | <PASS/FAIL/DEFERRED> | <verbatim evidence> |
    | 32.2 | <verbatim> | <status> | <evidence> |
    | 32.3 | <verbatim> | <status> | <evidence> |
    | 32.4 | <verbatim> | <status> | <evidence> |
    | 32.5 | <verbatim> | <status> | <evidence> |
    | 32.6 | <verbatim> | <status> | <evidence> |

    ### Phase 33 — dynamic-view-store

    | Criterion | Text | Status | Evidence |
    |-----------|------|--------|----------|
    | 33.1 | <verbatim> | <status> | <evidence> |
    | 33.2 | <verbatim> | <status> | <evidence> |
    | 33.3 | <verbatim> | <status> | <evidence> |
    | 33.4 | <verbatim> | <status> | <evidence> |

    ### Phase 34 — dynamic-view-ui

    | Criterion | Text | Status | Evidence |
    |-----------|------|--------|----------|
    | 34.1 | <verbatim> | <status> | <evidence> |
    | 34.2 | <verbatim> | <status> | <evidence> |
    | 34.3 | <verbatim> | <status> | <evidence> |
    | 34.4 | <verbatim> | <status> | <evidence> |

    ### Phase 35 — widget-binding-and-pipeline

    | Criterion | Text | Status | Evidence |
    |-----------|------|--------|----------|
    | 35.1 | <verbatim> | <status> | <evidence> |
    | 35.2 | <verbatim> | <status> | <evidence> |
    | 35.3 | <verbatim> | <status> | <evidence> |
    | 35.4 | <verbatim> | <status> | <evidence> |

    ## End-to-End Scenarios — ROADMAP Phase 36 Success Criterion 1 Detail

    | # | Scenario | Status | Evidence |
    |---|----------|--------|----------|
    | e2e.1 | create → preview → save → applies filter → dynamic view materializes → widget renders filtered data | <status> | <evidence from 36-01 scenario e2e.1> |
    | e2e.2 | raise filter threshold → dynamic view drops → widget shows over-threshold empty state | <status> | <evidence> |
    | e2e.3 | clear filters → dynamic view drops | <status> | <evidence> |
    | e2e.4 | lifecycle reset on logout drops all materialized dynamic views | <status> | <evidence> |
    | e2e.5 | lifecycle reset on dashboard switch drops all materialized dynamic views | <status> | <evidence> |

    ## v1.6 Phase Summary

    | Phase | Title | Status |
    |---|---|---|
    | 32 | dynamic-view-foundation | passed |
    | 33 | dynamic-view-store | passed |
    | 34 | dynamic-view-ui | passed |
    | 35 | widget-binding-and-pipeline | passed |
    | 36 | verification | <status from front-matter — passed or failed> |

    (Per-phase status reflects the per-phase rollup tables above: passed = all criteria PASS or PASS-with-DEFERRED-precedent; failed = any FAIL.)

    ## Gap Closures Landed During the Cycle (Out of Band)

    Operator interactive testing during the v1.6 cycle surfaced gaps that were closed in-cycle rather than via a formal Phase 36.x gap-closure plan. List each commit with one-liner — pull from `git log master --oneline --since=2026-05-14 -- kinetica_bi/` filtering for v1.6-relevant changes (commits referencing phases 32-35 or `dynamic-view*` paths).

    | Commit | Description |
    |---|---|
    | <hash> | <one-line description> |

    (If none beyond the planned phases — say "None beyond the planned Phase 32-35 plans.")

    ## Carry-over to v1.7

    - **TD-V14-WKB-SPIKE** — still open. Re-run path documented in `.planning/phases/18-spatial-spike-and-endpoint/18-SPIKE-NOTES.md`. Affects info-query AND spatial-filter materialize for native WKB-binary columns; resolved 2026-05-11 for WKT-content-in-Kinetica-GEOMETRY case (TD-V14-WKB closed at that scope; TRUE WKB-binary remains carried).
    - **Map-only dashboard spatial-trigger gap** (carry-over from v1.5) — dashboard with no chart + no records table on a spatial-target table still wouldn't fire materialize. Map-side trigger not implemented this cycle either; rare configuration.
    - **Live UAT for v1.6** — operator-skipped this cycle per the v1.5 Phase 31 precedent; remains open in case a production-only bug surfaces post-ship.
    - <Append any DEFERRED rows from the per-phase rollup or end-to-end scenarios with their rationale.>

    ---

    *Verified <today YYYY-MM-DD> — source-only attestation + automated test-gate proof. v1.6 ready for `/gsd:audit-milestone` and `/gsd:complete-milestone`.*
    ```

    Transcription rules:
      - Replace every `<...>` placeholder with the actual extracted value.
      - For criterion rows: pull `status` + `evidence` verbatim from 36-01-AUDIT-NOTES.md. Truncate evidence to ~200 chars per cell for table readability; keep file:line citations intact.
      - For success criterion 2: pull each command's `exit_code` and `tests_line` from 36-02-TEST-RESULTS.md and inline them.
      - For status flag: see pre-check rule above. green gate + no FAIL rows → `passed`; red gate OR any FAIL → `failed`.
      - For "Gap Closures Landed" table: run `git log master --oneline --since="2026-05-14" -- kinetica_bi/` and filter for commits that aren't in any 3[2-5]-*-PLAN.md task list. If unclear, list all commits since the v1.5 close commit and note "see git log for full list".

    Verbatim transcription helper:

    ```bash
    grep -A 4 "^- criterion_id: 32\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md
    grep -A 4 "^- criterion_id: 33\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md
    grep -A 4 "^- criterion_id: 34\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md
    grep -A 4 "^- criterion_id: 35\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md
    grep -A 4 "^- scenario_id: e2e\." .planning/phases/36-verification/36-01-AUDIT-NOTES.md
    grep -A 3 "^- command:" .planning/phases/36-verification/36-02-TEST-RESULTS.md
    ```

    Use those greps to build the table cells.

    Executor is forbidden from modifying any file under `kinetica_bi/src/` or `kinetica_bi/server/src/` in this plan.
  </action>
  <verify>
    <automated>test -f .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^## Scope Caveat$" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^## Phase 36 — Success Criteria" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^### Phase 32 — dynamic-view-foundation$" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^### Phase 33 — dynamic-view-store$" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^### Phase 34 — dynamic-view-ui$" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^### Phase 35 — widget-binding-and-pipeline$" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^## End-to-End Scenarios" .planning/phases/36-verification/36-VERIFICATION.md && grep -q "^## Carry-over to v1.7$" .planning/phases/36-verification/36-VERIFICATION.md && grep -E "^status: (passed|failed)$" .planning/phases/36-verification/36-VERIFICATION.md</automated>
  </verify>
  <acceptance_criteria>
    - File `.planning/phases/36-verification/36-VERIFICATION.md` exists.
    - Front-matter contains `phase:`, `verified:`, `verifier:`, `status:` (set to `passed` or `failed`), `score:`, `gate_summary:` (with five `*_exit:` fields), `inherits_precedent_from:` keys.
    - File contains `## Scope Caveat` section that references "v1.5 Phase 31" precedent.
    - File contains `## Phase 36 — Success Criteria (verbatim from ROADMAP)` table with EXACTLY 3 data rows (criteria 1, 2, 3); each row's Status column is one of PASS, FAIL, DEFERRED.
    - File contains `### Phase 32 — dynamic-view-foundation` section with EXACTLY 6 criterion table rows (32.1 through 32.6). Grep: `grep -cE "^\| 32\.[1-6] \|" .planning/phases/36-verification/36-VERIFICATION.md` returns 6.
    - File contains `### Phase 33 — dynamic-view-store` section with EXACTLY 4 criterion table rows (33.1 through 33.4). Grep: `grep -cE "^\| 33\.[1-4] \|" .planning/phases/36-verification/36-VERIFICATION.md` returns 4.
    - File contains `### Phase 34 — dynamic-view-ui` section with EXACTLY 4 criterion table rows (34.1 through 34.4). Grep: `grep -cE "^\| 34\.[1-4] \|" .planning/phases/36-verification/36-VERIFICATION.md` returns 4.
    - File contains `### Phase 35 — widget-binding-and-pipeline` section with EXACTLY 4 criterion table rows (35.1 through 35.4). Grep: `grep -cE "^\| 35\.[1-4] \|" .planning/phases/36-verification/36-VERIFICATION.md` returns 4.
    - File contains `## End-to-End Scenarios` section with EXACTLY 5 scenario rows (e2e.1 through e2e.5). Grep: `grep -cE "^\| e2e\.[1-5] \|" .planning/phases/36-verification/36-VERIFICATION.md` returns 5.
    - File contains `## v1.6 Phase Summary` table with EXACTLY 5 phase rows (32, 33, 34, 35, 36).
    - File contains `## Carry-over to v1.7` section that references TD-V14-WKB-SPIKE.
    - File contains a sign-off line at the bottom matching the v1.5 Phase 31 footer pattern (`*Verified <date> — source-only attestation + automated test-gate proof. v1.6 ready for /gsd:audit-milestone and /gsd:complete-milestone.*`).
    - The status flag is consistent with 36-02 gate_status: if `36-02-TEST-RESULTS.md` has `gate_status: red`, the 36-VERIFICATION.md front-matter has `status: failed` AND the success-criterion-2 row's Status column is FAIL (cross-check: `grep "gate_status: red" .planning/phases/36-verification/36-02-TEST-RESULTS.md && grep "status: failed" .planning/phases/36-verification/36-VERIFICATION.md`).
    - No production source file under `kinetica_bi/src/` or `kinetica_bi/server/src/` was modified — confirm with `git status kinetica_bi/`.
  </acceptance_criteria>
  <done>36-VERIFICATION.md exists with scope caveat + 3 Phase 36 criterion rows + 18 per-phase criterion rows (6+4+4+4) + 5 end-to-end scenarios + 5-phase summary + carry-over + sign-off; status flag consistent with 36-02 gate_status.</done>
</task>

<task type="auto">
  <name>Task 2: Flip VERIFY-V16-01 marker + update ROADMAP Phase 36 plans list + state files</name>
  <files>.planning/REQUIREMENTS.md, .planning/ROADMAP.md, .planning/STATE.md</files>
  <read_first>
    - .planning/phases/36-verification/36-VERIFICATION.md (Task 1 output — check status flag in front-matter)
    - .planning/REQUIREMENTS.md (find the VERIFY-V16-01 row to flip)
    - .planning/ROADMAP.md (find the Phase 36 plans block to update)
    - .planning/STATE.md (Current Position section to update)
  </read_first>
  <action>
    First read `.planning/phases/36-verification/36-VERIFICATION.md` and extract the front-matter `status:` value. The marker flips ONLY if status is `passed`.

    Step 1 — REQUIREMENTS.md:

    Find the line:
    ```
    - [ ] **VERIFY-V16-01** — `36-VERIFICATION.md` documents PASS / FAIL / DEFERRED per success criterion across Phases 32-35. Frontend vitest + tsc green; new server supertest specs green in both auth modes. Source-only attestation allowed if live UAT skipped (precedent from v1.4 / v1.5).
    ```

    If 36-VERIFICATION.md status is `passed`:
      - Edit the line to flip `[ ]` → `[x]`.

    If status is `failed`:
      - Do NOT flip. Leave as `[ ]`. Append a comment line below it noting the failure mode (which command failed or which criterion FAILed), e.g.:
        ```
          <!-- 2026-05-18: 36-VERIFICATION.md status: failed — <command or criterion> exit=<N>. Re-run after gap-closure. -->
        ```

    Step 2 — ROADMAP.md:

    Find the Phase 36 block:
    ```markdown
    ### Phase 36: verification
    **Goal**: ...
    **Depends on**: Phase 35
    **Requirements**: VERIFY-V16-01
    **Success Criteria** (what must be TRUE):
      1. ...
      2. ...
      3. ...
    ```

    Insert a `Plans:` block between **Requirements:** and **Success Criteria** (mirrors Phase 32-35 format):

    ```markdown
    **Plans:** 3/3 plans complete
    Plans:
    - [x] 36-01-source-audit-PLAN.md — Wave 1. Per-phase PASS/FAIL/DEFERRED audit matrix for Phases 32-35 + end-to-end scenario mapping. Produces 36-01-AUDIT-NOTES.md.
    - [x] 36-02-test-suite-run-PLAN.md — Wave 1 (parallel). Frontend vitest + tsc + server supertest in both AUTH_MODE blocks + server tsc. Produces 36-02-TEST-RESULTS.md with gate_status flag.
    - [x] 36-03-verification-doc-PLAN.md — Wave 2 (depends on 01 + 02). Compiles final 36-VERIFICATION.md with status: <passed/failed>.
    ```

    Also update the Progress table at the bottom of ROADMAP.md to add a Phase 36 row (mirrors Phase 35 row format). If a placeholder already exists for Phase 36, update it:

    ```
    | 36. verification | v1.6 | 3/3 | Complete | <today YYYY-MM-DD> |
    ```

    Step 3 — STATE.md:

    Update the `Current Position` section:

    ```
    Phase: 36 (verification) — COMPLETE (or FAILED if status: failed)
    Plan: 3 of 3 (36-01 + 36-02 + 36-03 complete; <passed/failed>; v1.6 ready for /gsd:audit-milestone)
    ```

    Also bump the `progress:` block in the YAML front-matter:
    ```yaml
    progress:
      total_phases: 5
      completed_phases: 5
      total_plans: 19  # was 16; +3 for Phase 36 plans
      completed_plans: 19
    ```

    And update `stopped_at:` to "Completed Phase 36 verification — v1.6 ready for milestone close".

    Verification helper after each edit:
    ```bash
    grep -E "^\- \[(x| )\] \*\*VERIFY-V16-01\*\*" .planning/REQUIREMENTS.md
    grep "Phase 36: verification" .planning/ROADMAP.md
    grep -A 1 "^Phase: 36" .planning/STATE.md
    ```

    Executor is forbidden from modifying any file under `kinetica_bi/src/` or `kinetica_bi/server/src/` in this plan.
  </action>
  <verify>
    <automated>grep -E "^- \[(x| )\] \*\*VERIFY-V16-01\*\*" .planning/REQUIREMENTS.md && grep -q "36-01-source-audit-PLAN.md" .planning/ROADMAP.md && grep -q "36-02-test-suite-run-PLAN.md" .planning/ROADMAP.md && grep -q "36-03-verification-doc-PLAN.md" .planning/ROADMAP.md && grep -q "^Phase: 36" .planning/STATE.md</automated>
  </verify>
  <acceptance_criteria>
    - `.planning/REQUIREMENTS.md` VERIFY-V16-01 row state is consistent with `.planning/phases/36-verification/36-VERIFICATION.md` front-matter `status:`:
      - If status is `passed`: `grep -E "^- \[x\] \*\*VERIFY-V16-01\*\*" .planning/REQUIREMENTS.md` returns 1 line.
      - If status is `failed`: `grep -E "^- \[ \] \*\*VERIFY-V16-01\*\*" .planning/REQUIREMENTS.md` returns 1 line AND a HTML comment with the failure note is appended below the marker.
    - `.planning/ROADMAP.md` Phase 36 block contains a `**Plans:** 3/3 plans complete` line AND three plan entries (`36-01-source-audit-PLAN.md`, `36-02-test-suite-run-PLAN.md`, `36-03-verification-doc-PLAN.md`).
    - `.planning/ROADMAP.md` Progress table contains a `36. verification` row with status `Complete`.
    - `.planning/STATE.md` Current Position section's `Phase:` line starts with `Phase: 36 (verification) —`.
    - `.planning/STATE.md` YAML front-matter `progress.completed_plans` is bumped (e.g. from 16 to 19).
    - No production source file under `kinetica_bi/src/` or `kinetica_bi/server/src/` was modified — confirm with `git status kinetica_bi/`.
  </acceptance_criteria>
  <done>VERIFY-V16-01 marker is consistent with 36-VERIFICATION.md status; ROADMAP and STATE.md both reflect Phase 36 completion (or failure).</done>
</task>

</tasks>

<verification>
After both tasks complete:
  - File `.planning/phases/36-verification/36-VERIFICATION.md` exists with status flag set to `passed` or `failed`.
  - File contains 3 success-criterion rows + 18 per-phase criterion rows (6+4+4+4) + 5 end-to-end scenarios + 5-row phase summary + scope caveat + carry-over.
  - `.planning/REQUIREMENTS.md` VERIFY-V16-01 row state matches the 36-VERIFICATION.md status flag.
  - `.planning/ROADMAP.md` Phase 36 block lists all three plans + Progress table updated.
  - `.planning/STATE.md` Current Position reflects Phase 36 completion.
  - `git status kinetica_bi/` shows no modified production-source files attributable to this plan.
</verification>

<success_criteria>
- VERIFY-V16-01 success criterion fully covered: 36-VERIFICATION.md documents PASS / FAIL / DEFERRED per success criterion across all five v1.6 phases.
- ROADMAP Phase 36 success criterion 3 satisfied: verification document produced with PASS / FAIL / DEFERRED per success criterion across all five v1.6 phases.
- Pragmatic-close pattern preserved: source-only + automated-test-gate attestation, live UAT skipped per v1.5 Phase 31 precedent.
- v1.6 milestone is ready for `/gsd:audit-milestone` + `/gsd:complete-milestone` (assuming status: passed).
</success_criteria>

<output>
After both tasks complete, create `.planning/phases/36-verification/36-03-SUMMARY.md` summarizing the final status (passed / failed), the gate_summary exit codes, and listing any DEFERRED items carried to v1.7.
</output>

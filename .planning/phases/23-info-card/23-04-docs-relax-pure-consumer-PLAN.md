---
phase: 23-info-card
plan: 04
plan_id: "23-04"
type: execute
wave: 3
depends_on: ["23-03"]
files_modified:
  - .planning/PROJECT.md
  - .planning/STATE.md
  - .planning/REQUIREMENTS.md
autonomous: true
requirements:
  - CARD-V14-02
must_haves:
  truths:
    - "STATE.md 'Info Card is a pure consumer' decision reworded to reflect Phase 23 relaxation: card and popup BOTH fetch via shared <InfoSelectionView />; other widget types still cannot"
    - "PROJECT.md gains a new Key Decisions table row documenting the relaxation with rationale and outcome"
    - "REQUIREMENTS.md CARD-V14-02 reworded from 'a dropdown in the widget config' to 'an in-widget layer dropdown'"
    - "Traceability table in REQUIREMENTS.md updated to mark CARD-V14-* status: Complete (or Pending → Complete pending Phase 24 verification)"
    - "All three docs reference the relaxation consistently (no orphan stale wording elsewhere referencing 'Info Card pure consumer / never call POST')"
  artifacts:
    - path: ".planning/STATE.md"
      provides: "Updated 'Info Card pure consumer' decision wording in Key v1.4 Architecture Decisions block"
      contains: "Info Card pure consumer"
    - path: ".planning/PROJECT.md"
      provides: "New Key Decisions table row for v1.4: Info Card / popup co-fetch via shared view"
    - path: ".planning/REQUIREMENTS.md"
      provides: "Updated CARD-V14-02 wording: 'in-widget layer dropdown'; Traceability rows for CARD-V14-* updated"
  key_links:
    - from: ".planning/STATE.md"
      to: ".planning/PROJECT.md"
      via: "consistent relaxation language"
      pattern: "in-widget layer dropdown|shared <InfoSelectionView />"
    - from: ".planning/REQUIREMENTS.md CARD-V14-02"
      to: ".planning/STATE.md Info Card decision"
      via: "consistent wording — both reference 'in-widget layer dropdown'"
      pattern: "in-widget layer dropdown"
---

<objective>
Update three planning documents to reflect the Phase 23 relaxation of the pure-consumer lock and the in-widget dropdown wording. The runtime change is shipped (Plans 23-01..03); this plan brings the documentation in line so future readers do not trip on stale "Info Card never calls POST /api/info/query" language. Three exact diffs:

1. STATE.md line 76: relax the "Info Card is a pure consumer" decision wording.
2. PROJECT.md Key Decisions table (after line 203): add a new v1.4 row documenting the relaxation with rationale and shipped outcome.
3. REQUIREMENTS.md CARD-V14-02 (line 57) and Traceability table (line 132-135): reword to "in-widget layer dropdown" and update status to Complete.

Purpose: The pure-consumer lock language was locked at v1.4 roadmap creation (Phase 18). Phase 23 deliberately relaxed it because the Info Card and popup must share dropdown-switch + Load-more fetch behavior via `<InfoSelectionView />` (locked at 23-CONTEXT.md). Failing to update the docs would leave a contradiction between the runtime behavior and the locked decision record — a verification trap for future phases (Phase 24 verification, future milestones).

Output: Three doc files with exact edits — surgically scoped diffs, no peripheral rewrites. The truth across PROJECT.md, STATE.md, REQUIREMENTS.md is consistent: card and popup both fetch via shared view; bar/line/pie/etc. cannot subscribe-to-fetch (XWIDGET-V2-01 deferred).
</objective>

<execution_context>
@/Users/rydelpereira/.claude/get-shit-done/workflows/execute-plan.md
@/Users/rydelpereira/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/REQUIREMENTS.md
@.planning/phases/23-info-card/23-CONTEXT.md
@.planning/phases/23-info-card/23-RESEARCH.md
@.planning/phases/23-info-card/23-01-extract-info-selection-view-SUMMARY.md
@.planning/phases/23-info-card/23-02-last-click-context-store-SUMMARY.md
@.planning/phases/23-info-card/23-03-info-card-renderer-SUMMARY.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Update STATE.md "Info Card is a pure consumer" decision wording (line 76)</name>
  <files>.planning/STATE.md</files>
  <read_first>
    - .planning/STATE.md (current line 76 — locate the exact wording before editing)
    - .planning/phases/23-info-card/23-CONTEXT.md § "Pure-consumer lock — RELAXED" (lines 67-70 — exact relaxation language)
    - .planning/phases/23-info-card/23-RESEARCH.md § "Pure-consumer lock — RELAXED" (lines 31-35)
  </read_first>
  <action>
    Open `.planning/STATE.md` and find the exact existing line 76:

    OLD (verbatim):
    ```
    - **Info Card is a pure consumer:** The Info Card (Phase 23) reads from `useInfoSelectionStore` only — it must never call `POST /api/info/query` directly. Only the map click handler in `MapChartRenderer` feeds the store.
    ```

    Replace with this NEW wording (verbatim):
    ```
    - **Info Card / popup co-fetch via shared `<InfoSelectionView />` (relaxed Phase 23 2026-05-09):** Both the popup and the Info Card mount `<InfoSelectionView />`, which calls `POST /api/info/query` on dropdown-switch (when `state[newLayerId]` is undefined) and on Load more — using replayed spatial coords from the new sibling `useLastInfoClickContextStore` slice. The map click handler in `MapChartRenderer` remains the SOLE entry point for the initial multi-layer fan-out and the SOLE writer of `useLastInfoClickContextStore`. Other widget types (bar / line / pie / scatter / table / records / bignumber / map) cannot fetch info-queries — only the popup and the card via the shared view can. Pre-Phase-23 lock language ("Info Card never calls POST /api/info/query directly") is OBSOLETE; future readers reference this entry instead. (XWIDGET-V2-01 deferred — non-popup-non-card widgets remain non-fetchers.)
    ```

    No other changes to STATE.md in this task. Do not touch other Key Decisions, do not reorganize the section.

    Verify the replacement by re-reading line 76 area; confirm only the one bullet was updated.

    Commit message: `docs(23-04): relax Info Card pure-consumer decision in STATE.md (Phase 23 P04 Task 1)`.
  </action>
  <verify>
    <automated>grep -c "Info Card is a pure consumer" .planning/STATE.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Info Card is a pure consumer" .planning/STATE.md` returns 0 (old wording fully removed)
    - `grep -c "Info Card / popup co-fetch via shared" .planning/STATE.md` returns >=1 (new wording present)
    - `grep -c "useLastInfoClickContextStore" .planning/STATE.md` returns >=1 (new slice referenced)
    - `grep -c "in-widget" .planning/STATE.md` returns >=0 (not strictly required in STATE.md; PROJECT and REQUIREMENTS carry that wording)
    - `grep -c "must never call \`POST /api/info/query\` directly" .planning/STATE.md` returns 0 (stale lock removed)
    - File still parses as valid markdown — visual sanity check via opening in editor or pandoc validation if available
  </acceptance_criteria>
  <done>STATE.md line 76 reflects the relaxed lock with explicit reference to the new sibling slice and the canonical narrowing (only popup+card via shared view can fetch).</done>
</task>

<task type="auto">
  <name>Task 2: Add new v1.4 Key Decisions row to PROJECT.md (after line 203 — the existing v1.4 HTML template policy row)</name>
  <files>.planning/PROJECT.md</files>
  <read_first>
    - .planning/PROJECT.md (lines 168-204 — Key Decisions table; locate line 203 v1.4 HTML template policy row; new row inserts directly after)
    - .planning/PROJECT.md (line 206 — Last updated footer; update timestamp to 2026-05-09 with Phase 23 reference)
    - .planning/phases/23-info-card/23-CONTEXT.md § "Pure-consumer lock — RELAXED" (lines 67-70)
  </read_first>
  <action>
    Open `.planning/PROJECT.md`. Find the v1.4 HTML template policy row at line 203 (verbatim from current PROJECT.md):

    ```
    | v1.4: HTML template policy — full HTML allowed in `info_template` (no sanitization) | Dashboard authors are privileged users (analogous to saved SQL queries and dashboard layout config); sanitizing limits power-user flexibility on a feature meant for technical analysts. Risk: untrusted dashboard authors can inject scripts on viewers. Mitigation: documented here; treat dashboard authoring as a privileged action; revisit if the user model expands to untrusted multi-tenant sharing. | — Pending (locked at v1.4 start) |
    ```

    Insert a NEW row IMMEDIATELY after line 203 (and before the closing `---` separator on line 204). The new row (verbatim):

    ```
    | v1.4: Info Card / popup co-fetch via shared `<InfoSelectionView />` (Phase 23 relaxation) | Pre-Phase-23 lock said "Info Card never calls POST /api/info/query directly — only the map click feeds the store." Phase 23's design north star is "card is popup mirrored in a widget" with full UX parity (in-widget layer dropdown switching, Load more). The card has no `mapRef`, so on-demand fetches replay the most-recent click's spatial coords from a new sibling slice `useLastInfoClickContextStore`. The relaxation narrows: the click handler in `MapChartRenderer` stays the SOLE multi-layer fan-out entry; popup and card single-layer dropdown-switch + Load-more fetches go via the shared `<InfoSelectionView />`; other widget types (bar/line/pie/scatter/table/records/bignumber/map) still cannot fetch info-queries (XWIDGET-V2-01 deferred). | ✓ Shipped v1.4 Phase 23 |
    ```

    Then update the footer at line 206 (verbatim current):
    ```
    *Last updated: 2026-05-08 — Phase 21 (map-click-popup) complete: POPUP-V14-01..06 shipped (renderInfoTemplate shared helper + InfoPopup + MapChartRenderer integration with kill-switch-gated singleclick + sequential fan-out + dismiss-resets-store)*
    ```

    Replace with:
    ```
    *Last updated: 2026-05-09 — Phase 23 (info-card) complete: CARD-V14-01..04 shipped (info-card chart type + `<InfoSelectionView />` shared body + `useLastInfoClickContextStore` sibling slice + four-store reset block + relaxed pure-consumer lock per new Key Decisions row)*
    ```

    No other PROJECT.md changes in this task.

    Commit message: `docs(23-04): add Phase 23 relaxed pure-consumer Key Decision row to PROJECT.md (Phase 23 P04 Task 2)`.
  </action>
  <verify>
    <automated>grep -c "Info Card / popup co-fetch via shared" .planning/PROJECT.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "Info Card / popup co-fetch via shared" .planning/PROJECT.md` returns >=1
    - `grep -c "useLastInfoClickContextStore" .planning/PROJECT.md` returns >=1
    - `grep -c "✓ Shipped v1.4 Phase 23" .planning/PROJECT.md` returns >=1
    - `grep -c "v1.4: HTML template policy" .planning/PROJECT.md` returns 1 (existing row preserved; not duplicated)
    - `grep -c "Last updated: 2026-05-09" .planning/PROJECT.md` returns >=1 (footer updated)
    - `grep -c "Phase 23 (info-card) complete" .planning/PROJECT.md` returns >=1
    - Total Key Decisions table row count increases by exactly 1 (new row added; no existing rows removed)
  </acceptance_criteria>
  <done>PROJECT.md Key Decisions table contains a v1.4 row explicitly documenting the relaxation, its rationale, and its shipped status. Footer reflects Phase 23 completion.</done>
</task>

<task type="auto">
  <name>Task 3: Reword REQUIREMENTS.md CARD-V14-02 from "dropdown in the widget config" to "in-widget layer dropdown"; update Traceability rows for CARD-V14-01..04</name>
  <files>.planning/REQUIREMENTS.md</files>
  <read_first>
    - .planning/REQUIREMENTS.md (line 57 — CARD-V14-02 current wording; lines 132-135 — Traceability table rows for CARD-V14-01..04; line 145-147 — coverage and last-updated footer)
    - .planning/phases/23-info-card/23-CONTEXT.md § "Pure-consumer lock — RELAXED" — locked rewording: "an in-widget layer dropdown" not "a widget config panel dropdown"
  </read_first>
  <action>
    Step 1: Open `.planning/REQUIREMENTS.md`. Find the CARD-V14-02 line at line 57 (verbatim current):

    ```
    - [ ] **CARD-V14-02**: The Info Card widget renders records from `useInfoSelectionStore` for a configured layer; a dropdown in the widget config allows the user to select which dashboard layer's info selection to display.
    ```

    Replace with this NEW wording (verbatim):

    ```
    - [x] **CARD-V14-02**: The Info Card widget renders records from `useInfoSelectionStore` for a configured layer; an in-widget layer dropdown (sticky header band of the card body — NOT a widget config panel dropdown) lets the user switch which dashboard layer's info selection to display. Dropdown source is dashboard-scoped: all layers where `info_enabled === 1` AND `spatialMode !== "wkb"`. On-demand `POST /api/info/query` fires when the switched-to layer has no entry in the store, using replayed spatial coords from `useLastInfoClickContextStore` (Phase 23 relaxed pure-consumer lock — see PROJECT.md Key Decisions). When `useLastInfoClickContextStore.context === null` (no prior click), dropdown switch only updates focus and does NOT fetch (Pitfall 2 lock).
    ```

    Step 2: Update the other three CARD-V14 entries from `[ ]` to `[x]` to match Phase 23's completion:

    Line 56 (current): `- [ ] **CARD-V14-01**: System registers a new \`info-card\` chart type in the chart-type registry alongside the existing 8 types (bar/line/pie/scatter/table/records-table/big-number/map); it is selectable from the chart type picker when adding a new widget.`

    Change `[ ]` to `[x]`. No wording change.

    Line 58 (current): `- [ ] **CARD-V14-03**: The Info Card renders records using the selected layer's \`info_template\` HTML string when configured; falls back to a plain key-value table when no template is set; matches the popup rendering path in POPUP-V14-04.`

    Change `[ ]` to `[x]`. No wording change.

    Line 59 (current): `- [ ] **CARD-V14-04**: When no info selection exists for the configured layer (store empty or \`activeLayerId\` null), the Info Card displays a neutral empty state ("Click a point on the map to see details") rather than a blank panel or an error.`

    Change `[ ]` to `[x]`. No wording change.

    Step 3: Update the Traceability table rows at lines 132-135 (verbatim current):

    ```
    | CARD-V14-01 | Phase 23 | Pending |
    | CARD-V14-02 | Phase 23 | Pending |
    | CARD-V14-03 | Phase 23 | Pending |
    | CARD-V14-04 | Phase 23 | Pending |
    ```

    Change all four `Pending` to `Complete`:

    ```
    | CARD-V14-01 | Phase 23 | Complete |
    | CARD-V14-02 | Phase 23 | Complete |
    | CARD-V14-03 | Phase 23 | Complete |
    | CARD-V14-04 | Phase 23 | Complete |
    ```

    Step 4: Update the footer at line 146 (verbatim current):

    ```
    *Last updated: 2026-05-07 — v1.4 roadmap created; all 25 requirements mapped to Phases 18-24*
    ```

    Replace with:

    ```
    *Last updated: 2026-05-09 — Phase 23 complete: CARD-V14-01..04 shipped; CARD-V14-02 reworded for in-widget dropdown clarity (relaxed pure-consumer lock — see PROJECT.md Key Decisions row).*
    ```

    No other changes to REQUIREMENTS.md in this task.

    Commit message: `docs(23-04): reword CARD-V14-02 (in-widget dropdown) and mark CARD-V14-01..04 Complete (Phase 23 P04 Task 3)`.
  </action>
  <verify>
    <automated>grep -c "in-widget layer dropdown" .planning/REQUIREMENTS.md</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c "in-widget layer dropdown" .planning/REQUIREMENTS.md` returns >=1 (new wording present)
    - `grep -c "a dropdown in the widget config" .planning/REQUIREMENTS.md` returns 0 (stale wording fully removed)
    - `grep -c "useLastInfoClickContextStore" .planning/REQUIREMENTS.md` returns >=1 (referenced in CARD-V14-02 expanded language)
    - `grep -E "CARD-V14-0[1234].*Complete" .planning/REQUIREMENTS.md` returns 4 matches (all four traceability rows show Complete)
    - `grep -E "CARD-V14-0[1234].*Pending" .planning/REQUIREMENTS.md` returns 0 (no traceability row left as Pending)
    - `grep -E "^\- \[x\] \*\*CARD-V14-0[1234]\*\*" .planning/REQUIREMENTS.md` returns 4 matches (all four checkboxes ticked)
    - `grep -E "^\- \[ \] \*\*CARD-V14-0[1234]\*\*" .planning/REQUIREMENTS.md` returns 0 (no CARD checkbox left unchecked)
    - `grep "Last updated: 2026-05-09" .planning/REQUIREMENTS.md` returns >=1 (footer updated)
  </acceptance_criteria>
  <done>REQUIREMENTS.md CARD-V14-02 wording reflects "in-widget layer dropdown" with explicit cross-reference to the relaxed lock; all four CARD-V14-* are marked Complete in both the requirement list and the traceability table; footer is dated 2026-05-09.</done>
</task>

</tasks>

<verification>
- Cross-doc consistency: `grep -E "Info Card is a pure consumer|never call .POST /api/info/query. directly" .planning/PROJECT.md .planning/STATE.md .planning/REQUIREMENTS.md` returns ZERO matches across all three files (no orphan stale wording)
- Cross-doc consistency: `grep -E "useLastInfoClickContextStore|in-widget layer dropdown|<InfoSelectionView />" .planning/PROJECT.md .planning/STATE.md .planning/REQUIREMENTS.md` returns matches in MULTIPLE files (relaxation language present consistently)
- All four CARD-V14-* status fields say Complete in REQUIREMENTS.md
- All three docs have updated Last-updated footers (2026-05-09 with Phase 23 reference)
</verification>

<success_criteria>
1. STATE.md line ~76: "Info Card is a pure consumer" replaced with "Info Card / popup co-fetch via shared `<InfoSelectionView />` (relaxed Phase 23 2026-05-09)" and the new explanatory text. No other STATE.md changes.
2. PROJECT.md Key Decisions table gains exactly one new row (after the v1.4 HTML template policy row) documenting the relaxation with rationale and ✓ Shipped v1.4 Phase 23 outcome. Footer updated to 2026-05-09 referencing Phase 23.
3. REQUIREMENTS.md CARD-V14-02 reworded to "in-widget layer dropdown ... NOT a widget config panel dropdown" with cross-reference to the relaxed lock + useLastInfoClickContextStore + Pitfall 2 short-circuit. CARD-V14-01..04 checkboxes all ticked; Traceability table rows all show Complete. Footer updated to 2026-05-09.
4. Cross-document consistency check passes: no orphan stale "Info Card pure consumer / never call POST" wording survives in any of the three files.
</success_criteria>

<output>
After completion, create `.planning/phases/23-info-card/23-04-docs-relax-pure-consumer-SUMMARY.md` capturing: exact lines edited per file (line numbers post-modification may shift; show before/after diff for each file), cross-doc grep results confirming no orphan stale wording survives, and any deviations from plan with rationale. This SUMMARY closes Phase 23 documentation; Phase 24 verification will exercise the runtime behavior end-to-end.
</output>

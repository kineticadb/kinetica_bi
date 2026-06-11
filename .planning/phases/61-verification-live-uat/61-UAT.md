---
plan: 61-02
operator: RPereira@kinetica.com
started_on: 2026-06-11
automated_gates_ref: .planning/phases/61-verification-live-uat/61-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS (commit 162e514, 2026-06-11T13:50:35Z — frontend vitest 1935/1935 green, web tsc clean, server tsc clean, server set-gate pass (8 failing files all ⊆ TD-V16-TEST-ISOLATION known-flaky list), targeted v1.11 specs 210/210 (10 files))
---

# 61 UAT — Live v1.11 Programmable-Widget Chain Walk-Through

**Purpose:** Operator-executed end-to-end verification of the v1.11 programmable-widget chain against the running app. This document is self-contained — no other planning files need to be read to execute the walk.

**Pre-reading required:** None. All context is below.

**Outcome routing:** Any `status: FAIL` item halts this UAT. A 61.x repro-test-driven gap plan is spun per defect (failing RED reproduction first, then fix, then the affected section is re-walked before 61-03 may compile). This is the v1.11 milestone gate — gaps are NOT accepted as tech debt. Trivial fixes may ride as inline follow-ups at the executor's discretion; anything non-trivial gets a 61.x plan.

---

## Section 0 — Preconditions

Operator confirms ALL of the following BEFORE beginning the walk. Each item must be PASS before continuing.

```
id: P1
check: App is running (web + server) against the deployed Kinetica instance in password mode.
status: PENDING
evidence:
```

```
id: P2
check: A non-bypass ANALYST-role login is ready for §3 (record the lowercased username here: _____________).
  Confirm this login is NOT admin, NOT designer — it does NOT hold any bypass role. It must be a pure
  analyst (or equivalent restricted-view role). The §3 viewer-safe payoff depends on this identity
  exercising the radio widget with no PATCH privilege — confirming the transient overlay approach
  causes zero permission friction.
status: PENDING
evidence:
```

```
id: P3
check: A dashboard exists in the app with the following authored fixtures (via the Phase 59 config panel):
  (a) A MAP widget bound to a real class-break-capable Kinetica layer (one that supports STYLES=cb_raster
      or equivalent class-break WMS rendering).
  (b) A RADIO-GROUP widget with at least 2 options, authored via the Phase 59 panel:
        Option A — patches the map layer's class-break render mode (e.g. renderMode field in the
                   allow-listed layer config, OR cb_config to a specific class-break scheme). This is
                   the SC1/§1 render-mode switch option.
        Option B — patches the same (or a different) allow-listed field of the map layer, OR
                   patches a widget.config field of a separate widget. Used in §1.2 (widget.config
                   live switch) and/or §2.1 (switch-replace isolation).
        Ideally: one option sets BOTH renderMode + cb_config (for the §2.1 switch-replace test);
                   a second option sets ONLY renderMode. If this is not available, note it and use
                   the closest two-field vs one-field pair available.
  (c) A defaultOptionId is configured on the radio group (used in §1.3 / §3.2 reload-resets-to-default
      attest). Record the dashboard name, layer name, and option names used: _____________
status: PENDING
evidence:
```

```
id: P4
check: 61-01 automated gates recorded ALL PASS — see header above and
  .planning/phases/61-verification-live-uat/61-01-AUTOMATED-GATES.md (commit 162e514, recorded
  2026-06-11T13:50:35Z). Outcomes: frontend vitest 1935/1935 green (92 files, 0 failures);
  web tsc clean (exit 0); server tsc clean (exit 0); server set-gate pass (8 failing files
  ⊆ TD-V16-TEST-ISOLATION known-flaky list, identical to the Phase 57 baseline — zero server
  regression from v1.11 which is confirmed frontend-only); targeted v1.11 specs 210/210 (10 files,
  engine + radio chain all green). Record-only — no manual rerun required.
status: PENDING
evidence:
```

---

## Section 1 — Live Config Switch [ROADMAP SC1] (DESIGNER)

**Setup:** Log in as the designer/admin (RPereira@kinetica.com). Open the dashboard from P3.

**Transient model reminder:** In v1.11 the radio widget operates a session-only overlay. A viewer's runtime selection is NEVER PATCHed to the server. On reload (or dashboard-switch), the radio re-applies its designer-configured `defaultOptionId`. The operator attests **reload-resets-to-configured-default** in §1.3. Do NOT expect the live click to survive reload — that would be a false fail against the locked design.

```
id: 1.1
check: RENDER-MODE LIVE SWITCH (SC1 — class-break rendering changes in place).
  Click the radio option that patches the map layer's class-break render mode (Option A from P3).
  The MAP must update LIVE — class-break rendering changes in place — with NO remount or full reload.
  Specifically: the map must NOT blank-and-rebuild (no full canvas teardown); WMS tiles re-request
  with the new STYLES/rendering params and render without a manual refresh. The switch is immediate
  (no page reload needed).
  Confirm the render-mode change is visible (different class-break colour scheme, or the visual
  change expected for the configured option).
status: PENDING
evidence:
```

```
id: 1.2
check: widget.config-FIELD LIVE SWITCH.
  Click the radio option that patches a widget.config field of another widget (Option B from P3,
  or the equivalent option configured for a widget.config target).
  That widget must reflect the new config value LIVE — updating in place without a page reload.
  (If Option B targets a layer field rather than widget.config, note that and confirm the layer
  reflects the new value LIVE instead. The key attestation is: the target updates live, no remount.)
status: PENDING
evidence:
```

```
id: 1.3
check: RELOAD RESETS TO DEFAULT (TRANSIENT — the corrected SC1/SC4 behavior; reload-resets-to-configured-default).
  After selecting a non-default option (any option other than the configured defaultOptionId),
  RELOAD the dashboard (browser refresh or navigate away and back).
  The radio must re-apply its configured defaultOptionId — the control shows the DEFAULT option
  active and the target reflects the default, NOT the option selected before reload.
  ATTEST: reload-resets-to-configured-default.
  NOTE: The live click is transient by design (session-only overlay, no PATCH). Expecting the
  live selection to survive reload would be a false fail against the locked v1.11 transient model.
  The authored radio config + the defaultOptionId persist (they are the saved dashboard state);
  the viewer's runtime click does not.
status: PENDING
evidence:
```

---

## Section 2 — Switch-Replace + Isolation [ROADMAP SC2] (DESIGNER)

**Setup:** Remain as designer/admin. Use the same dashboard from P3.

```
id: 2.1
check: SWITCH-REPLACE ISOLATION (renderMode+cb_config option → renderMode-only option reverts cb_config).
  If Option A sets BOTH renderMode + cb_config (and Option B sets ONLY renderMode), perform the
  following sequence:
    1. Select Option A — observe the map shows the renderMode AND cb_config from Option A.
    2. Select Option B — observe the map shows the renderMode from Option B AND the cb_config
       reverts to the layer's saved baseline (the prior option's cb_config does NOT linger).
  Attest that cb_config reverts to baseline on the option switch (the overlay applies a clean
  replace, not a deep-merge that preserves stale keys from the previous option).
  If P3 did not author a cb_config-setting option, note it here and exercise the closest
  two-field vs one-field pair available; attest the analogous field isolation behaviour.
status: PENDING
evidence:
```

```
id: 2.2
check: OUT-OF-ALLOW-LIST PATCH REJECTED AT SAVE (operator-visible validation).
  In the Phase 59 config panel (radio group config editor), hand-edit an option's JSON binding
  to include an unknown/meta key — for example:
    - a field name not in the v1.11 allow-list (e.g. "id", "__proto__", "tableId", "type",
      or any other non-allow-listed key)
  Attempt to SAVE the option.
  Save must be REJECTED with an operator-visible validation message (an error banner, inline
  field error, or toast that identifies the rejected key/field). The bad binding must not persist
  to the dashboard state.
  Attest the rejection is visible and the panel does not save the invalid config.
status: PENDING
evidence:
```

```
id: 2.3
check: NO FILTER CHIPS / NO MATERIALIZE DURING DISPATCH (engine fully decoupled from filter pipeline).
  While clicking radio options during §1 and §2 above, confirm:
    (a) NO filter chips appear in the filter bar during or after option dispatch.
    (b) NO materialize network call fires (open DevTools Network tab — confirm no POST to
        /api/dynamic-view/materialize or equivalent materialize/drop endpoint during dispatch).
    (c) filterVersion is UNCHANGED — the dashboard's filtered data is not disturbed.
  The action engine is fully decoupled from the filter/materialize system (confirmed by the
  targeted v1.11 actionEngineDecoupling.spec.ts gate in 61-01). The sole-materialize-trigger
  contract is intact — radio switches must never invoke materialize.
status: PENDING
evidence:
```

---

## Section 3 — Viewer-Safe / Transient [ROADMAP SC1 Payoff] (VIEWER = non-bypass ANALYST)

**Setup:** Switch to the non-bypass ANALYST-role login from P2. Open the same dashboard from P3 in a separate browser session (or use incognito). Keep the designer/admin session available in a second window for §3.2 confirmation.

**Headline payoff:** This section proves the primary v1.11 user story: a viewer (analyst) can click the radio widget to interactively explore different map renderings — live, with zero permission friction — and their exploration leaves no trace on the shared dashboard. Enabled by the transient session-only overlay (no PATCH from viewer sessions).

```
id: 3.1
check: VIEWER LIVE SWITCH, NO PERMISSION ERROR.
  As the non-bypass analyst (P2), open the dashboard. Click the radio render-mode option
  (Option A from P3 — the one that switches class-break rendering).
  The map must switch LIVE — the class-break rendering changes in place — with:
    (a) NO permission error (no 403 response, no "Insufficient permissions" toast, no denial
        banner). The switch proceeds silently and successfully.
    (b) NO remount/reload (same live-switch behaviour as §1.1).
  The transient model is why this works: the dispatch is a session-only overlay write with NO
  PATCH to the server, so the analyst's read-only role is never challenged.
status: PENDING
evidence:
```

```
id: 3.2
check: NO SHARED-DASHBOARD MUTATION (viewer's selection does not persist to the shared dashboard).
  After the analyst clicks a non-default radio option in §3.1, verify BOTH of the following:
    (a) In the DESIGNER/ADMIN session (second window): reload the dashboard. The saved dashboard
        state must reflect the configured defaultOptionId — NOT the option the analyst clicked.
        The analyst's runtime pick must be invisible to the designer session.
    (b) In the ANALYST session: reload the dashboard. The radio resets to the configured
        defaultOptionId (transient — same reload-resets-to-default behaviour as §1.3). The
        analyst's own selection does not persist even within their own session across reload.
  Attest that the shared dashboard is unmutated and the viewer's exploration is fully transient.
status: PENDING
evidence:
```

```
id: 3.3
check: ORPHAN TARGET SAFETY (warning / typed no-op + toast; no crash).
  Exercise an orphan target scenario. Two equivalent paths:
    Path A (config side): In the radio group config panel, author an option bound to a target
    widget/layer, then DELETE that target widget/layer. Reopen the config panel — the orphan
    warning from Phase 59 must be visible (an indicator that the binding points to a missing
    target). No crash or silent corruption.
    Path B (runtime side): Click a radio option whose target has been deleted (e.g. author an
    option, save, delete the target, then click the option as the analyst or designer). The
    dispatch must produce a typed no-op (no partial write, no crash) + a toast notification
    indicating the target is missing.
  Attest that at least one orphan path surfaces the appropriate signal (warning or typed no-op
  + toast) and nothing is corrupted.
status: PENDING
evidence:
```

---

## Section 4 — Automated Gates Reference [ROADMAP SC3/SC4]

SC3/SC4 are covered by the automated gates recorded in `61-01-AUTOMATED-GATES.md` (cited in §0 P4). No live re-run is required in this walk-through.

Gate outcomes (from 61-01-AUTOMATED-GATES.md, commit 162e514, recorded 2026-06-11T13:50:35Z):

| Gate | Result | Detail |
|------|--------|--------|
| frontend_vitest | PASS | 1935/1935 tests, 92/92 files, 0 failures (>= 1935 baseline, 100% green) |
| web_tsc | PASS | Clean — exit 0, zero errors |
| server_tsc | PASS | Clean — exit 0, zero errors |
| server_vitest_setgate | PASS | 8 failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set (unchanged from Phase 57 baseline; zero server regression from v1.11 frontend-only changes) |
| targeted_v111_specs | PASS | 210/210 tests, 10/10 files (engine + radio chain: widgetAction, actionAllowList, applyWidgetAction, actionEngineDecoupling, widgetActionStore, actionEngine.canary, radioGroupConfig, radioGroupCapture, RadioGroupConfigPanel, RadioGroupRenderer) |

```
id: 4.1
check: SC3/SC4 automated gates record — ALL PASS per 61-01-AUTOMATED-GATES.md (commit 162e514,
  2026-06-11T13:50:35Z). Record-only, no manual rerun required. The targeted
  actionEngineDecoupling.spec.ts gate confirms SAFETY-V111-02: static source grep proves the
  engine contains zero references to materializeFilter, dropFilterView, addFilter,
  setBulkFilters, or filterVersion — fully decoupled from the filter/materialize pipeline.
status: PENDING
evidence:
```

---

## Section 5 — Gaps Block

```yaml
gaps:
  []
# If the walk-through surfaces defects, add one entry per defect below this line:
# - id: GAP-61-01
#   severity: blocking|major|minor
#   in_scope: v1.11
#   sections: [N.N, N.N]
#   title: Short description of the defect
#   resolution: OPEN — routed to plan 61.x (repro-test-driven gap-closure; failing RED repro
#               first, then fix, then the affected section is re-walked before 61-03 compiles)
```

---

## Attestation Summary

```
overall_result: PENDING
sections_passed:
sections_failed:
sections_skipped:
operator_notes: |
  (operator fills at walk-through time)
attested_by:
attested_on:
```

---

## Traceability

| ROADMAP SC | Success Criterion | Covered by sections |
|---|---|---|
| SC1 | Radio option switches map layer class-break render mode LIVE (no remount); reload resets to configured default (transient); viewer clicks LIVE with no permission error; nothing persists to shared dashboard | §1 (1.1, 1.2, 1.3) + §3 (3.1, 3.2) |
| SC2 | Switch-replace isolation (renderMode+cb_config → renderMode-only reverts cb_config to baseline); out-of-allow-list patch rejected at save (operator-visible); NO filter chips + NO materialize during dispatch | §2 (2.1, 2.2, 2.3) |
| SC3 | Frontend vitest 100% (deterministic), web+server tsc clean — automated gates | §0 P4 + §4 (4.1) → 61-01-AUTOMATED-GATES.md |
| SC4 | Server vitest set-based gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set); targeted v1.11 engine+radio specs 210/210; reload-resets-to-default (transient model confirmed) — automated gates | §0 P4 + §4 (4.1) → 61-01-AUTOMATED-GATES.md |

| Requirement ID | Description | Sections |
|---|---|---|
| VERIFY-V111-01 | Live operator walk-through — prove the v1.11 programmable-widget chain end-to-end against the deployed system; all 4 SCs attested | §0–§5 (all) |

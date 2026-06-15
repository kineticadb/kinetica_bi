---
plan: 61-02
operator: RPereira@kinetica.com
started_on: 2026-06-11
rewalk_on: 2026-06-15
automated_gates_ref: .planning/phases/61-verification-live-uat/61-01-AUTOMATED-GATES.md
automated_gates_verdict: ALL PASS (refreshed at HEAD 0834447, 2026-06-15 — frontend vitest 2087/2087 (95 files), web tsc clean, server tsc clean, server set-gate UNCHANGED (zero server diff since 162e514, failing files ⊆ TD-V16-TEST-ISOLATION), v1.11 engine+radio specs green. Original record at 162e514.)
---

# 61 UAT — Live v1.11 Programmable-Widget Chain Walk-Through

**Purpose:** Operator-executed end-to-end verification of the v1.11 programmable-widget chain against the running app. Self-contained — no other planning files need to be read to execute the walk.

**Pre-reading required:** None. All context is below.

> **RE-WALK NOTE (2026-06-15):** This walk was paused after the original §1/§2 attestations, then the milestone GREW: Phase 60.1 (re-scoped the layer editor to the FULL `KineticaWmsLayerForm` side-by-side — new req **RADIOUX-V111-01**), Phase 60.2 (one option drives MULTIPLE targets — new req **RADIOMULTI-V111-01**), plus ~8 polish/bug fixes (green radios, vertical orientation, real layer names, class-break table-context, pie tooltip, full-form seeding) and a theming-hardening pass. Because the authoring UI + dispatch changed materially, the live items (§1, §2, §3) are RESET to PENDING for a fresh walk against the current build, and two new sections (§2A RADIOUX, §2B RADIOMULTI) were added. Automated gates (§0 P4, §4) are refreshed to HEAD 0834447.

**Outcome routing:** Any `status: FAIL` halts this UAT — a 61.x repro-test-driven gap plan per defect (failing RED repro first, then fix, then re-walk the affected item before 61-03 compiles). This is the v1.11 milestone gate; gaps are NOT accepted as tech debt. Trivial fixes may ride as inline follow-ups.

**How to fill this in:** For each item, set `status:` to PASS or FAIL and write one line of `evidence:` (what you saw). Leave PENDING only if not yet walked.

---

## Section 0 — Preconditions

Confirm ALL before beginning. Each must be PASS before continuing.

```
id: P1
check: App is running (web + server) against the deployed Kinetica instance in password mode.
  (Launch: `npm run dev` for web, `npm run dev:server` for server — or your usual setup.)
status: PENDING
evidence:
```

```
id: P2
check: A non-bypass ANALYST-role login is ready for §3 (record the lowercased username: _____________).
  NOT admin, NOT designer — no bypass role. The §3 viewer-safe payoff exercises the radio widget with
  no PATCH privilege, proving the transient overlay causes zero permission friction.
status: PENDING
evidence:
```

```
id: P3
check: A dashboard exists with these authored fixtures (authored via the CURRENT "Radio Dashboard Control"
  config panel — the full-form side-by-side editor):
  (a) A MAP widget bound to a real class-break-capable Kinetica layer (e.g. demo.nyctaxi). Give the layer
      an operator display name (config name) so the picker shows it (e.g. "Main NYC taxi").
  (b) A RADIO DASHBOARD CONTROL widget with at least 3 options authored via the full-form editor:
        Option A — layer target, renderMode classbreak with a configured cb_config (a class-break scheme).
        Option B — layer target, renderMode heatmap (or raster) — a DIFFERENT render mode (for §1.1 switch
                   + §2.1 switch-replace: A sets renderMode+cb_config, B sets renderMode only).
        Option C — (for §2B RADIOMULTI) an option with TWO targets: the map layer AND a second target
                   (another widget's config, or a second layer).
  (c) A defaultOptionId configured (for §1.3 / §3.2 reload-resets-to-default).
  Record dashboard name + layer name + option labels: _____________
status: PENDING
evidence:
```

```
id: P4
check: 61-01 automated gates — ALL PASS, refreshed at HEAD 0834447 (2026-06-15). See
  61-01-AUTOMATED-GATES.md "GATE REFRESH" block: frontend vitest 2087/2087 (95 files), web tsc clean,
  server tsc clean, server set-gate UNCHANGED (zero server diff since 162e514 → failing files still
  ⊆ TD-V16-TEST-ISOLATION), v1.11 engine+radio specs green. Record-only — no manual rerun required.
status: PASS
evidence: Record-only. 61-01-AUTOMATED-GATES.md refreshed verdict ALL PASS at HEAD 0834447 (frontend 2087/2087, web+server tsc clean, zero server diff). Re-confirmed 2026-06-15.
```

---

## Section 1 — Live Config Switch [ROADMAP SC1] (DESIGNER)

**Setup:** Log in as designer/admin. Open the P3 dashboard.

**Transient model reminder:** the radio widget operates a session-only overlay; a runtime selection is NEVER PATCHed. On reload it re-applies the designer-configured `defaultOptionId`. §1.3 attests reload-resets-to-default — the live click is NOT expected to survive reload.

```
id: 1.1
check: RENDER-MODE LIVE SWITCH (SC1). Click Option A (classbreak). The MAP updates LIVE — class-break
  rendering changes in place, NO remount/full reload, no manual refresh (WMS tiles re-request with new
  STYLES). Confirm the visual change. Also confirm the in-map Layers legend updates to match (GAP-61-01).
status: PENDING
evidence:
```

```
id: 1.2
check: SECOND-TARGET LIVE SWITCH. Click Option B (different render mode, or a widget.config target).
  The target updates LIVE in place, no reload, no remount. (If Option B targets a layer field, confirm
  the layer reflects it live; if widget.config, the widget updates live.)
status: PENDING
evidence:
```

```
id: 1.3
check: RELOAD RESETS TO DEFAULT (transient). Select a non-default option, then RELOAD the dashboard.
  The radio re-applies its configured defaultOptionId — control + target show the DEFAULT, not the
  pre-reload click. ATTEST: reload-resets-to-configured-default.
status: PENDING
evidence:
```

---

## Section 2 — Switch-Replace + Isolation [ROADMAP SC2] (DESIGNER)

```
id: 2.1
check: SWITCH-REPLACE ISOLATION. With Option A = renderMode+cb_config and Option B = renderMode only:
  1. Select A → map shows A's renderMode AND cb_config.
  2. Select B → map shows B's renderMode AND cb_config reverts to the layer's saved baseline (A's
     cb_config does NOT linger). Attest the clean replace (not a stale-key deep-merge).
status: PENDING
evidence:
```

```
id: 2.2
check: OUT-OF-ALLOW-LIST PATCH REJECTED (operator-visible). In an option's "Advanced (raw JSON)" editor,
  add a meta/forbidden key (e.g. "id", "__proto__", "tableId", "type", or — for a layer target — a
  data-binding key like "table_id"/"spatialMode"). The panel must reject it with an operator-visible
  error and NOT persist the bad binding. (Validation is live/inline — no separate Save button.)
status: PENDING
evidence:
```

```
id: 2.3
check: NO FILTER CHIPS / NO MATERIALIZE during dispatch (engine decoupled). While clicking options in
  §1/§2, confirm in DevTools: (a) no filter chips appear; (b) no POST to /api/.../materialize|drop fires;
  (c) the dashboard's filtered data is undisturbed. (Automated-gated by actionEngineDecoupling.spec.ts.)
status: PENDING
evidence:
```

---

## Section 2A — Full-Form Layer Editor [RADIOUX-V111-01] (DESIGNER)

**What this proves:** a layer-target option is authored via the FULL `KineticaWmsLayerForm` side-by-side (the same form as Map Layers), not hand-edited JSON — and the embedded form actually works.

```
id: RX.1
check: SIDE-BY-SIDE FULL FORM. Add/edit a radio option, set its target to the MAP LAYER. The modal widens
  to two panes: left = radio config, right = the full layer form (RENDER MODE + style params + opacity +
  INFO POPUP). DATA SOURCE and SPATIAL MODE sections are ABSENT. No raw JSON needed to author the option.
status: PENDING
evidence:
```

```
id: RX.2
check: FORM SEEDED FROM LAYER + REAL LAYER NAME. On opening a layer-target option, the render-mode radio
  is PRE-SELECTED to the layer's current mode (not blank), params populated. The Target picker shows the
  layer's real name (e.g. "Main NYC taxi"), NOT "Layer #N".
status: PENDING
evidence:
```

```
id: RX.3
check: CLASS-BREAK AUTHORING WORKS (the table-context fix). Set render mode = Classbreak. Pick a VARCHAR
  column (e.g. payment_type) → distinct-count succeeds (NO "Could not count distinct values" / no
  "FROM unknown"). Pick a NUMERIC column (e.g. pickup_longitude), Method = Equal Interval → Auto-suggest
  breaks returns REAL break values (not all 0).
status: PENDING
evidence:
```

```
id: RX.4
check: RADIO THEMING. The radio widget on the dashboard renders with GREEN-accented radios (not browser
  blue) and VERTICAL orientation actually stacks vertically. With 3+ options, EACH option's render-mode
  radio in the config editor shows its OWN selection (not only the last option selected).
status: PENDING
evidence:
```

```
id: RX.5
check: ADVANCED JSON FALLBACK + WIDGET/DV UNCHANGED. The raw-JSON editor is still available under a
  collapsible "Advanced (raw JSON)" for layer targets. Widget and dynamic-view targets keep their
  simple inputs (no full-form pane).
status: PENDING
evidence:
```

---

## Section 2B — Multi-Target Options [RADIOMULTI-V111-01] (DESIGNER)

**What this proves:** one radio option can drive MULTIPLE targets at once; switching options is switch-replace at the option level (stale targets revert).

```
id: RM.1
check: AUTHOR MULTIPLE TARGETS. On Option C, click "+ Add target" and configure a SECOND target (a
  different widget/layer than the first). Both target editors are present and independently editable.
  (Single-target options stay clean — no list chrome until a 2nd target is added.)
status: PENDING
evidence:
```

```
id: RM.2
check: ONE OPTION → MANY TARGETS LIVE. Select Option C. BOTH targets update LIVE in the same action
  (e.g. the map layer changes AND the second widget/layer changes), no reload/remount.
status: PENDING
evidence:
```

```
id: RM.3
check: OPTION-LEVEL SWITCH-REPLACE (stale targets drop). After selecting Option C (targets {map, widget2}),
  select an option that targets ONLY the map (e.g. Option A). The second widget/layer must REVERT to its
  baseline — Option C's effect on it does NOT linger. (This is the key multi-target correctness check.)
status: PENDING
evidence:
```

```
id: RM.4
check: BACK-COMPAT. Any radio option authored BEFORE this milestone (legacy single-target) still loads,
  edits, and dispatches correctly. (If none exist, note N/A.)
status: PENDING
evidence:
```

---

## Section 3 — Viewer-Safe / Transient [ROADMAP SC1 Payoff] (VIEWER = non-bypass ANALYST)

**Setup:** Switch to the P2 analyst login (separate session / incognito). Keep the designer session in a 2nd window for §3.2.

**Headline payoff:** a viewer (analyst) clicks the radio widget to explore renderings — live, zero permission friction — leaving no trace on the shared dashboard (transient session-only overlay, no PATCH).

```
id: 3.1
check: VIEWER LIVE SWITCH, NO PERMISSION ERROR. As the analyst, click Option A. The map switches LIVE
  with (a) NO 403 / no "Insufficient permissions" toast / no denial banner; (b) no remount/reload.
status: PENDING
evidence:
```

```
id: 3.2
check: NO SHARED-DASHBOARD MUTATION. After the analyst clicks a non-default option:
  (a) DESIGNER session (2nd window): reload → saved state reflects the configured defaultOptionId, NOT
      the analyst's pick (analyst's runtime choice is invisible to the designer session).
  (b) ANALYST session: reload → radio resets to defaultOptionId (transient even within their own session).
  Attest the shared dashboard is unmutated and the viewer's exploration is fully transient.
status: PENDING
evidence:
```

```
id: 3.3
check: ORPHAN TARGET SAFETY. Author an option bound to a target, then DELETE that target widget/layer.
  Reopen the config panel → orphan warning visible (no crash). OR click the option whose target was
  deleted → typed no-op + toast (no partial write, no crash). Attest one orphan path surfaces the signal.
status: PENDING
evidence:
```

---

## Section 4 — Automated Gates Reference [ROADMAP SC3/SC4]

SC3/SC4 covered by `61-01-AUTOMATED-GATES.md` (cited in §0 P4) — refreshed at HEAD 0834447. No live re-run required.

| Gate | Result | Detail (HEAD 0834447) |
|------|--------|------------------------|
| frontend_vitest | PASS | 2087/2087 tests, 95/95 files, 0 failures |
| web_tsc | PASS | clean, exit 0 |
| server_tsc | PASS | clean, exit 0 |
| server_vitest_setgate | PASS | UNCHANGED — zero server diff since 162e514; failing files ⊆ TD-V16-TEST-ISOLATION |
| targeted_v111_specs | PASS | engine + radio chain green (now incl. radioGroupLayerPatch, theme-guard) |
| server_diff_guard | PASS | `git diff 162e514..HEAD -- packages/server` empty — v1.11 frontend-only across all phases |

```
id: 4.1
check: SC3/SC4 automated gates — ALL PASS per 61-01-AUTOMATED-GATES.md (refreshed HEAD 0834447,
  2026-06-15). Record-only. actionEngineDecoupling.spec.ts confirms SAFETY-V111-02 (engine has zero
  references to materializeFilter/dropFilterView/addFilter/setBulkFilters/filterVersion).
status: PASS
evidence: Record-only — SC3/SC4 gates ALL PASS per refreshed 61-01-AUTOMATED-GATES.md (HEAD 0834447). Re-confirmed 2026-06-15.
```

---

## Section 5 — Gaps Block

```yaml
gaps:
  - id: GAP-61-01
    severity: minor
    in_scope: v1.11
    sections: [1.1, 2.1]
    title: >-
      In-map Layers legend stayed frozen on the SAVED layer config during a radio overlay switch
      (legend read the persisted store while WMS tiles used overlay-merged effectiveLayers).
    resolution: >-
      RESOLVED — FIXED INLINE (commit f62da07). legendKey + resolveLegendLayers now derive from
      effectiveLayers; regression-locked by 3 specs. Re-confirm in §1.1.
  - id: GAP-61-02
    severity: major
    in_scope: v1.11
    sections: [1.1, 1.2]
    title: >-
      Layer visibility toggle (legend eye) stopped working after a radio switch — a captured
      config.visible overlay masked the persisted-store toggle write.
    resolution: >-
      RESOLVED — FIXED INLINE (commit 4afad81). widgetActionStore.releaseLayerConfigField + the
      visibility hook release the overlay's hold so the live toggle wins. Re-confirm in §1.1/§1.2.
# Post-pause UI/UX fixes (also fixed inline, regression-tested; re-confirm during the re-walk):
#   green radios + vertical orientation (de1cbfd), real layer names in picker (f2155bc),
#   class-break table-context FROM-unknown (2a6c668), full-form seeding (1b837ba),
#   pie tooltip dark-theme (b91fc1a), per-instance radio-group name collision (de1cbfd).
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

| ROADMAP SC / Req | Success Criterion | Covered by |
|---|---|---|
| SC1 | Radio switches map layer render mode LIVE (no remount); reload resets to default (transient); viewer clicks LIVE, no permission error; nothing persists to shared dashboard | §1 (1.1-1.3) + §3 (3.1, 3.2) |
| SC2 | Switch-replace isolation; out-of-allow-list patch rejected (operator-visible); NO filter chips + NO materialize during dispatch | §2 (2.1-2.3) |
| SC3 | Frontend vitest 100%, web+server tsc clean — automated gates | §0 P4 + §4 (4.1) |
| SC4 | Server vitest set-based gate ⊆ TD-V16-TEST-ISOLATION; targeted v1.11 specs green; reload-resets-to-default | §0 P4 + §4 (4.1) |
| RADIOUX-V111-01 | Layer-target option authored via the full-form side-by-side editor (not raw JSON); class-break authoring works; real layer name; themed radios | §2A (RX.1-RX.5) |
| RADIOMULTI-V111-01 | One option drives multiple targets; option-level switch-replace drops stale targets; back-compat | §2B (RM.1-RM.4) |
| VERIFY-V111-01 | Live operator walk-through — prove the v1.11 chain end-to-end; all SCs + new reqs attested | §0–§5 (all) |

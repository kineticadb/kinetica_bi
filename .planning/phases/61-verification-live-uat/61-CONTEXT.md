# Phase 61: Verification + Live UAT - Context

**Gathered:** 2026-06-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Prove the full programmable-widget chain (engine + allow-list + radio config panel + runtime renderer) end-to-end against the deployed system, run the automated gates fresh, and compile `61-VERIFICATION.md` that closes v1.11. Final v1.11 phase. Mirrors the v1.9 Phase 54 / v1.10 Phase 57 pattern: automated-gates record + operator walk-through doc with a blocking human checkpoint → compiled verification. NO feature code (verification only; gap fixes only via a 61.x decimal phase if the walk-through finds defects).

</domain>

<decisions>
## Implementation Decisions

### Reload behavior — TRANSIENT (re-scopes the stale ROADMAP SC wording)
- The ROADMAP SC1/SC4 originally said the radio selection "persists across reload" / "selectedIndex survives reload" — that wording is STALE (predates the Phase 58 transient-for-everyone + Phase 60 persistence reframe). It has been corrected in ROADMAP §Phase 61.
- The UAT attests the LOCKED behavior: a runtime radio selection is **session-only/transient**; on reload (or dashboard-switch) the radio re-applies its designer-configured **defaultOptionId** (or neutral if none). What persists is the authored radio config + the default — NOT the viewer's live click. The operator attests **reload-resets-to-configured-default**, NOT live-selection-survives-reload (which would be a false fail).

### Personas / test identities
- **Designer** authors the radio + a map widget with a class-break-capable layer (via the Phase 59 config panel) and exercises authoring + interaction.
- **Viewer (non-bypass analyst)** logs in and clicks the radio to prove the headline payoff: the target switches LIVE, there is NO permission error (transient, no PATCH), and the viewer's exploration does NOT mutate the shared dashboard. (Operator has separate non-admin logins, per the v1.10 setup.)

### Environment
- **Live deployed Kinetica, password mode** (same as v1.9/v1.10 closes). Requires a real class-break-capable map layer to exercise the headline scenario.

### Gap handling
- Defects → a **decimal 61.x** repro-test-driven gap-closure (failing RED repro → fix → re-walk the affected section), then close. NOT accept-as-tech-debt. Trivial fixes may ride inline; non-trivial → a 61.x plan.

### Walk-through scenario coverage (maps to the corrected 4 SCs)
- **§1 Live config switch (SC1):** as the designer, a radio option switches a map layer's class-break **render mode** (and a separate option/field a `widget.config` field) — the map/target updates LIVE with no remount. Reload → the radio resets to its configured default (transient confirmed).
- **§2 Switch-replace + isolation (SC2):** switching from an option that set renderMode + cb_config to one that sets only renderMode → cb_config reverts to the layer's saved baseline (no stale field). An out-of-allow-list patch (e.g. hand-edited JSON with an unknown/meta key) is rejected at save (operator-visible). During dispatch: NO filter chips appear, NO materialize fires (filterVersion unchanged; sole-materialize-trigger intact).
- **§3 Viewer-safe / transient (SC1 payoff):** as the analyst viewer, clicking the radio switches the target live with no permission error; nothing persists to the shared dashboard; reload resets to default. Orphan target (a since-deleted target) surfaces the authoring warning (config side) / typed no-op + toast (runtime).
- **§4 Automated gates (SC3/SC4):** frontend vitest 100% (run from packages/web — DETERMINISTIC, real 100% bar); web AND server `tsc --noEmit` clean (separate gates); server vitest SET-BASED (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set — NEVER a fixed pass-count). Engine checklist (idempotency, orphan-safety, reload-resets-to-default) green.

### Close criteria
- `61-VERIFICATION.md` committed `overall_status: passed` (or `gaps_found` → 61.x; `failed` not an acceptable close state). All SCs attested PASS + gates green → milestone gate PASSED, ready for `/gsd:complete-milestone 1.11`.

### Claude's Discretion
- Plan decomposition (likely: automated-gates plan + UAT-doc plan with the blocking checkpoint + compile-verification plan — mirror Phase 57; planner decides).
- Exact UAT doc structure (reuse 57-UAT.md / 54-UAT.md format).
- Which specific dashboard/layer/options the operator uses as fixtures.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### What shipped (under test)
- `.planning/phases/58-action-engine-contract-allow-list-canary/58-VERIFICATION.md` + `58.1-.../58.1-01-SUMMARY.md` — engine + allow-list + deep-merge + the known-flaky server-test set.
- `.planning/phases/59-.../59-VERIFICATION.md` — radio config panel + Capture + validation + orphan warning.
- `.planning/phases/60-.../60-01/02/03-SUMMARY.md` + `60-VERIFICATION.md` — control-keyed store + RadioGroupRenderer + MCP-seam doc; the TRANSIENT model.

### Format precedent
- `.planning/phases/57-verification-live-uat/57-UAT.md` + `.planning/phases/54-verification-live-walk-through/54-VERIFICATION.md` — UAT doc structure + compiled-verification format.

### Phase contract
- `.planning/ROADMAP.md` §Phase 61 — goal + 4 success criteria (SC1/SC4 now corrected to the transient model).
- `.planning/REQUIREMENTS.md` — VERIFY-V111-01.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- v1.9 `54-UAT.md` / v1.10 `57-UAT.md` + `*-VERIFICATION.md` as templates.
- The Phase 59 config panel (author the radio) + Phase 60 renderer (interact) — the live surfaces being walked.

### Test-gate reality (SC3/SC4)
- Frontend vitest DETERMINISTIC → 100% (current baseline 1935; run from `packages/web`).
- Server vitest flaky → SET-BASED gate (failing files ⊆ TD-V16-TEST-ISOLATION known-flaky set: auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.wms); NEVER a fixed pass-count.
- `npx tsc --noEmit -p packages/web` AND `-p packages/server` both clean (separate gates). v1.11 has been frontend-only (Phases 58-60 zero server diffs) — server gates should be unchanged/green.

### Integration Points
- The walk-through exercises the running deployed app (password mode) — no code changes unless a gap is found.

</code_context>

<specifics>
## Specific Ideas

- The headline moment v1.11 has built toward: a VIEWER clicks a radio option and the map LIVE-switches class-break rendering — with zero permission friction and zero mutation of the shared dashboard. §3 is the proof.
- Operator: RPereira@kinetica.com (admin/bypass) drives the walk; uses a separate non-admin analyst login for §3.

</specifics>

<deferred>
## Deferred Ideas

- AI chat widget + MCP server BUILD, additional control widget types, filter-setting actions, cross-dashboard targeting, persisting a viewer's runtime selection — all v2.
- Pre-existing tech-debt (TD-V16-TEST-ISOLATION, TD-V14-WKB-SPIKE, TD-V17-LIVE-UAT, GAP-54-04) — NOT in this UAT's scope (VERIFY-V111-01 covers only the programmable-widget chain).

</deferred>

---

*Phase: 61-verification-live-uat*
*Context gathered: 2026-06-10*

---
phase: 103
name: verification-live-uat
milestone: v1.19
status: passed
verified: "2026-07-02"
re_verified: "2026-07-08"
re_verification: true
requirements: [VERIFY-V119-01]
---

# Phase 103: Verification + Live UAT — VERIFICATION

**Status:** passed
**Requirement:** VERIFY-V119-01 — Complete

The v1.19 milestone (Visualization Customization) is verified: green automated gates on both stacks + a blocking live operator walk-through of all five features (all scenarios PASS), with every gap found fixed in-session (repro-test-driven) and re-walked to PASS.

## Re-Verification (2026-07-08) — covers the final 8-phase count (adds Phase 104)

Phase 104 (synchronized-map-viewports) was inserted into v1.19 AFTER the original 2026-07-02 verification, so this re-run re-establishes SC1 on the current HEAD and extends coverage to the full phase set (97–104). **Verdict: PASS (unchanged).**

- **SC1 re-run — Web:** `tsc --noEmit` clean; vitest **3229/3229** (141 files, 0 failed — the 7 pre-existing `InfoCardRenderer`/`InfoPopup` 401 unhandled-rejection lines are the documented non-failing noise); theme-guard **138/138**.
- **SC1 re-run — Server:** `tsc --noEmit` clean; vitest **SET-BASED PASS** run with `DEFAULT_VIEW_TTL_MINUTES=""` (the documented dev-`.env`-leak neutralizer). 8 failing files — `auth.oidc`, `auth.routes`, `boot.hardening`, `boot.wipe`, `bootstrap`, `oidc.module` (TD-V11-04 OIDC issuer-mock), `db.smoke` (schema-snapshot drift), `routes.wms` (pre-existing credential-forwarding, untouched since v1.17) — **all ⊆ the documented TD-V16-TEST-ISOLATION set** (per `103-GATES.md`); zero files outside it. No server code changed since 2026-07-02 (`git log --since` empty), so the server surface is byte-identical to the originally-verified state.
- **SC1 re-run — Sole-materialize-trigger invariant:** re-grepped `packages/web/src/components/charts/` — zero non-comment `materializeFilter(`/`dropFilterView(` call sites. Held across the post-103 commits.
- **SC2 re-run — Live UAT extended to Phase 104:** the sync-viewport walk-through recorded 7/7 PASS (`104-UAT.md`). The one gap found during it — "map info popup not working" — was diagnosed as a **pre-existing multi-map scoping bug** (global `infoSelectionStore.activeLayerId` shared across maps), NOT a Phase 104 regression, and fixed by scoping the active selection to the owning map widget (`activeWidgetId`). Operator confirmed the popup works. Phase 104's own VERIFICATION is PASS (6/6 must-haves).
- **SC3 re-run — Gap fixed in-session + regression-tested:** the info-popup gap was fixed with regression test `InfoPopup H7` and committed (`9652182`); info-card label parity fixed (`21facf2`).

**Post-103 commits landing on the milestone (all green in the web suite above):**
- `9652182` fix(map): scope info popup to the owning map widget (Phase 104 UAT gap fix)
- `21facf2` fix(info-card): operator-set layer name in dropdown
- `bc4ffc7` feat(bar): Min Bar Size option with scroll-on-overflow — *net-new, outside the v1.19 locked scope*
- `e265485` feat(table): aggregated multi-column group-by Data Table + value-axis width fix — *net-new, outside the v1.19 locked scope*

The two `feat` commits are out-of-scope additions (not VERIFY-V119-01 requirements); they are green and do not affect milestone requirement coverage. VERIFY-V119-01 remains **Complete**.

## Success Criteria

### SC1 — Automated gates green (both stacks) + invariant ✅
- **Web:** `tsc --noEmit` clean; vitest **3195/3195** (139 files, 0 failed — pre-existing InfoCardRenderer 401 unhandled-rejection is non-failing noise); theme-guard green.
- **Server:** `tsc --noEmit` clean; vitest SET-BASED — failing files ⊆ TD-V16-TEST-ISOLATION (OIDC issuer-mock set, db.smoke drift, cross-mode contamination); v1.19 server specs (custom_metrics CRUD 23/23, `/api/auth/me` cap fields) pass in isolation. No fixed pass-count asserted.
- **Sole-materialize-trigger invariant:** re-grepped across all five features — CalendarRenderer / TimelineRenderer / NumericLineRenderer / bar path + the 4 v1.19 lib helpers (customMetricSql, yAxisScale, customWhere, barGroupedSeries) are token-free; only the 4 authorized call sites reference materialize. Evidence: `103-GATES.md`.

### SC2 — Blocking live operator walk-through, all 5 features attest PASS ✅
Operator walked the full matrix (F1–F5 + cross-feature combos X + backward-compat sweep R) on the live deployed Kinetica (password mode) and attested **PASS on all scenarios** (2026-07-02). Detail + per-scenario status: `103-UAT.md`.

### SC3 — Gaps fixed in-session (regression-tested) + re-walked to PASS ✅
5 gaps found during the walk, each fixed repro-test-driven, committed, and re-walked to PASS:

| # | Feature | Gap | Commit(s) |
|---|---------|-----|-----------|
| 1 | F1 | Smart time-scale selectable only in config, not on the widget → added viewer-facing "Time scale" dropdown (delivers CALSMART-V119-03 as written) | `a28afdb` |
| 2 | F1 | Overlapping controls → consolidated into a 3-way "Time grouping control" (advanced / advanced-adjustable / smart); removed the redundant checkbox | `2e47e31` |
| 3 | F1 | Allowed-scales checkbox stack looked like a separate group → compact multi-select box (extracted shared `MultiSelectChips`) | `eedfb3d`, `2260283` |
| 4 | F3 | Custom metric on grouped timeline/numeric-line emitted empty `AVG()` → routed the inline top-N ranking pre-query through `resolveMetricExpr` | `4744314` |
| 5 | F5 | Multi-series truncation note overlapped the plot → flex-column layout gives the note its own row | `681d5ed` |

Plus a deploy-doc improvement (not a gap): documented the boot-read tuning env vars in `packages/server/.env.example` (`01f0fa4`).

## Invariants held
- `AggregatedWidgetRenderer` remains the sole materialize trigger (all fixes are config/render/pure-helper).
- Theme-tokens-only; no invented classNames (all fixes reuse existing classes).
- All feature fixes FRONTEND-ONLY (zero `packages/server` diff); the only server change this phase is the `.env.example` doc.

## Requirement coverage
- **VERIFY-V119-01:** Complete. (All 19 v1.19 feature requirements — CALSMART/VIZSQL/METRIC/YAXIS/BARGRP — were verified Complete in phases 97–102; this phase closes the milestone-level verification requirement.)

---
*Verified 2026-07-02 — operator UAT PASS; 5 in-session gaps fixed + re-walked.*

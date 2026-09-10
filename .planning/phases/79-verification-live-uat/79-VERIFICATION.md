---
phase: 79
phase_name: verification-live-uat
status: passed
automated_gate: passed
live_uat: passed
requirements: [TTLKEEP-V115-02, VERIFY-V115-01]
updated: 2026-06-22
---

# Phase 79: Verification + Live UAT — Record

Milestone gate for v1.15 (Column Formatting & View Lifecycle, Phases 74–79).

## Criterion 1 — Automated gates (BOTH stacks) — ✅ PASS (2026-06-22)

| Gate | Result | Notes |
|------|--------|-------|
| Server `tsc --noEmit` | ✅ clean (exit 0) | |
| Web `tsc --noEmit` | ✅ clean (exit 0) | |
| Frontend vitest (from `packages/web`) | ✅ 2586 / 2586 (111 files) | includes theme-guard |
| theme-guard.spec.ts | ✅ 52 / 52 | no raw hex; new components NOT allowlisted |
| Server vitest (SET-BASED) | ✅ PASS | full suite 861 pass / 50 fail; 8 failing FILES ⊆ TD-V16-TEST-ISOLATION baseline (9 files at pre-75 commit `fd1ac18`). **Zero new failing files from v1.15.** |
| v1.15 server spec `routes.column-display-config` | ✅ 10 / 10 (isolated) | green outside the isolation cascade |
| Phase-74 materialize specs | ✅ 28 / 10 / 29 standalone; pass in full suite | a 3-file ad-hoc subset shows 2 spurious fails ("expected undefined to be defined") — same TD-V16-TEST-ISOLATION worker-sharing contamination, grouping-dependent, NOT a regression |
| Sole-materialize-trigger static guards | ✅ 32 / 32 | DataFilterRenderer + useViewKeepAlive import NO `materializeFilter`/`materializeDynamicView`/`dropFilterView`/`fromSwap` |

**Set-based gate evidence:** baseline (commit `fd1ac18`, pre-Phase-75) full server suite = 50 fail / 851 pass across 9 failing files (auth.oidc, auth.routes, boot.hardening, boot.wipe, bootstrap, db.smoke, oidc.module, routes.management, routes.wms). Current = 50 fail / 861 pass across 8 of those same files (+10 new passing from the column-display-config spec). The failing set is a subset of the documented known-flaky set; v1.15 introduced no new failures.

## In-session fixes folded into this milestone (post-autonomous-run, operator-found)

These were caught during operator review and fixed with regression tests (all in the green gate above):
- `fix(76)` — missing `ColumnFormatEditorModal` CSS (modal rendered as a flat list; two-pane layout never styled). Gap: theme-guard scans only `src/components/`, not `src/styles/global.css`, and jsdom tests don't apply layout.
- `fix(76)` — unsaved columns now default to **None** (were type-inferred + baseline-seeded, so the shown default could never be Saved and misrepresented unsaved columns).
- `fix(datafilter)` — Data Filter dropdowns re-fetch their value universe when the async `tables` registry loads after mount (race produced a spurious "No matches" that never recovered).

---

## Criterion 2 — Live walk-through: column formatting + labels — ⏳ PENDING (operator + deployed Kinetica)

Open a dashboard backed by a real Kinetica table. Configure a few columns via Datasets → (table) View → **Format columns**, then confirm the saved label + format appear on every surface. **Operator attested PASS 2026-06-22.**

- [x] **Editor**: open the editor; pick a numeric column → set Number (commas + 2 decimals, or currency `$`) → **live preview** updates → set a **display label** → **Save** → reopen and confirm it persisted (green dot on the column).
- [x] **Records Table** widget: column **header shows the custom label**; **cell values are formatted** (raw fallback for unconfigured columns).
- [x] **Chart** widget (bar/line/pie): **tooltip value is formatted**, tooltip/axis-title/series-legend show the **label** (user-set axis/series labels still win). _(In-session fixes: single-series tooltip now shows the metric label; pie slice labels + on-bar value labels run through the formatter.)_
- [x] **Map info popup** (click a map feature): **template `{column}` mode** AND **key/value mode** show the **label + formatted value**.
- [x] **Map layers legend** (`LayersLegendPanel`): confirmed **UNCHANGED** — no column label/format applied (locked by guard test, eyeball-confirm).

## Criterion 3 — Live walk-through: env-driven TTL flow — ✅ PASS (operator attested 2026-06-22)

> Revised for the Phase-74 env-var pivot: there is NO settings UI / `app:manage_settings` permission. TTL is configured via env vars read once at boot.

- [x] Set `DEFAULT_VIEW_TTL_MINUTES=10` (and optionally `TTL_KEEPALIVE_LEAD_MINUTES`) in the server's environment and restart the server.
- [x] Apply a filter (creates a filter-view) and open a dynamic-view-backed widget (creates a dynamic-view) → confirm the newly materialized views use **TTL = 10**, not the old hardcoded 5. (Inspect via Kinetica view metadata if available, OR confirm the client's expiry tracking / network response `expiresAt` ≈ now + 10 min.)
- [x] Confirm `GET /api/auth/me` returns `ttlKeepaliveLeadMinutes` (devtools Network) and that an invalid value (`DEFAULT_VIEW_TTL_MINUTES=abc`) falls back to the default + logs the boot warning `[boot] DEFAULT_VIEW_TTL_MINUTES must be a positive integer (got: "abc"); falling back to default 5` (app still starts). — confirmed.

## Criterion 4 — TTLKEEP-V115-02: live TTL-reset confirmation — ✅ PASS (operator attested 2026-06-22)

**The crux of the milestone.** Confirm that *reading* a materialized view resets its Kinetica TTL (so the Phase 78 keep-alive touch keeps idle dashboards alive). **Chosen method (2026-06-22): Method B (behavioral short-TTL).** Method A retained as the rigorous escalation if B is ambiguous.

- **Method A (rigorous, needs admin SQL):** materialize a view; note its TTL/last-access via Kinetica view metadata; issue a `SELECT … LIMIT 1` read against the view; re-check the metadata → confirm the TTL window reset.
- **Method B (behavioral, end-to-end):** set a SHORT TTL (`DEFAULT_VIEW_TTL_MINUTES=2`) + `TTL_KEEPALIVE_LEAD_MINUTES=1`; open a dashboard with a live filter/dynamic view; leave it idle past the original 2-minute window WITHOUT interacting; confirm widgets still render (views not expired) — i.e. the keep-alive touch kept them alive.

**Disposition if a read does NOT reset TTL:** document that the touch is insufficient and the **re-materialize fallback** is the mechanism (Phase 78 would need to re-materialize rather than just read). Record the outcome here either way.

- [x] **TTL-reset confirmed (read resets TTL) — keep-alive touch is sufficient.** Disposition via Method B (behavioral): with a short TTL + keep-alive lead, the idle dashboard survived past its original TTL window (touches fired and kept the view alive, no re-materialize). The re-materialize fallback is therefore NOT needed.
- [ ] ~~TTL-reset NOT confirmed → re-materialize fallback~~ — not applicable (read DID reset TTL).

## Criterion 5 — Compile record + fix UAT gaps — ✅ PASS

- [x] Gaps surfaced during UAT were fixed in-session (repro-test-driven) and re-walked PASS:
  - `fix(76)` missing ColumnFormatEditorModal CSS (two-pane layout)
  - `fix(76)` unsaved columns default to None
  - `fix(datafilter)` dropdown re-fetches when table registry loads after mount
  - `fix(77)` single-series tooltip shows the metric label
  - `fix(77)` pie slice labels + on-bar value labels run through the formatter
  - `fix(datafilter)` multi-select popover portaled so it isn't clipped by the widget
- [x] Record finalized → `status: passed`, milestone ready to complete.

---

*Automated gate completed by Claude 2026-06-22. Live walk-through (criteria 2–4) attested PASS by operator 2026-06-22; all in-session UAT gaps fixed with regression tests and re-walked. Phase 79 PASSED.*

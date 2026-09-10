---
phase: 13-spikes-and-endpoint
plan: 01
subsystem: infra
tags: [spike, kinetica, wms, ddl, materialized-view, oidc-deferred]

# Dependency graph
requires:
  - phase: 11-map-chart
    provides: SPIKE-NOTES format precedent (one section per spike with verdict + downstream consequence)
provides:
  - Verbatim S3 error string `SqlEngine: Object '<view-name>' not found (S/SDc:1513)` at HTTP 400 — drives Phase 15 LIFE-V13-02 isViewNotFoundError()
  - S2 password-mode DDL grant verified PASS — Plan 13-03 endpoint can call kineticaSql(req, ddl, ...) with per-user creds, no service-account fallback needed in v1.3
  - S4 verdict — both qualified and unqualified LAYERS work; endpoint returns UNQUALIFIED view names; Plan 13-02 view-name builder simplified
  - S1 verdict — WMS LAYERS=<materialized_view_name> renders PNG tiles; MAP-V13-* requirements stay in v1.3
  - Documented OIDC-mode DDL deferral (S2.b N/A) — Phase 15/17 must re-probe before milestone close
affects: [phase-13-02-view-utils, phase-13-03-endpoint, phase-15-chart-filtering, phase-16-map-filtering, phase-17-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator spike runner — Claude provides probes; operator executes against deployed Kinetica with own BI-user creds; findings captured in SPIKE-NOTES.md (matches v1.2 Phase 11 precedent)"

key-files:
  created:
    - .planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md
  modified: []

key-decisions:
  - "Plan 13-02 view-name builder returns UNQUALIFIED names (e.g. `_kbi_filt_u<...>_d<...>_t<...>_s<...>`) — both forms work per S4, bare is simpler"
  - "Plan 13-03 endpoint uses `kineticaSql(req, ddl, { op: MATERIALIZE })` with per-user creds verbatim — no service-account fallback path built in v1.3 (S2.a PASSed in password mode)"
  - "Phase 15 LIFE-V13-02 isViewNotFoundError() matches `/SqlEngine: Object '[^']+' not found/i` substring + Kinetica code `S/SDc:1513` — derived from S3 verbatim error"
  - "OIDC-mode DDL grant (S2.b) deferred to Phase 15/17 re-probe — no OIDC token reachable in this spike environment; Phase 13 ships with both code paths via existing `kineticaSql` branching"
  - "MAP-V13-* requirements stay in v1.3 scope — S1 PASSed; Phase 16 LAYERS-swap is buildable as planned"

patterns-established:
  - "Spike methodology: single SPIKE-NOTES.md per phase; one section per spike with verbatim probe output + downstream consequence — extends Phase 11 precedent"
  - "Defer OIDC permission probes when token endpoint unreachable — document gap with explicit re-probe requirement at later phase, do NOT block on inaccessible auth flows"

requirements-completed: [SPIKE-V13-01, SPIKE-V13-02, SPIKE-V13-03, SPIKE-V13-04]

# Metrics
duration: ~25min (operator probe execution + Task 2 capture + commit)
completed: 2026-05-06
---

# Phase 13 Plan 01: spike-runner Summary

**S1-S4 architectural spikes resolved against deployed Kinetica — WMS LAYERS=view PASS, password-mode DDL PASS, verbatim S3 error captured (`SqlEngine: Object '<n>' not found (S/SDc:1513)` at HTTP 400), S4 both forms work (endpoint returns unqualified). OIDC-mode DDL deferred to Phase 15/17 re-probe.**

## Performance

- **Duration:** ~25 min (operator probe execution + Task 2 capture)
- **Started:** 2026-05-06T17:42:58Z (Phase 13 STATE.md last_updated)
- **Completed:** 2026-05-06T18:06:46Z
- **Tasks:** 2 (Task 1 operator-run probes; Task 2 SPIKE-NOTES capture)
- **Files modified:** 1 created (`13-SPIKE-NOTES.md`)

## Accomplishments

- All four Phase-13 architectural spikes resolved with verbatim probe outputs
- Verbatim Kinetica error string captured for Phase 15 reactive recovery: `SqlEngine: Object '_kbi_filt_spike_test' not found (S/SDc:1513)` (HTTP 400)
- S2 password-mode DDL grant verified — Plan 13-03 endpoint can ship without speculative service-account fallback
- S4 schema-qualification question resolved — both forms work; endpoint returns unqualified (simpler) view names
- S1 PASSed — MAP-V13-* requirements stay in v1.3 scope; Phase 16 LAYERS-swap buildable
- OIDC-mode DDL gap explicitly documented with re-probe requirement at Phase 15/17 (not a blocker for Phase 13)

## Task Commits

Each task was committed atomically:

1. **Task 1: Operator runs S1-S4 spike probes against deployed Kinetica** — no commit (checkpoint:human-action; output captured to chat)
2. **Task 2: Write 13-SPIKE-NOTES.md from spike output** — `3d63fac` (docs)

**Plan metadata commit:** (this SUMMARY + STATE/ROADMAP updates) — see final commit below.

## Files Created/Modified

- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md` — locked findings for S1/S2/S3/S4 with PASS/FAIL/N/A verdicts + downstream consequences for Plans 13-02, 13-03, 15-LIFE-V13-02, 16, 17

## Decisions Made

- **Endpoint returns UNQUALIFIED view names** (S4 outcome): Both `ki_home._kbi_filt_spike_test` and `_kbi_filt_spike_test` resolve correctly through WMS LAYERS. Bare is simpler. Plan 13-02 view-name builder produces `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` with no schema prefix.
- **No service-account DDL fallback in v1.3** (S2 outcome): Password-mode DDL works (`info.X-Kinetica-Group: DDL`, `count_affected: 500000` on a 500k-row source). Plan 13-03 wires `kineticaSql(req, ddl, { op: "MATERIALIZE" })` directly with no fallback branch. VIEW-V13-05 (KineticaPermissionError → 403) ships as defense-in-depth but should rarely fire.
- **isViewNotFoundError() pattern locked** (S3 outcome): Phase 15 LIFE-V13-02 will use `/SqlEngine: Object '[^']+' not found/i.test(msg) || /\(S\/SDc:1513\)/.test(msg)` against `KineticaUpstreamError.upstreamMessage` after confirming `upstreamStatus === 400`. The `(S/SDc:1513)` Kinetica internal code is also stable and serves as a secondary predicate.
- **OIDC-mode probe deferred, not blocking** (S2.b N/A): Phase 13 ships on the strength of S2.a (password mode) PASS. Plan 13-03 supertest coverage exercises both `AUTH_MODE=password` and `AUTH_MODE=oidc` code paths via mocked `fetch`; the live OIDC permission grant gets re-probed at Phase 15 or Phase 17. If S2.b ultimately FAILs for OIDC users, a future gap-closure plan introduces a service-account DDL path; not built speculatively.

## Deviations from Plan

None — plan executed exactly as written. Task 1 was a `checkpoint:human-action`; operator ran all five probe blocks (A through E) and pasted verbatim output into chat. Task 2 was the autonomous follow-up to capture findings into a structured file. No auto-fixes triggered; no architectural changes needed.

The only out-of-scope-but-related observation: Phase 13 plan files (`13-01-spike-runner-PLAN.md`, `13-02-view-utils-PLAN.md`, `13-03-endpoint-PLAN.md`) are present in the working tree as untracked files. Per Task 2's instruction ("Commit Task 2 atomically: only the new SPIKE-NOTES.md file"), these were NOT included in the Task 2 commit. They are separate planner-output artifacts that get committed by the planner workflow, not the executor — leaving them untracked is the correct hand-off boundary.

## Issues Encountered

- **OIDC token unreachable in spike environment** — handled by deferring S2.b explicitly with an N/A verdict and documented re-probe requirement at Phase 15/17. NOT a Phase-13 blocker because (a) S2.a established that DDL grants exist for BI-users on this Kinetica cluster, and (b) Plan 13-03's `kineticaSql` helper already branches on `req.user.credentialType` so the OIDC code path is exercised by supertest mocks regardless of whether live OIDC was probed.

## Deferred Issues

- **S2.b OIDC-mode DDL grant probe** — must re-run when an OIDC access token is reachable. Documented in `13-SPIKE-NOTES.md` § S2.b and § Caveats. Owners: Phase 15 LIFE-V13-02 or Phase 17 verification.
- **`file` byte-detection output for S1 and S4.a PNGs** — operator confirmed success in plain text but did not paste the literal `file /tmp/wms_view_test.png` byte-detection output. Acceptance criterion is met (operator confirmation that PNG was returned, not XML). If a stricter audit demands the raw `file` output, both probes can be re-run cheaply (single curl call each).

## User Setup Required

None — Plan 13-01 only writes a documentation artifact. No environment variables, no external service config, no manual steps required for downstream consumers.

## Self-Check

**File existence:**
- `.planning/phases/13-spikes-and-endpoint/13-SPIKE-NOTES.md`: FOUND (committed at `3d63fac`, 225 insertions)

**Required section coverage:**
- `## S1 — WMS LAYERS=...`: present, verdict PASS, downstream consequence documented
- `## S2 — DDL Permission ...`: present, verdict PASS (password) + N/A DEFERRED (OIDC), downstream consequence documented
- `## S3 — Expired/Dropped-View Query Error`: present, verdict RESOLVED, verbatim error string captured
- `## S4 — Schema Qualification ...`: present, verdict BOTH WORK, downstream consequence documented
- `## Open Question Resolutions`: present (OQ-1, OQ-2 RESOLVED; OQ-3, OQ-4 deferred to Plan 13-03 default-pick)
- `## Caveats`: present (OIDC deferral, internal `/create/jointable` dispatch, `file` output gap, cleanup confirmed)

**Acceptance-criteria checks (from PLAN.md):**
- All four spikes have definitive PASS/FAIL/N/A verdicts: VERIFIED
- S3 verbatim string captured: VERIFIED — `SqlEngine: Object '_kbi_filt_spike_test' not found (S/SDc:1513)` at HTTP 400
- S2.b OIDC gap explicitly noted with re-probe owner: VERIFIED (Phase 15 or Phase 17)
- `**Overall S2 status:**` and `**Overall S4 status:**` literal lines present: VERIFIED
- No `<...>` placeholder lines remaining: VERIFIED (grep returned 0 matches)
- No TODO/FIXME/XXX markers: VERIFIED (grep returned 0 matches)

**Commit verification:**
- Task 2 commit `3d63fac` exists in `git log`: VERIFIED

## Self-Check: PASSED

## Next Phase Readiness

Plan 13-02 (view-utils) and Plan 13-03 (endpoint) are unblocked. Specifically:

- **Plan 13-02:** View-name builder produces `_kbi_filt_u<userId>_d<dashId>_t<tableId>_s<sessionShort>` (UNQUALIFIED). No `SHOW SCHEMAS` lookup needed. OIDC userId sanitizer per CONTEXT.md spec (replace non-alphanumeric with `_`, truncate to 32 chars).
- **Plan 13-03:** POST + DELETE `/api/filter/materialize` routes use `kineticaSql(req, ddl, { op: "MATERIALIZE" })` directly. No try/catch in handlers (server stateless re views). DDL string format: `CREATE OR REPLACE MATERIALIZED VIEW <name> AS (SELECT * FROM <table> WHERE <clause>) USING TABLE PROPERTIES (TTL = 5)`. Supertest mocks both `AUTH_MODE=password` and `AUTH_MODE=oidc` per RESEARCH.md Pattern 5 + 6.
- **Phase 15 LIFE-V13-02:** `isViewNotFoundError()` regex pattern locked — ready to implement when Phase 15 starts.

**Pending re-probe for milestone close:** S2.b (OIDC DDL grant) — Phase 15 LIFE-V13-02 or Phase 17 VERIFICATION.md must re-run with a live OIDC token before v1.3 ships.

---
*Phase: 13-spikes-and-endpoint*
*Completed: 2026-05-06*

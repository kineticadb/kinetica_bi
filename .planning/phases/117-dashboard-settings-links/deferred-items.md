# Deferred Items — Phase 117

## Suite is non-deterministic under parallel load (2 files, 5 tests — TRANSIENT)

**Found during:** 117-01 full-suite verification.

`src/components/DatasetsPage.spec.tsx` (1 failure) and
`src/components/charts/actionEngine.canary.spec.tsx` (4 failures: CANARY A1, A3, B1, C1) failed
during 117-01's verification run. **They are NOT reproducible.**

**Evidence gathered by the orchestrator after 117-01 reported, because the plan's gate requires a
100% suite and the failures were logged as "pre-existing" without that claim being tested:**

| Run | Commit | Result |
|---|---|---|
| Baseline, full suite | `439958e` (immediately BEFORE 117-01's code) | **175 files / 3902 tests, 100% pass** |
| Branch, full suite | `4701630` (117-01 complete) | **175 files / 3927 tests, 100% pass** (3902 + 25 new) |

Both endpoints are clean. The failures therefore were:
- **NOT caused by 117-01** — the branch passes with its changes in place, and
- **NOT "pre-existing"** in the sense of reproducible at baseline — the baseline passes too.

They were **transient, load-dependent flakes**. Both verification runs took 103-134s against a
~40s norm, i.e. the machine was heavily loaded and parallel scheduling shifted.

**Two claims were corrected by this evidence, recorded so neither is repeated:**
1. 117-01's SUMMARY called them "pre-existing … not caused by this phase's changes". The conclusion
   holds, but the stated reason was asserted, not tested — no baseline run was performed.
2. The orchestrator then over-corrected, reading the clean baseline as proof the failures were a
   regression, before reproducing on the branch. A single clean baseline does not establish
   causation for a timing-dependent flake; the branch run is what settled it.

**The real, standing finding:** this suite is **not deterministic under parallel load**. Neither
failing file imports `lib/dashboardUrl.ts` or `lib/tableUrl.ts`, and both pass in isolation
(15/15). This is the same class as the repo's documented "Web vitest parallel fake-timer leak"
(`test/setup.ts:62`'s global `vi.useRealTimers()` was the fix for the previously-known instance).

**Action:** none in this phase — out of scope, and nothing is currently red. Worth a dedicated
investigation: a suite that can redden under load will eventually redden in CI, and the next person
to hit it will also have to spend two full-suite runs proving it is not their fault.

**Guidance if it recurs mid-phase:** do not log it as pre-existing and do not assume a regression.
Run the full suite at the commit before the change AND on the branch. Only both results together
are evidence.

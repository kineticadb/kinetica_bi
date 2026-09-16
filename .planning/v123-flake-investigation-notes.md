# v1.23 candidate — web suite non-determinism: investigation notes

**Started:** 2026-09-16. Pre-milestone evidence gathering. **Nothing here is a conclusion yet.**

## The observed problem

Across Phase 117, four spec files failed at different points under full `npx vitest run`, all
non-reproducibly, all passing in isolation, all with **zero diff on disk**:

- `src/components/DatasetsPage.spec.tsx` ("renders a 'Format columns' button on the TableDetail screen")
- `src/components/charts/actionEngine.canary.spec.tsx` (4 CANARY cases: A1, A3, B1, C1)
- `src/App.tableDeeplink.spec.tsx`
- `src/components/DashboardContext.spec.tsx`

Cost: the Phase 117 closeout needed **3** runs to get one clean pass; the independent verifier also
needed **3**; the v1.22 milestone close needed **2**. Every endpoint was green and no failure ever
reproduced at a known-good commit.

## Facts established so far (verified, not assumed)

| Fact | Source |
|---|---|
| 16 CPUs, 64 GB RAM | `sysctl hw.ncpu hw.memsize` |
| vitest **4.1.5** | `packages/web/package.json:47` |
| `isolate: true`, jsdom, globals | `packages/web/vitest.config.ts` — the WHOLE config, 11 lines |
| **No `testTimeout` set** → vitest default 5000 ms | same file, absent |
| **No `maxWorkers` / pool config set** → workers scale to core count | same file, absent |
| A global `vi.useRealTimers()` already runs in `afterEach` | `src/test/setup.ts:62` |

## SUPERSEDED hypothesis (kept for the reasoning trail)

**CPU oversubscription causing timeout failures, not cross-file contamination.**

Supporting circumstantial evidence:
- Failures correlated with SLOW runs: 103-134 s against a ~40 s norm.
- During Phase 117 the orchestrator was running multiple background agents, several of which ran the
  **full suite concurrently**. With no `maxWorkers` cap, each vitest instance spawns workers scaled to
  16 cores — so two or three overlapping suites genuinely oversubscribe the machine.
- Non-reproducible, different files each time, passes in isolation — all consistent with timeouts
  under contention rather than deterministic state leakage.

**If true, a material share of this "flaky suite" is an artifact of how work was orchestrated, not a
defect in the suite** — and the fix is configuration (`maxWorkers`, `testTimeout`), not a bug hunt.

**The discriminating evidence is the failure MESSAGE:**
- `Test timed out in 5000ms` → oversubscription/timeout.
- An assertion mismatch (expected X, got Y) → genuine cross-file contamination.

That has NOT been checked yet. It decides the whole shape of the work. Do not skip it.

## Competing hypothesis

**Genuine cross-file contamination.** `src/test/setup.ts:53-62` documents a PREVIOUS instance of
exactly this, fixed by the global `vi.useRealTimers()`. Note the comment asserts "vitest workers run
spec files sequentially sharing global timer state" — but the config sets `isolate: true`, which
should give each file a fresh environment. **That comment and that setting appear to contradict each
other; resolving which is true for vitest 4 is a concrete research question.**

## Prior art in this repo — read before designing anything

`packages/server/scripts/test-gate.mjs` already solves this problem **for the server suite**, with a
SET-BASED gate rather than a pass-count:

1. Run the full suite.
2. Failing files in `KNOWN_FAILING` → allowed.
3. Any OTHER failing file → **re-run it ALONE**.
   - passes in isolation → contamination, allowed (and reported)
   - still fails in isolation → REAL failure, gate fails.

Its own header states the reasoning: *"Asserting '0 failures' would redden every run and train
everyone to ignore CI; asserting a fixed pass-count would go stale on every new spec."*

**This is a mitigation, not a cure.** It is the right fallback if the cause turns out to be genuine
and hard to eliminate — but adopting it reflexively is plausibly why the server's contamination
(`TD-V16-TEST-ISOLATION`) was never root-caused and is still carried, milestones later. Prefer a real
fix for web if the cause is configuration.

## Open questions for research

1. **What is the actual failure message?** Timeout vs assertion. Decides everything.
2. Does `--no-file-parallelism` produce a consistently clean suite? If yes, contention or contamination
   is confirmed and the two can then be separated by timing.
3. Does capping `maxWorkers` (e.g. 4) eliminate it while keeping runtime acceptable?
4. Does `isolate: true` actually prevent the leakage `setup.ts`'s comment describes, under vitest 4?
5. Is the failure set stable under a fixed `--sequence.seed`? Reproducibility would make bisection possible.
6. What does CI do? CI runners are typically 2-4 cores — **fewer workers, so possibly no flake there at
   all**, or conversely much slower and thus MORE timeout-prone. Worth checking `.github/workflows/ci.yml`
   before assuming the developer-machine symptom generalises.

## Standing caveat on prior evidence

Phase 117's verification leaned heavily on automated coverage (3990 tests, 20 mutation probes). A suite
that reddens differently on each run is weaker evidence than a stable one. That caveat is recorded in
`117-VERIFICATION.md` and stands until this is resolved.


---

# FINDINGS — evidence gathered 2026-09-16

## Reproduced, on an otherwise-idle machine

Run 1 of 4 sequential full-suite runs **reproduced the flake with only one vitest instance running**:

```
Test Files  1 failed | 174 passed (175)
     Tests  1 failed | 3989 passed (3990)
  Duration  175.07s  (environment 1528.82s aggregate)
```

Failure: `src/components/DatasetsPage.spec.tsx > renders a 'Format columns' button on the TableDetail screen`
```
TestingLibraryElementError: Unable to find role="button" and name "View"
```

## ROOT CAUSE — confirmed for 2 of the 4 files

**Testing Library's `findBy*` default timeout is 1000 ms, and it reports expiry as "Unable to find …"
— which reads like an assertion failure but is a TIMEOUT.** That is why this was misdiagnosed twice.

- `DatasetsPage.spec.tsx:76` — `await screen.findByRole("button", { name: "View" })`, waiting on an
  async table-list load.
- `packages/web/src/test/setup.ts` contains **no `configure()` call**, so RTL's 1000 ms
  `asyncUtilTimeout` default is in force suite-wide.
- vitest's own `testTimeout` (5000 ms) is never reached, which is why no "Test timed out" ever appeared.
- `environment 1528.82s` aggregate shows jsdom setup dominating; under that contention a render that
  normally completes in well under 1 s exceeds the window.

Explains: non-reproducibility (depends on co-scheduling), passing in isolation (no contention),
zero diff on disk, and the misleading error text.

**Two corrections recorded honestly:** the orchestrator first hypothesised CPU oversubscription from
its own concurrent agents, then reversed on seeing an "assertion-shaped" error, then reversed back on
finding RTL's timeout semantics. Run 1 settles it — a single instance, idle machine, still reproduced.
Load is the trigger, but the defect is the 1 s window, not the orchestration.

## NOT explained — do not claim this is solved

| File | `findBy` | `waitFor` | Covered by the above? |
|---|---|---|---|
| `DatasetsPage.spec.tsx` | 2 | 3 | YES |
| `App.tableDeeplink.spec.tsx` | 12 | 2 | YES |
| `actionEngine.canary.spec.tsx` | **0** | **0** | **NO — different cause** |
| `DashboardContext.spec.tsx` | **0** | **0** | **NO — different cause** |

Two of the four files use no async queries whatsoever, so the RTL-timeout mechanism cannot account
for them. **There are at least two distinct causes.** Their failures were observed earlier in Phase
117 but have not been captured with a message yet — that is the next evidence to gather.

## CI risk is concrete, not hypothetical

`.github/workflows/ci.yml:32` runs the web suite as **"must be 100% — 0 failures"**, and
`build-images.yml` runs `ci.yml` as a gate before publishing release images. So this flake can block a
release build outright. The `v1.21.0` and `v1.22.0` tags both just took that path — **worth checking
whether either build went red.** Note the server job uses the set-based gate and is immune.

## Candidate fixes, in order of directness

1. **Raise RTL's `asyncUtilTimeout` globally** via `configure({ asyncUtilTimeout: 5000 })` in
   `src/test/setup.ts`. Directly addresses the confirmed cause; one line; brings RTL into line with
   vitest's own 5 s budget. Does NOT mask real hangs — vitest's `testTimeout` still bounds them.
2. **Cap worker count** (`poolOptions`/`maxWorkers`) so jsdom setup does not starve workers. Reduces
   the trigger; costs wall-clock.
3. **Port the server's set-based gate** (`packages/server/scripts/test-gate.mjs`) to web — the proven
   in-repo pattern. **Fallback only:** it manages flakiness rather than removing it, and is plausibly
   why the server's own contamination was never root-caused and is still carried as
   `TD-V16-TEST-ISOLATION`.

Prefer 1 (+2 if needed). Reach for 3 only for whatever remains genuinely unexplainable.

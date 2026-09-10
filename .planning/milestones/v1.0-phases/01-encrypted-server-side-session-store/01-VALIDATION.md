---
phase: 1
slug: encrypted-server-side-session-store
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

Source: `.planning/phases/01-encrypted-server-side-session-store/01-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Wave 0 installs — no test runner currently in `kinetica_bi/server/package.json`) |
| **Config file** | `kinetica_bi/server/vitest.config.ts` (Wave 0 creates) |
| **Quick run command** | `cd kinetica_bi/server && npm test -- --run tests/<spec-file>.spec.ts` |
| **Full suite command** | `cd kinetica_bi/server && npm test -- --run` |
| **Estimated runtime** | ~5–10 seconds full suite |

Wave 0 install command:
```bash
cd kinetica_bi/server && npm install -D vitest @vitest/coverage-v8 supertest @types/supertest
```

Wave 0 must also add a `"test": "vitest"` script to `kinetica_bi/server/package.json`.

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the spec(s) the task touched.
- **After every plan wave:** Run the full suite command.
- **Before `/gsd:verify-work`:** Full suite must be green AND manual SESS-01..05 acceptance per ROADMAP.md (sqlite3 query against `kinetica.db`, JWT base64-decode check).
- **Max feedback latency:** ~10 seconds (full suite).

---

## Per-Requirement Verification Map

Task IDs are populated after PLAN.md files exist. The rows below enumerate the test surface by requirement; the planner maps each test to a specific task in PLAN frontmatter and updates the Task ID column.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | 1+ | SESS-01 | unit (property) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crypto.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-01 | unit (tamper) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crypto.spec.ts -t "tamper"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-01 | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-01 | integration (in-memory better-sqlite3) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-02 | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts -t "no password in JWT"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-02 | unit | `cd kinetica_bi/server && npm test -- --run tests/auth.cookie.spec.ts -t "opaque sid"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-03 | integration (supertest) | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "logout deletes row"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-03 | integration | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "logout best-effort"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-03 | integration | `cd kinetica_bi/server && npm test -- --run tests/auth.routes.spec.ts -t "me after delete"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-04 | integration | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "8h TTL"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-04 | integration | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "no sliding"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-05 | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "sweep"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-05 | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.crud.spec.ts -t "passive expiry"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-05 | unit (fake timers) | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.sweep.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | SESS-05 | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.sweep.spec.ts -t "resilient"` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | architectural | integration (table-driven) | `cd kinetica_bi/server && npm test -- --run tests/auth.requireAuth.spec.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | 1+ | boot | unit | `cd kinetica_bi/server && npm test -- --run tests/sessionStore.boot.spec.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Wave 0 establishes the test infrastructure — no source-code behavior changes here.

- [ ] `kinetica_bi/server/package.json` — add `"test": "vitest"` script and dev deps `vitest`, `@vitest/coverage-v8`, `supertest`, `@types/supertest`
- [ ] `kinetica_bi/server/vitest.config.ts` — vitest config (node environment, ts support)
- [ ] `kinetica_bi/server/tests/sessionStore.crypto.spec.ts` — stubs for SESS-01 round-trip + tamper
- [ ] `kinetica_bi/server/tests/sessionStore.crud.spec.ts` — stubs for SESS-04 (8h TTL), SESS-05 (sweep + passive expiry)
- [ ] `kinetica_bi/server/tests/sessionStore.sweep.spec.ts` — stubs for SESS-05 (timer + resilience)
- [ ] `kinetica_bi/server/tests/sessionStore.boot.spec.ts` — stubs for SESSION_ENCRYPTION_KEY validation
- [ ] `kinetica_bi/server/tests/auth.cookie.spec.ts` — stubs for SESS-01/SESS-02 cookie shape
- [ ] `kinetica_bi/server/tests/auth.routes.spec.ts` — stubs for SESS-03 logout + /me
- [ ] `kinetica_bi/server/tests/auth.requireAuth.spec.ts` — stubs for table-driven failure modes
- [ ] `kinetica_bi/server/tests/setup.ts` — shared fixtures (in-memory `:memory:` better-sqlite3 factory, mock Kinetica responses)

**Testability refactor (Wave 0 design choice — see RESEARCH §"Validation Architecture" › Wave 0 Gaps for tradeoffs):**

The current `db.ts` instantiates `Database` at module load reading `process.env.DB_PATH`. To make integration tests injectable, the planner picks one of:

1. **Recommended:** Export factories — `createDb(path)` and `createSessionStore(db)`. Module top-level still calls them with env values for production; tests construct their own. Cleaner, slightly bigger Wave 0.
2. Keep the module-singleton pattern; tests set `process.env.DB_PATH = ":memory:"` before importing `db.ts` in a fresh `vi.resetModules()` cycle. Smaller Wave 0; uglier test setup.

The planner should pick one and lock it in plan tasks; the recommendation is **Option 1**.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| sessions row visible after login with non-empty BLOB columns | SESS-01 (ROADMAP criterion 1) | ROADMAP success criterion explicitly references `sqlite3 kinetica.db` CLI inspection | After login, run `sqlite3 kinetica_bi/server/data/kinetica.db "SELECT sid, username, length(ciphertext), length(iv), length(auth_tag), expires_at FROM sessions"`; expect one row with ciphertext length > 0, iv length = 12, auth_tag length = 16. |
| Cookie payload contains no password | SESS-02 (ROADMAP criterion 2) | ROADMAP success criterion explicitly references `cut -d. -f2 \| base64 -d` JWT decode | Capture the `kbi_session` cookie from browser devtools; run `echo "<jwt>" \| cut -d. -f2 \| base64 -d`; assert payload is `{ sub, sid, v: 1, iat, exp }` and contains no `password` substring. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (always `--run`)
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

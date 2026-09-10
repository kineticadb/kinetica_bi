---
phase: 03-auth-failure-ux-admin-credential-removal
plan: "04"
status: deferred-pending-manual-verification
created: 2026-04-28
---

# Phase 3 Plan 04 — Manual UX Verification (Deferred)

These 7 browser-based checks were deferred at the checkpoint per user decision. They verify the user-visible deliverables of Plan 03-04 (useApiQuery hook, Toast, grayed-widget state, LoginPage banner, no-stuck-spinners). Phase 3 continues to Plan 03-05 (admin credential removal) without blocking on these. Run them before milestone close, or via /gsd:verify-work 3.

**Pre-flight (start dev servers):**
```bash
cd kinetica_bi/server && set -a && source .env && set +a && npm run dev   # :4000
cd kinetica_bi && npm run dev                                              # :5173
```
Note: the `set -a; source .env; set +a` step is needed in dev because sessionStore.ts:25 reads SESSION_ENCRYPTION_KEY at module-top before dotenv.config() runs in index.ts. Worth filing as a follow-up dev-experience improvement (not in Phase 3 scope).

## Check 1 — UX-01 session-expired banner
1. Log in as a valid Kinetica user
2. From a terminal: `sqlite3 kinetica_bi/server/data/kinetica.db "DELETE FROM sessions"`
3. Click any UI action (e.g., navigate to Dashboards)
- **Expected:** Redirected to LoginPage; banner "Your session has ended. Please sign in again." visible above the form; kbi_session cookie cleared (DevTools → Application → Cookies)

## Check 2 — Explicit logout has NO banner
1. Log in
2. Click Logout button
- **Expected:** LoginPage with NO banner (reason: null after explicit logout)

## Check 3 — Bootstrap 401 has NO banner
1. Hard-refresh with no session cookie
- **Expected:** LoginPage with NO banner (bootstrap 401 is not session expiry)

## Check 4 — UX-02 403 toast + grayed widget
Either: use a restricted Kinetica user, OR temporarily edit a backend route to throw `KineticaPermissionError("Test")` at the start of any handler.
- **Expected:** Bottom-right toast "You don't have permission to view this data." (auto-dismiss 5s); affected widget shows dashed-border "Permission denied" placeholder; user remains logged in; other widgets keep working

## Check 5 — Toast debouncing
Trigger same 403 error 3+ times rapidly
- **Expected:** Only ONE toast visible; duplicates suppressed within 5s window

## Check 6 — No stuck spinners
Kill backend mid-load while a fetch is in-flight (Ctrl+C the dev server)
- **Expected:** Migrated widget shows error state, NOT perpetual spinner

## Check 7 — Build + tests clean
```bash
cd kinetica_bi && npm run build              # exits 0
cd kinetica_bi/server && npm test -- --run   # 210 passed, 0 failed
```

## Resolution
When all 7 pass, update this file's frontmatter to `status: passed` and the date. If any fail, file specific issues against Plan 03-04 (or open a 3.1 gap-closure phase via /gsd:plan-phase 3 --gaps after running /gsd:verify-work 3).

---

# Phase 3 Plan 06 — ADMN-04 Manual Smoke (Deferred)

These 9 steps verify ADMN-04: server boots and serves authenticated Kinetica-backed routes with `KINETICA_USERNAME` and `KINETICA_PASSWORD` UNSET. Deferred at the checkpoint per user decision. Run before milestone close, or via /gsd:verify-work 3.

The user's local `.env` (gitignored) contains the env vars for normal dev use. These steps require unsetting them in the shell environment that launches the server (does NOT require editing .env).

## Step 1 — Stop running backend
Stop any backend dev server already running (Ctrl+C, or `pkill -f tsx`).

## Step 2 — Unset env vars in shell
```bash
unset KINETICA_USERNAME KINETICA_PASSWORD
env | grep -E 'KINETICA_USERNAME|KINETICA_PASSWORD'
```
Expected: no output.

## Step 3 — Start server with env vars unset
Two options:
- Compiled: `cd kinetica_bi/server && npm run build && node dist/index.js`
- Dev (preferred for live testing): `cd kinetica_bi/server && env -u KINETICA_USERNAME -u KINETICA_PASSWORD set -a && source .env && set +a && unset KINETICA_USERNAME KINETICA_PASSWORD && npm run dev`
- Or temporarily comment those two lines in .env then `npm run dev`

You also still need SESSION_ENCRYPTION_KEY and AUTH_SECRET set (these are not Phase 3's removal target).

## Step 4 — Boot log clean
Expected: `Kinetica BI backend running on http://localhost:4000` with NO error about missing env vars and NO `Missing KINETICA_USERNAME...` message.

## Step 5 — Health endpoint
```bash
curl -i http://localhost:4000/api/health
```
Expected: HTTP 200 + `{"status":"ok",...}`.

## Step 6 — Log in
```bash
curl -i -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<a real Kinetica user>","password":"<their password>"}'
```
Expected: HTTP 200 with `Set-Cookie: kbi_session=...`.

## Step 7 — Authenticated Kinetica route uses session creds
```bash
curl -i http://localhost:4000/api/kinetica/schemas \
  -b 'kbi_session=<token from step 6>'
```
Expected: HTTP 200 with `{"data":[...]}`. NOT 500 with missing-env-var error. NOT 401.

## Step 8 — SC#5 grep audit (mechanical)
```bash
git grep -nE 'KINETICA_USERNAME|KINETICA_PASSWORD' -- ':!.planning/'
```
Expected: no output (this can be run anytime; no server required).

## Step 9 — Stop server
Ctrl+C the dev server.

## Resolution
When all 9 steps pass, update this file's frontmatter to `status: passed` and the date. If any fail (e.g., step 7 returns 500 with Missing-env-var error), file the issue against Plan 03-06 or open a 3.1 gap-closure phase via /gsd:plan-phase 3 --gaps after running /gsd:verify-work 3.

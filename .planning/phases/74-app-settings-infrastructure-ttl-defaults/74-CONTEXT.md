# Phase 74: Env-Driven TTL Defaults - Context

**Gathered:** 2026-06-19
**Status:** Ready for planning

> ⚠️ **SCOPE PIVOT (2026-06-19):** During discussion the operator chose to **drop the app-settings DB store / admin UI / new permission entirely** and configure both TTL values via **environment variables** instead. This contradicts the original ROADMAP Phase 74 entry and SETTINGS-V115-01/02/03 as worded. ROADMAP.md + REQUIREMENTS.md + PROJECT.md milestone wording must be amended to match (see `<deferred>` / planner note below). Plan against THIS document, not the original roadmap text.

<domain>
## Phase Boundary

Make the materialized-view TTL and the keep-alive lead-time **deploy-time configurable via environment variables**, replacing the hardcoded `TTL = 5` across the materialize endpoints, and expose the keep-alive lead value to the client so Phase 78 can consume it.

**This phase delivers:**
- A boot-captured `DEFAULT_VIEW_TTL_MINUTES` const (default `5`) that drives the `ttl` + `expiresAt` at **all three** materialize sites.
- A boot-captured `TTL_KEEPALIVE_LEAD_MINUTES` const (default `1`), exposed to the client via the existing `/api/me` bootstrap for Phase 78 to read.

**Explicitly NOT in this phase (descoped by the pivot):**
- ❌ `app_settings` SQLite table + DDL
- ❌ GET / PATCH settings endpoints
- ❌ the `app:manage_settings` permission (catalog + seed + web byte-parity mirror)
- ❌ the admin-only Settings UI page + form/save/validation UX
- ❌ runtime (no-restart) editing of these values

</domain>

<decisions>
## Implementation Decisions

### Configuration mechanism
- **Environment variables, not a runtime store.** Both values are read once at boot and captured as module consts, following the existing `AUTH_MODE` / `APP_ADMIN_USERNAME` pattern and the `ARCHITECTURE.md` AP-5 rule ("never re-read `process.env` after boot").
- Changing a value is a **deploy-time action** (edit env + restart the container). Runtime admin editing is explicitly NOT a goal — confirmed acceptable by the operator.
- Env var names (confirmed): **`DEFAULT_VIEW_TTL_MINUTES`** (default `5`) and **`TTL_KEEPALIVE_LEAD_MINUTES`** (default `1`). SCREAMING_SNAKE + unit suffix, matching existing vars.

### TTL replacement scope
- The configured TTL applies to **all THREE** materialize sites — not just the two named in the original roadmap:
  - `index.ts:1053` — filter-materialize (table path)
  - `index.ts:1716` — dynamic-view materialize
  - **`index.ts:967` — filter-applied-to-a-dynamic-view** (the branch the roadmap's "both endpoints" wording missed; also returns its own `expiresAt`)
- Each site uses the boot-captured const for both the `ttl:` arg to `createOrReplaceMaterialized` AND the `Date.now() + ttl*60*1000` `expiresAt` it returns. Leaving any site on hardcoded `5` would produce inconsistent expiry behavior — that is the bug this closes.

### Apply semantics
- **New views only.** Changing `DEFAULT_VIEW_TTL_MINUTES` affects newly created views; existing live Kinetica materialized views keep their original TTL until they expire/refresh. No retroactive re-TTL / ALTER of live views. (Phase 78's keep-alive will refresh existing views with the current value naturally.)

### Invalid value handling
- **Fall back to default + log a boot warning.** If an env var is missing, non-numeric, zero, or negative → use the built-in default (`5` / `1`) and emit a warning. Resilient: a deploy typo cannot take the app down. (Deliberately NOT fail-fast like `AUTH_MODE` — TTL is a non-critical tuning knob.)

### Client exposure
- Expose **only `ttlKeepaliveLeadMinutes`** to the client, added top-level to the existing `GET /api/me` response (mirrors how `authMode` is surfaced there). Phase 78 reads it from there.
- `default_view_ttl_minutes` is NOT exposed separately — the client already receives per-view `expiresAt` directly from each materialize response, so it needs nothing more for expiry tracking.

### Claude's Discretion
- Exact validation/parse helper shape (e.g. a small `readPositiveIntEnv(name, default)` util vs inline parsing).
- Precise wording of the boot warning log line.
- Whether the two consts live in `index.ts` boot block alongside `authMode` or in a tiny config module — pick whatever matches existing convention best.

</decisions>

<specifics>
## Specific Ideas

- Operator's framing: "Setting this TTL limit as an application-level state that can be changed seems very complicated. Maybe we set it as an environment variable — that way it's only done once and makes things much simpler."
- Follow the `authMode` precedent end-to-end: boot-captured const on the server, surfaced top-level on `/api/me` for the client.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Env-var config + boot pattern
- `.planning/codebase/ARCHITECTURE.md` — AP-5: env vars are captured at boot and never re-read from `process.env` afterward. Both TTL consts must follow this.
- `packages/server/src/index.ts:136` — `AUTH_MODE` boot-capture + validation pattern to mirror (capture once, validate, fall back / throw).
- `packages/server/src/index.ts:348` — `GET /api/me` response shape; add `ttlKeepaliveLeadMinutes` top-level here next to `authMode`.

### TTL replacement sites
- `packages/server/src/lib/materializedView.ts:35` — `createOrReplaceMaterialized` helper; emits `USING TABLE PROPERTIES (TTL = ${ttl})`. The `ttl` arg is where the configured value flows in.
- `packages/server/src/index.ts:967` — filter-on-dynamic-view materialize (`ttl: 5`, `dvExpiresAt`).
- `packages/server/src/index.ts:1053` — filter-materialize table path (`ttl: 5`, `expiresAt`).
- `packages/server/src/index.ts:1716` — dynamic-view materialize (`ttl: 5`, `expires_at`).

### Affected planning docs (must be amended to match this pivot)
- `.planning/ROADMAP.md` — Phase 74 entry (currently describes the DB store / endpoints / permission / UI approach).
- `.planning/REQUIREMENTS.md` — SETTINGS-V115-01/02/03 (currently require store + UI + permission).
- `.planning/PROJECT.md` §"Current Milestone" lines 13, 20, 26, 28 — "admin-configurable defaults" / "admin settings store" wording.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`AUTH_MODE` boot pattern (`index.ts:136`)**: read `process.env`, validate, capture as const — exact template for both TTL consts.
- **`GET /api/me` (`index.ts:348`)**: already returns `authMode` top-level to the client; add `ttlKeepaliveLeadMinutes` the same way (and `GET /api/auth/config:357` is the unauthenticated sibling if ever needed).
- **`createOrReplaceMaterialized` (`materializedView.ts`)**: single helper already takes `ttl` as an arg — no signature change needed, just pass the const at each call site.

### Established Patterns
- Env-driven deploy config is the norm here (`KINETICA_URL`, `AUTH_SECRET`, `DB_PATH`, `AUTH_MODE`, OIDC vars). TTL config joins that family cleanly.
- AP-5: capture env at boot, never re-read — so a value change requires a restart (consistent with the deploy-time decision).

### Integration Points
- Server boot block (`index.ts` ~line 118–145) — where the two consts are captured/validated.
- Three materialize call sites (`:967`, `:1053`, `:1716`) — swap `ttl: 5` and the `expiresAt` arithmetic for the const.
- `GET /api/me` response — one added field for the client.
- Phase 78 (keep-alive) is the downstream consumer of `ttlKeepaliveLeadMinutes` from `/api/me`.

</code_context>

<deferred>
## Deferred Ideas

- **Runtime admin-editable app-settings store + UI + `app:manage_settings` permission** — the original Phase 74 vision. Deferred indefinitely (operator chose env vars). If a future milestone genuinely needs runtime-tunable settings, this is the place to revisit; the env-var approach does not preclude adding a store later.
- **PLANNER ACTION (not deferred — do before/with planning):** amend `ROADMAP.md` Phase 74, `REQUIREMENTS.md` SETTINGS-V115-01/02/03, and `PROJECT.md` milestone wording so they describe the env-var approach. Leaving them as-is will mislead the planner and verifier (they read those docs alongside this one).

</deferred>

---

*Phase: 74-app-settings-infrastructure-ttl-defaults*
*Context gathered: 2026-06-19*

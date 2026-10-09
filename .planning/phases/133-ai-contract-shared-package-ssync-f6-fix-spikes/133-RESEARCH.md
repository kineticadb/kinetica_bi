# Phase 133: AI Contract, Shared Package, SSYNC-F6 Fix & Spikes - Research

**Researched:** 2026-10-09
**Domain:** server SQL-identifier hardening, npm-workspace shared TS package (web Vite + server Express/esbuild), env-config parsing, Kinetica capability spikes
**Confidence:** HIGH for audit / packaging / env (read code, packaging verified empirically in a scratch workspace); MEDIUM for spike outcomes (S1/S2/S7 need live Kinetica; S3 prediction from registry read)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01** Check filter columns against the **registered snapshot** (`tables.columns`, kept current by Schema Sync) — no extra Kinetica call on the drill path. A column added in Kinetica but not yet synced is rejected until Schema Sync is applied (acceptable, by operator choice).
- **D-02** A filter/drill on a column that does not exist is **rejected with a clear error naming the column and table** (e.g. `Column "region" no longer exists on fleet.trips`); nothing is applied, no SQL executed. Not skip-and-warn.
- **D-03** Reach: **audit and fix all** server routes that interpolate client-supplied column names into SQL, not only `POST /api/filter/materialize`. Produce a caller inventory in the style of v1.26's `127-CALLER-AUDIT.md` (`133-COLUMN-AUDIT.md`), classify each site, and guard every one that takes client column names. Sites that only use server-derived names are recorded as such.
- **D-04** The guard must be shown to discriminate: the rejection test fails (SQL reaches Kinetica / interpolated) before the fix and passes after.
- **D-05** AI is off unless `AI_ENABLED=true`. With AI off, behaviour is byte-identical to today.
- **D-06** `AI_ENABLED=true` with invalid settings (missing key where required, unknown provider, malformed URL, bad numbers) -> the **app starts normally with AI disabled** and the server log shows a loud, specific error. It must NOT exit the process (unlike `SESSION_ENCRYPTION_KEY`). -> Roadmap 133 criterion 2 reworded accordingly.
- **D-07** Startup validates **format only** — no live call to the provider. A wrong key surfaces later as a clear "provider rejected the key" error (Phase 135/137).
- **D-08** AI status is reported in the **server log only** in this phase (no admin UI, no status in an endpoint yet).
- **D-09** Provider selection is **generic**: `AI_PROVIDER=openai-compatible|claude`, with `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`. No Gemini/Ollama-specific code; `packages/server/.env.example` carries copy-paste examples for **Gemini** (`https://generativelanguage.googleapis.com/v1beta/openai/`) and **Ollama** (`http://localhost:11434/v1`, no key). Other `AI_*` vars from research (`AI_DATA_ACCESS`, `AI_MAX_TOOL_STEPS`, `AI_TIMEOUT_MS`, caps) may be parsed here or in 135 — planner's call, but defaults must be safe (`AI_DATA_ACCESS=schema`).
- **D-10** The API key never appears in logs or error messages (log "AI_API_KEY is missing", never its value).
- **D-11 S2 (streaming):** spike against `:4000` only in this phase; the real deploy-proxy check (docker nginx `:8080`, `docker/nginx.conf` has `gzip on` and no `proxy_buffering off`) is **deferred to Phase 137**. Record the expected nginx change as a finding.
- **D-12 S7 (Kinetica capabilities):** the operator **has a non-admin Kinetica user** — test as that user: can it create the views the AI flow needs, statement timeouts, any read-only enforcement. Admin-only results are not sufficient.
- **D-13 S1 (session-only dynamic views):** if a dv cannot be materialized without a `dashboard_dynamic_views` row, the accepted fallback is **"AI dynamic views go live only after Keep"** (proposed in-session, materialized on Keep). Draft rows are NOT the fallback. If S1 fails, AIACT-V20-07 must be reworded at the checkpoint — flag it explicitly.
- **D-14 S3 (per-type validators):** decide whether zod validators can be derived from the widget registry for all types; fallback is a named subset of widget types for v2.0 — the subset is presented at the checkpoint.
- **D-15 Gate:** write `133-SPIKES.md` (per spike: question, method, result, decision, fallback, consequence for later phases) and **stop at a `checkpoint:human-verify` for operator approval** before Phases 134/135 start.

### Claude's Discretion
- How dynamic-view filter columns are checked (e.g. the dv's materialized column list read from Kinetica at materialize time vs its definition) — must still reject unknown columns with the D-02 error.
- `packages/shared` structure, build/tooling, and how web/server consume it (workspace package; note the Dockerfile copies each package's `package.json` explicitly in both stages — the new package must be added there).
- Exact env var parsing module layout and log format.
- Error status codes (400 vs 422) as long as the message is clear and consistent across routes.

### Deferred Ideas (OUT OF SCOPE)
- Admin-visible AI status (`/api/ai/config` reporting enabled/disabled + reason) — Phase 135 may add it; not in 133.
- Deploy-proxy streaming verification and nginx change — Phase 137.
- Live provider key check — surfaces on first use (135/137), never at boot.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| AISAFE-V20-01 | `POST /api/filter/materialize` rejects any column that does not exist on the target table or view (closes SSYNC-F6) | Column audit (sec. "Column-Interpolation Audit"): 4 sites need an existence guard, 3 a structural guard; shared `assertColumnsExist` helper design; dv column-source options; 7 existing spec fixtures with `columns: {}` must be re-seeded |
| AIPRV-V20-01 | Admin sets provider/endpoint/model/key through env; AI off by default; app unchanged without it | `parseAiConfig(env)` pure-function design (never exits, never echoes key, testable without dev `.env`); `.env.example` block; `tests/setup.ts` leak guard |
</phase_requirements>

## Summary

The SSYNC-F6 hole is wider than the one route named in CONTEXT. `whereClause.ts:14-21` and `spatialQuery.ts:21-27` both document a trust boundary ("column names originate from server-side table metadata") that is **false in the shipped code**: `ActiveFilter.column`, `SpatialTarget.lonCol/latCol/spatialCol`, `spatialColumns.*`, and `/api/quantile|top-values|column-stats` `{schema,table,column}` all come straight from the request body and are interpolated unquoted. Exports validate the *shape* (`EXPORT_IDENT_RE`, `lib/exportSql.ts:30`) but never existence. The guard that fits D-01 is a single pure helper (`assertColumnsExist(snapshot, columns) -> {column, table}` error) fed by `getTable(tableId).columns`, applied at: filter/materialize table path, the spatial target on the same route, exports, and info/query. The dv branch has no registered snapshot (`dashboard_dynamic_views.columns_json` is *client-asserted* at save time, `index.ts:1753-1768`, and nullable), so it needs a server-derived list (probe of the dv's materialized view). Quantile / top-values / column-stats address arbitrary tables *and* views by name with no `tableId`, so they get a structural identifier guard plus snapshot membership when `(schema,table)` is a registered table.

`packages/shared` should be a **TypeScript-source workspace package** (`main: src/index.ts`, no build step). I verified in a scratch workspace that this works for: server `tsc --noEmit` (no TS6059 rootDir error, dist layout unchanged), `tsx` (dev watch), vitest on both web and server, and the Docker esbuild bundle **only if** the esbuild command gets `--alias:@kinetica-bi/shared=./packages/shared/src/index.ts` — with the current `--packages=external` alone the import stays external and the runtime image (which copies only `node_modules` + the bundle) would crash at boot. `zod` must then be a real `dependency` of the server (stays external at runtime).

AI env config is a pure `parseAiConfig(env)` returning a discriminated result; the single boot call logs once and never exits. Spikes: S3 and S2 and the code half of S1 are autonomous; the live halves of S1 and all of S7 need the operator at a terminal with Kinetica creds. Strong S3 prediction: **8 of 16 widget types have `fields: []` + a CustomConfigPanel**, and data-binding keys (metric, aggregation, groupBy, tableRef/tableId) are not in `fields[]` for any type, so "derive for all types" will almost certainly fail and the named-subset fallback applies.

**Primary recommendation:** Build `assertColumnsExist` first (red test before, green after), TS-source `packages/shared` with the esbuild `--alias` fix and `zod` as server dependency, `parseAiConfig(env)` as a pure module, and run S3 + S2 + S1-code autonomously while scheduling one operator session for S1-live + S7.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | `^3.25.76` (root `node_modules` resolves 3.25.76; npm latest is 4.6.5 - do NOT jump) | AiOp / WidgetAction contract in `packages/shared`; server request validation | Web already on it; one hoisted copy; `zod/v4` subpath exists if ever needed |
| TypeScript source package (no build) | - | `packages/shared` consumed as source via workspace symlink | Verified scratch: server tsc, tsx, vitest (web+server), esbuild alias all pass |
| esbuild (already in root node_modules, used by Dockerfile) | existing | bundle server + shared into `dist/index.js` | Dockerfile already uses it; needs `--alias` |
| vitest `^4.1.5` | existing | shared package specs (node env) | same as web/server |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| `dotenv` (existing) | `.env` loading in `src/env.ts` | untouched; AI parser takes an explicit env object so it never depends on it |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| TS-source shared | built `dist` + project references | dev needs a watch/build step before `tsx watch` sees changes; more Dockerfile surface. Not worth it. |
| zod 3 | zod 4 | would force a web migration; out of scope |
| `--alias` in esbuild | `--packages=external` with `--external` exceptions | alias inlines shared, verified (see Pitfall 2) |

**Installation:**
```bash
# from repo root; creates packages/shared and updates package-lock.json (commit the lockfile)
npm install zod@^3.25.76 --workspace @kinetica-bi/server
npm install zod@^3.25.76 --workspace @kinetica-bi/shared   # after packages/shared/package.json exists
```
**Version verification:** `npm view zod version` -> 4.6.5 (latest) vs installed `node_modules/zod` 3.25.76; stay on `^3.25.76` (matches `packages/web/package.json`).

## Architecture Patterns

### Recommended Project Structure
```
packages/shared/
├── package.json            # name @kinetica-bi/shared, private, type module, main+types: src/index.ts, deps: zod
├── tsconfig.json           # strict, noEmit, moduleResolution Node (mirror server) - used by `tsc --noEmit` only
├── vitest.config.ts        # environment node, include src/**/*.spec.ts
└── src/
    ├── index.ts            # SINGLE barrel (server uses moduleResolution Node => `exports` subpaths are ignored)
    ├── widgetAction.ts     # moved from web (TARGET_KINDS, schemas, result types)
    ├── actionAllowList.ts  # moved from web (ALLOW_LIST_VERSION -> "v3", validateActionPatch, getFieldLocation, ...)
    ├── aiOp.ts             # AiOpSchema discriminated union (minimal; see below)
    └── *.spec.ts           # moved widgetAction.spec / actionAllowList.spec + aiOp.spec
packages/web/src/lib/widgetAction.ts       # becomes `export * from "@kinetica-bi/shared"` shim (11 importers unchanged)
packages/web/src/lib/actionAllowList.ts    # same shim
packages/server/src/lib/columnGuard.ts     # assertColumnsExist, UnknownColumnError
packages/server/src/lib/aiConfig.ts        # parseAiConfig(env), loadAiConfig(), log formatter
packages/server/src/spikes/*.ts            # S1/S7/S2 scripts (house pattern: tsx + npm script)
```

### Pattern 1: Pure helper + typed error for the column guard
**What:** one pure function, no Express/Kinetica imports (mirrors `whereClause.ts` module purity), plus a typed error the routes map to a 400 body.
**Example (design, not shipped code):**
```typescript
// packages/server/src/lib/columnGuard.ts
export class UnknownColumnError extends Error {
  constructor(public readonly column: string, public readonly tableLabel: string) {
    super(`Column "${column}" no longer exists on ${tableLabel}`);   // D-02 copy
    this.name = "UnknownColumnError";
  }
}
/** snapshot = Table.columns (Record<name,type>) or a probed dv column list. Exact, case-sensitive match
 *  (snapshot keys ARE Kinetica's reported names). Own-property check - never `name in snapshot`
 *  ("constructor"/"__proto__" must not pass). */
export function assertColumnsExist(snapshot: Record<string, string>, columns: unknown[], tableLabel: string): void {
  for (const c of columns) {
    if (typeof c !== "string" || !Object.prototype.hasOwnProperty.call(snapshot, c)) {
      throw new UnknownColumnError(String(c), tableLabel);
    }
  }
}
```
Route maps it: `res.status(400).json({ error: e.message, code: "UNKNOWN_COLUMN", column, table })` (existing routes use 400 for validation; keep 400 everywhere, same body shape). Place the check **before** `composeWhereClause` / `createOrReplaceMaterialized` so no SQL is built or sent.

### Pattern 2: Pure env parser with injected env (never `process.env` inside)
```typescript
// packages/server/src/lib/aiConfig.ts (design)
export type AiConfig = { provider: "openai-compatible" | "claude"; baseUrl?: string; model: string;
  dataAccess: "schema" | "query"; maxToolSteps: number; timeoutMs: number; readonly apiKey?: string };
export type AiConfigResult =
  | { enabled: false; reason: "not_enabled" }
  | { enabled: false; reason: "invalid"; errors: string[] }     // D-06: boot continues
  | { enabled: true; config: AiConfig };
export function parseAiConfig(env: Record<string, string | undefined>): AiConfigResult { /* ... */ }
```
Rules: `""`/whitespace == unset (the `tests/setup.ts` pin-to-empty idiom depends on this). Only exact `true` (case-insensitive) enables; other non-empty values (e.g. `yes`) => off + one warn line "AI_ENABLED must be 'true'". Errors list **names and reasons only**: `AI_API_KEY is missing`, `AI_BASE_URL is not a valid http(s) URL`, `AI_PROVIDER must be 'openai-compatible' or 'claude'`, `AI_TIMEOUT_MS must be a positive integer`. Never interpolate raw values: Gemini keys are sometimes passed in URL query strings and a URL can carry userinfo, so even a "valid" `AI_BASE_URL` is logged as `new URL(x).origin` only. Make `apiKey` non-enumerable (or override `toJSON` / `util.inspect.custom`) so an accidental `console.log(config)` cannot leak it.
Boot wiring: one call in `createApp()` next to the `readPositiveIntEnv` block (`index.ts:186-234`): `const AI = parseAiConfig(process.env)`; log once **only when `AI_ENABLED` was set** (unset => silent => byte-identical logs, D-05). No `process.exit`, no throw. Export a `getAiConfig()` for Phase 135.

### Pattern 3: Shared-package consumption
- web/server import `from "@kinetica-bi/shared"` (bare specifier, workspace symlink in `node_modules/@kinetica-bi/`). Add `"@kinetica-bi/shared": "*"` to both packages' dependencies so npm links it and the lockfile records it.
- `applyWidgetAction.ts` **stays web-side** (imports `WidgetDto`/`DashboardLayerDto` from `../api/client`, writes the overlay store). `widgetActionStore.ts` stays web-side.
- Minimal `AiOp` for this phase (do not over-build; payloads `.strict()` so later phases extend deliberately): envelope `{ op: "patch" | "add_widget" | "remove_widget" | "add_layer" | "remove_layer" | "add_dynamic_view" | "remove_dynamic_view" | "apply_filter" | "clear_filter" }`. Concrete payloads now only where existing code defines them: `patch` -> `{action: WidgetActionSchema-with-nonzero-id}`; `add_widget` -> `{tempId: int negative, type: string, title: string, config: record}`; `remove_*` -> `{id: int}`; the rest -> `{tempId?/id?}` placeholder objects with a `// extended in Phase 13x` note. Success criterion 3 ("an invalid op is rejected by the shared schema") needs only that the union exists and rejects unknown `op`, positive `tempId`, extra keys.
- Allow-list v3 (minimal, deliberate): bump `ALLOW_LIST_VERSION` to `"v3"`; add an AI-path target schema that allows negative temp ids (`int().nonzero()`) **without** changing `WidgetActionTargetSchema` (web engine stays `positive()`); keep `PERMANENTLY_BLOCKED_KEYS` as is. Widening patchable fields belongs to 136. The existing spec asserts `"v2"` (`actionAllowList.spec.ts:24-25`) - update it in the same commit as the bump.
- Keep `actionEngineDecoupling.spec.ts` meaningful after the move: it greps `src/lib/widgetAction.ts` and `src/lib/actionAllowList.ts` by path (`ENGINE_MODULES`, lines ~38-43). Either keep the shims at those paths (grep passes trivially) **and** add the new `packages/shared/src/widgetAction.ts` / `actionAllowList.ts` paths to `ENGINE_MODULES`; do not let the list silently point at shims only.

### Anti-Patterns to Avoid
- **Quoting as the fix:** wrapping identifiers in quotes changes SQL bytes for every existing view/WMS name and does not satisfy D-02 (reject nonexistent). Membership check is the guard; quoting is out of scope.
- **`name in snapshot`:** matches `constructor`, `toString`. Use `hasOwnProperty`.
- **Trusting `columns_json` for dvs:** it is client-supplied at create/update (`index.ts:1753-1768`) and cleared on SQL edit (`db.ts:1347`); using it re-opens the hole.
- **Importing shared via relative path** (`../../shared/src/...`): breaks the workspace-package contract and the Docker alias.
- **A `process.exit` anywhere in `aiConfig.ts`:** violates D-06 (contrast `sessionStore.ts` SESSION_ENCRYPTION_KEY).

## Column-Interpolation Audit (seed for `133-COLUMN-AUDIT.md`)

**Method.** Read every `kineticaSqlHelper(`/`kineticaSql(` site and every SQL-builder in `packages/server/src` (127-CALLER-AUDIT style). Line numbers are at branch `feat/ai-driven-dashboards` HEAD `8a56eb2`. "Snapshot" = `getTable(id).columns` (`Record<string,string>`, `db.ts:667`, written by Schema Sync `setTableSchemaSnapshot` `db.ts:745`). Re-grep before writing the final doc.

**Legend:** CLIENT-COL = client-supplied name interpolated unquoted. SERVER-DERIVED = from server state only. FREE-SQL = whole statement/fragment is client/designer text by design (Kinetica per-user creds are the boundary). Guard tier: **A** = existence check against snapshot/probe; **B** = structural identifier check (no registered anchor); **C** = record only.

| # | File:line | Route / builder | Where name comes from | Current guard | Snapshot available | Class / Tier |
|---|---|---|---|---|---|---|
| 1 | `lib/whereClause.ts:110,120,124,131,134,137,140,144` via `index.ts:1446` (`composeWhereClause`) | POST /api/filter/materialize **table path** (`index.ts:1289`) | `body.filters[].column` (`ActiveFilter.column`, `index.ts:1297`) - no type check at all (non-strings stringify) | none; header comment `whereClause.ts:14-21` claims server metadata (false) | YES: `getTable(tableId)` at `index.ts:1427` (already loaded; `table.columns`) | CLIENT-COL, **A** (the SSYNC-F6 core) |
| 2 | `lib/spatialWhereClause.ts:155,158` via `index.ts:1446` | same route, spatial block | `body.spatialTarget.lonCol/latCol/spatialCol` | none (comment `spatialWhereClause.ts:21-27` claims admin-trusted); only presence/mode coherence (`:140-150`) | YES (same `table`); also `spatialTarget.tableId === tableId` already enforced `index.ts:1420-1424` | CLIENT-COL, **A** |
| 3 | `lib/whereClause.ts` via `index.ts:1366` | same route, **dv path** (`index.ts:1331-1381`) | `body.filters[].column` | none | NO registered snapshot. `dvRow.columns_json` exists but is client-asserted/nullable (see anti-patterns) | CLIENT-COL, **A** (needs dv column source; see below) |
| 4 | `lib/exportSql.ts:101-105,110,142,159-170,207-230` (`buildExportPlan`) called from `exportRoutes.ts:54-` -> `lib/exportRunner.ts:237` | POST /api/exports | `spec.filters[].column`, `spec.sortField`, `spatialTarget.*Col` from body; `cfg.columns`, `cfg.sortField` from saved widget config | **shape only**: `EXPORT_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/` (`exportSql.ts:30`) on filter cols, sort, spatial cols, columns list. No existence check. Table path has `getTable(cfg.tableId)` available (`exportSql.ts:130-131`), dv path doesn't | YES for table path (`row` from `getTable`) - note `getTable` DTO in this lib is `{name, schema}` typed; widen to include `columns` | CLIENT-COL, **A** on table path, **B-kept** on dv path (regex already present; add dv probe if the dv list is built) |
| 5 | `lib/spatialQuery.ts:100,117,147` via `index.ts:2358,2369,2370,2417` | POST /api/info/query (`index.ts:2260`) | `body.spatialColumns.lonCol/latCol/wktCol/wkbCol`; `body.schema`, `body.table`, `body.viewName` (!) | `typeof === "string"` only. `tableRow = getTable(body.tableId)` at `:2314` is used **only as a 404 guard** - `body.schema/table` are NOT compared to it | YES: `tableRow.columns`; schema/table can be taken from `tableRow` instead of body | CLIENT-COL **and** CLIENT-TABLE, **A** for columns; also pin `schema/table` to `tableRow` (viewName: see #9) |
| 6 | `lib/quantileSql.ts` (`buildQuantileSql`) via `index.ts:1574` | POST /api/quantile (`index.ts:1535`) | `body.schema`, `body.table`, `body.column` | non-empty string only | NO `tableId`; table may be a registered table OR a dv/filter view name with `schema=""` | CLIENT-COL + CLIENT-TABLE, **B** (+ **A** when `(schema,table)` matches a registered table) |
| 7 | `lib/topValuesSql.ts` via `index.ts:1625` | POST /api/top-values (`index.ts:1589`) | same | same | same | **B** (+A) |
| 8 | `lib/columnStatsSql.ts` via `index.ts:1657` | POST /api/column-stats (`index.ts:1639`) | same | same | same | **B** (+A) |
| 9 | `index.ts:1491-1493` then `:1522` | DELETE /api/filter/materialize `?viewName=` direct-drop branch (COMBO-V118-04) | `req.query.viewName` interpolated into `DROP TABLE IF EXISTS` | none. Comment claims "no new injection surface" - false: any table name the user can drop is droppable | n/a (not a column) | **ADJACENT FINDING** (not a column site). Recommend restricting to `^_kbi_filt_u<sanitizeForViewName(username)>_` prefix in this phase; flag to planner as scope add |
| 10 | `index.ts:2930` | POST /api/sql | whole statement | none by design | n/a | FREE-SQL, **C** (note for Phase 140: this is the model-must-never-reach surface) |
| 11 | `index.ts:1901` (preview), `lib/dynamicViewSql.ts` | POST /api/dynamic-view/preview (auth-only) | `body.template_sql` | `{view}` token only | n/a | FREE-SQL, **C** |
| 12 | `index.ts:2011-2160` | POST /api/dynamic-view/materialize | stored `row.template_sql`; names from `buildDynamicViewName/buildFilterViewName` | server-derived names | n/a | SERVER-DERIVED + stored FREE-SQL, **C** |
| 13 | `index.ts:1187-1195` | POST /api/views/:id/materialize | stored `view.filter_clause`, `view.view_name` | RBAC `DASHBOARDS_EDIT` | n/a | stored FREE-SQL, **C** |
| 14 | `lib/exportSql.ts:145-150` | export `cfg.customWhere` | saved widget config text | none (designer-authored) | n/a | FREE-SQL, **C**. **Flag for 136:** `customWhere` is a registry `textarea` field in 8+ types; the AI allow-list must keep it out |
| 15 | `index.ts:2846,2859` | GET /api/kinetica/schemas/:schema/tables[/:table/columns] | path params in string literals | `.replace(/'/g, "''")` escaping (literal context, correct) | n/a | SERVER-ESCAPED literal, **C** |
| 16 | `index.ts:2893` | GET /api/wms | raw query string forwarded to Kinetica WMS | none (not app-built SQL; Kinetica enforces) | n/a | passthrough, **C** |
| 17 | `index.ts:1366`-area `DELETE` table/dv branches, `:1523`, `:2163-2200` | DROP of names from `buildFilterViewName/buildDynamicViewName` | server-derived | n/a | n/a | SERVER-DERIVED, **C** |

**Framing for the planner:** because `/api/sql` is already a deliberate raw passthrough executed with the *user's own* Kinetica credentials (`index.ts:2930`), today's unguarded interpolation is not a privilege escalation. The reason it must close **now** is that AI-supplied (hallucinated or prompt-injected) columns will flow through exactly these routes (AISAFE-V20-01, PITFALLS C1/C5/C6) and stale/renamed columns should produce a clear 400 instead of a raw Kinetica error. Per CLAUDE.md, the audit doc's own acceptance criteria must be runnable red-before (see Validation).

**Recommended guard tiers (Claude's discretion area):**
- **Tier A sites (1, 2, 4-table, 5):** `assertColumnsExist(table.columns, cols, "<schema>.<name>")`, label exactly as D-02 (`fleet.trips`; if `schema` is empty use bare `name`). Empty snapshot (`columns: {}`) => every column is "missing"; surface the same error. Message hint "run Schema Sync" is allowed in addition but the D-02 sentence must be intact.
- **dv path (3), and dv export:** do **not** trust `columns_json`. Recommended source: probe the dv's own materialized view column names, cached in-process per `(viewName)` for the TTL window. Reuse the existing pattern that already decodes `column_headers` from `SELECT * FROM <view> LIMIT n` (`index.ts:1953-1960`, preview) - spike S1 must confirm `LIMIT 0` still returns `column_headers`; if not use `LIMIT 1`. Alternative: `INFORMATION_SCHEMA.COLUMNS` by view name (the same query already used at `index.ts:2859`). Session-only/ad-hoc AI dvs (Phase 139) have a better source: the server-compiled structured spec's output column list - design the helper to accept any `Record<string,string>` or `string[]`.
- **Tier B (6-8):** `^[A-Za-z_][A-Za-z0-9_]*$` (schema and table also allow `.`-free segments) on `column`, `table`, `schema`, `"" ` allowed for schema; plus Tier-A membership when `(schema,table)` resolves to a registered table (`getTables()` scan; cheap, SQLite). Views (`_kbi_dv_*`, `_kbi_filt_*`) pass on the identifier check only. Flag the residual (a view column is not membership-checked) in the audit as accepted, with the dv probe as the future closer.
- **Error status:** 400 with `{ error, code: "UNKNOWN_COLUMN", column, table }`; consistent across routes. Web client already surfaces `error` strings.

**Test-fixture ripple (important, verified):** 7 existing route specs seed `createTable({ ..., columns: {} })` and then post real column names - `routes.filter-materialize{,-dv,-combo,-spatial}.spec.ts`, `routes.info-query.spec.ts`, plus `routes.dynamic-view*.spec.ts` (count `columns: {}` = 1 each) and export specs (`routes.exports*.spec.ts`, `lib.exportRunner*.spec.ts` each call `createTable(` once). After the guard, those fail for the *wrong* reason. Plan order: (1) write the new rejection specs against **unmodified** code and record them red; (2) land the guard; (3) re-seed fixtures with the columns each spec actually uses. Filters used today include `zone`, `name`, `x`, `region`, `fare` (`routes.filter-materialize.spec.ts:157-409`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Op/contract validation | hand-written `typeof` ladders | zod discriminated union in `packages/shared` | one source for server gateway, client apply, Keep |
| "Does column exist" | regex-only identifier checks | snapshot membership (`hasOwnProperty`) | a syntactically valid name can still be hallucinated |
| Env parsing | ad-hoc `process.env.X` reads scattered in routes | one pure `parseAiConfig(env)` | testable, redaction in one place |
| Bundling shared into server | copying shared into runtime image / dist | esbuild `--alias` | verified inlines shared, keeps `zod` external |
| Streaming SSE framing library | any SSE npm package | ~60 lines of `res.write("data: ...\n\n")` (STACK.md decision) | already decided; spike S2 validates it |

**Key insight:** the existing identifier/value escaping split (values escaped via `escapeKineticaStringLiteral`, identifiers trusted) is the actual root cause; the fix is making identifier trust *earned* (membership) instead of assumed.

## Common Pitfalls

### Pitfall 1: Guard passes tests for the wrong reason
**What goes wrong:** fixtures with `columns: {}` make every valid request fail after the guard; executors "fix" it by loosening the guard (e.g. skip when snapshot empty), reopening the hole.
**How to avoid:** the rejection spec must assert (a) status 400, (b) body names column and table, (c) `fetch` mock has **zero** `/execute/sql` calls (see `vi.stubGlobal("fetch", ...)` pattern in `routes.filter-materialize.spec.ts`). Empty snapshot is *rejected* (D-02), fixtures are fixed, not the guard.

### Pitfall 2: Docker runtime crashes on `@kinetica-bi/shared`
**What goes wrong:** `esbuild ... --packages=external` (Dockerfile line 13) leaves the shared import as a bare specifier. Verified in scratch: output keeps `import { A } from "@kinetica-bi/shared"`. The runtime stage copies only `node_modules` (from `proddeps`) and `dist`; the workspace symlink there dangles (precedent: `@kinetica-bi/web` already dangles) => `ERR_MODULE_NOT_FOUND` at boot.
**How to avoid:** add `--alias:@kinetica-bi/shared=./packages/shared/src/index.ts` to the esbuild command (verified: shared inlined, `import { z } from "zod"` stays external). Add `zod` to `packages/server/package.json` `dependencies` so `npm ci --omit=dev` installs it. Verification: `docker build` + `docker run ... node -e` boot smoke, or locally run the same esbuild command and `grep -c '@kinetica-bi/shared' packages/server/dist/index.js` must be **0** (currently the bundle has no such string, so the check must be paired with an import actually existing - run it after the first server import lands).
**Also:** README documents `npm run build:server` (tsc) then `npm start` (`node dist/index.js`) at `README.md:127-128`. tsc does **not** emit the shared TS source, so that flow breaks at runtime. Recommend changing `packages/server` `build` to `tsc --noEmit && esbuild ... --alias ...` (same command as Dockerfile) and having the Dockerfile call `npm run build:server`-equivalent, or update the README. Planner decision (Open Question 2).

### Pitfall 3: Dockerfile `npm ci` lock mismatch
Both `build` (line 5-8) and `proddeps` (line 17-20) stages copy each workspace `package.json` before `npm ci`. Add `COPY packages/shared/package.json ./packages/shared/` to **both**. The final `server` runtime stage only copies the server package.json; no shared copy is needed once bundled (dangling symlink precedent). `package-lock.json` must be regenerated and committed or `npm ci` fails.

### Pitfall 4: tsc rootDir / dist layout
Verified scratch: with `rootDir: "src"` and `main: src/index.ts` in the symlinked package, `tsc` reports **no** TS6059 and emits only `dist/index.js` (no layout change). Do **not** add `include: ["../shared"]` or remove `rootDir` - that would move `dist/index.js` to `dist/server/src/index.js` and break `start`.

### Pitfall 5: `actionEngineDecoupling.spec.ts` reads sources by path
It `fs.readFileSync`s `src/lib/widgetAction.ts`, `src/lib/actionAllowList.ts` (`ENGINE_MODULES`). A `git mv` without updating the list throws ENOENT; shims make it pass vacuously. Add the shared paths explicitly. `applyWidgetAction.spec.ts:594-642` also reads `docs/mcp-action-seam.md` and greps `applyWidgetAction.ts` for the pointer comment - leave both in place; update the doc's `"v2"` literal (`docs/mcp-action-seam.md:80`) when bumping to v3 (the doc test only requires the string `ALLOW_LIST_VERSION`).

### Pitfall 6: Dev `.env` leaks AI vars into server vitest
`env.ts` runs `dotenv.config()` at import; dotenv does not override keys already in `process.env` (the comment in `tests/setup.ts:27-29` relies on this). A developer with `AI_ENABLED=true` + a real Gemini key would otherwise make boot specs log/enable AI. **Fix:** add `process.env.AI_ENABLED = ""` and blank `AI_PROVIDER/AI_BASE_URL/AI_MODEL/AI_API_KEY/AI_DATA_ACCESS/AI_MAX_TOOL_STEPS/AI_TIMEOUT_MS` to `tests/setup.ts`; unit-test `parseAiConfig` with explicit objects (no env at all); createApp-level tests use `vi.stubEnv`. Also keep the key out of test output: assert a sentinel (`"sk-test-SENTINEL"`) never appears in captured `console.*` output.

### Pitfall 7: STACK.md vs CONTEXT.md provider names
`research/STACK.md:38` says `AI_PROVIDER=anthropic`; D-09 says `claude`. CONTEXT wins: accept exactly `openai-compatible` and `claude`; reject `anthropic` with a specific message ("did you mean 'claude'?" is fine, no value echo needed).

### Pitfall 8: AI-path allow-list must exclude raw-SQL config
Registry `fields[]` includes `customWhere` (`textarea`, "Raw SQL predicate", e.g. `definitions/bar.ts:35`) on bar/line/pie/scatter/table/bignumber/heatmap/records. Any validator derived from the registry (S3) and any v3 allow-list must treat `customWhere` as **blocked** for AI ops (AISAFE-V20-04: the model never submits raw SQL), and `type: "color"` fields as theme-token-only (CLAUDE.md no-hex; `bar.ts` default is a hex).

## Code Examples

### esbuild command (Dockerfile + server build script)
```bash
# Source: verified in scratch workspace 2026-10-09 (alias inlines shared; zod/express stay external)
npx esbuild packages/server/src/index.ts --bundle --platform=node --format=esm --target=node20 \
  --packages=external --alias:@kinetica-bi/shared=./packages/shared/src/index.ts \
  --outfile=packages/server/dist/index.js
```

### shared package.json
```json
{
  "name": "@kinetica-bi/shared",
  "version": "1.23.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest --run", "typecheck": "tsc --noEmit" },
  "dependencies": { "zod": "^3.25.76" }
}
```
(Version string mirrors the other packages, `1.23.0`.) Root `package.json` already globs `packages/*`; add `"test:shared": "npm run test --workspace @kinetica-bi/shared"` and fold into `test:all`. CI (`.github/workflows/ci.yml`) has only `web` and `server` jobs - add a `shared` job (tsc + vitest) or the contract specs never run in CI.

### Guard call site (table path, design)
```typescript
// index.ts, after `const table = getTable(tableId)` (~:1427), BEFORE composeWhereClause (:1446)
const tableLabel = table.schema ? `${table.schema}.${table.name}` : table.name;
try {
  assertColumnsExist(table.columns, [
    ...filtersArr.map((f) => f.column),
    ...(spatialTarget ? [spatialTarget.lonCol, spatialTarget.latCol, spatialTarget.spatialCol].filter((c) => c !== undefined) : []),
  ], tableLabel);
} catch (e) {
  if (e instanceof UnknownColumnError) return res.status(400).json({ error: e.message, code: "UNKNOWN_COLUMN", column: e.column, table: tableLabel });
  throw e;
}
```
Note the WKB 501 early-return (`:1410`) and spatialTarget.tableId check stay ahead of it.

## Spike Designs (planner converts to tasks; all results go in `133-SPIKES.md` per D-15)

`133-SPIKES.md` per-spike template: **Question / Method / Result (verbatim evidence: command + output excerpt) / Decision / Fallback / Consequence for later phases / Confidence**. House pattern for live spikes: standalone `packages/server/src/spikes/<name>Spike.ts` run with `tsx` + an npm script (see `package.json` `*-spike` scripts, `schemaFingerprintSpike.ts` header for the env-var convention). **Executor sessions cannot discover or guess credentials** (precedent in `schemaFingerprintSpike.ts` header: sandboxed agents are denied credential discovery) - live parts are operator-run, output pasted back.

| Spike | Autonomous? | Needs operator |
|---|---|---|
| S3 per-type validators | **Yes, fully** (web registry read + vitest) | only the checkpoint review |
| S2 streaming on :4000 | **Yes** (local Express on an ephemeral port, forged session via `createSession` like server tests) | none |
| S1 ad-hoc dv materialize | **Code half yes** (mocked-fetch specs prove naming/SQL composition & route reachability); **live half no** | live Kinetica creds: does the view create, does TTL reap it untouched, does a view-of-view filter work |
| S7 Kinetica capabilities | **No** | non-admin Kinetica user at a terminal (D-12) |

### S3 - per-widget-type validators (autonomous)
**Method:** throwaway web spec (not shipped) `packages/web/src/spikes/s3Validators.spec.ts` or a script run through vitest: `registerAllChartTypes()` then for each `getAllChartTypes()` entry derive a zod object from `fields[]` (`text/textarea -> string`, `number -> number min/max`, `range -> number min/max`, `boolean`, `select -> enum(options)`, `color -> string` (theme-token only), `formatSpec`/`colorRules -> record/array unknown`) merged over `defaultConfig`. Score each type: (a) every key in `defaultConfig` is covered by a derived field? (b) are data-binding keys present (`metric`, `aggregation`, `groupByColumns`, `dimension`, `tableId/tableRef`) - they are written by `ChartConfigPanel` generic section, not `fields[]`; (c) does the validator accept real saved configs (query dev SQLite `widgets.config` per type) and reject a tampered one.
**Registry facts already read:** 16 types registered (`definitions/index.ts`). Generic-`fields` types with non-empty `fields`: bar 15, bignumber 11, heatmap 15, line 10, pie 12, records 9, scatter 8, table 4. **Custom-panel types with `fields: []`:** calendar, datafilter, info-card, legend, map, numericline, radiogroup, timeline (8 types; config shape lives in their `CustomConfigPanel`). Heatmap and scatter may be `addable: false` (`registry.ts` comment; `registry.addable.spec.ts` exists) - check, they should not be in the AI subset regardless.
**Predicted outcome (MEDIUM; spike confirms):** derive-for-all = FAIL. Decision likely: derive for the generic types + a small hand-written binding-key table; **named v2.0 subset: bar, line, pie, table, bignumber, records** (+ hand-written `map` only if 136 needs it; map is the main AI target but its config is custom - flag at checkpoint). The shared package cannot import the registry (React/web-only), so whichever way it goes the output is a **generated or hand-maintained catalogue in `packages/shared`** plus a web-side drift test that regenerates from the registry and compares (note in 133-SPIKES.md as consequence for 136).

### S2 - POST + fetch-ReadableStream SSE on :4000 (autonomous)
**Method:** `src/spikes/sseSpike.ts` boots a tiny Express app with the real middleware that matters (`express.json({limit:"1mb"})`, `cookieParser`, the real `requireAuth` from `auth.ts`), mounts `POST /spike/stream`, forges a session (`createSession` as in tests/helpers) and runs a Node `fetch` client. Checks, each with timestamps: (1) headers `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`, `res.flushHeaders()` -> client receives first event before the server finishes (prove with >=3 events spaced 500 ms, client receive times differ by ~500 ms, not all at end); (2) cookie auth works on POST streaming; (3) 1 MB json limit: >1 MB body returns the existing JSON 413 (`index.ts:~3282`) *before* any stream starts; (4) client abort (`AbortController`) is observed server-side via `res.on("close")` (use `res.on`, not `req.on("close")`, which fires after body read on modern Node); (5) session expiry mid-stream: `requireAuth` only runs at request start (`auth.ts:155-190`), so a stream outlives its session - record the decision (cap stream duration at `AI_TIMEOUT_MS` and/or re-check `getSession(sid)` per emitted op); (6) heartbeat comment line (`: ping\n\n` every 15 s) to survive idle proxies.
**Recorded finding (no test needed, D-11):** deploy nginx `docker/nginx.conf` has `gzip on` and the `location /api/` block has no buffering directives. For the 137 stream location add `proxy_buffering off; proxy_cache off; proxy_read_timeout 300s; gzip off;` (and `proxy_http_version 1.1; proxy_set_header Connection "";`), or rely on the `X-Accel-Buffering: no` response header which nginx honours (set both). `text/event-stream` is not in `gzip_types` today (only css/js/json/svg), so gzip is not the current blocker; `proxy_buffering` (default on) is. Verification through `:8080` is Phase 137's, not here. Node `http.Server.requestTimeout` (300 s default) bounds request *receipt*, not the response stream.
**Fallback if blocked:** NDJSON over POST or job polling (export-job precedent).

### S1 - session-scoped dv without a `dashboard_dynamic_views` row
**Code facts (HIGH, read):** `createOrReplaceMaterialized` (`lib/materializedView.ts`) takes `{req, view, sqlBody, ttl, route, op}` - **no row dependency**, so the helper itself serves an inline definition. The blockers are all at route level: `POST /api/dynamic-view/materialize` loads `getDashboardDynamicView(id)` + `getTable(row.source_table_id)` (`index.ts:2013-2025`) and derives the name from `row.id`; the dv branch of `/api/filter/materialize` requires `dvRow` + `dashboard_id` match (`index.ts:1347-1351`) and names via `buildDynamicViewName({dynamicViewId})` (`:1352-1356`) and `buildFilterViewName({dynamicViewId})` (`lib/viewNaming.ts` requires `tableId` or `dynamicViewId`, throws otherwise). `:id/drop` is by id (`index.ts:2161`).
**Method (steps):**
1. *Autonomous, code half:* write a throwaway spec showing `createOrReplaceMaterialized` called with an inline name (`_kbi_ai_u<user>_s<sid8>_<n>`, new naming fn) emits the exact `CREATE OR REPLACE MATERIALIZED VIEW ... USING TABLE PROPERTIES (TTL = n)` with no DB access; and sketch the minimal route delta: an ad-hoc branch that takes a server-held structured spec (never SQL), a session-bound name, and an `adHocViewName` (validated to start with the caller's own `_kbi_ai_u<sanitized user>_s<sid8>_` prefix) for the filter branch's FROM and a new `_ai<n>` segment in `buildFilterViewName`.
2. *Operator, live half* (`src/spikes/adhocDvSpike.ts`, read-only except its own `_kbi_spike_*` views, dropped in `finally`): as the operator's **non-admin** user: create the ad-hoc view from a registered table; `SELECT COUNT(*)`; create a filter view over it (`CREATE OR REPLACE MATERIALIZED VIEW f AS (SELECT * FROM adhoc WHERE col = 'x')`); fetch a WMS tile against the filter view (`/api/wms` with `LAYERS=<view>` - map tiles are AIACT-V20-07); wait > TTL without touching it and confirm the view is gone (is TTL sliding and does only the client keep-alive extend it? the code comment at `index.ts:1459` says "TTL (sliding)"); confirm `DROP TABLE IF EXISTS` works.
3. Also record the dv column source decision: does `SELECT * FROM <view> LIMIT 0` return `column_headers` (needed for the dv column guard)?
**Decision rule (D-13):** all green => ad-hoc inline path (ARCHITECTURE option B). Any of {create denied for non-admin, view-of-view filter fails, WMS cannot render the view} => "AI dvs go live only after Keep"; **explicitly flag AIACT-V20-07 for rewording at the checkpoint** and note Phase 139 shrinks (no ad-hoc materialize/temp-view lifecycle for session; Keep materializes). Draft rows are not a fallback.

### S7 - Kinetica capabilities as the non-admin user (operator-run)
**Method (`src/spikes/kineticaCapsSpike.ts`, operator pastes output; non-destructive, own `_kbi_spike_*` objects only):**
1. **View creation:** `CREATE OR REPLACE MATERIALIZED VIEW _kbi_spike_<rand> AS (SELECT * FROM <registered table> LIMIT 10) USING TABLE PROPERTIES (TTL = 2)` in the user's default schema and with `current_schema` option; record exact error text on denial (maps to `KineticaPermissionError`). Docs: schema-level `GRANT CREATE TABLE ON SCHEMA` governs creation (docs.kinetica.com/7.2/sql/security) - the operator's grant state decides.
2. **Statement timeout:** the documented `/execute/sql` `options` map (docs.kinetica.com/7.2/api/rest/execute_sql_rest, fetched 2026-10-09) lists 19 keys - cost_based_optimization, distributed_joins, distributed_operations, ignore_existing_pk, late_materialization, paging_table, paging_table_ttl, parallel_execution, plan_cache, prepare_mode, preserve_dict_encoding, query_parameters, results_caching, rule_based_optimization, ssq_optimization, ttl, update_on_existing_pk, validate_change_column, current_schema - **no per-statement timeout or read-only option** (MEDIUM: legacy docs page; confirm against the operator's actual version). Spike: run a deliberately slow query (e.g. self cross-join on a mid-size table) with and without a client `AbortSignal` and measure whether the server keeps executing after the client aborts. Pass options through `kineticaSql`'s `extra` (merged into `options`, `kinetica.ts:64-67`).
3. **Read-only enforcement:** attempt `DELETE`, `INSERT`, `DROP TABLE <registered table>`, `ALTER`, and `CREATE TABLE` as the user; record which Kinetica denies by grants alone. Result decides whether Phase 140's "guarded read-only SELECT" can lean on a read-only Kinetica role or must be fully app-side (statement allowlist + row cap + view cap).
4. **Cost/row preflight:** does `EXPLAIN <select>` work as this user and return a usable row estimate? (feeds 139/140 caps).
**Fallback (from research SUMMARY):** app-side guard + row cap + per-session view cap + client-abort. Record each result in `133-SPIKES.md` even when "denied" - a "can't" is a decision input.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Identifiers trusted as "admin metadata" (`whereClause.ts:14-21`) | Snapshot membership check | this phase | closes SSYNC-F6; comments must be corrected, they assert something false |
| Web-only `widgetAction.ts` / allow-list v2 | shared package, allow-list v3 | this phase | server can validate ops; AI path gets negative temp ids |
| Fail-fast env (SESSION_ENCRYPTION_KEY) | degrade-to-disabled for AI | D-06 | do not copy the throw pattern |

**Deprecated/outdated:** `research/STACK.md` `AI_PROVIDER=anthropic` and "fail fast at startup" for AI (superseded by D-06/D-09). Roadmap/ARCHITECTURE phase numbers (e.g. "137 Structural") differ from ROADMAP.md; use ROADMAP.md numbering.

## Open Questions

1. **Scope of the adjacent DELETE `?viewName=` hole (audit row 9).**
   - What we know: `index.ts:1491-1493` drops any client-named table the user may drop.
   - Unclear: whether the operator wants it fixed in 133 (cheap prefix check) or only recorded.
   - Recommendation: fix with a `_kbi_filt_u<sanitized user>_` prefix guard (one test), record in the audit as "adjacent, not a column site".
2. **`npm run build:server` + `npm start` non-Docker flow.**
   - tsc will not bundle shared TS source; README:127-128 documents this flow.
   - Recommendation: change server `build` to `tsc --noEmit && esbuild ... --alias ...` and point the Dockerfile at the same command so there is one definition; update README. If the operator doesn't use the non-Docker path, minimum is the Dockerfile `--alias` plus a README note.
3. **dv column source for the guard** (discretion): probe `SELECT * FROM <dv view> LIMIT 0` (+ in-process cache) vs `INFORMATION_SCHEMA.COLUMNS`. Resolve inside S1 (does `LIMIT 0` return `column_headers`).
4. **Tier-B for quantile/top-values/column-stats:** is identifier-regex + registered-table membership acceptable, given views can't be membership-checked without a probe? Recommend yes for 133, document the residual.
5. **`AI_MAX_TOOL_STEPS` / `AI_TIMEOUT_MS` / caps in 133 or 135?** Recommend parse `AI_DATA_ACCESS`, `AI_MAX_TOOL_STEPS` (int 1-50, default 8), `AI_TIMEOUT_MS` (int 1000-600000, default 60000) now (same module, cheap, bad numbers => invalid => disabled per D-06) and leave per-user/token caps to 135.
6. **Case-sensitivity of column match.** Recommend exact match (snapshot names are Kinetica's own); the client sends names it read from that snapshot. Revisit only if Kinetica folds case for unquoted identifiers in the operator's data (S7 can check: `SELECT "ZONE"` vs `zone`).

## Validation Architecture

> `.planning/config.json` has `workflow.nyquist_validation: false`; this section is included because the spawning prompt explicitly requested it. Per CLAUDE.md every grep criterion below was checked to read **0 / fail before the work** (counts as of 2026-10-09 at `8a56eb2`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.5` (web jsdom, server node, shared node - new config) |
| Config file | `packages/web/vitest.config.ts`, `packages/server/vitest.config.ts`, `packages/shared/vitest.config.ts` (Wave 0) |
| Quick run (server) | `cd packages/server && npx vitest run tests/<file>.spec.ts` |
| Full suite | web `cd packages/web && npx tsc --noEmit && npx vitest run && npx vitest run src/styles/theme-guard.spec.ts`; server `cd packages/server && npx tsc --noEmit && node scripts/test-gate.mjs` (SET-BASED; never assert a pass count); shared `cd packages/shared && npx tsc --noEmit && npx vitest run` |

### Phase Requirements -> Test Map
| Req / Decision | Behavior | Test type | Command | Red before? |
|----------------|----------|-----------|---------|-------------|
| AISAFE-V20-01 / D-02,D-04 | unknown filter column on table path -> 400, body has `Column "x" no longer exists on s.t`, **zero** `/execute/sql` fetch calls | route (supertest, fetch stub) | `npx vitest run tests/routes.filter-materialize.column-guard.spec.ts` | YES - write first against current code: it returns 200 and calls fetch (`index.ts:1446-1461`) |
| D-03 | same for spatialTarget cols, dv path, `/api/exports`, `/api/info/query`, quantile/top-values/column-stats (tier B: `x; DROP TABLE t` -> 400, no fetch) | route | one spec per site | YES for each (all currently 200 / reach fetch) |
| D-04 mutation proof | temporarily delete the guard call; the new specs must go red; restore | manual executor step recorded in SUMMARY | - | by construction |
| AISAFE-V20-01 (non-regression) | valid column still produces the byte-identical SQL (`SELECT * FROM s.t WHERE zone = 'East Village'`) | existing specs after fixture re-seed | `npx vitest run tests/routes.filter-materialize*.spec.ts` | green before and after |
| Criterion 3 | `@kinetica-bi/shared` imported by web AND server; invalid op rejected | shared spec + one web spec + one server spec importing the bare specifier | `cd packages/shared && npx vitest run`; `grep -rl "@kinetica-bi/shared" packages/web/src packages/server/src` must list both (currently 0 files) | YES (0 today) |
| Criterion 3 | `AiOpSchema` rejects unknown `op`, positive `tempId`, extra keys | shared spec | `npx vitest run src/aiOp.spec.ts` | YES (file absent) |
| AIPRV-V20-01 / D-05 | no `AI_*` => `{enabled:false, reason:"not_enabled"}`, no log output | pure unit | `npx vitest run tests/lib.aiConfig.spec.ts` | YES (module absent; `grep -rl parseAiConfig packages/server` = 0) |
| D-06 | `AI_ENABLED=true` + each invalid setting => `{enabled:false, errors}` naming the setting; `createApp()` resolves and `process.exit` is never called (spy) | unit + boot spec with `vi.stubEnv` | `npx vitest run tests/boot.aiConfig.spec.ts` | YES |
| D-07 | no `fetch` call during parse/boot even with a valid config | spec (fetch stub, assert 0 calls) | same | YES |
| D-10 | sentinel key never in captured `console.log/warn/error` nor in any `errors[]`, `JSON.stringify(result)` | unit | same | YES |
| Env leak | AI_* blanked in `tests/setup.ts` | `grep -c "AI_ENABLED" packages/server/tests/setup.ts` -> 0 now, 1 after | - | YES (0 today) |
| Docker | server bundle inlines shared, zod external | scripted: run the esbuild command, assert `packages/server/dist/index.js` has no `from "@kinetica-bi/shared"` (grep -c = 0 **after** a server file imports shared; today the string never appears so pair it with "server imports shared" check) + optional `docker build --target server .` smoke | - | partial (see note) |
| D-15 | `133-SPIKES.md` exists with S1,S2,S3,S7 sections, each with Decision + Fallback + Consequence; operator approval recorded | `checkpoint:human-verify` (not grep-provable) | - | n/a |
| Human-only | operator's S1-live/S7 results are real; nginx finding reads correctly | `checkpoint:human-verify` | - | route honestly, do not grep-dress |

### Sampling Rate
- **Per task commit:** the touched spec file(s) + `npx tsc --noEmit` in the touched package.
- **Per wave merge:** server `node scripts/test-gate.mjs`; web full vitest + theme-guard; shared vitest.
- **Phase gate:** all three green + both tscs clean before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/shared/{package.json,tsconfig.json,vitest.config.ts}` + root `package.json` script + CI `shared` job + `npm install` lockfile update
- [ ] `packages/server/tests/routes.filter-materialize.column-guard.spec.ts` (+ per-site specs) written **red** first
- [ ] `packages/server/tests/lib.aiConfig.spec.ts`, `boot.aiConfig.spec.ts`; AI_* blanks in `tests/setup.ts`
- [ ] fixture re-seeding for the 7+ specs with `columns: {}` (after guard, not before)
- [ ] `packages/shared/src/aiOp.spec.ts`, moved `widgetAction.spec.ts` / `actionAllowList.spec.ts` (update `"v2"` -> `"v3"` in the same commit as the bump)

## Sources

### Primary (HIGH confidence)
- Repo code read at `8a56eb2`: `packages/server/src/index.ts` (1187-1530, 1535-1660, 1900-2260, 2260-2460, 2831-2960, 3280-3324), `lib/whereClause.ts`, `lib/spatialWhereClause.ts`, `lib/spatialQuery.ts`, `lib/exportSql.ts`, `exportRoutes.ts`, `lib/{quantileSql,topValuesSql,columnStatsSql}.ts`, `lib/materializedView.ts`, `lib/viewNaming.ts`, `lib/dynamicViewName.ts`, `db.ts` (columns, columns_json), `env.ts`, `kinetica.ts`, `auth.ts`, `tests/setup.ts`, `scripts/test-gate.mjs`, `Dockerfile`, `docker/nginx.conf`, `.github/workflows/ci.yml`, README 114-128
- `packages/web/src/lib/{widgetAction,actionAllowList}.ts`, `actionEngineDecoupling.spec.ts`, `components/charts/registry.ts` + `definitions/*.ts`, `docs/mcp-action-seam.md`
- Scratch-workspace experiments (2026-10-09): esbuild `--packages=external` vs `--alias`; server `tsc` with `rootDir: src` + TS-source workspace package; tsx; vitest on web and server resolving the bare specifier
- `.planning/research/{SUMMARY,ARCHITECTURE,STACK}.md`, `133-CONTEXT.md`, `127-CALLER-AUDIT.md`

### Secondary (MEDIUM confidence)
- https://docs.kinetica.com/7.2/api/rest/execute_sql_rest/ - option keys list (no timeout/read-only option documented)
- https://docs.kinetica.com/7.2/sql/security/ - `GRANT ... CREATE <object type> ON SCHEMA` model

### Tertiary (LOW confidence)
- nginx `proxy_buffering`/`X-Accel-Buffering` behaviour for SSE is standard nginx knowledge, not re-verified against 1.27 docs here (deferred to 137 by D-11)
- TTL sliding vs fixed semantics (code comment only; S1 live step confirms)

## Metadata

**Confidence breakdown:**
- Standard stack / packaging: HIGH - reproduced empirically; only the real-repo `docker build` unverified
- Column audit: HIGH for listed sites (file:line read); MEDIUM for completeness - re-run the grep inventory when writing `133-COLUMN-AUDIT.md`
- Architecture (guard design, env design): HIGH
- Spike outcomes: MEDIUM (S3 prediction from registry), LOW-MEDIUM for S1-live/S7 (unknown Kinetica grants)
- Pitfalls: HIGH

**Research date:** 2026-10-09
**Valid until:** 2026-11-08 (stable codebase; re-check line numbers if other phases land first)

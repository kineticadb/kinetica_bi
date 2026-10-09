# Phase 127: Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix - Research

**Researched:** 2026-10-02
**Domain:** Kinetica `/execute/sql` envelope-limit fix, caller-by-caller audit, heatmap truncation correctness, CSV in-browser export fix
**Confidence:** HIGH for all file:line/code claims (read directly from the current checkout). MEDIUM for one Kinetica server-config default (`max_get_records_size` ≈ 20000, WebSearch-synthesized, not independently reconfirmed this session). The request-envelope `limit`/`offset` ↔ SQL-text `LIMIT`/`OFFSET` interaction is now DOC-VERIFIED (see §3) at the semantic level; the one remaining gap — whether repeated `/execute/sql` calls with byte-identical SQL text return rows in a stable order absent an explicit unique `ORDER BY` — is NOT documented either way and is flagged as `checkpoint:human-verify` / deferred to Phase 128's live spike.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**What replaces the 1,000 cap**
- **D-01** — A deploy-time env var is the per-QUERY maximum, replacing the hardcoded `limit: 1000` in `kineticaSql` (`packages/server/src/kinetica.ts:186`). Default **20,000**. Suggested name `KINETICA_MAX_ROWS_PER_QUERY` (final name at Claude's discretion, following `env.ts` conventions). An app-level safety net remains; an admin raises it without a code change. Env, not a settings UI — the operator's standing preference for set-once deploy values.
- **D-02** — A SECOND env var is the per-CALL batch size, default **20,000**, matching Kinetica's `max_get_records_size`. Suggested name `KINETICA_MAX_RECORDS_PER_CALL`. **No single Kinetica API call may request more than this.** Operator's words: "Kinetica max_get_records is 20000 so you cannot exceed that in a single API call, so if they increase it to 40000, the code needs to make sure it splits the batch into 2."
- **D-03** — The per-query max may exceed the per-call batch; the SERVER splits it. A query whose effective limit is 40,000 with a 20,000 batch is served by two Kinetica calls (offset 0 and offset 20,000), concatenated, and returned as one result. Splitting is transparent to callers.
- **D-04** — A browser-requested limit is clamped to the per-query max. `/api/sql` forwards client `options` as `extra` today, and `extra.limit` overrides the default (`kinetica.ts:160-194`). The browser may ask for less than the max, never more. No single request pulls an unbounded result through the app server.
- **D-05** — Callers that already pin their own limit keep it (`index.ts:1190` `extra: { limit: 1 }`, `:2374` and `:2398` `extra: { limit: 50 }`), subject to the D-04 clamp.

**In-browser CSV size**
- **D-06** — The in-browser download's default row cap stays 100,000 (the existing `csvDownloadRowCap` default, `WidgetRenderer.tsx:1941`). It now actually reaches it. This is also the hand-off point to the background job in Phase 131.
- **D-07** — An admin env HARD CEILING on the in-browser download, which a designer's per-widget `csvDownloadRowCap` cannot exceed. A widget configured for 1M is clamped to it. Suggested name `CSV_INBROWSER_MAX_ROWS`. The web app has no direct env access at runtime, so the value must reach the browser from the server (mechanism at Claude's discretion — e.g. an existing config/health/me response).
- **D-08** — When the download stops at the cap, the message says how much was left out: "Downloaded the first 100,000 of 1,234,567 rows". Use the records table's existing total-count query (`totalCount`, `WidgetRenderer.tsx:~2285`), not a new mechanism. Replaces today's "Capped at N rows" toast.
- **D-09** — The download button shows progress: rows so far (e.g. "Exporting… 40,000 rows") instead of a static exporting state. The loop already pages, so this is cheap.
- **D-10** — The in-browser loop must stop on real exhaustion, not on "short page". Today `if (rows.length < limit) break` (`WidgetRenderer.tsx:~1995`) is the exact mechanism that turned the server cap into a silent 1,000-row file. The server should expose an authoritative "more rows exist" signal — Kinetica's `has_more_records` — and the client should page on that. Mechanism at Claude's discretion.

**When Kinetica's own per-call limit is lower**
- **D-11** — Misconfiguration tolerance: if the batch env (D-02) is set higher than the deployment's real `max_get_records_size`, Kinetica returns a short page. The server MUST keep paging on `has_more_records` (never treat a short page as "done") and log a warning once that the batch env exceeds the server's max. No silent data loss, and queries keep working.
- **D-12** — Truncation is never silent, on ANY widget. When a query's real result is larger than the per-query max (D-01), so the app returns only the first N, the widget shows a small "limited to N rows" notice. Same principle as the heatmap fix. The server must tell the caller that the result was cut (e.g. a `truncated` / `hasMore` flag on the `/api/sql` response). Charts' Result limits (max 500) and the heatmap's (max 5,000) never reach a 20,000 default, so in practice this mostly bites records tables with large page sizes and a lowered max. It must still be correct.

**Heatmap truncation warning**
- **D-13** — Keep the compact one-line banner (`HeatmapRenderer.tsx:322-340`, "Truncated to the top N cells", guidance in the `title` tooltip), but N is the number of cells actually shown, never the requested limit. Today a 2,500 Result limit that the server cut to 1,000 would claim 2,500, or (as today) show nothing at all.
- **D-14** — Warn only when more cells really exist. Today `truncated = data.length >= cellLimit` (`:306`) warns falsely on a grid with exactly 5,000 real cells. Use the server's "more rows exist" signal (D-10/D-12) or fetch limit+1. An exactly-full grid must not show the banner.
- **D-15** — The tooltip names WHICH limit was hit, because the fixes differ: the user's Result limit ("raise Result limit, narrow the query, or pick lower-cardinality axes") vs the deployment's per-query max ("ask an admin to raise `KINETICA_MAX_ROWS_PER_QUERY`").

### Claude's Discretion
- Exact env var names (suggested above) and their validation (positive integers; how a batch > max or a max < 1 is handled at boot).
- Where batch splitting lives (inside `kineticaSql` vs a wrapper) and how the "more rows exist" flag is surfaced on `/api/sql` responses without breaking existing consumers of `parseKineticaResponse`.
- How `CSV_INBROWSER_MAX_ROWS` reaches the browser.
- The form and location of the written caller audit (ROADMAP criterion 2 requires one, classifying every `runSql` / `kineticaSqlHelper` / `kineticaSql` call site as has-own-SQL-LIMIT / already-pins-`extra.limit` / needed-explicit-limit).
- Notice styling for D-12 — must reuse existing classes (e.g. `config-hint`, as the heatmap banner does). No invented class names (CLAUDE.md).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (A "Showing N of M cells" heatmap total was considered and declined: it needs an extra COUNT query per heatmap load.)

**NOT in this phase** (explicit phase boundary): the server-side background export job, resumable download, gzip, export history (Phases 128-131); formula-injection escaping (EXPRT-V126-04, Phase 128); the line chart (Phase 132).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| EXPRT-V126-01 | Records-table CSV download contains every matching row up to the widget's CSV row cap (default 100,000), not 1,000. Root cause: hardcoded `limit: 1000` + client loop reading a short page as exhaustion. | §1 (envelope fix), §5 (has_more_records signal), §7 (CSV loop exact mechanics, button markup, existing toast) |
| EXPRT-V126-02 | Every app query asking for >1,000 rows gets them, audited caller by caller; no caller that relied on the 1,000 cap as an implicit safety net starts returning unbounded results. | §2 (complete caller audit table, including two previously-unflagged latent-truncation call sites: Calendar and grouped Timeline/NumericLine) |
| EXPRT-V126-03 | Heatmap truncation warning fires correctly (compares against real server cap, not requested limit). | §6 (HeatmapRenderer exact fix, D-13/14/15 mechanics) |

</phase_requirements>

## Summary

The 1,000-row envelope cap lives in exactly one place — `kineticaSql` (`packages/server/src/kinetica.ts:184-193`) — and its override mechanism (`options.extra` spread last) is already proven in production by three call sites. That makes the *mechanical* fix narrow. The actual work of this phase is the **audit** (§2): a complete, call-site-by-call-site classification is the ROADMAP's own criterion 2, and this research found it is **larger than the milestone's own prior research described** — not just the heatmap, but **Calendar (`CELL_LIMIT = 10000`) and grouped Timeline/NumericLine (`maxIntervals × MAX_SERIES` up to 12,000)** also carry a SQL-level `LIMIT` above the current 1,000 envelope cap, and neither has ever been flagged as silently truncated before this research. Raising the default to 20,000 (D-01) fixes all three "for free," the same way it fixes the heatmap — but Calendar has **zero** truncation-detection UI today (unlike heatmap and Timeline/NumericLine's unrelated series-truncation banners), so if `KINETICA_MAX_ROWS_PER_QUERY` is ever lowered below 10,000 by an admin, Calendar would silently under-render with no warning at all, a gap D-12's own wording ("on ANY widget") already anticipates but whose author's commentary ("mostly bites records tables") did not know about.

The second major finding is a genuine landmine in `parseKineticaResponse` (`WidgetRenderer.tsx:243-300`, the web decoder for `/api/sql` responses): it builds its row set by **iterating every key in the response object** that isn't `column_headers`/`column_datatypes` and treating each as an array-valued data column. Naively merging Kinetica's `has_more_records`/`total_number_of_records` (confirmed, via official docs, to live as **siblings of `json_encoded_response` inside `data_str`**, not nested inside the encoded payload itself) onto the same object `kineticaSql` returns would corrupt or zero out **every chart in the app**, the first time that object reaches `parseKineticaResponse` — unless its `METADATA_KEYS` set is extended to also exclude the two new fields. This is the single most load-bearing fact in this research for D-10/D-12's "surface a hasMore signal without breaking every consumer" requirement. The sibling renderer decoder, `decodeSqlResponse` (duplicated in `TimelineRenderer.tsx:103-117`, used by Timeline/NumericLine/Calendar), reads columns by **explicit `column_${i+1}` key lookup against `column_headers.length`**, not generic iteration — it is already immune and needs no change.

Third, the D-07 (env value reaching the browser) and D-09/D-08 (progress/final-count messaging) mechanisms already have exact, shipped precedents to copy rather than invent: `/api/auth/me` (`index.ts:436-449`) already carries four deploy-time env-derived numbers to the browser (`ttlKeepaliveLeadMinutes`, `maxCombinationViewsPerTable`, `dvFilterScopeDisabled`, `maxBarGroupBySeriesCap`), each following the same five-hop chain (boot-time `readPositiveIntEnv` → `/api/auth/me` response field → `MeResponse` type in `client.ts` → `fetchMe()`'s defensive `?? default` coalesce → `useAuthStore` state with its own hardcoded default), and `ChartConfigPanel.tsx:442` already demonstrates a **client-side** `Math.min`-against-an-auth-store-cap pattern that D-07's clamp should copy verbatim.

**Primary recommendation:** Fix the envelope default and the `has_more_records`/`total_number_of_records` surfacing inside `kinetica.ts` only (no new server route), extend `parseKineticaResponse`'s `METADATA_KEYS`, add the two new env vars using `kinetica.ts`'s own existing per-call `process.env.X` read style (not `index.ts`'s boot-closure style — they are different files with different existing conventions), thread `CSV_INBROWSER_MAX_ROWS` through the proven `/api/auth/me` → `useAuthStore` pipe, and fix HeatmapRenderer's truncation check to consume the new signal instead of comparing against its own requested limit.

## Standard Stack

No new libraries. This is a fix to existing first-party code (`kinetica.ts`, `WidgetRenderer.tsx`, `HeatmapRenderer.tsx`, `index.ts`, `client.ts`, `store/auth.ts`) plus two new env vars. Consistent with the milestone's STACK.md ("zero new npm dependencies").

**Installation:** none.

**Version verification:** not applicable — no package dependency changes.

## 1. The envelope fix itself

`packages/server/src/kinetica.ts:184-193`:

```ts
body: JSON.stringify({
  statement: sql,
  offset: 0,
  limit: 1000,                 // line 187 — becomes the new default-env read
  encoding: "json",
  request_schema_str: "",
  data: [],
  options: {},
  ...(options.extra ?? {}),    // line 192 — spread LAST; extra.limit/extra.offset already win
}),
```

`kinetica.ts` reads `process.env.KINETICA_URL!` directly inside `kineticaSql` (line 175) and `kineticaShowTable` (line 298) — **per-call**, not hoisted to a boot-time closure the way `index.ts`'s `readPositiveIntEnv` is. This is a *different* convention from `index.ts`'s (`createApp()`'s local closure, §4's `MAX_BAR_GROUP_BY_SERIES` etc.), and it exists because `kinetica.ts` has no `createApp()`-equivalent entry point — it is a module of free functions called from many places, including `index.ts` route handlers that have no access to `createApp()`'s local `const`s. **Recommendation: `KINETICA_MAX_ROWS_PER_QUERY` and `KINETICA_MAX_RECORDS_PER_CALL` should be read the same way `KINETICA_URL` already is inside `kinetica.ts`** (a small local `readPositiveIntEnv`-equivalent helper duplicated into `kinetica.ts`, or exported from a tiny new `lib/envInt.ts` and imported by both files) — not threaded as a new parameter through `KineticaSqlOptions` and 20+ existing call sites in `index.ts`, which would be a much larger, riskier diff for no behavioral benefit (every call site already gets the new default for free via the unchanged `options.extra` override path).

## 2. Complete caller audit

**Classification legend:** **SAFE-SQL-LIMIT** = SQL text itself bounds rows below any sane default, no envelope risk. **SAFE-PINNED** = `extra.limit` already overrides the envelope. **SAFE-SINGLE-ROW** = result is inherently 0/1 rows (COUNT, DDL, probe). **AT-RISK (latent)** = SQL-level ask already exceeds 1,000 today, silently truncated right now, fixed by raising the default (no code change beyond D-01). **NEEDS-FIX** = requires an explicit code change in this phase beyond the shared default bump.

### 2a. Server (`kineticaSqlHelper`/`kineticaSql` call sites in `packages/server/src/index.ts`)

| Line(s) | Route / op | SQL shape | Classification | Notes |
|---|---|---|---|---|
| 1187 | `POST /api/views/:id/materialize` (`MATERIALIZE`) | `CREATE OR REPLACE MATERIALIZED VIEW ...` + `extra: { limit: 1 }` | SAFE-PINNED | DDL, no row data anyway |
| 1493, 2023, 2158, 2190 | various (`MATERIALIZE`/`DYNAMIC_MATERIALIZE`/`DYNAMIC_DROP`) | `DROP TABLE IF EXISTS ...` | SAFE-SINGLE-ROW | No row data |
| 1553 (`buildQuantileSql`) | `POST /api/quantile` (`QUANTILE`) | NTILE bucket-MIN; `n` server-validated to `[2, 256]` (line 1531-1539) | SAFE-SQL-LIMIT | Tiny, bounded result |
| 1604 (`buildTopValuesSql`) | `POST /api/top-values` (`TOP_VALUES`) | `GROUP BY ... LIMIT 1000`; `n` validated `[2, 1000]` (line 1584-1592, comment: "Server cost bounded by Kinetica `GROUP BY ... LIMIT 1000`") | SAFE-SQL-LIMIT | Max 1,000 rows, exactly at today's cap — coincidentally already safe; stays safe once default rises |
| 1636 (`buildColumnStatsSql`) | `POST /api/column-stats` (`COLUMN_STATS`) | MIN/MAX/AVG/STDDEV, single row | SAFE-SINGLE-ROW | |
| 1921 | `POST /api/dynamic-view/preview` (`DYNAMIC_PREVIEW`) | `SELECT 1 FROM <view> LIMIT 0` | SAFE-SINGLE-ROW | 0 rows by construction |
| 1947 | `POST /api/dynamic-view/preview` (`DYNAMIC_PREVIEW`) | `SELECT * FROM (...) LIMIT ${sampleLimit}` | SAFE-SQL-LIMIT | **Correction to milestone ARCHITECTURE.md**, which claimed "no upper bound": `sampleLimit` **is** clamped server-side, line 1896-1899: `Math.min(body.sample_limit, 1000)` when `body.sample_limit > 0`, else default 100. Already bounded ≤1000, safe regardless of the envelope default. |
| 2046, 2071 | `POST /api/dynamic-view/materialize` (`DYNAMIC_MATERIALIZE`) | `SELECT COUNT(*) FROM ...` ×2 | SAFE-SINGLE-ROW | |
| 2371, 2395 | `POST /api/info/query` (`INFO_QUERY`) | spatial query, SQL has its own `LIMIT 50 OFFSET <page*50>` + `extra: { limit: 50 }` | SAFE-PINNED | Comment at :2368-2370 explicitly documents the envelope-vs-SQL-LIMIT distinction this whole phase is about |
| 2809, 2820, 2832 | `GET /api/kinetica/schemas`, `/tables`, `/columns` (`DISCOVERY`) | `INFORMATION_SCHEMA` queries, no `LIMIT`, no `extra.limit` | **NEEDS-FIX (low priority)** | Theoretical risk on an install with >20,000 schemas/tables/columns in one schema — edge case, not previously flagged, recommend an explicit `extra.limit` pin (e.g. 20,000) rather than relying on the shared default, since discovery lists feed UI dropdowns that have no pagination of their own |
| 2909 | `POST /api/sql` (`SQL`) | Full passthrough: `extra: options` where `options` is the client's raw request body | **This IS the clamp site (D-04)** | Needs the clamp logic: `options.limit` (if client-supplied) must be `Math.min(clientLimit, KINETICA_MAX_ROWS_PER_QUERY)` before being spread into `extra`, not passed through verbatim |

### 2b. Web (`runSql` call sites, routing through `POST /api/sql`)

| File:line | Caller | SQL-level cap today | Classification | Notes |
|---|---|---|---|---|
| `WidgetRenderer.tsx:657` | `AggregatedWidgetRenderer` chart query — bar/line/pie/table (non-heatmap) | `ALLOWED_LIMITS` ladder `[5,10,25,50,100,250,500]` (`ChartConfigPanel.tsx:945-ish`); multi-column bar group-by uses the SAME ladder (`ALLOWED_LIMITS_C`, `ChartConfigPanel.tsx:479`) | SAFE-SQL-LIMIT | Max 500, always safe |
| `WidgetRenderer.tsx:657` (same call site) | `AggregatedWidgetRenderer` chart query — **heatmap** | `HEATMAP_LIMITS = [250,500,1000,2500,HEATMAP_CELL_LIMIT=5000]` (`ChartConfigPanel.tsx:36`, `heatmapGrid.ts:56`) | **AT-RISK (latent) → NEEDS-FIX for the truncation banner** | SQL can ask for up to 5,000; envelope caps at 1,000 today = **the confirmed pre-existing bug** (§6). Fixed by D-01's default rise to ≥5,000; the banner logic (D-13/14/15) is a separate, required code change |
| `WidgetRenderer.tsx:1991` (`handleDownloadCsv`) | Records-table CSV export loop | SQL built per-page: `... LIMIT ${limit} OFFSET ${offset}` where `limit = min(PAGE=5000, remaining)` | **NEEDS-FIX** | This is EXPRT-V126-01 itself — §7 |
| `WidgetRenderer.tsx:2111` (page-fetch effect) | Records-table page fetch | `... LIMIT ${pageSize} OFFSET ${offset}`; `pageSize = Math.max(1, Number(cfg.pageSize) || 25)` | **AT-RISK if hand-configured high** | `pageSize` is a plain `<input type="number">` with **no min/max HTML attribute** (`ChartConfigPanel.tsx:1146-1155`, generic `"number"` field case) and **no UI field exists for it in the Records Table's own definition beyond a bare number box** (`definitions/records.ts:16`, default 25). An operator can type e.g. 50,000 directly. This is exactly the scenario D-12 is written for ("in practice this mostly bites records tables with large page sizes and a lowered max") |
| `WidgetRenderer.tsx:2188` (total-count effect) | `SELECT COUNT(*) AS total FROM ...` | 1 row | SAFE-SINGLE-ROW | |
| `TimelineRenderer.tsx:307,343,362,399` | Timeline range-probe / top-N-series-probe / main grouped query | Range probe = 1 row; top-N probe bounded by `MAX_SERIES=12` (`groupedSeries.ts:23`); **main query**: ungrouped `LIMIT ${maxIntervals}` (≤1000, `TimelineConfigPanel.tsx:539` clamps UI input to `[2,1000]`); **grouped: `LIMIT ${maxIntervals * seriesIn.length}` or `${maxIntervals * MAX_SERIES}`, i.e. up to 1000 × 12 = 12,000** (`buildTimelineSql.ts:95-131`) | **AT-RISK (latent) — previously unflagged** | The milestone's own ARCHITECTURE.md claimed Timeline "bounded... safe in practice" — **true only for the ungrouped case**. The grouped case can ask for up to 12,000 rows, already silently capped at 1,000 today with **no symptom visible as a row-truncation warning** — the existing `truncated`/`seriesInfo` state (`TimelineRenderer.tsx:254,265,356,378,501,536-539`, `data-testid="timeline-truncated-note"`) covers **series-count** truncation (the top-N pre-query), an entirely different and already-correct mechanism; it says nothing about whether each surviving series' own bucket data was cut short by the envelope. Fixed by D-01's default rise to ≥12,000; no further code change required for Timeline in-phase (D-12's generic "any widget" notice is a nice-to-have but not a locked requirement for Timeline specifically — flag as an Open Question for the planner) |
| `NumericLineRenderer.tsx:284,319,338,377` | Same shape as Timeline | `maxBuckets` clamped `[2,1000]` (`NumericLineConfigPanel.tsx:516`); grouped `LIMIT (maxBuckets+1) * seriesIn.length` or `× MAX_SERIES`, up to ~12,012 (`buildNumericLineSql.ts:112,129`) | **AT-RISK (latent) — previously unflagged** | Identical situation to Timeline |
| `CalendarRenderer.tsx:327` | Calendar single query | `buildCalendarSql`'s `limit ?? CELL_LIMIT`; `CELL_LIMIT = 10000` (`calendarBin.ts:110`, via `buildCalendarSql.ts:103,115`) | **AT-RISK (latent) — previously unflagged, AND has zero truncation UI** | Worse than Heatmap/Timeline: grep of `CalendarRenderer.tsx` for `truncat` returns **nothing** — there is no post-fetch truncation signal of any kind today. `CalendarConfigPanel.tsx`'s `estimateCalendarCells`/`capState` (lines 296-304, 697) is a **pre-save estimate probe** (MIN/MAX date-range query, 1 row) that blocks saving a config whose *estimated* cell count exceeds `CELL_LIMIT` — it does not detect an *actual* fetch being cut short post-save. Fixed for the default 20,000 case by D-01; if an admin ever lowers `KINETICA_MAX_ROWS_PER_QUERY` below 10,000, Calendar would silently under-render with **no warning whatsoever** — the single worst gap this audit found, more severe than the heatmap's (which at least suppresses a notice that exists). Recommend flagging to the planner as a candidate for the SAME D-12 generic notice, even though CONTEXT.md's D-13/14/15 only lock the heatmap-specific banner wording |
| `CalendarConfigPanel.tsx:288` | Pre-save range probe | `buildCalendarRangeQuery` — MIN/MAX, 1 row | SAFE-SINGLE-ROW | |
| `hooks/useViewKeepAlive.ts:97` | Dashboard keep-alive touch | `SELECT 1 FROM <view> LIMIT 1` | SAFE-SINGLE-ROW | |

### 2c. Not in the blast radius (confirmed by direct read, not assumed)

- `kineticaWms` (`kinetica.ts:367-434`) — GET `/wms`, no `limit`/`offset`/`options` body field at all.
- `kineticaShowTable` (`kinetica.ts:283-358`) — POST `/show/table`, schema/metadata only, no row-data body shape.
- `DashboardsPage.tsx`, `DatasetsPage.tsx` — grepped directly for `runSql`, **zero matches**; both use schema-check/schema-apply/CRUD endpoints, not row-data endpoints.
- `InfoCardRenderer` (`"info-card"` widget type) — short-circuits before `AggregatedWidgetRenderer` specifically because it has no SQL (`WidgetRenderer.tsx:351-354` comment: "info-card defaultConfig is {} — no SQL").
- Data-filter / radio-group option loaders — route through `/api/top-values` (already audited above as SAFE-SQL-LIMIT), not a direct `runSql` call.

**This table is the ROADMAP's criterion-2 deliverable.** Recommend committing it (or an equivalent) verbatim into the phase's summary/plan, since the planner needs the AT-RISK rows to decide whether Calendar/Timeline/NumericLine get an explicit D-12-style notice in this phase or are deliberately deferred (CONTEXT.md's locked decisions only name the heatmap specifically for D-13/14/15 — expanding to Calendar/Timeline is a scope call the planner/operator should make consciously, not one this research should silently decide).

## 3. Kinetica `/execute/sql` response shape, `has_more_records` location, and the offset/limit-vs-SQL-LIMIT question

**DOC-VERIFIED (https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/, fetched 2026-10-02):**

```
{
  "status": "OK",
  "message": "",
  "data_type": "execute_sql_response",
  "data_str": {
    "count_affected": <long>,
    "response_schema_str": <string>,
    "json_encoded_response": <string>,   // <-- what kinetica.ts currently extracts and returns
    "total_number_of_records": <long>,   // <-- SIBLING of json_encoded_response, DISCARDED today
    "has_more_records": <boolean>,       // <-- SIBLING of json_encoded_response, DISCARDED today
    "paging_table": <string>,
    "info": { ... }
  }
}
```

`kinetica.ts:232-237` today does:

```ts
const dataStr = typeof body.data_str === "string" ? JSON.parse(body.data_str) : body.data_str;
const encoded = typeof dataStr?.json_encoded_response === "string"
  ? JSON.parse(dataStr.json_encoded_response)
  : dataStr?.json_encoded_response;
...
return encoded ?? body;
```

`dataStr.has_more_records` / `dataStr.total_number_of_records` are read from `body.data_str` but **never captured** — `kineticaSql`'s return value is `encoded` alone (confirmed against the existing test fixture in `kinetica.sql.spec.ts:30-35`, which doesn't even include these fields, and the happy-path assertion at line 68: `expect(result).toEqual({ column_1: [1, 2] })` — a bare encoded object, no wrapper). **No existing fixture anywhere in this repo mocks `has_more_records`/`total_number_of_records`** — this is genuinely new ground, not a "fix an existing broken mock" task.

**The landmine — `parseKineticaResponse` (`WidgetRenderer.tsx:243-300`):**

```ts
const METADATA_KEYS = new Set(["column_headers", "column_datatypes"]);   // :269
const dataKeys = Object.keys(columnar).filter((k) => !METADATA_KEYS.has(k));  // :275
...
const firstDataKey = dataKeys[0];
const numRows = Array.isArray(columnar[firstDataKey]) ? columnar[firstDataKey].length : 0;  // :286-288
...
for (const rawKey of dataKeys) {
  const realName = keyToName[rawKey];
  row[realName] = (columnar[rawKey] as unknown[])[i];   // :296 — assumes EVERY non-metadata key is an array
}
```

If `kineticaSql` (and therefore `/api/sql`'s JSON response) grows two new sibling keys (`has_more_records: boolean`, `total_number_of_records: number`) on the SAME object that carries `column_1`/`column_headers`, **every chart in the app breaks the next time this code runs**, because these two keys are not arrays: at best they get spuriously included as a garbage extra "column" with `undefined` values at every row; at worst (if `has_more_records` happens to be the first key after JSON round-tripping) `numRows` computes from a non-array and the ENTIRE response decodes to **zero rows app-wide**. Note this is specifically a `parseKineticaResponse`-only risk: `decodeSqlResponse` (duplicated in `TimelineRenderer.tsx:103-117`, used by Timeline/NumericLine/Calendar) and the server's own inline decoders (`index.ts:1967-1980`'s dynamic-view-preview, `:2411-2426`'s info-query) all read columns by **explicit `column_${i+1}` key lookup bounded by `column_headers.length`**, never by iterating all keys — they are unaffected by extra sibling keys and need no change.

**Required fix, precisely scoped:**
1. `kinetica.ts`'s `kineticaSql` must also extract `dataStr.has_more_records` / `dataStr.total_number_of_records` and merge them onto the returned object (e.g. `{ ...encoded, has_more_records: ..., total_number_of_records: ... }`), using Kinetica's own field names verbatim (no reason to rename; avoids an extra translation layer and keeps server-log/audit language consistent with Kinetica's docs).
2. `WidgetRenderer.tsx`'s `METADATA_KEYS` set (line 269) must be extended: `new Set(["column_headers", "column_datatypes", "has_more_records", "total_number_of_records"])`. This is a **one-line, additive, well-isolated change** but an absolutely load-bearing one — recommend a dedicated test (`parseKineticaResponse` already has its own test block per `WidgetRenderer.spec.tsx:2410`'s `src.indexOf("function parseKineticaResponse")` pattern) asserting a response carrying `has_more_records`/`total_number_of_records` alongside `column_1` still decodes the correct row count and values.
3. Server-internal callers that read specific named keys (`decodeCount`, discovery routes, info-query) are unaffected and need no change — confirmed by direct read, not assumed.

**The SQL-LIMIT vs envelope-offset/limit interaction (needed for D-02/D-03 batch splitting):**

DOC-VERIFIED, same URL: the envelope `limit`/`offset` **windows the retrieval of the query's already-computed result set** — i.e. if the SQL text itself contains `LIMIT n OFFSET m`, Kinetica first computes that SQL-bounded result (≤n rows starting at m), and the envelope's own `offset`/`limit` then further windows *that* result for the purposes of this particular HTTP response. This is exactly consistent with the pre-existing in-repo comment at `index.ts:2368-2370` ("the SQL itself has `LIMIT 50 OFFSET <page*50>`; the kineticaSql `extra.limit` is the Kinetica request envelope's limit — distinct from the SQL `LIMIT` clause") and explains the current bug precisely: the records-table/CSV-loop SQL asks for up to 5,000 rows via its own `LIMIT`, but the envelope's hardcoded `limit: 1000` (offset 0) returns only the first 1,000 of that already-computed window, discarding the rest — not an error, just a silent truncation of an inner, bounded result by an outer, smaller one.

**This confirms D-03's "server splits it" is semantically sound** for a batch-splitting design that holds the SQL text constant and varies only the envelope's `offset`/`limit` across N calls (e.g. call 1: `{offset:0, limit:20000}`, call 2: `{offset:20000, limit:20000}`, concatenating `column_N` arrays and carrying `has_more_records` from the last call made). **One gap remains, not resolvable without a live Kinetica call (out of scope for this research per task constraints): Kinetica's docs do not state whether re-executing the identical SQL statement with an incremented envelope `offset` is guaranteed to return a stable, non-overlapping continuation of the SAME result set absent an explicit, unique `ORDER BY`** — this is the same unresolved question the milestone's own PITFALLS.md already flagged generically (Pitfall 2) and explicitly deferred to Phase 128's live spike. **For Phase 127 specifically this risk is low-consequence and narrow in scope**: both new env vars default to the same value (20,000), so splitting **never fires under default configuration** — it only activates when an admin deliberately sets `KINETICA_MAX_ROWS_PER_QUERY` above `KINETICA_MAX_RECORDS_PER_CALL` (the operator's own example: "if they increase it to 40000"), an explicit admin-tuning action, not the hot path. **Recommendation:** implement the splitting loop purely mechanically (envelope `offset`/`limit` only, SQL text untouched, per the doc-confirmed semantics above), cover it with a unit test using a mocked `fetch` returning two sequential `/execute/sql` responses (mirrors the existing `kinetica.sql.spec.ts` mocking style exactly), and record the ordering-stability caveat as a `checkpoint:human-verify` / explicitly-deferred-to-Phase-128 item rather than attempting to prove it with a live call this phase is barred from making.

## 4. Env var conventions

Two **coexisting, legitimately different** conventions exist in this codebase, and the planner should pick per-file, not uniformly:

**`index.ts`'s `createApp()` boot-closure convention** (`index.ts:186-197`):
```ts
const readPositiveIntEnv = (name: string, def: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    console.warn(`[boot] ${name} must be a positive integer (got: ${JSON.stringify(raw)}); falling back to default ${def}`);
    return def;
  }
  return n;
};
const DEFAULT_VIEW_TTL_MINUTES = readPositiveIntEnv("DEFAULT_VIEW_TTL_MINUTES", 5);
```
Read ONCE at boot, inside `createApp()`, fallback+warn (not fail-fast) on an invalid value. Used for every existing tuning knob (`DEFAULT_VIEW_TTL_MINUTES`, `TTL_KEEPALIVE_LEAD_MINUTES`, `MAX_COMBINATION_VIEWS_PER_TABLE`, `MAX_BAR_GROUP_BY_SERIES`). Boolean flags use a plain `=== "true"` compare instead (`DISABLE_DV_FILTER_SCOPE`, line 214) — **not** `readPositiveIntEnv`.

**`kinetica.ts`'s own per-call direct-read convention** (lines 175, 298): `const kineticaUrl = process.env.KINETICA_URL!;` — read fresh on every `kineticaSql`/`kineticaShowTable` invocation, because `kinetica.ts` is a module of free functions with no `createApp()`-equivalent boot hook and no access to `index.ts`'s local closure variables.

**Recommendation:** `KINETICA_MAX_ROWS_PER_QUERY` and `KINETICA_MAX_RECORDS_PER_CALL` are consumed exclusively inside `kinetica.ts` (the only file that builds the envelope body) — follow **`kinetica.ts`'s own convention**, not `index.ts`'s. Concretely: a small local helper (duplicate the `readPositiveIntEnv` logic, or factor it into a tiny shared `lib/envInt.ts` imported by both `index.ts` and `kinetica.ts` — the latter is slightly better DRY but is a judgment call, not a correctness requirement) called at the top of `kineticaSql` itself, mirroring the existing `process.env.KINETICA_URL!` read one line above where the hardcoded `1000` currently sits. This avoids threading a new parameter through `KineticaSqlOptions` and every one of the ~25 existing call sites in `index.ts`, none of which need to change to pick up the new default.

`CSV_INBROWSER_MAX_ROWS` is consumed inside `createApp()`'s `/api/auth/me` handler (§5) — follow `index.ts`'s boot-closure convention instead, exactly like its four existing siblings.

**The dev-`.env`-leaks-into-server-vitest hazard** (per repo memory and `env.ts`'s own docstring: `dotenv.config()` loads `packages/server/.env` before any other module, including in test runs) applies to both new vars identically to every existing tuning knob — existing specs for `DEFAULT_VIEW_TTL_MINUTES` etc. are NOT in this read set, but the pattern to follow is: tests that need a specific env value must set/delete `process.env.KINETICA_MAX_ROWS_PER_QUERY` etc. explicitly in a `beforeEach`/`afterEach`, never rely on the ambient dev `.env`. (This repo's instructions explicitly forbid reading `packages/server/.env` — not done, and not needed: the convention is independent of its contents.)

## 5. Server env value reaching the browser (D-07)

**This exact mechanism already exists, four times over.** `index.ts:436-449`:

```ts
app.get("/api/auth/me", (req, res) => {
  ...
  return res.json({
    user: { username: loaded.session.username, roles, permissions },
    authMode,
    ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES,
    maxCombinationViewsPerTable: MAX_COMBINATION_VIEWS_PER_TABLE,
    dvFilterScopeDisabled: DISABLE_DV_FILTER_SCOPE,
    maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES,
  });
});
```

Full chain, all four fields follow it identically:
1. **Server boot** (`index.ts:186-209`): `readPositiveIntEnv("MAX_BAR_GROUP_BY_SERIES", 12)` etc.
2. **`/api/auth/me` response** (`index.ts:449`): field added to the JSON body.
3. **`MeResponse` type** (`packages/web/src/api/client.ts:252`): `export type MeResponse = { user: AuthUser; authMode: AuthMode; ttlKeepaliveLeadMinutes: number; maxCombinationViewsPerTable: number; dvFilterScopeDisabled: boolean; maxBarGroupBySeriesCap: number };`
4. **`fetchMe()`** (`client.ts:273-297`): defensively coalesces — e.g. `maxBarGroupBySeriesCap: typeof json.maxBarGroupBySeriesCap === "number" ? json.maxBarGroupBySeriesCap : 12` — "an older server build that omits the field never yields undefined."
5. **`useAuthStore`** (`packages/web/src/store/auth.ts:8-55`): state field with its OWN hardcoded default (`maxBarGroupBySeriesCap: 12` at line 40), overwritten by `bootstrap()`'s `set({ ..., maxBarGroupBySeriesCap: me.maxBarGroupBySeriesCap, ... })` at line 55.
6. **Consumption**: plain `useAuthStore((s) => s.maxBarGroupBySeriesCap)` (`WidgetRenderer.tsx:970`) or imperative `useAuthStore.getState().maxBarGroupBySeriesCap` (`ChartConfigPanel.tsx:442`).

**`ChartConfigPanel.tsx:442` is also the exact clamp-pattern precedent for D-07's "designer's cap cannot exceed the admin cap" requirement:**
```ts
? baseLimit * useAuthStore.getState().maxBarGroupBySeriesCap * 2
```
i.e. a **client-side** `Math.min`/multiply-against-store-value pattern, not a server-side rejection. **Recommendation for D-07:** add `csvInBrowserMaxRows: CSV_INBROWSER_MAX_ROWS` as a fifth field through this exact five-hop chain, then in `WidgetRenderer.tsx`'s `handleDownloadCsv`/render body, change:
```ts
const csvDownloadRowCap = Math.max(1, Math.floor(Number(cfg.csvDownloadRowCap) || 100000));
```
to additionally clamp against `useAuthStore.getState().csvInBrowserMaxRows` (or the hook form if used in a render-phase variable), mirroring `ChartConfigPanel.tsx:442` exactly.

## 6. Heatmap (D-13/14/15)

`HeatmapRenderer.tsx` receives **parsed `data: Row[]`** (already row-major, via `parseKineticaResponse` at the `AggregatedWidgetRenderer` call site `WidgetRenderer.tsx:658`) and `config: Record<string, unknown>` — it does **not** see the raw `/api/sql` response object. The call site:

```ts
// WidgetRenderer.tsx:655-658
const res = await runSql<Record<string, unknown>>(sqlToRun, undefined, controller.signal);
setData(parseKineticaResponse(res));   // <-- res (and any has_more_records on it) is discarded here
...
// :854
return <HeatmapRenderer data={data} config={cfg} />;
```

**Minimal change required:** `AggregatedWidgetRenderer` needs a new piece of state (e.g. `const [hasMoreServer, setHasMoreServer] = useState<boolean | undefined>(undefined)`) set alongside `setData(...)` from `res.has_more_records` (post §3's fix), and a new prop threaded into the `HeatmapRenderer` call site (`:854`): `<HeatmapRenderer data={data} config={cfg} serverHasMore={hasMoreServer} />`.

Inside `HeatmapRenderer.tsx`, the current logic:

```ts
// :291-295 — cellLimit: the limit the QUERY actually used
const rawLimit = Number(config.limit);
const cellLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, HEATMAP_CELL_LIMIT) : HEATMAP_CELL_LIMIT;
...
// :306 — THE BUG
const truncated = data.length >= cellLimit;
```

`:306`'s fix (D-14) is: **replace the row-count-vs-requested-limit comparison with the new `serverHasMore` prop** — `const truncated = serverHasMore === true;` (never inferred from `data.length`). D-13 ("N is the number shown, never requested") is already correct in the surrounding code — `cellLimit` is only used for the BANNER TEXT ("Truncated to the top {cellLimit...} cells", `:340`) and the tooltip (`:329`), and `data.length` is never substituted for it in the text; the only thing that needs to change is the **boolean gate**, not the displayed number. D-15 (name WHICH limit was hit) requires comparing `config.limit` (the operator's Result-limit choice) against the deployment's `KINETICA_MAX_ROWS_PER_QUERY` value — but **the renderer has no access to the env value today**; recommend threading it the same way as §5 (a new `/api/auth/me` field, e.g. `kineticaMaxRowsPerQuery`, read via `useAuthStore`), so the tooltip can branch: if `config.limit <= cellLimit` and `cellLimit < kineticaMaxRowsPerQuery` → the operator's own Result-limit choice was the binding constraint ("raise Result limit..."); if `cellLimit >= kineticaMaxRowsPerQuery` → the deployment's own ceiling was hit ("ask an admin to raise KINETICA_MAX_ROWS_PER_QUERY").

**Existing test file to extend:** `packages/web/src/components/charts/HeatmapRenderer.spec.tsx` (confirmed present; its current tests almost certainly assert the OLD `data.length >= cellLimit` behavior and will need updating, not just adding to — check for an existing "exactly at cellLimit warns" test, which is precisely the false-positive D-14 names and would currently be asserting the WRONG behavior).

## 7. CSV loop (D-06..D-10)

`WidgetRenderer.tsx:1957-2031` (`handleDownloadCsv`), exact mechanics:

```ts
const csvDownloadRowCap = Math.max(1, Math.floor(Number(cfg.csvDownloadRowCap) || 100000));  // :1941
...
setExporting(true);
const PAGE = 5000;                                   // :1982
const all: Row[] = [];
let offset = 0;
let capped = false;
try {
  while (all.length < csvDownloadRowCap) {
    const remaining = csvDownloadRowCap - all.length;
    const limit = Math.min(PAGE, remaining);
    const sql = `SELECT ${colsClause} FROM ${fromSourceCsv}${cw}${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    const res = await runSql<Record<string, unknown>>(sql, undefined, controller.signal);
    const rows = parseKineticaResponse(res);
    all.push(...rows);
    offset += rows.length;
    if (rows.length < limit) break;                   // :1995 — THE BUG: short page ≠ exhausted
    if (all.length >= csvDownloadRowCap && rows.length === limit) {
      capped = true;
      break;
    }
  }
  ...
  if (capped) {
    useToastStore.getState().showToast(`Capped at ${csvDownloadRowCap.toLocaleString()} rows`, "info");  // :2023 — TODAY's message, to be replaced per D-08
  }
} ...
```

**Required changes:**
- `:1995`'s `if (rows.length < limit) break;` must become `if (!res.has_more_records) break;` (consuming §3's new field) — this is the actual D-10 fix. Note `rows.length < limit` is STILL a reasonable defensive fallback for an older/mocked server response that omits `has_more_records` (coalesce `res.has_more_records ?? rows.length < limit`, mirroring `fetchMe`'s own defensive-coalesce house style).
- `:2023`'s toast message needs `totalCount` (already computed by the separate total-count effect, `WidgetRenderer.tsx:2142-2204`, into component state) threaded into the capped-message string per D-08: `` `Downloaded the first ${all.length.toLocaleString()} of ${totalCount?.toLocaleString() ?? "?"} rows` ``. `totalCount` is already in scope inside `RecordsTableRenderer` (same component as `handleDownloadCsv`) — no new query needed, exactly as D-08 specifies.
- D-09 (progress) needs `exporting: boolean` (`:1942`) widened to carry a row count, e.g. `const [exportProgress, setExportProgress] = useState<number | null>(null)`, updated once per page inside the `while` loop (`setExportProgress(all.length)`), and the button text (`:2369-2373`, currently `{exporting ? "Exporting…" : "Download"}`) changed to `` exporting ? `Exporting… ${exportProgress?.toLocaleString() ?? ""} rows` : "Download" ``.
- Button markup/classes to preserve exactly: `className="widget-csv-download ghost-sm"` (`:2369`) — reuse, do not invent a new class.
- Existing toast store call signature confirmed: `useToastStore.getState().showToast(message: string, kind: "info" | "error")`.

**Existing spec files to extend:** confirmed present (`WidgetRenderer.spec.tsx` is the umbrella spec for this whole component; a dedicated CSV-export describe block almost certainly exists given the FK4 phase tag in comments — grep for `handleDownloadCsv`/`Capped at`/`csvDownloadRowCap` inside it when planning tasks).

## 8. D-12 notice — which renderers, which class

`.config-hint` is confirmed defined in `global.css:1319` (plus a semantic-color extension at `:2817`, and a scoped override at `:4549`) — it is the exact class the heatmap banner already uses (`HeatmapRenderer.tsx:324`) and the Result-limit field's own hint text uses (`ChartConfigPanel.tsx`, "Maximum number of groups to return" etc.) — **reuse `config-hint` verbatim, do not invent a new class**, per CLAUDE.md.

Per §2's audit, the renderers where a D-12 "limited to N rows" notice is both locked-in-scope and straightforward: **Records Table** (`WidgetRenderer.tsx`'s `widget-records-footer`, alongside the existing `widget-records-count` span showing "Showing X–Y of Z" — a `config-hint`-classed line can sit in the same footer, gated on the new `res.has_more_records`/truncation signal from the page-fetch effect, not just the CSV loop). Per the audit's Calendar/Timeline/NumericLine findings, those are candidates the planner should explicitly accept or defer — CONTEXT.md's locked decisions (D-13/14/15) only name the heatmap specifically, so expanding the generic D-12 notice to Calendar is an in-scope-per-requirement-text-but-not-per-locked-decision judgment call the planner/operator should make consciously (see Open Questions).

## 9. Test strategy (informational — `nyquist_validation` is `false` in `.planning/config.json`, so no formal Validation Architecture section is produced per the researcher contract)

Relevant existing spec files to extend, confirmed present by direct listing:
- `packages/server/tests/kinetica.sql.spec.ts` — the right home for: new-default-value test, `extra.limit` still overriding it, the new `has_more_records`/`total_number_of_records` extraction, and the batch-splitting mechanism (mocked `fetch` returning 2 sequential responses, asserting concatenation + `has_more_records` aggregation). Existing pattern (`mockFetch(status, body)` stubbing `global.fetch`, `buildReq()` fake `AuthedRequest`) is directly reusable.
- `packages/server/tests/routes.sql.spec.ts` — the right home for the D-04 clamp test (`POST /api/sql` with a client-supplied `options.limit` above `KINETICA_MAX_ROWS_PER_QUERY`, asserting the forwarded envelope `extra.limit` was clamped down, not passed through verbatim). Existing pattern (`buildTestApp()`, `createAdminSession()`) directly reusable.
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — `parseKineticaResponse`'s `METADATA_KEYS` extension test (reuse the existing `EMPTY_RESPONSE` fixture style at line 265-268 as a template for a new fixture that also carries `has_more_records`/`total_number_of_records`); the CSV-loop `has_more_records`-based continuation test (replacing/strengthening whatever currently asserts the `rows.length < limit` short-page-break behavior); the D-08 message-text test; the D-09 progress-text test.
- `packages/web/src/components/charts/HeatmapRenderer.spec.tsx` — the D-13/14/15 rewrite: an "exactly cellLimit real cells, serverHasMore=false → no banner" test (the one CLAUDE.md-style **toothless-criterion risk**: verify this exact scenario currently shows a FALSE-POSITIVE banner under today's code, i.e. run the assertion against the OLD logic first, per CLAUDE.md's "measure the before-value" rule, before claiming the fix is proven) and a "serverHasMore=true → banner, with tooltip naming the correct limit" test.

**`checkpoint:human-verify` candidates for this phase**, per CLAUDE.md's "some requirements are not automatically verifiable" guidance:
- The batch-splitting mechanism's row-ordering stability across repeated identical-SQL calls with incrementing envelope offset (unverifiable without a live Kinetica call, explicitly out of scope this phase, deferred to Phase 128's spike) — the STRUCTURAL precondition (the splitting loop issues N calls with the SAME sql string and only varies envelope offset/limit, concatenating in order) is fully grep/test-provable; the live row-stability guarantee is not, this phase.
- Whether an admin-lowered `KINETICA_MAX_ROWS_PER_QUERY` genuinely surfaces D-11's "log a warning once" without spamming logs on every request — a timing/once-ness property worth a targeted unit test (assert the warning fires on the first over-threshold call and NOT on the second), not a human-verify item — flagging here only because it's easy to under-test (e.g. a naive "log every time" implementation passes a single-request test but fails the "once" requirement under load).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Carrying a deploy-time env number to the browser | A new endpoint, a new store, a new fetch call | The existing `/api/auth/me` → `MeResponse` → `fetchMe()` → `useAuthStore` five-hop chain (§5) | Four fields already do exactly this; a fifth is a one-line diff at each hop, fully precedented |
| Client-side "designer cap cannot exceed admin cap" enforcement | A server-side rejection of an "invalid" widget config | `Math.min`/clamp against a `useAuthStore` value at render/use time, exactly like `ChartConfigPanel.tsx:442` | Already the established pattern for `maxBarGroupBySeriesCap`; a server-side rejection would be a new, inconsistent enforcement model for a value that's purely a client-side UX cap |
| Env var reading inside `kinetica.ts` | A new config-loader module, or threading a param through `KineticaSqlOptions` | A small helper mirroring the existing inline `process.env.KINETICA_URL!` read, following `kinetica.ts`'s own (not `index.ts`'s) established per-call convention | `kinetica.ts` has no boot hook; introducing one just for two new vars is a bigger, riskier change than matching the file's existing style |
| CSV progress/notice UI | New CSS classes | `widget-csv-download ghost-sm` (button, unchanged), `config-hint` (notice text, §8) | CLAUDE.md: never invent a class that already has an equivalent |

**Key insight:** every mechanism this phase needs (env-to-browser, client-side cap clamping, additive response fields, CSV progress) already has a shipped, working precedent somewhere in this codebase. The research risk in this phase is not "what pattern to invent" but "which of two coexisting conventions to follow where," and "don't let an additive server field silently break a generic key-iterating decoder" (§3).

## Common Pitfalls

### Pitfall 1: Merging `has_more_records`/`total_number_of_records` onto the columnar response without updating `parseKineticaResponse`'s `METADATA_KEYS`
**What goes wrong:** Every chart that reads through `parseKineticaResponse` (bar/line/pie/table/heatmap/records-table — i.e. almost everything except Timeline/NumericLine/Calendar, which use the separate, already-safe `decodeSqlResponse`) either gains a garbage pseudo-column or, in the worst case (if the new key sorts first), decodes to **zero rows app-wide**.
**Why it happens:** `parseKineticaResponse` was written assuming "every non-metadata key is a `column_N` array" was a safe, permanent invariant — true until the response shape itself needed to carry a second kind of metadata.
**How to avoid:** Add both new field names to `METADATA_KEYS` (`WidgetRenderer.tsx:269`) in the SAME change that adds them to `kineticaSql`'s return value. Write the test FIRST (assert decode is unaffected by the new fields present) so it fails before the `METADATA_KEYS` fix and passes after — a genuine before/after proof, not a criterion that was already green.
**Warning signs:** Any chart going blank / "No records returned" immediately after this phase ships, with no other code change nearby.

### Pitfall 2: Treating Timeline/NumericLine/Calendar's existing `truncated` state as if it already covers row-level truncation
**What goes wrong:** Timeline/NumericLine's `seriesInfo.truncated` (`TimelineRenderer.tsx:254,265`) is a top-N **series-count** truncation flag from an entirely separate pre-query — it says nothing about whether each series' own bucket data was cut short by the envelope cap. Someone skimming for "does this chart already warn on truncation" could wrongly conclude Timeline is covered and skip auditing its SQL-level LIMIT math (§2b).
**How to avoid:** This research's §2b table makes the distinction explicit; the planner should NOT reuse `seriesInfo.truncated`/`data-testid="timeline-truncated-note"` as evidence Timeline is safe from the row-cap bug.

### Pitfall 3: Assuming Calendar is "bounded... safe in practice" because the milestone's own prior ARCHITECTURE.md said so
**What goes wrong:** `CELL_LIMIT = 10000` (`calendarBin.ts:110`) is already above the current 1,000-row cap and CalendarRenderer has **no** truncation-detection UI of any kind. ARCHITECTURE.md's blanket "grouped/bucketed queries... safe in practice" claim does not hold for Calendar once actually traced through its SQL builder.
**How to avoid:** Verify file:line claims in prior research rather than copying them forward, exactly as this research's own instructions required — this phase's research found the gap by reading `buildCalendarSql.ts`/`calendarBin.ts` directly rather than trusting the summary.

### Pitfall 4: A client-supplied `limit` reaching `/api/sql` unclamped (D-04)
**What goes wrong:** `index.ts:2909-2913`'s passthrough (`extra: options`) forwards whatever `options.limit` the client sends verbatim into the envelope. Once the hardcoded `1000` is gone, a malicious or buggy client request with `{ options: { limit: 5000000 } }` would be honored up to Kinetica's own server ceiling, pulling an unbounded result through the Node process in one response.
**How to avoid:** The `/api/sql` handler itself must clamp `options.limit` (if present) to `KINETICA_MAX_ROWS_PER_QUERY` BEFORE spreading it into `extra` — this is the one genuinely new piece of validation logic this phase adds at the route layer, not inside `kineticaSql` (which has no way to distinguish "a trusted server-internal caller's `extra.limit`" from "an untrusted client's forwarded `options.limit`" — they arrive through the identical `extra` parameter).
**Warning signs:** A test sending an absurdly large `options.limit` to `/api/sql` and asserting the ACTUAL envelope body sent to Kinetica (via the mocked-`fetch` call args) was clamped, not the raw value.

## Code Examples

### Existing kineticaSql test pattern to extend (`kinetica.sql.spec.ts:1-88`)
```ts
// Source: packages/server/tests/kinetica.sql.spec.ts (read directly)
const happyBody = {
  status: "OK",
  data_str: JSON.stringify({
    json_encoded_response: JSON.stringify({ column_1: [1, 2] }),
  }),
};
const mockFetch = (status: number, body?: unknown) => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body !== undefined ? JSON.stringify(body) : "", { status, headers: {...} })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
// New test should extend happyBody with has_more_records/total_number_of_records
// siblings inside data_str (per §3's doc-verified shape) and assert kineticaSql's
// return value surfaces them alongside column_1.
```

### Existing `/api/auth/me` env-to-browser precedent to copy for D-07 (`index.ts:449`, `client.ts:252,289`, `store/auth.ts:22,40,55`)
```ts
// Source: packages/server/src/index.ts:449 (read directly)
return res.json({
  user: { username: loaded.session.username, roles, permissions },
  authMode,
  ttlKeepaliveLeadMinutes: TTL_KEEPALIVE_LEAD_MINUTES,
  maxCombinationViewsPerTable: MAX_COMBINATION_VIEWS_PER_TABLE,
  dvFilterScopeDisabled: DISABLE_DV_FILTER_SCOPE,
  maxBarGroupBySeriesCap: MAX_BAR_GROUP_BY_SERIES,
  // + csvInBrowserMaxRows: CSV_INBROWSER_MAX_ROWS,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| Hardcoded envelope `limit: 1000` for every Kinetica SQL call | Deploy-time env ceiling (`KINETICA_MAX_ROWS_PER_QUERY`, default 20,000) + per-call batch size (`KINETICA_MAX_RECORDS_PER_CALL`), server-side splitting | This phase | Unblocks every AT-RISK caller in §2 simultaneously; admin-tunable without a redeploy of code |
| Client infers "exhausted" from a short page (`rows.length < limit`) | Server-authoritative `has_more_records` signal | This phase | Removes the exact mechanism (§7) that produced the 1,000-row CSV bug and the suppressed heatmap banner |
| Heatmap banner compares returned rows to the REQUESTED limit | Compares against a server-provided "more exist" signal | This phase | Fixes false negatives (silently short above 1,000) and the false positive CLAUDE.md's own lesson would flag (exactly-full grid warning) |

**Deprecated/outdated:** the "Capped at N rows" toast (`WidgetRenderer.tsx:2023`) — replaced by D-08's "Downloaded the first N of M rows" message.

## Open Questions

1. **Should Calendar (and/or grouped Timeline/NumericLine) get an explicit D-12-style "limited to N rows" notice in THIS phase, or is the default-raise-only fix sufficient?**
   - What we know: both are currently silently truncated above 1,000 rows today (confirmed by direct code read, §2b); raising the default to 20,000 makes the silent truncation NOT HAPPEN under default config; neither is named in CONTEXT.md's locked D-13/14/15 (heatmap-specific); D-12's TEXT is generic ("on ANY widget") but its author's own commentary only anticipated records tables.
   - What's unclear: whether the operator, if told about this newly-discovered gap, would want it folded into this phase (cheap: same `config-hint` mechanism, same `has_more_records` signal, just wired into two more renderers) or explicitly deferred as tech debt (to avoid scope growth mid-phase, consistent with CLAUDE.md's "don't reinterpret explicit requirement wording" caution).
   - Recommendation: surface this finding to the operator/planner explicitly before planning tasks; do not silently expand scope, but also do not silently drop a confirmed, previously-unknown silent-truncation bug this research discovered. A single sentence added to the phase's PLAN.md scope note, or a deliberate "logged as follow-up, not fixed here" decision, both satisfy the project's own evidentiary standards — only an UNDOCUMENTED gap is a problem.

2. **Exact final env var names.**
   - What we know: CONTEXT.md suggests `KINETICA_MAX_ROWS_PER_QUERY`, `KINETICA_MAX_RECORDS_PER_CALL`, `CSV_INBROWSER_MAX_ROWS`, all "at Claude's discretion" for final naming.
   - What's unclear: nothing technical — these names are clear, descriptive, and consistent with existing naming (`DEFAULT_VIEW_TTL_MINUTES`, `MAX_BAR_GROUP_BY_SERIES`). Recommendation: use them verbatim as suggested; no reason to deviate.

3. **Whether the batch-splitting mechanism (D-02/D-03) needs to be built in this phase at all, given it only activates on an admin misconfiguration that is, by definition, not the default.**
   - What we know: D-02/D-03 are locked decisions, not optional — the operator's own words explicitly require it ("if they increase it to 40000, the code needs to make sure it splits the batch into 2").
   - What's unclear: nothing — this is locked. Flagging only to make clear to the planner that this is a REQUIRED code path even though it is not exercised by default-config integration tests; it needs its OWN dedicated unit test (mocked 2-call sequence) since no end-to-end test will ever hit it under default settings.

## Sources

### Primary (HIGH confidence — read directly from the current checkout, 2026-10-02)
- `packages/server/src/kinetica.ts` (full file) — `kineticaSql`, hardcoded `limit: 1000` (:187), `extra` spread (:192), `dataStr`/`json_encoded_response` extraction (:232-237), per-call `process.env.KINETICA_URL` reads (:175, :298)
- `packages/server/src/index.ts` — boot env-closure convention (:156-241), every `kineticaSqlHelper` call site (:1187-2915, enumerated in §2a), `/api/auth/me` (:436-449), `/api/sql` (:2904-2915)
- `packages/web/src/components/charts/WidgetRenderer.tsx` — `parseKineticaResponse` (:243-306), `AggregatedWidgetRenderer` chart-query effect (:560-658), `HeatmapRenderer` call site (:854), `RecordsTableRenderer` (:1853-2385, including `handleDownloadCsv` :1957-2031, page-fetch effect :2053-2140, total-count effect :2145-2204, footer markup :2365-2385)
- `packages/web/src/components/charts/HeatmapRenderer.tsx` (full file) — `cellLimit`/`truncated` logic (:285-341)
- `packages/web/src/lib/heatmapGrid.ts` (full file) — `HEATMAP_CELL_LIMIT = 5000`
- `packages/web/src/components/charts/ChartConfigPanel.tsx` — `HEATMAP_LIMITS`/`ALLOWED_LIMITS`/`ALLOWED_LIMITS_C` (:36, :479-496, :945-965), generic `"number"` field case with no min/max (:1146-1155), `maxBarGroupBySeriesCap` clamp precedent (:442)
- `packages/web/src/components/charts/definitions/records.ts` (full file) — `pageSize`/`csvDownloadRowCap`/`enableCsvDownload` field defs
- `packages/web/src/components/charts/TimelineRenderer.tsx`, `NumericLineRenderer.tsx`, `CalendarRenderer.tsx`, `CalendarConfigPanel.tsx`, `TimelineConfigPanel.tsx`, `NumericLineConfigPanel.tsx` — grouped-query LIMIT math, `maxIntervals`/`maxBuckets` UI clamps, existing series-truncation state (distinct from row truncation)
- `packages/web/src/lib/buildTimelineSql.ts`, `buildNumericLineSql.ts`, `buildCalendarSql.ts`, `lib/calendarBin.ts`, `lib/groupedSeries.ts` (`MAX_SERIES = 12`) — SQL-level LIMIT derivations
- `packages/web/src/api/client.ts` — `runSql` (:299-316), `MeResponse` type (:252), `fetchMe` (:273-297)
- `packages/web/src/store/auth.ts` (:1-60) — the five-hop env-to-browser chain's client-side half
- `packages/web/src/styles/global.css` — `.config-hint` (:1319, :2817, :4549)
- `packages/server/tests/kinetica.sql.spec.ts`, `routes.sql.spec.ts` — existing mock/test patterns to extend
- `packages/web/src/components/charts/WidgetRenderer.spec.tsx` — `EMPTY_RESPONSE` fixture pattern (:263-268)
- `CLAUDE.md` — UI class reuse, verifiable-acceptance-criteria discipline, test gates
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` § Phase 127, `.planning/phases/127-.../127-CONTEXT.md`, `.planning/config.json` (`nyquist_validation: false`)

### Secondary (MEDIUM confidence)
- `max_get_records_size` default value (≈20,000) — carried forward from milestone STACK.md as WebSearch-synthesized, not independently reconfirmed this session (task constraints bar live Kinetica calls)

### Tertiary (LOW confidence, flagged explicitly, not asserted as fact)
- Row-ordering stability across repeated identical-SQL `/execute/sql` calls with an incrementing envelope `offset`, absent an explicit unique `ORDER BY` — not documented either way by Kinetica; deferred to Phase 128's live spike per §3

### Official docs fetched this session
- https://docs.kinetica.com/7.1/api/rest/execute_sql_rest/ (fetched 2026-10-02) — full response JSON shape including `data_str.has_more_records`/`data_str.total_number_of_records`/`data_str.paging_table`, `limit`/`offset`/`options.paging_table`/`options.paging_table_ttl` request semantics, quoted verbatim in §3

## Metadata

**Confidence breakdown:**
- Caller audit (§2): HIGH — every row in the table is a direct file:line read, not inferred; two findings (Calendar, grouped Timeline/NumericLine) correct/extend the milestone's own prior research
- Response-shape / `has_more_records` location (§3): HIGH for the doc-verified shape; MEDIUM-LOW for the one unresolved live-semantics question, explicitly flagged and scoped out
- Env-to-browser mechanism (§5), heatmap fix (§6), CSV loop (§7): HIGH — all precedent-based, read directly, with exact line numbers

**Research date:** 2026-10-02
**Valid until:** ~30 days (stable first-party code; the one external dependency, Kinetica's documented response shape, is unlikely to change within a 7.1 point release)

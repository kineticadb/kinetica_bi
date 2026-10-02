# Phase 127: Row-Limit Ceiling, Caller Audit & Heatmap Truncation Fix - Context

**Gathered:** 2026-10-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Every app query that asks Kinetica for more than 1,000 rows actually gets them — audited caller by caller, not assumed safe by one default bump — the existing in-browser CSV download works up to its row cap, and a heatmap that really is truncated always says so. Requirements: EXPRT-V126-01, -02, -03.

NOT in this phase: the server-side background export job, resumable download, gzip, export history (Phases 128-131); formula-injection escaping (EXPRT-V126-04, Phase 128); the line chart (Phase 132).

</domain>

<decisions>
## Implementation Decisions

### What replaces the 1,000 cap
- **D-01 — A deploy-time env var is the per-QUERY maximum**, replacing the hardcoded `limit: 1000` in `kineticaSql` (`packages/server/src/kinetica.ts:186`). Default **20,000**. Suggested name `KINETICA_MAX_ROWS_PER_QUERY` (final name at Claude's discretion, following `env.ts` conventions). An app-level safety net remains; an admin raises it without a code change. Env, not a settings UI — the operator's standing preference for set-once deploy values.
- **D-02 — A SECOND env var is the per-CALL batch size**, default **20,000**, matching Kinetica's `max_get_records_size`. Suggested name `KINETICA_MAX_RECORDS_PER_CALL`. **No single Kinetica API call may request more than this.** Operator's words: "Kinetica max_get_records is 20000 so you cannot exceed that in a single API call, so if they increase it to 40000, the code needs to make sure it splits the batch into 2."
- **D-03 — The per-query max may exceed the per-call batch; the SERVER splits it.** A query whose effective limit is 40,000 with a 20,000 batch is served by two Kinetica calls (offset 0 and offset 20,000), concatenated, and returned as one result. Splitting is transparent to callers.
- **D-04 — A browser-requested limit is clamped to the per-query max.** `/api/sql` forwards client `options` as `extra` today, and `extra.limit` overrides the default (`kinetica.ts:160-194`). The browser may ask for less than the max, never more. No single request pulls an unbounded result through the app server.
- **D-05 — Callers that already pin their own limit keep it** (`index.ts:1190` `extra: { limit: 1 }`, `:2374` and `:2398` `extra: { limit: 50 }`), subject to the D-04 clamp.

### In-browser CSV size
- **D-06 — The in-browser download's default row cap stays 100,000** (the existing `csvDownloadRowCap` default, `WidgetRenderer.tsx:1941`). It now actually reaches it. This is also the hand-off point to the background job in Phase 131.
- **D-07 — An admin env HARD CEILING on the in-browser download**, which a designer's per-widget `csvDownloadRowCap` cannot exceed. A widget configured for 1M is clamped to it. Suggested name `CSV_INBROWSER_MAX_ROWS`. The web app has no direct env access at runtime, so the value must reach the browser from the server (mechanism at Claude's discretion — e.g. an existing config/health/me response).
- **D-08 — When the download stops at the cap, the message says how much was left out:** "Downloaded the first 100,000 of 1,234,567 rows". Use the records table's existing total-count query (`totalCount`, `WidgetRenderer.tsx:~2285`), not a new mechanism. Replaces today's "Capped at N rows" toast.
- **D-09 — The download button shows progress:** rows so far (e.g. "Exporting… 40,000 rows") instead of a static exporting state. The loop already pages, so this is cheap.
- **D-10 — The in-browser loop must stop on real exhaustion, not on "short page".** Today `if (rows.length < limit) break` (`WidgetRenderer.tsx:~1995`) is the exact mechanism that turned the server cap into a silent 1,000-row file. The server should expose an authoritative "more rows exist" signal — Kinetica's `has_more_records` — and the client should page on that. Mechanism at Claude's discretion.

### When Kinetica's own per-call limit is lower
- **D-11 — Misconfiguration tolerance:** if the batch env (D-02) is set higher than the deployment's real `max_get_records_size`, Kinetica returns a short page. The server MUST keep paging on `has_more_records` (never treat a short page as "done") and **log a warning once** that the batch env exceeds the server's max. No silent data loss, and queries keep working.
- **D-12 — Truncation is never silent, on ANY widget.** When a query's real result is larger than the per-query max (D-01), so the app returns only the first N, the widget shows a small **"limited to N rows"** notice. Same principle as the heatmap fix. The server must tell the caller that the result was cut (e.g. a `truncated` / `hasMore` flag on the `/api/sql` response). Charts' Result limits (max 500) and the heatmap's (max 5,000) never reach a 20,000 default, so in practice this mostly bites records tables with large page sizes and a lowered max. It must still be correct.

### Heatmap truncation warning
- **D-13 — Keep the compact one-line banner** (`HeatmapRenderer.tsx:322-340`, "Truncated to the top N cells", guidance in the `title` tooltip), but **N is the number of cells actually shown, never the requested limit.** Today a 2,500 Result limit that the server cut to 1,000 would claim 2,500, or (as today) show nothing at all.
- **D-14 — Warn only when more cells really exist.** Today `truncated = data.length >= cellLimit` (`:306`) warns falsely on a grid with exactly 5,000 real cells. Use the server's "more rows exist" signal (D-10/D-12) or fetch limit+1. An exactly-full grid must not show the banner.
- **D-15 — The tooltip names WHICH limit was hit**, because the fixes differ: the user's Result limit ("raise Result limit, narrow the query, or pick lower-cardinality axes") vs the deployment's per-query max ("ask an admin to raise `KINETICA_MAX_ROWS_PER_QUERY`").

### Claude's Discretion
- Exact env var names (suggested above) and their validation (positive integers; how a batch > max or a max < 1 is handled at boot).
- Where batch splitting lives (inside `kineticaSql` vs a wrapper) and how the "more rows exist" flag is surfaced on `/api/sql` responses without breaking existing consumers of `parseKineticaResponse`.
- How `CSV_INBROWSER_MAX_ROWS` reaches the browser.
- The form and location of the written caller audit (ROADMAP criterion 2 requires one, classifying every `runSql` / `kineticaSqlHelper` / `kineticaSql` call site as has-own-SQL-LIMIT / already-pins-`extra.limit` / needed-explicit-limit).
- Notice styling for D-12 — must reuse existing classes (e.g. `config-hint`, as the heatmap banner does). No invented class names (CLAUDE.md).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone scope and research
- `.planning/REQUIREMENTS.md` — EXPRT-V126-01, -02, -03 (this phase); -04 explicitly belongs to Phase 128
- `.planning/ROADMAP.md` § "Phase 127" — goal, four success criteria, canonical refs
- `.planning/research/SUMMARY.md` — consolidated findings; Phase 1 implications; open Kinetica-semantics gaps
- `.planning/research/ARCHITECTURE.md` § 1 "The 1000 ceiling's blast radius" — per-caller trace with file:line
- `.planning/research/PITFALLS.md` — raising the global limit: callers that relied on the cap as a safety net
- `.planning/research/STACK.md` — Kinetica `/execute/sql` `limit`/`offset`/`has_more_records` semantics, with doc URLs (note: it cites `src/lib/kinetica.ts`; the real path is `packages/server/src/kinetica.ts`)

### Code
- `packages/server/src/kinetica.ts:155-200` — `kineticaSql`: hardcoded `limit: 1000`; `...(options.extra ?? {})` spread after it is the existing override path
- `packages/server/src/index.ts:2904-2915` — `POST /api/sql` forwards client `options` as `extra` (the clamp site, D-04)
- `packages/server/src/index.ts:1190`, `:2374`, `:2398` — existing `extra.limit` pins
- `packages/web/src/api/client.ts:299-316` — `runSql`
- `packages/web/src/components/charts/WidgetRenderer.tsx:1939-2030` — `handleDownloadCsv`: `PAGE = 5000`, `csvDownloadRowCap` default 100,000, short-page break, "Capped at" toast
- `packages/web/src/components/charts/WidgetRenderer.tsx:~2100-2290` — records table paging, `pageSize`, `totalCount`
- `packages/web/src/components/charts/HeatmapRenderer.tsx:285-340` — `cellLimit`, `truncated`, banner + tooltip text
- `packages/web/src/lib/heatmapGrid.ts:56` — `HEATMAP_CELL_LIMIT = 5000`
- `packages/web/src/components/charts/ChartConfigPanel.tsx:36`, `:492`, `:945-965` — Result limit option lists (heatmap 250…5,000; others 5…500)
- `packages/server/src/env.ts` — env config conventions

### Project rules
- `CLAUDE.md` — UI class reuse (no invented class names), "Writing verifiable acceptance criteria" (measure every grep before relying on it), test gates (server vitest is set-based)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `options.extra` spread in `kineticaSql`: already the override mechanism for `limit`, proven by three call sites. Batch splitting and clamping build on it rather than replacing it.
- Records table `totalCount`: already computed for pagination. It supplies the "of M rows" total for D-08 without a new query path.
- `config-hint` class: used by the heatmap banner. The natural class for the D-12 notice.

### Established Patterns
- Env config for deploy-time knobs (`env.ts`); `.env.example` documents tuning knobs.
- **Hazard:** `packages/server/.env` is loaded into server vitest by `env.ts` `dotenv.config`. Dev overrides of the new env vars would falsely redden or green specs. Tests must set or clear these vars explicitly.
- Server vitest is SET-BASED: failing files must be ⊆ the known `TD-V16-TEST-ISOLATION` set (`packages/server/scripts/test-gate.mjs`).

### Integration Points
- `kineticaSql` is the single choke point for every Kinetica SQL call (`kineticaSqlHelper` and `/api/sql` route through it). The ceiling, the batch split, the clamp and the more-rows signal all land there or immediately around it.
- Any change to the `/api/sql` response shape must stay compatible with `parseKineticaResponse` consumers across `WidgetRenderer.tsx`, `HeatmapRenderer.tsx` and the other renderers.
- The export job (Phase 128) will always pass its own explicit batch limit and must not depend on the default. Phase 127's batch/max env values are what it reads.

</code_context>

<specifics>
## Specific Ideas

- Operator, verbatim: "use the 20000, but also make a note that Kinetica max_get_records is 20000 so you cannot exceed that in a single API call so if they increase it to 40000, the code needs to make sure it splits the batch into 2."
- The milestone's own bug report: a CSV download of a large table came back with exactly 1,000 rows and no indication anything was missing. Every fix in this phase is measured against "nothing is ever silently cut short".

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (A "Showing N of M cells" heatmap total was considered and declined: it needs an extra COUNT query per heatmap load.)

</deferred>

---

*Phase: 127-row-limit-ceiling-caller-audit-heatmap-truncation-fix*
*Context gathered: 2026-10-02*

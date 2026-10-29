# Phase 143: Claude Desktop MCP Connector — Context

**Started:** 2026-10-28 as a spike (`spike/kbi-mcp`), formalised 2026-10-29 at the operator's request.
**Why:** Gemini's free tier allows about 20 requests a day, which stalls live testing. The operator has a Claude subscription and already uses Claude Desktop with Kinetica's own MCP server, which can only produce a plain HTML page. Letting Claude Desktop build real Kinetica BI dashboards uses the subscription (no API key) and the dashboards stay in the product.
**Promotes:** AI-F6 ("MCP server facade over the tool registry") from the v2 list.

## Architecture (decided in the spike)

- **`packages/mcp`**: a stdio MCP server Claude Desktop runs locally (`@modelcontextprotocol/sdk` 1.32.1, pinned). It signs in to Kinetica BI as a user and forwards tool calls. Local tools: `list_tables`, `start_dashboard`, `finish_dashboard`. Kinetica BI's own tools (`describe_table`, `add_widget`, `add_dynamic_view`, `add_heatmap_layer`) come from `GET /api/mcp/tools`, so their schemas and descriptions stay the in-app AI's.
- **Server `/api/mcp/*`** (only when `MCP_ENABLED=true`): sessions held in memory (2 h TTL, 3 per user), each with a ShadowState. Mutate tools go through the same gateway as the in-app AI (`checkAiOp`: shape, allow-list, permission, reference, live schema). Read tools return only the data classes the configured AI data access allows (`isClassAllowed`). Claude never sends SQL.
- **Handoff:** `finish_dashboard` returns `/?dashboard=N&mcp=<session>`. The browser takes the ops once (`GET /api/mcp/sessions/:id/handoff`) and folds them into an unsaved AI session with the normal Keep / Discard bar. Nothing is saved until Keep. The browser fold (`foldSession`) is web-only, which is why the handoff reuses the browser.
- The MCP SDK is used only in `packages/mcp` (runs on the operator's machine), not in the server, so the v2.0 "no MCP SDK" out-of-scope row is unchanged for the server.

## Decisions taken during the spike UAT (2026-10-28/29)

- **D-01 Layout is the server's job, not Claude's.** `finish_dashboard` re-lays out every added widget (`placeFitBands`): text first full width, KPIs (2x2 when four beside a map), charts two across beside a map that fills the right half and matches the left column, records last. Aim: fits one screen when there are not too many widgets.
- **D-02 Text is sized in the browser.** The server cannot know the screen width; the browser refits text widgets at handoff (`refitTextLayouts`) and moves what is below.
- **D-03 Text widget renders markdown only, as React elements** (`lib/markdownText`, no dependency). HTML shows as text; only http/https/mailto links. The operator asked for "md or html"; HTML from a model on a shared dashboard is an XSS risk (CLAUDE.md boundary), so markdown only.
- **D-04 KPI number format** (`numberFormat`, `decimals`) and the text widget are add-only AI fields (like timeline), so ALLOW_LIST_VERSION is unchanged.
- **D-05 Instructions steer Claude:** short titles, findings in the text widget, label counts, currency KPIs, at most 3-4 summary bullets, never invent numbers.
- **D-06 App-wide chart fixes found in this UAT** (affect every dashboard): COUNT values skip the column format and get thousands separators; vertical bar labels tilt instead of dropping; single-series bar/line hide the legend; large value-axis ticks drop decimals; a KPI shows no label rather than "value"/"Count of x"; AI layers are clickable (info_enabled 1).

## Remaining work, in the operator's order (2026-10-29)

1. **Token sign-in (AIMCP-V20-04).** The connector signs in with a personal access token instead of a password in Claude Desktop's config.
2. **Cleanup on Discard (AIMCP-V20-05).** Discarding a Claude-built dashboard (or never opening the link) leaves no dashboard behind.
3. **AI activity kind (AIMCP-V20-06).** Claude Desktop builds are their own kind in the audit log and on the AI activity page.
4. **Keep without the in-app AI (AIMCP-V20-07).** Keep of a Claude Desktop build works when `AI_ENABLED` is off.
5. **Edit an existing dashboard (AIMCP-V20-08).** Claude can open a dashboard the user can edit and change it, reviewed with the same Keep bar.
6. **Filters (AIMCP-V20-09).** Claude can apply filters (session-only, like the in-app AI's).

## Constraints

- Credentials are written by the operator only; Claude never handles them.
- `.env` AI data-access edits are made by the operator.
- Commit only when asked; never push without asking.

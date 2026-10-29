# Requirements: Kinetica BI — v2.0 AI-Driven Dashboards

**Defined:** 2026-10-08
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

**Milestone goal:** A user asks a question in an AI visualization on the dashboard, and the AI answers by changing the dashboard itself — not by replying in a chat transcript. Designers can also ask it to build a starter dashboard from a table.

**Research:** `.planning/research/SUMMARY.md` (+ STACK, FEATURES, ARCHITECTURE, PITFALLS). Operator decisions after research: no Anthropic key available — the OpenAI-compatible adapter is the live-verified path (Gemini via AI Studio free tier for development + one local Ollama model); the Claude adapter is `fetch`-based, unit-tested only; `@anthropic-ai/sdk` is not added. Open spikes S1–S7 are listed in SUMMARY.md and resolved in their phases, not here.

## v1 Requirements

### Safety foundations

- [x] **AISAFE-V20-01**: `POST /api/filter/materialize` rejects any column that does not exist on the target table or view (closes `SSYNC-F6`). Lands before any AI filter or dynamic-view tool.
- [x] **AISAFE-V20-02**: Every AI-proposed change passes one server-side gateway — request shape, allow-list, the user's permissions, the live table schema — before reaching the browser. A change that fails any check is rejected and never applied.
- [x] **AISAFE-V20-03**: The AI never exceeds the asking user's rights: it sees only tables the user can see and proposes only changes the user's role allows.
- [x] **AISAFE-V20-04**: AI dynamic views are a structured description (table, joins, columns, filters, grouping, aggregates, sort, limit) that the server compiles to SQL. The model never submits raw SQL. *(Amended 2026-10-20, Phase 139 discussion D-07 — joins added: INNER/LEFT, equality keys, env cap AI_DV_MAX_JOINS default 2.)*
- [x] **AISAFE-V20-05**: Instructions hidden in data values, column names, table comments or dashboard titles cannot make the AI act beyond the gateway's rules. AI text renders as plain text only (no links, markdown or images). Proven with an injected-instruction fixture.
- [x] **AISAFE-V20-06**: Temporary Kinetica views the AI creates are removed on undo, discard, dashboard switch, logout and server restart.

### AI widget

- [x] **AIWID-V20-01**: A designer can add an AI widget to a dashboard. Its presentation follows the tile's size (no Compact/Full setting): a large tile shows the chat inline; a small tile shows an ask bar + history icon + a one-line result of the last answer, and the full conversation opens in a portalled drawer (full-screen on narrow screens). *(Changed 2026-10-12, Phase 134 discussion — was a designer-chosen Compact/Full mode.)*
- [x] **AIWID-V20-02**: A user types a question in the AI widget; the dashboard changes to answer it AND the widget keeps a full chat conversation (the user's prompts and the AI's full answers). All AI widgets on a dashboard share one conversation. *(Changed 2026-10-12 — was "no chat transcript".)*
- [x] **AIWID-V20-03**: Each AI answer in the conversation shows its full plain-text answer (not shortened), 2–3 clickable follow-up questions (clicking one asks it), and a **"Revert dashboard to this state"** button. *(Changed 2026-10-12 — was a short explanation in Full mode only.)*
- [x] **AIWID-V20-04**: The widget shows progress while the AI works, and the user can cancel. Only one answer runs at a time per widget.
- [ ] **AIWID-V20-05**: When a question is ambiguous, the widget offers 2–3 clickable choices instead of the AI guessing.
- [x] **AIWID-V20-06**: Widgets and layers the AI added or changed are visibly highlighted.
- [x] **AIWID-V20-07**: If the AI fails, is capped or is rate-limited (e.g. provider quota exceeded), the user sees a clear message and the dashboard is left unchanged.

### Dashboard actions

- [x] **AIACT-V20-01**: The AI can add a visualization.
- [x] **AIACT-V20-02**: The AI can remove a visualization.
- [x] **AIACT-V20-03**: The AI can edit an existing visualization's settings (chart type, metric, group-by, sort; colors only via theme tokens, never hex).
- [x] **AIACT-V20-04**: The AI can add a heatmap map layer (other layer types: AI-F12).
- [x] **AIACT-V20-05**: The AI can remove a map layer.
- [x] **AIACT-V20-06**: The AI can edit a heatmap map layer's style (other layer types: AI-F12).
- [x] **AIACT-V20-07**: The AI can add a session-only dynamic view and point widgets or layers at it; map tiles follow.
- [x] **AIACT-V20-08**: The AI can remove a dynamic view.
- [x] **AIACT-V20-09**: The AI can apply and clear filters through the existing filter path; charts, records tables and map tiles narrow exactly as they would after a click.
- [x] **AIACT-V20-10**: The AI places new widgets sensibly in the layout and can resize or reorder widgets.
- [x] **AIACT-V20-11**: A reference to a table or column that does not exist is repaired (at most 2 attempts) or refused — never applied.

### Session layer

- [x] **AISES-V20-01**: The changes from one answer apply together and immediately, and only the asking user sees them.
- [x] **AISES-V20-02**: A second answer builds on the first; no earlier AI change is lost.
- [x] **AISES-V20-03**: The user can revert the dashboard to the state after any earlier AI answer (and jump forward again to a later one); asking a new question after reverting replaces the later answers. Keep clears the history. *(Changed 2026-10-12 — was undo one answer at a time.)*
- [x] **AISES-V20-04**: A visible indicator shows the dashboard has unsaved AI changes (with counts), with Keep and Discard.
- [x] **AISES-V20-05**: Keep saves the added, changed and removed widgets, layers and dynamic views into the dashboard in one all-or-nothing step, only for a user with edit rights (otherwise Keep is not offered). Filters are not saved, and the user is told so.
- [x] **AISES-V20-06**: If someone else changed the dashboard since the AI session began, Keep refuses with a clear message rather than overwriting.
- [x] **AISES-V20-07**: Discard, or reloading the page, restores the saved dashboard exactly.

### Generate

- [ ] **AIGEN-V20-01**: A designer picks a table and asks for a starter dashboard; they get 4–8 widgets suited to its columns (e.g. KPIs, a time trend, a breakdown, a map if it has geometry, a records table) to review, refine by asking, and Keep.
- [ ] **AIGEN-V20-02**: Discarding a generated dashboard leaves nothing behind — no dashboard, widgets or views.

### Provider

- [x] **AIPRV-V20-01**: An admin sets the AI provider, endpoint, model and key through env. AI is off by default, and the app behaves exactly as today without it.
- [ ] **AIPRV-V20-02**: The OpenAI-compatible provider works end to end, proven live by the operator on **Gemini** (Google AI Studio).
- [ ] **AIPRV-V20-03**: The same provider is proven live on one named **local open model** (Ollama).
- [x] **AIPRV-V20-04**: A Claude provider exists and is unit-tested, documented as not live-verified.
- [x] **AIPRV-V20-05**: The API key never reaches the browser or the logs; automated tests never call a real provider or read the dev key.

### Governance

- [x] **AIGOV-V20-01**: An admin grants a **"Use AI"** permission to roles. Without it, a user cannot use or add the AI widget, and the server refuses AI requests.
- [x] **AIGOV-V20-02**: An admin sets AI data access through env: **schema** (default — the AI sees table structure and dashboard config; no row value ever reaches the provider, proven with a planted value) or **query** (the AI may also run queries).
- [x] **AIGOV-V20-03**: In query mode, AI queries are single read-only SELECT statements, run as the user with their own Kinetica credentials and a row cap; anything else is refused.
- [x] **AIGOV-V20-04**: Every AI answer is logged — who asked, on which dashboard, the question, the tools run, the changes applied or rejected, and the outcome — with no row values.
- [ ] **AIGOV-V20-05**: An admin can browse the AI log on an audit page gated by the existing `audit:view` permission. *(Changed 2026-10-12, Phase 135 discussion — was "its own permission".)*
- [x] **AIGOV-V20-06**: An admin sets AI usage caps through env (steps per answer, answers per user per hour); a capped user is told why.

### Claude Desktop (MCP) — added 2026-10-29, promotes AI-F6

- [x] **AIMCP-V20-01**: A user builds a new dashboard from Claude Desktop through a Kinetica BI MCP connector. Every change passes the same gateway as the in-app AI (no SQL, live schema, the user's permissions), and nothing is saved until the user opens the link and presses Keep.
- [x] **AIMCP-V20-02**: A Claude-built dashboard is laid out by the server to fit one screen when there are not too many widgets; text is sized to the real screen width in the browser.
- [x] **AIMCP-V20-03**: A Text widget shows markdown (headings, lists, tables, links) rendered without HTML; the user and the AI can add one.
- [x] **AIMCP-V20-04**: The connector signs in with a personal access token the user creates and can revoke, not a password in Claude Desktop's config.
- [x] **AIMCP-V20-05**: Discarding a Claude-built dashboard, or never opening its link, leaves no dashboard behind.
- [x] **AIMCP-V20-06**: Claude Desktop builds are their own kind in the AI log and on the AI activity page.
- [x] **AIMCP-V20-07**: Keep of a Claude Desktop build works when the in-app AI is turned off.
- [x] **AIMCP-V20-08**: Claude can change an existing dashboard the user can edit, reviewed with the same Keep bar.
- [x] **AIMCP-V20-09**: Claude can apply filters, session-only like the in-app AI's.

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

- **AI-F1**: Per-step undo (undo one change within an answer).
- **AI-F2**: An in-widget list of what the AI changed (audit-trail view in the widget).
- **AI-F3**: Generate a dashboard across multiple related tables (joins).
- **AI-F4**: Keep also saves AI-applied filters as dashboard defaults.
- **AI-F5**: Kinetica SQL-GPT as an optional SQL-suggestion tool.
- ~~**AI-F6**: MCP server facade over the tool registry.~~ Promoted 2026-10-29 to Phase 143 (AIMCP-V20-01..09).
- **AI-F7**: Proactive insights (AI surfaces anomalies unasked).
- **AI-F8**: Voice input.
- **AI-F9**: Plan-then-approve mode (propose changes before applying).
- **AI-F10**: Thumbs up/down feedback on answers.
- **AI-F11**: Live verification of the Claude provider (needs an Anthropic key).
- **AI-F12**: The AI can add and edit raster, class-break and track map layers.
- **AI-F13**: A per-dashboard "viewers can prompt" switch (Tableau-style) on top of the "Use AI" role permission — e.g. for kiosk/read-only dashboards.

## Out of Scope

| Feature | Reason |
|---------|--------|
| ~~Chat transcript / side-panel chat~~ | REMOVED from out-of-scope 2026-10-12 (Phase 134 discussion): the operator chose a full chat conversation in the AI widget with a revert button per answer; the dashboard still changes to answer. |
| Raw AI-written SQL (dynamic views or queries outside the guarded SELECT tool) | Injection, privilege and cost risk on a GPU DB; the structured spec replaces it. |
| AI saving to the shared dashboard without Keep | Other viewers must never see unreviewed AI changes. |
| AI settings stored in the DB or a settings UI | Operator prefers env config for set-once deploy values. |
| AI session surviving a page reload | Locked: reload reverts to the saved dashboard. |
| `@anthropic-ai/sdk`, Vercel AI SDK, `openai`, LangChain, MCP SDK | Cannot be exercised without a key / need Node ≥22 / unnecessary weight; adapters are `fetch`-based. Still true for the server. Phase 143's `packages/mcp` uses the MCP SDK (pinned 1.32.1); it runs on the user's machine for Claude Desktop, not in the server. |

## Traceability

Which phases cover which requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AISAFE-V20-01 | Phase 133 | Complete |
| AISAFE-V20-02 | Phase 135 | Complete |
| AISAFE-V20-03 | Phase 135 | Complete |
| AISAFE-V20-04 | Phase 139 | Complete (structured spec, no SQL field, compiled server-side with quoted identifiers; real Kinetica 7.2.3.12 UAT 2026-10-20 built APPROX median/percentile and DATE_TRUNC views; join live checks (preflight cancel, join through filter view) deferred to Phase 142 live UAT, covered by unit/e2e specs) |
| AISAFE-V20-05 | Phase 140 | Complete (INJ-1..11 obedient-provider fixtures + EGX-Q canary matrix; UAT 2026-10-21 light+dark: markup literal, no request to evil.test; live model adherence unverified until 142) |
| AISAFE-V20-06 | Phase 139 | Complete (operator UAT 2026-10-20 verified by listing views in Kinetica: gone after undo, discard, dashboard switch, logout (3 s) and server restart (boot sweep); 6th view refused; no TTL-only remainder observed; expired-session/OIDC-token/never-registered gap falls back to TTL) |
| AIWID-V20-01 | Phase 137 | Complete (operator UAT 2026-10-15 light+dark: picker add at 12x40, inline chat, small tile + right-anchored portalled drawer after fix 81117b2; drawer below 900 px not eyeballed, CSS media rule) |
| AIWID-V20-02 | Phase 137 | Complete (operator UAT 2026-10-15: conversation bubbles, auto-scroll, shared store; multi-widget sync unit-tested only) |
| AIWID-V20-03 | Phase 137 | Complete (operator UAT 2026-10-15 step 2: full answers, follow-ups, per-answer Revert; trailer follow-ups server-tested, live adherence in 142) |
| AIWID-V20-04 | Phase 137 | Complete (operator UAT 2026-10-15 step 3: spinner + elapsed, Send -> Cancel; one-at-a-time + cancel unit-tested; W1 deadline; S2 nginx block) |
| AIWID-V20-05 | Phase 137 | Partial (choices UI + choose_option contract done; live model adherence verified in Phase 142 UAT) |
| AIWID-V20-06 | Phase 137 | Complete (operator UAT 2026-10-15 steps 5/5b/5c: fading outline, pills, layer-only edit highlights the host map, Layers-panel AI row) |
| AIWID-V20-07 | Phase 137 | Complete (inline error + Retry operator-checked 2026-10-15; cap/quota/429 messages and unchanged dashboard unit-tested) |
| AIACT-V20-01 | Phase 136 | Complete |
| AIACT-V20-02 | Phase 136 | Complete |
| AIACT-V20-03 | Phase 136 | Complete |
| AIACT-V20-04 | Phase 136 | Complete |
| AIACT-V20-05 | Phase 136 | Complete |
| AIACT-V20-06 | Phase 136 | Complete |
| AIACT-V20-07 | Phase 139 | Complete (operator UAT 2026-10-20: bar and heatmap layer bound to an AI view render; real WMS tiles use the AI view name at both buildWmsParams sites, light and dark; drill filters work) |
| AIACT-V20-08 | Phase 139 | Complete (operator UAT 2026-10-20: removal repoints the fitting widget and drops the view-only one, view dropped, one Revert restores; saved-view removal asks once) |
| AIACT-V20-09 | Phase 138 | Complete |
| AIACT-V20-10 | Phase 136 | Complete |
| AIACT-V20-11 | Phase 136 | Complete |
| AISES-V20-01 | Phase 134 | Complete |
| AISES-V20-02 | Phase 134 | Complete |
| AISES-V20-03 | Phase 134 | Complete |
| AISES-V20-04 | Phase 137 | Complete (operator UAT 2026-10-15: bar with counts + Discard; operator accepted a visible-but-disabled Keep for this phase, Keep enabled in Phase 141) |
| AISES-V20-05 | Phase 141 | Complete (SC1/SC2 server-proven; SC4 operator UAT 2026-10-22 on Kinetica 7.2.3.12, reload matches, light+dark; UAT step 6 skipped by operator, covered by KEEP-ROUTE forged/partial-rights specs; join note deferred to 142) |
| AISES-V20-06 | Phase 141 | Complete (409 pre-check + in-transaction race proven; operator UAT step 5 two tabs, own-write chains pass, foreign write 409s, light+dark) |
| AISES-V20-07 | Phase 134 | Complete |
| AIGEN-V20-01 | Phase 142 | Pending |
| AIGEN-V20-02 | Phase 142 | Pending |
| AIPRV-V20-01 | Phase 133 | Complete |
| AIPRV-V20-02 | Phase 142 | Pending |
| AIPRV-V20-03 | Phase 142 | Pending |
| AIPRV-V20-04 | Phase 135 | Complete |
| AIPRV-V20-05 | Phase 135 | Complete |
| AIGOV-V20-01 | Phase 135 | Complete (server refusal + Roles grant in 135; widget use/add gate UI + server create/patch guard in 137; no-access widget view unit-tested, not operator-viewed) |
| AIGOV-V20-02 | Phase 135 | Complete |
| AIGOV-V20-03 | Phase 140 | Complete (libpg-query guard + run-as-user port; live spike on Kinetica 7.2.3.12: cap 200, timeout/cancel leave no tagged job, writes refused with 0 SQL sent; spike ran as admin, live model ask deferred to 142) |
| AIGOV-V20-04 | Phase 135 | Complete |
| AIGOV-V20-05 | Phase 142 | Pending |
| AIGOV-V20-06 | Phase 135 | Complete |
| AIMCP-V20-01 | Phase 143 | Complete (spike 91ede8b; live in Claude Desktop 2026-10-29) |
| AIMCP-V20-02 | Phase 143 | Complete (2ae8a5b, f5611dc, 0961ef6, 5301497; checked live at 1440 and 1920) |
| AIMCP-V20-03 | Phase 143 | Complete (d592ecb; dark and light, script shown as text) |
| AIMCP-V20-04 | Phase 143 | Complete (a410fbd; token created, used and revoked live in the Profile page, light and dark) |
| AIMCP-V20-05 | Phase 143 | Complete (a410fbd; Discard deleted the dashboard, Keep cleared the mark, checked in SQLite) |
| AIMCP-V20-06 | Phase 143 | Complete (a410fbd; AI activity row "Claude Desktop" seen live) |
| AIMCP-V20-07 | Phase 143 | Complete (a410fbd; route specs with AI off; browser handoff/Keep have no AI-config gate, not re-run live with AI off) |
| AIMCP-V20-08 | Phase 143 | Complete (955634f; rename, confirmed removal and an added note kept live on dashboard 59) |
| AIMCP-V20-09 | Phase 143 | Complete (filters applied live through the handoff; not saved by Keep) |

**Coverage:**
- v1 requirements: 53 total (44 + 9 AIMCP added 2026-10-29)
- Mapped to phases: 53 (133: 2, 134: 4, 135: 8, 136: 8, 137: 8, 138: 1, 139: 4, 140: 2, 141: 2, 142: 5, 143: 9)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-08*
*Last updated: 2026-10-29 — Phase 143: AIMCP-V20-01..09 all complete (live-checked by Claude in the operator's Chrome through the connector routes; a live Claude Desktop run of 04-09 is the operator's next step). Earlier the same day: Phase 143 (Claude Desktop MCP connector) added: AIMCP-V20-01..09, promoting AI-F6; 01-03 complete from the spike and its UAT. Previously 2026-10-22 — Phase 141 complete: AISES-V20-05 and AISES-V20-06 Complete (automated proofs + operator UAT 2026-10-22 driven by Claude in the operator's Chrome, light and dark, Kinetica 7.2.3.12; step 6 rights UI skipped and covered by route specs; join note deferred to Phase 142; three UAT fixes e5bb56e, eaad490, 3aef06f). Previously 2026-10-21 — Phase 140 complete: AIGOV-V20-03 and AISAFE-V20-05 Complete (automated proofs + live spike and operator UAT 2026-10-21 driven by Claude, light and dark, Kinetica 7.2.3.12; live model adherence to the query rules deferred to Phase 142). Previously 2026-10-20 — Phase 139 complete: AIACT-V20-07, AIACT-V20-08, AISAFE-V20-04, AISAFE-V20-06 Complete (automated proofs + operator UAT 2026-10-20 driven by Claude in the operator's Chrome, light and dark, Kinetica 7.2.3.12; lifecycle verified by listing views; AISAFE-V20-04 amended to include joins (D-07); join preflight-cancel and join-through-filter-view live checks deferred to Phase 142). Previously 2026-10-16 — Phase 138 complete: AIACT-V20-09 Complete (automated proofs + operator UAT 2026-10-16 driven by Claude in the operator's Chrome, light and dark, against real Kinetica; AI filter produced the identical combination view and narrowed map tiles as a hand click; live model adherence deferred to Phase 142). Previously 2026-10-15 — Phase 137 complete: AIWID-V20-01/02/03/04/06/07, AISES-V20-04 and AIGOV-V20-01 Complete (automated proofs + operator UAT 2026-10-15 driven by Claude in the operator's Chrome, light and dark, 7 visual issues fixed in 81117b2 and re-verified; operator accepted a disabled Keep for AISES-V20-04 until Phase 141). AIWID-V20-05 Partial (no live ask was run; choices verified via harness only, live model adherence in Phase 142 UAT). Previously 2026-10-14 — Phase 136 complete: AIACT-V20-01/02/03/04/05/06/10/11 Complete (automated proofs + operator UAT 2026-10-14: VAL_ATTR tiles, light/dark, layout, removal approval, undo; legend "AI heat" row and layer-edit highlight on the host map carried to Phase 137 under AIWID-V20-06). Previously 2026-10-13 — Phase 135 complete: AISAFE-V20-02/03, AIPRV-V20-04/05, AIGOV-V20-02/04/06 Complete; AIGOV-V20-01 Partial (server + Roles done, widget-side gate with the AI widget in Phase 137; AIGOV-V20-02 delivers the env setting and schema-mode proof, query tools themselves are AIGOV-V20-03, Phase 140). Previously 2026-10-12 — AIWID-V20-01/02/03 and AISES-V20-03 changed to a full chat with per-answer revert and size-driven presentation (Phase 134 discussion + research); chat transcript removed from out-of-scope; AI-F13 added. Previously 2026-10-09 — AIACT-V20-04/06 narrowed to heatmap layers and AI-F12 added at the 133 operator checkpoint (2026-10-09); AISAFE-V20-01 and AIPRV-V20-01 complete*

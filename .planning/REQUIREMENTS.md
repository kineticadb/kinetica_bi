# Requirements: Kinetica BI — v2.0 AI-Driven Dashboards

**Defined:** 2026-10-08
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, enabling fast iterative analysis without writing SQL.

**Milestone goal:** A user asks a question in an AI visualization on the dashboard, and the AI answers by changing the dashboard itself — not by replying in a chat transcript. Designers can also ask it to build a starter dashboard from a table.

**Research:** `.planning/research/SUMMARY.md` (+ STACK, FEATURES, ARCHITECTURE, PITFALLS). Operator decisions after research: no Anthropic key available — the OpenAI-compatible adapter is the live-verified path (Gemini via AI Studio free tier for development + one local Ollama model); the Claude adapter is `fetch`-based, unit-tested only; `@anthropic-ai/sdk` is not added. Open spikes S1–S7 are listed in SUMMARY.md and resolved in their phases, not here.

## v1 Requirements

### Safety foundations

- [ ] **AISAFE-V20-01**: `POST /api/filter/materialize` rejects any column that does not exist on the target table or view (closes `SSYNC-F6`). Lands before any AI filter or dynamic-view tool.
- [ ] **AISAFE-V20-02**: Every AI-proposed change passes one server-side gateway — request shape, allow-list, the user's permissions, the live table schema — before reaching the browser. A change that fails any check is rejected and never applied.
- [ ] **AISAFE-V20-03**: The AI never exceeds the asking user's rights: it sees only tables the user can see and proposes only changes the user's role allows.
- [ ] **AISAFE-V20-04**: AI dynamic views are a structured description (table, columns, filters, grouping, aggregates, sort, limit) that the server compiles to SQL. The model never submits raw SQL.
- [ ] **AISAFE-V20-05**: Instructions hidden in data values, column names, table comments or dashboard titles cannot make the AI act beyond the gateway's rules. AI text renders as plain text only (no links, markdown or images). Proven with an injected-instruction fixture.
- [ ] **AISAFE-V20-06**: Temporary Kinetica views the AI creates are removed on undo, discard, dashboard switch, logout and server restart.

### AI widget

- [ ] **AIWID-V20-01**: A designer can add an AI widget to a dashboard and choose **Compact** (ask box only) or **Full** (ask box + explanation + suggested follow-ups).
- [ ] **AIWID-V20-02**: A user types a question in the AI widget and the dashboard changes to answer it. There is no chat transcript.
- [ ] **AIWID-V20-03**: In Full mode, after an answer the widget shows a short plain-text explanation and 2–3 clickable follow-up questions; clicking one asks it.
- [ ] **AIWID-V20-04**: The widget shows progress while the AI works, and the user can cancel. Only one answer runs at a time per widget.
- [ ] **AIWID-V20-05**: When a question is ambiguous, the widget offers 2–3 clickable choices instead of the AI guessing.
- [ ] **AIWID-V20-06**: Widgets and layers the AI added or changed are visibly highlighted.
- [ ] **AIWID-V20-07**: If the AI fails, is capped or is rate-limited (e.g. provider quota exceeded), the user sees a clear message and the dashboard is left unchanged.

### Dashboard actions

- [ ] **AIACT-V20-01**: The AI can add a visualization.
- [ ] **AIACT-V20-02**: The AI can remove a visualization.
- [ ] **AIACT-V20-03**: The AI can edit an existing visualization's settings (chart type, metric, group-by, sort; colors only via theme tokens, never hex).
- [ ] **AIACT-V20-04**: The AI can add a map layer.
- [ ] **AIACT-V20-05**: The AI can remove a map layer.
- [ ] **AIACT-V20-06**: The AI can edit a map layer's style or render mode (e.g. raster, heatmap, class-break).
- [ ] **AIACT-V20-07**: The AI can add a session-only dynamic view and point widgets or layers at it; map tiles follow.
- [ ] **AIACT-V20-08**: The AI can remove a dynamic view.
- [ ] **AIACT-V20-09**: The AI can apply and clear filters through the existing filter path; charts, records tables and map tiles narrow exactly as they would after a click.
- [ ] **AIACT-V20-10**: The AI places new widgets sensibly in the layout and can resize or reorder widgets.
- [ ] **AIACT-V20-11**: A reference to a table or column that does not exist is repaired (at most 2 attempts) or refused — never applied.

### Session layer

- [ ] **AISES-V20-01**: The changes from one answer apply together and immediately, and only the asking user sees them.
- [ ] **AISES-V20-02**: A second answer builds on the first; no earlier AI change is lost.
- [ ] **AISES-V20-03**: The user can undo the AI's changes one answer at a time.
- [ ] **AISES-V20-04**: A visible indicator shows the dashboard has unsaved AI changes (with counts), with Keep and Discard.
- [ ] **AISES-V20-05**: Keep saves the added, changed and removed widgets, layers and dynamic views into the dashboard in one all-or-nothing step, only for a user with edit rights (otherwise Keep is not offered). Filters are not saved, and the user is told so.
- [ ] **AISES-V20-06**: If someone else changed the dashboard since the AI session began, Keep refuses with a clear message rather than overwriting.
- [ ] **AISES-V20-07**: Discard, or reloading the page, restores the saved dashboard exactly.

### Generate

- [ ] **AIGEN-V20-01**: A designer picks a table and asks for a starter dashboard; they get 4–8 widgets suited to its columns (e.g. KPIs, a time trend, a breakdown, a map if it has geometry, a records table) to review, refine by asking, and Keep.
- [ ] **AIGEN-V20-02**: Discarding a generated dashboard leaves nothing behind — no dashboard, widgets or views.

### Provider

- [ ] **AIPRV-V20-01**: An admin sets the AI provider, endpoint, model and key through env. AI is off by default, and the app behaves exactly as today without it.
- [ ] **AIPRV-V20-02**: The OpenAI-compatible provider works end to end, proven live by the operator on **Gemini** (Google AI Studio).
- [ ] **AIPRV-V20-03**: The same provider is proven live on one named **local open model** (Ollama).
- [ ] **AIPRV-V20-04**: A Claude provider exists and is unit-tested, documented as not live-verified.
- [ ] **AIPRV-V20-05**: The API key never reaches the browser or the logs; automated tests never call a real provider or read the dev key.

### Governance

- [ ] **AIGOV-V20-01**: An admin grants a **"Use AI"** permission to roles. Without it, a user cannot use or add the AI widget, and the server refuses AI requests.
- [ ] **AIGOV-V20-02**: An admin sets AI data access through env: **schema** (default — the AI sees table structure and dashboard config; no row value ever reaches the provider, proven with a planted value) or **query** (the AI may also run queries).
- [ ] **AIGOV-V20-03**: In query mode, AI queries are single read-only SELECT statements, run as the user with their own Kinetica credentials and a row cap; anything else is refused.
- [ ] **AIGOV-V20-04**: Every AI answer is logged — who asked, on which dashboard, the question, the tools run, the changes applied or rejected, and the outcome — with no row values.
- [ ] **AIGOV-V20-05**: An admin can browse the AI log on an audit page gated by its own permission.
- [ ] **AIGOV-V20-06**: An admin sets AI usage caps through env (steps per answer, answers per user per hour); a capped user is told why.

## v2 Requirements

Deferred to a future release. Tracked but not in the current roadmap.

- **AI-F1**: Per-step undo (undo one change within an answer).
- **AI-F2**: An in-widget list of what the AI changed (audit-trail view in the widget).
- **AI-F3**: Generate a dashboard across multiple related tables (joins).
- **AI-F4**: Keep also saves AI-applied filters as dashboard defaults.
- **AI-F5**: Kinetica SQL-GPT as an optional SQL-suggestion tool.
- **AI-F6**: MCP server facade over the tool registry.
- **AI-F7**: Proactive insights (AI surfaces anomalies unasked).
- **AI-F8**: Voice input.
- **AI-F9**: Plan-then-approve mode (propose changes before applying).
- **AI-F10**: Thumbs up/down feedback on answers.
- **AI-F11**: Live verification of the Claude provider (needs an Anthropic key).

## Out of Scope

| Feature | Reason |
|---------|--------|
| Chat transcript / side-panel chat | The milestone's premise is that the dashboard is the answer. |
| Raw AI-written SQL (dynamic views or queries outside the guarded SELECT tool) | Injection, privilege and cost risk on a GPU DB; the structured spec replaces it. |
| AI saving to the shared dashboard without Keep | Other viewers must never see unreviewed AI changes. |
| AI settings stored in the DB or a settings UI | Operator prefers env config for set-once deploy values. |
| AI session surviving a page reload | Locked: reload reverts to the saved dashboard. |
| `@anthropic-ai/sdk`, Vercel AI SDK, `openai`, LangChain, MCP SDK | Cannot be exercised without a key / need Node ≥22 / unnecessary weight; adapters are `fetch`-based. |

## Traceability

Which phases cover which requirements.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AISAFE-V20-01 | Phase 133 | Pending |
| AISAFE-V20-02 | Phase 135 | Pending |
| AISAFE-V20-03 | Phase 135 | Pending |
| AISAFE-V20-04 | Phase 139 | Pending |
| AISAFE-V20-05 | Phase 140 | Pending |
| AISAFE-V20-06 | Phase 139 | Pending |
| AIWID-V20-01 | Phase 137 | Pending |
| AIWID-V20-02 | Phase 137 | Pending |
| AIWID-V20-03 | Phase 137 | Pending |
| AIWID-V20-04 | Phase 137 | Pending |
| AIWID-V20-05 | Phase 137 | Pending |
| AIWID-V20-06 | Phase 137 | Pending |
| AIWID-V20-07 | Phase 137 | Pending |
| AIACT-V20-01 | Phase 136 | Pending |
| AIACT-V20-02 | Phase 136 | Pending |
| AIACT-V20-03 | Phase 136 | Pending |
| AIACT-V20-04 | Phase 136 | Pending |
| AIACT-V20-05 | Phase 136 | Pending |
| AIACT-V20-06 | Phase 136 | Pending |
| AIACT-V20-07 | Phase 139 | Pending |
| AIACT-V20-08 | Phase 139 | Pending |
| AIACT-V20-09 | Phase 138 | Pending |
| AIACT-V20-10 | Phase 136 | Pending |
| AIACT-V20-11 | Phase 136 | Pending |
| AISES-V20-01 | Phase 134 | Pending |
| AISES-V20-02 | Phase 134 | Pending |
| AISES-V20-03 | Phase 134 | Pending |
| AISES-V20-04 | Phase 137 | Pending |
| AISES-V20-05 | Phase 141 | Pending |
| AISES-V20-06 | Phase 141 | Pending |
| AISES-V20-07 | Phase 134 | Pending |
| AIGEN-V20-01 | Phase 142 | Pending |
| AIGEN-V20-02 | Phase 142 | Pending |
| AIPRV-V20-01 | Phase 133 | Pending |
| AIPRV-V20-02 | Phase 142 | Pending |
| AIPRV-V20-03 | Phase 142 | Pending |
| AIPRV-V20-04 | Phase 135 | Pending |
| AIPRV-V20-05 | Phase 135 | Pending |
| AIGOV-V20-01 | Phase 135 | Pending |
| AIGOV-V20-02 | Phase 135 | Pending |
| AIGOV-V20-03 | Phase 140 | Pending |
| AIGOV-V20-04 | Phase 135 | Pending |
| AIGOV-V20-05 | Phase 142 | Pending |
| AIGOV-V20-06 | Phase 135 | Pending |

**Coverage:**
- v1 requirements: 44 total
- Mapped to phases: 44 (133: 2, 134: 4, 135: 8, 136: 8, 137: 8, 138: 1, 139: 4, 140: 2, 141: 2, 142: 5)
- Unmapped: 0 ✓

---
*Requirements defined: 2026-10-08*
*Last updated: 2026-10-08 after roadmap creation*

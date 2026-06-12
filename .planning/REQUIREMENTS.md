# Requirements: Kinetica BI — v1.11 Programmable Widgets (Cross-Widget Control)

**Defined:** 2026-06-10
**Core Value:** Click-through data exploration — users drill into chart elements and the entire dashboard filters to that slice of data, without writing SQL.

**Locked decisions (from milestone questioning + research, 2026-06-10):** Build a generic, serializable widget-action engine + a first control widget (radio group); AI chat widget and MCP server are DESIGNED-FOR but NOT built this milestone. Action contract is a serializable envelope `{ target, configPatch }` (zod-validated — the only new dep; also the future MCP `inputSchema`), NOT JSON-Patch or a typed command union. A **versioned allow-list** of patchable fields per target kind is the safety contract (no free-form patches) and ships in the engine foundation. The engine routes to THREE target kinds: **widget.config**, **map layer config** (`useDashboardLayersStore` / `dashboard_layers`, incl. top-level `track_config`/`cb_config`), and **dynamic-view config** (`dashboard_dynamic_views` — lower priority, "able to touch" but lighter verification). Same-dashboard targeting only. Must stay fully decoupled from the drill-down/filter + sole-materialize-trigger systems. Target widgets must re-render LIVE from externally-changed config (the read-once-at-mount trap is the #1 risk; mounted-renderer re-render test is the canary). MCP-future server surface is the existing `PATCH /api/widgets/:id` (+ layer/dynamic-view PATCH routes) — no new routes/WebSocket/action-log this milestone.

## v1 Requirements

### Action Engine & Contract

- [x] **ENGINE-V111-01**: A serializable widget-action contract — an envelope `{ target (kind + id), configPatch }` with NO closures or component refs (emittable by a non-human agent) — is defined and zod-validated; it is the single shape every caller (the radio widget now, a future AI/MCP layer) produces
- [x] **ENGINE-V111-02**: A single dispatch path applies an action to its target — transient session-overlay update (no runtime PATCH per the Phase 58 transient-for-everyone decision) — and the target widget re-renders LIVE from the changed config with NO remount (verified by a mounted-renderer re-render canary test)
- [x] **ENGINE-V111-03**: The engine routes actions to three target kinds: (a) a widget's `config` (widgets table), (b) a map layer's config via `useDashboardLayersStore` incl. the top-level `track_config`/`cb_config` fields, and (c) a dynamic-view's config (`dashboard_dynamic_views`); (a) and (b) are primary/verified, (c) is supported by the contract + router with lighter verification
- [x] **ENGINE-V111-04**: Targeting is same-dashboard only; an action whose target no longer exists (deleted widget/layer/dynamic-view) or whose field is absent fails safely — no crash, a no-op with a surfaced signal, no partial/corrupt write

### Safety & Decoupling

- [x] **SAFETY-V111-01**: A versioned allow-list defines exactly which config fields are patchable per target kind / widget type; an action patching any field outside it (or a prototype-polluting / meta key like `id`/`tableId`) is rejected by validation — no free-form `Object.assign`. The allow-list IS the contract a future AI/MCP layer is bound by (`ALLOW_LIST_VERSION` constant)
- [x] **SAFETY-V111-02**: The action engine never writes to the drill-down/filter stores or triggers materialize (no `filterVersion` bump, no `materializeFilter`) — the sole-materialize-trigger invariant is preserved, enforced by a static source-grep assertion (mirrors the `DataFilterRenderer` precedent)

### Radio Control Widget

- [x] **RADIO-V111-01**: A net-new "radio group" control widget type (registry definition + config panel + renderer) — the operator configures N options, each with a label and a bound action
- [x] **RADIO-V111-02**: The config panel lets the operator pick a same-dashboard target (widget / map layer / dynamic view) and an allowed field + value driven by the allow-list (no raw arbitrary JSON for unsafe fields); selecting an invalid/empty binding is prevented
- [x] **RADIO-V111-03**: Selecting a radio option applies its action — the target updates LIVE and the change persists across dashboard reload; the radio's own selected option persists (its `selectedIndex` is part of its config)

### AI/MCP Future Seam (design + document only)

- [x] **SEAM-V111-01**: The dispatch entry point (e.g. `applyWidgetAction`) and the action envelope are documented as the hook a future AI chat widget / MCP server reuses, with the concrete MCP tool shape noted (the envelope as zod `inputSchema`, calling the existing PATCH routes) — NO AI widget and NO MCP server are built this milestone

### Verification

- [ ] **VERIFY-V111-01**: Live operator UAT — a radio group switches a map layer's class-break render mode AND a widget.config field live + persisted across reload; an out-of-allow-list patch is rejected; no filter chips appear and no materialize fires; automated gates green (frontend 100%, web + server tsc clean, server set-based known-flaky gate)

## v2 Requirements

Deferred to a future milestone. Tracked but not in this roadmap.

### AI-Driven Dashboards

- **AI-V2-01**: AI chat widget — a user asks a question in natural language; an LLM emits widget-actions that reconfigure the dashboard to answer it
- **AI-V2-02**: MCP server exposing the widget-action envelope as tools, so an external AI agent can configure/drive a dashboard
- **AI-V2-03**: AI can compose new visualizations / zoom a map to relevant data / set filters, not just patch existing widget config

### More Control Widgets / Actions

- **CTRL-V2-01**: Additional control widget types (dropdown, buttons, toggle, slider)
- **CTRL-V2-02**: Actions that set data FILTERS (distinct from config; needs its own invariant analysis vs the existing drill-down/materialize pipeline)
- **CTRL-V2-03**: One control driving multiple targets at once / dashboard-wide parameters

## Out of Scope

Explicitly excluded for v1.11.

| Feature | Reason |
|---------|--------|
| AI chat widget | Large LLM-integration scope; v1.11 only designs the action seam it will reuse (SEAM-V111-01). Deferred to AI-V2-01. |
| MCP server | Built later on top of the same envelope; v1.11 documents the shape only. Deferred to AI-V2-02. |
| Control widgets beyond radio (dropdown/buttons/toggle/slider) | Prove the mechanism with one control type first. Deferred to CTRL-V2-01. |
| Actions that set data filters | Distinct from config-control; would entangle with the drill-down/sole-materialize-trigger systems. Deferred to CTRL-V2-02. |
| New Express routes / WebSocket / action-log table | The existing PATCH routes are the entire server surface; no new server infra needed. |
| Cross-dashboard targeting | Same-dashboard only for v1.11 (the `widgets` array scope). |
| JSON-Patch (RFC 6902) / fast-json-patch / immer / a new Zustand-vs-function bikeshed | Research: the shallow `{ ...config, ...configPatch }` envelope + zod is sufficient; dispatch-mechanism detail resolved at discuss/plan-phase. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ENGINE-V111-01 | Phase 58 | Complete |
| ENGINE-V111-02 | Phase 58 | Complete |
| ENGINE-V111-03 | Phase 58 | Complete |
| ENGINE-V111-04 | Phase 58 | Complete |
| SAFETY-V111-01 | Phase 58 | Complete |
| SAFETY-V111-02 | Phase 58 | Complete |
| RADIO-V111-01 | Phase 59 | Complete |
| RADIO-V111-02 | Phase 59 | Complete |
| RADIO-V111-03 | Phase 60 | Complete |
| SEAM-V111-01 | Phase 60 | Complete |
| VERIFY-V111-01 | Phase 61 | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11 ✓
- Unmapped: 0 ✓

**Phase distribution:**
- Phase 58 (Action Engine + Contract + Allow-List + Canary): ENGINE-V111-01..04, SAFETY-V111-01..02 (6)
- Phase 59 (Radio-Group Registry Def + Config Panel): RADIO-V111-01, RADIO-V111-02 (2)
- Phase 60 (Radio Renderer + Wiring + Persistence + MCP Seam Doc): RADIO-V111-03, SEAM-V111-01 (2)
- Phase 61 (Verification + Live UAT): VERIFY-V111-01 (1)

---
*Requirements defined: 2026-06-10*
*Last updated: 2026-06-10 — traceability populated at roadmap creation (Phases 58-61); 11/11 mapped, no orphans*

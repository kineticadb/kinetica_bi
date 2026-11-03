# Feature Research

**Domain:** AI-driven dashboards (AI widget that answers by mutating the dashboard) in an existing BI app
**Researched:** 2026-10-08
**Confidence:** MEDIUM (competitor claims verified via vendor docs for Power BI, Databricks, ThoughtSpot, Looker, Tableau, Kinetica; Hex Magic, Metabase Metabot, Omni NOT verified, so LOW; design recommendations are my synthesis)

## Key framing finding

Every mainstream product examined is a **chat/side-panel copilot** (Power BI Copilot pane, Tableau Agent, Spotter conversation, Looker Conversational Analytics chat, Genie Code agent). None found that makes "the dashboard itself is the answer" the primary UX, with a widget embedded in the dashboard. The milestone's concept is therefore a real differentiator in interaction model. Underneath, the *mechanics* (NL to structured edits, show-what-changed, undo, follow-up suggestions, explain-how) are well established and become table stakes. Do not copy the transcript; copy the trust mechanics.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Category: AI widget** | | | |
| Ask box (NL prompt) with busy/progress state and cancel | Every product has it; LLM calls take seconds | LOW | New widget type; reuse widget registry/config panel. Compact vs Full mode is a designer config enum |
| Short explanation of what was done (Full mode) | Looker "How was this calculated?" (text lists fields, filters, sort); Spotter query tokens; Databricks agent plans and confirms | MED | Model-emitted summary plus a *deterministic* change list built from the applied actions (do not trust model prose alone) |
| Clickable suggested follow-up questions (Full mode) | Tableau Pulse/Agent suggest initial and follow-up questions; Spotter and Looker support follow-ups | MED | Generate with each answer; also seed initial suggestions from schema/dashboard. Click = submit as prompt |
| Follow-up context (the "it", "now by region") | Spotter treats successive questions as follow-ups and shows the delta vs the previous step | MED | Keep a short server-side or client-held turn memory for the session; not displayed as a transcript |
| Clear "I couldn't do that" / clarifying outcome | Wrong/ambiguous answers are the main trust killer (Spotter has dedicated "Unexpected answers" docs) | MED | Structured refusal result, not a silent no-op; see Ambiguity below |
| **Category: Dashboard actions** | | | |
| Apply filters through the existing filter path | Tableau Agent handles filtering; every product filters | MED-HIGH | Must go through `filterCombinationStore` + materialize, not bypass. Action engine currently cannot set data filters (gap) |
| Add/remove visualization | Power BI Copilot adds/changes/deletes visuals; Tableau Agent builds/changes viz type | HIGH | Action engine only patches today; needs structural add/remove with validated config |
| Add/remove map layer | Milestone requirement | HIGH | Layer config is complex (`track_config` is a top-level field; WMS is a separate read-path: Map chart renderer wiring) |
| Add/remove dynamic view | Milestone requirement | MED-HIGH | Saved SQL-template views; needs permission check and template/param validation |
| Validate every model-proposed action against a schema + allow-list | Models emit invalid configs (nonexistent columns, wrong types) | MED | Extend `actionAllowList.ts`; reject server-side or client-side before apply; re-ask model with error (Databricks agent "fixes errors automatically") |
| **Category: Session layer / undo** | | | |
| Changes apply immediately | The milestone's "talking back" | MED | Overlay on `widgetActionStore`-style transient store; per-user, never PATCHed |
| Undo (step-level) and redo | Power BI Copilot integrates with the undo/redo stack; "Undo" is the standard safety net | MED | Per-turn undo stack of inverse operations; also "Undo all / Discard" |
| Visible indicator that unsaved AI changes exist | Users must know the view differs from the saved dashboard | LOW-MED | Banner/badge with Keep / Discard / Undo; per-viewer only |
| Keep (save) gated on edit permission | Milestone requirement; RBAC | MED | Reuse dashboard save + RBAC; analysts without edit rights see no Keep (or "export as copy") |
| Reload/discard reverts | Milestone requirement | LOW | Falls out of transient store |
| **Category: Generation** | | | |
| "Build a dashboard for table X" yields a starter dashboard | Power BI Copilot suggests report pages from data and creates on request; Databricks Genie Code agent plans then builds multi-page dashboards; Tableau Agent starts from a blank canvas | HIGH | Designer-only. Output should compile to existing widget configs (or the v1.24 export format) then apply as the session layer |
| Plan or suggest-before-build step | Power BI: Copilot suggests pages, user clicks Create per page; Databricks: agent plan approved before build | MED | For generation only: show proposed widget list; apply immediately on accept; analysts' small edits skip this |
| Result is editable with normal tools | Generated output must be refinable | LOW | Falls out of Keep: becomes ordinary widgets |
| **Category: Provider** | | | |
| Provider abstraction with tool-calling | Milestone requirement; on-prem demand | HIGH | Stack researcher covers; feature-wise needs a capability probe (tool support, context size) |
| Per-deployment provider config (env) | Matches operator preference for env config over runtime store | LOW | Env vars |
| **Category: Governance** | | | |
| Admin setting: schema-only vs results-as-user | Milestone requirement; Kinetica native LLM story is "data never leaves environment" and permissioned contexts | MED | Deploy-level env; results queried with the user's own credentials |
| Respect Kinetica per-user permissions and app RBAC for every AI action | An AI must not widen access | MED | AI actions run through the same endpoints/guards as manual actions; designer-only generation |
| Audit log of AI requests and actions | Enterprise expectation | MED | At least server log line per request with user, prompt, actions |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Dashboard-as-answer, no transcript** (widget embedded in the dashboard) | Competitors are chat panes; yours keeps the analyst looking at the data, which fits the core value (click-through exploration) | MED (UX is the work) | The defining differentiator. Compact mode is the purest form |
| Per-turn "what changed and why" strip (Full mode) | Spotter shows changes from the previous step; Looker shows steps/filters; combine into one concise delta list with per-item undo | MED | Built from applied-action records, not model text |
| Transient highlight of changed elements | Direct manipulation feedback ("this widget was just added") without a transcript | MED | Pulse/outline on added widgets, filter chips tagged "AI" |
| Per-action undo (not only per-turn) | Finer control than Power BI's start-over | MED | Cheap if actions are inverse-able records |
| AI changes visible as "AI-applied" filter chips in existing filter UI | Reuses filtering badges (which read `filterCombinationStore`) and teaches users the manual path | LOW-MED | Must read combination store, not legacy view store |
| Spatial awareness (map layers, WMS, track) | Competitors are largely tabular BI; Kinetica's geospatial strength | HIGH | Needs strict layer-config schema; map WMS read-path wiring |
| Kinetica SQL-GPT / native LLM as a provider option | On-prem, permissioned context objects, Kinetica-syntax SQL; data stays in customer environment | MED (LOW confidence it fits tool-calling) | Vendor blog says native LLM and context objects exist (2023); unverified whether it supports tool/function-calling. Likely suited to "propose SQL for a dynamic view" only, not general tool use. Flag for stack researcher |
| Generated dashboard exported/imported as JSON | Free by-product of v1.24 format: share, diff, review AI output | LOW | Optional; reuse as generation target format |
| Suggestions grounded in the current dashboard state | Follow-ups that reference visible widgets/filters rather than generic | MED | Feed dashboard config summary to model |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Chat transcript / history panel | Familiar from Copilot/Spotter | Contradicts locked decision; becomes the primary UI and hides the dashboard | Compact/Full widget; one-turn explanation + follow-up chips |
| Model writes arbitrary SQL / arbitrary config JSON applied unvalidated | Flexible | Injection, exfiltration, broken widgets, bypasses RBAC and schema-sync safety | Typed tool calls to a versioned allow-list; SQL only via dynamic-view templates with validation |
| AI auto-saves to the shared dashboard | Convenience | Others see unreviewed AI output; violates locked decision | Session layer + explicit Keep |
| Silent auto-repair of errors by retrying indefinitely | Hides failures | Cost, latency, nondeterminism | Bounded retry (1-2) with validation errors, then a clear failure |
| Free-text narrative insights ("revenue grew 12% because...") | Pulse-like; impressive demo | Hallucinated numbers; requires result data and causal claims | Explanations describe what was changed; numbers come from widgets, not model prose |
| Raw result rows sent to the model by default | Better answers | Data exfiltration; breaks air-gap promise | Default schema + config only; results only when admin enables |
| Per-user runtime AI settings UI / DB-stored API keys | Self-service | Operator prefers env config for set-once deploy values | Env vars |
| Voice input, multi-language prompt UI, scheduled AI insights/alerts | Seen in competitors (Pulse) | Out of scope; large surface | Defer |
| Auto-rename / auto-fix of schema changes by AI | Tempting after v1.25 | Schema-sync deliberately detect-only | Out of scope |
| Learning/feedback training loop (thumbs update model) | Spotter allows feedback | Needs persistence and curation | At most a log-only thumbs; defer |
| Multi-dashboard or cross-table joins by AI | "Ask anything" | Action engine scope is one dashboard; filters apply per Kinetica table | Constrain to current dashboard tables; say so on refusal |

## Wrong / Ambiguous Answers: how products handle it, and what to do here

- Looker: "How was this calculated?" exposes fields, calculations, filters, sort (docs.cloud.google.com, accessed 2026-10).
- ThoughtSpot Spotter: query tokens show how the data was computed; follow-ups show changes from the previous step; feedback on incorrect answers lets users edit the underlying search; dedicated "Unexpected answers" troubleshooting page.
- Databricks Genie Code agent: plans first, confirms next steps with the user, and fixes errors automatically.
- Power BI Copilot: undo/redo stack integration; page suggestions the user opts into; Undo restarts page creation.
- Tableau Agent: fuzzy matching for misspellings and semantic search for synonyms in filters.

Recommended here (my synthesis): (1) resolve columns/values against schema with fuzzy match before proposing; (2) if confidence is low or multiple columns match, return a clarification with clickable options (reuses the follow-up chip UI) rather than guessing; (3) always show the applied delta so a wrong guess is visible and one click from undo; (4) validation failures produce a plain-language "could not apply X because Y" and leave the dashboard unchanged (atomic per turn).

## Feature Dependencies

```
AI widget (new type, Compact/Full)
    └──requires──> Provider abstraction (tool-calling)
    └──requires──> Structured action vocabulary (add/remove widget, layer, dynamic view, set filter)
                       └──requires──> Extend v1.11 action engine + allow-list (structural + filters)
                       └──requires──> Filter path via filterCombinationStore + materialize
Session layer + undo stack ──requires──> Action engine with inverse-able records
Keep ──requires──> Session layer + dashboard save + RBAC (edit permission)
Dashboard generation ──requires──> add-widget action (or v1.24 import format) + schema access
Follow-up suggestions ──requires──> AI widget Full mode + provider
Results-as-user access ──requires──> Admin env setting + per-user Kinetica credentials (as in v1.26 export)
Governance/audit ──enhances──> everything
Chat transcript ──conflicts──> Dashboard-as-answer concept
```

### Dependency Notes

- **Structural actions require action-engine extension:** v1.11 only patches existing targets; add/remove and data filters are the gap. This is the critical path and should be its own early phase.
- **Filters must reuse the combination store:** badges and the table read-path read `filterCombinationStore`; AI filters going elsewhere go stale or bypass server-side materialize.
- **Map layer actions depend on map wiring:** WMS is a separate read-path, so layer add/remove must wire the map renderer, not just the widget renderer.
- **Keep depends on structural actions being persistable:** the session overlay must be convertible into the same save payloads as manual edits (and be import-format-compatible).
- **Generation depends on add-widget plus validation:** generated configs should reuse the v1.24 reference/remap discipline (text-valued refs such as frozen `config.sql` were a known blind spot).

## MVP Definition

### Launch With (v2.0; milestone says full loop, not a spike)

- [ ] AI widget (Compact + Full), ask box, progress/cancel, explanation, follow-up chips
- [ ] Provider abstraction, Claude default, one non-Claude/local path proven
- [ ] Action vocabulary: add/remove widget, add/remove layer, add/remove dynamic view, apply filters (via combination store), validated against allow-list
- [ ] Session layer, per-turn and per-action undo, Discard, Keep gated on edit permission, "unsaved AI changes" indicator
- [ ] Delta display ("what changed") built from applied actions
- [ ] Designer "build dashboard for table X" generation to session layer, refine, Keep
- [ ] Admin data-access setting (schema-only default vs results-as-user), RBAC-respecting execution, request audit log
- [ ] Clarify/refuse path and atomic per-turn apply

### Add After Validation (v2.x)

- [ ] Highlight pulse on changed elements - after UX feedback
- [ ] Plan-then-approve step for large generations - if users find big builds surprising
- [ ] Thumbs feedback logging - once there is a review process
- [ ] Kinetica SQL-GPT as an optional SQL-suggestion backend for dynamic views

### Future Consideration (v3+)

- [ ] Proactive insights/alerts (Pulse-style)
- [ ] Editing existing widget configs beyond what the allow-list permits (patch of arbitrary props), if not already covered
- [ ] Re-generation over an existing dashboard (cf. `DXIM-F5` re-import deferral)

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Structural + filter actions on action engine | HIGH | HIGH | P1 |
| Session layer + undo + Keep | HIGH | MEDIUM | P1 |
| AI widget Compact | HIGH | LOW-MED | P1 |
| Provider abstraction | HIGH | HIGH | P1 |
| Full mode explanation + follow-ups | MEDIUM-HIGH | MEDIUM | P1 (milestone-locked) |
| Delta ("what changed") display | HIGH | MEDIUM | P1 |
| Designer generation from table | HIGH | HIGH | P1 (milestone-locked) |
| Data-access admin setting | HIGH | MEDIUM | P1 |
| Clarification/ambiguity path | MEDIUM-HIGH | MEDIUM | P1 |
| Audit log | MEDIUM | LOW-MED | P2 |
| Change highlighting | MEDIUM | MEDIUM | P2 |
| Native Kinetica LLM backend | LOW-MED | MEDIUM | P3 |

## Competitor Feature Analysis

| Feature | Power BI Copilot | Tableau Agent / Pulse | ThoughtSpot Spotter | Looker Conv. Analytics | Databricks Genie Code | Our Approach |
|---------|------------------|-----------------------|---------------------|------------------------|-----------------------|--------------|
| Interaction model | Copilot pane | Conversational assistant in web author | Conversation | Chat | Agent mode in authoring | Widget on the dashboard, no transcript |
| Builds dashboard from data | Suggests pages, user clicks Create | Starts from blank canvas | n/a | n/a | Plans, builds multi-page, applies filters | Designer-only generation to session layer |
| Edits existing dashboard | Add/change/delete visuals | Filtering, viz type change, fuzzy match | Follow-up refines answer | n/a | Refines with you | Add/remove widgets, layers, dynamic views, filters |
| Undo | Undo/redo stack integration | Not verified | Not verified | Not verified | Plan approval instead | Per-action and per-turn undo; session-only layer |
| Explains | Not verified | Pulse: insights and source references | Query tokens, delta vs previous step | "How was this calculated?" | Plan/steps | Deterministic change list plus short summary |
| Follow-ups | Suggested prompts (not verified in detail) | Suggested initial and follow-up questions | Follow-ups | Follow-ups in chat | Iterative | Clickable chips (Full) |
| Wrong answers | Undo | Not verified | Feedback and edit search tokens | Show calculation | Auto-fix errors | Clarify options, atomic apply, undo |
| Local/private models | No | No | n/a | No | No | Pluggable provider (differentiator for on-prem) |

Not verified (LOW): Hex Magic, Metabase Metabot, Omni. Searches returned only Looker for that query; I did not retrieve their docs. Treat them as unresearched; the roadmap does not depend on them.

## Sources

- Power BI Copilot report creation (Microsoft Learn): https://learn.microsoft.com/en-in/power-bi/create-reports/copilot-create-report-service ; https://learn.microsoft.com/he-il/power-bi/create-reports/copilot-create-desktop-report ; https://powerbi.microsoft.com/blog/introducing-improvements-to-the-report-copilot-in-power-bi (MEDIUM; via search summaries, 2026)
- Databricks dashboard agent / Genie Code: https://docs.databricks.com/aws/en/dashboards/manage/dashboard-agent ; https://www.databricks.com/blog/whats-new-aibi-february-2026-roundup (MEDIUM; GA claim from search summary)
- ThoughtSpot Spotter: https://docs.thoughtspot.com/cloud/latest/spotter-getting-started ; https://docs.thoughtspot.com/cloud/latest/spotter-error (MEDIUM)
- Looker Conversational Analytics: https://docs.cloud.google.com/looker/docs/conversational-analytics-looker-data (MEDIUM)
- Tableau Agent: https://help.tableau.com/current/online/en-us/web_author_einstein.htm ; Pulse Q&A: https://help.tableau.com/current/online/en-us/pulse_ask_discover_qa.htm (MEDIUM)
- Kinetica native LLM / SQL-GPT: https://tdwi.org/articles/2023/09/18/kinetica-launches-native-llm-sql.aspx ; https://www.kinetica.com/blog/the-future-is-a-conversation-democratizing-big-data-analytics-with-kinetica (2023-era; LOW-MEDIUM for current state)
- Project context: .planning/PROJECT.md

---
*Feature research for: AI-driven dashboards (Kinetica BI v2.0)*
*Researched: 2026-10-08*

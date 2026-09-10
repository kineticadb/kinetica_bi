# Codebase Concerns

**Analysis Date:** 2026-03-23

## Tech Debt

**Large monolithic components:**
- Issue: `DashboardsPage.tsx` (579 lines) and `DatasetsPage.tsx` (398 lines) contain multiple concerns (list view, detail view, edit view, create view, modals) in single files, making them difficult to maintain and test.
- Files: `src/components/DashboardsPage.tsx`, `src/components/DatasetsPage.tsx`
- Impact: Harder to modify individual features without affecting others. Changes to one view mode risk breaking others. Testing individual features requires test setup for the entire component.
- Fix approach: Extract sub-components (Detail, Edit, Create, List, Modals) into separate files. Use composition to keep parent component focused on state and routing between views.

**Repetitive API error handling:**
- Issue: Every API call in `src/api/client.ts` duplicates identical error handling pattern: fetch, check response.ok, extract error text, throw new Error with formatted message.
- Files: `src/api/client.ts` (all 262 lines follow this pattern)
- Impact: Error handling changes require updates in 20+ locations. Inconsistent error messages if someone forgets the pattern. No centralized error recovery or retry logic.
- Fix approach: Create an `apiCall()` wrapper function that handles response validation and error formatting. Use it for all fetch operations. Allows centralized timeout, retry, and monitoring.

**Hard-coded Kinetica SQL limits and schema exclusions:**
- Issue: SQL queries in `server/src/index.ts` have hard-coded LIMIT 1000 and hard-coded schema exclusions in WHERE clauses.
- Files: `server/src/index.ts` lines 177-207 (kineticaSql function), line 213 (schema filter), lines 227 and 242 (table queries)
- Impact: Cannot query datasets > 1000 rows without code change. Adding/removing system schemas requires code modification and redeployment. No pagination support.
- Fix approach: Extract limits and schema filters to environment variables or config file. Implement pagination with offset/limit parameters passed from client. Use SQL parameter binding for schema names.

**Missing input validation:**
- Issue: API endpoints accept user input without comprehensive validation. `server/src/index.ts` validates presence of required fields but not format, length, or type safety.
- Files: `server/src/index.ts` (all POST/PATCH endpoints), `src/components/DashboardsPage.tsx` (form inputs), `src/components/DatasetsPage.tsx` (form inputs)
- Impact: Malformed data can corrupt database state. No protection against XSS in widget config or table descriptions. Column names/types from forms not validated before DB insert.
- Fix approach: Add schema validation library (zod/joi) to server. Validate dashboard names (length, special chars), table schemas (valid SQL identifiers), column JSON structure. Client-side: add field length limits and format checks.

**SQL injection vulnerability in Kinetica queries:**
- Issue: `server/src/index.ts` lines 227 and 242 use string interpolation with schema and table names in SQL queries: `WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}' AND TABLE_NAME = '${table.replace(/'/g, "''")}'`
- Files: `server/src/index.ts` lines 227, 242
- Impact: Users can craft schema/table names that bypass the escaping (e.g., `schema'); DROP TABLE widgets; --`) depending on Kinetica's SQL parser. The replace() approach is error-prone.
- Fix approach: Use parameterized queries if Kinetica's API supports them. If not, use a SQL escaping library designed for the target dialect. Add input validation to reject schema/table names with suspicious characters.

**No error recovery in UI:**
- Issue: Components display errors but provide no recovery mechanism. Failed API calls result in stuck UI state.
- Files: `src/components/DashboardsPage.tsx`, `src/components/DatasetsPage.tsx`, `src/components/Dashboard.tsx`
- Impact: Users must reload page to recover from failed operations. Failed batch operations (adding multiple tables) leave dashboard in partial state.
- Fix approach: Add retry buttons in error messages. Implement error boundaries. Store failed operations for retry. Add exponential backoff to API client.

## Known Bugs

**Modal state not cleared on successful action:**
- Symptoms: After creating a dashboard in `DashboardsPage`, modal closes but component state still thinks a save is in progress. Clicking "New Dashboard" again shows loading state until next successful interaction.
- Files: `src/components/DashboardsPage.tsx` (DashboardCreate, DashboardEdit components)
- Trigger: Create a dashboard, watch the save button show "Creating..." then see it persist
- Workaround: Refresh page after successful creation
- Root cause: Modal subcomponents manage their own `saving` state but don't reset it on successful callback. Parent component doesn't reset modal state.

**Empty grid layout causes crash in dashboard view:**
- Symptoms: Opening a dashboard with no widgets shows "No visualizations yet" message correctly, but if you add a widget and it fails to load, the grid layout doesn't re-render.
- Files: `src/components/DashboardsPage.tsx` (DashboardOpen component, lines 414-449)
- Trigger: Add widget, then close backend server before widget renders
- Workaround: Delete and re-add the widget, or refresh page
- Root cause: `mounted` state and `width` from `useContainerWidth` may not update when layout becomes non-empty

**Dashboard table association allows duplicates on concurrent requests:**
- Symptoms: Adding the same table to a dashboard twice via concurrent requests succeeds, showing duplicate in list temporarily until refresh.
- Files: `server/src/db.ts` lines 210-217, `src/components/DashboardsPage.tsx` lines 332-339
- Trigger: Click "Add Table" button twice rapidly before first request completes
- Workaround: Refresh page to see correct state (DB has INSERT OR IGNORE so no duplicate stored)
- Root cause: Client-side state update doesn't check for existing association before making request. No optimistic UI update preventing double-click.

## Security Considerations

**Basic auth credentials in plain HTTP requests:**
- Risk: Kinetica credentials are sent as Base64-encoded auth header in HTTP requests. Base64 is not encryption; it's trivially reversible.
- Files: `server/src/index.ts` lines 182, 264, 296 (Buffer.from auth header)
- Current mitigation: Environment variables store credentials (not in code). Assumes production runs over HTTPS.
- Recommendations: Enforce HTTPS in production. Consider using OAuth2 or API tokens instead of basic auth. Rotate credentials regularly. Log all Kinetica queries for audit trail.

**No authentication on backend API:**
- Risk: All endpoints in `server/src/index.ts` are public. Anyone with network access can create, modify, delete dashboards and run arbitrary SQL on Kinetica.
- Files: `server/src/index.ts` (all routes lack auth middleware)
- Current mitigation: CORS origin check on line 36, but easily bypassed from backend requests
- Recommendations: Add JWT or session-based auth. Implement per-dashboard access control. Audit sensitive operations (SQL execution). Add rate limiting.

**Widget config and table descriptions stored as plain JSON without validation:**
- Risk: Users can inject malicious JSON in widget config or descriptions that could be executed as JavaScript in browser or cause rendering issues.
- Files: `server/src/db.ts` (JSON.parse on lines 70, 156), `src/components/DashboardsPage.tsx` (widget config used to render layout)
- Current mitigation: React's JSX auto-escapes strings, but config objects are not validated
- Recommendations: Sanitize all user-input JSON with strict schema validation. Never eval() or use dangerouslySetInnerHTML with user data. Add CSP headers.

## Performance Bottlenecks

**Loading all tables and dashboards on page render:**
- Problem: DashboardsPage and DatasetsPage fetch all entities on mount without pagination. Rendering 1000 dashboards in a loop becomes slow.
- Files: `src/components/DashboardsPage.tsx` line 44-47, `src/components/DatasetsPage.tsx` line 29-32
- Cause: No server-side pagination. Frontend renders all rows in a single table.
- Improvement path: Implement limit/offset in client API calls. Add server endpoint parameters for limit, offset, sort. Use virtual scrolling (windowing) in table renders.

**Kinetica schema discovery causes full table scans:**
- Problem: `/api/kinetica/schemas/:schema/tables` and `/api/kinetica/schemas/:schema/tables/:table/columns` queries hit INFORMATION_SCHEMA directly without limit, potentially scanning large system catalogs.
- Files: `server/src/index.ts` lines 213, 227, 242
- Cause: INFORMATION_SCHEMA queries are unbounded. Kinetica must parse and return all matching rows.
- Improvement path: Cache schema/table metadata with TTL. Implement server-side caching layer. Add LIMIT clause. Use Kinetica REST API metadata endpoints if available instead of SQL queries.

**Re-fetching widget list on layout change:**
- Problem: `handleLayoutChange` in DashboardOpen calls `updateWidget` for each widget (lines 367-376), then immediately updates local state, causing double renders.
- Files: `src/components/DashboardsPage.tsx` lines 367-384
- Cause: Network request updates server state, then component state updates separately. No debouncing on layout drag/resize events.
- Improvement path: Batch layout updates (debounce 500ms before sending). Use optimistic updates (update local state immediately, sync to server in background). Show save indicator instead of making immediate requests.

## Fragile Areas

**Complex view state machine in DashboardsPage and DatasetsPage:**
- Files: `src/components/DashboardsPage.tsx` (View union type, multiple conditional renders), `src/components/DatasetsPage.tsx`
- Why fragile: Seven different view modes (list, view, edit, create, open for dashboards; list, view, edit, create for tables) controlled by single useState. Adding new mode requires understanding all state transitions and render paths. Easy to forget to update a transition handler.
- Safe modification: Extract each view mode into separate component or use routing library. Create helper function to transition between states. Add TypeScript exhaustiveness checks on View union.
- Test coverage: No tests for state transitions. Modal closure during operations, error states, and race conditions between view changes untested.

**Kinetica proxy endpoints without request/response validation:**
- Files: `server/src/index.ts` (lines 210-253 for schema discovery, lines 256-281 for WMS proxy, lines 284-316 for SQL proxy)
- Why fragile: Directly passes through Kinetica responses without checking schema. If Kinetica API changes, client breaks silently. Assumes Kinetica always returns expected JSON structure (column_1, column_2, json_encoded_response).
- Safe modification: Define TypeScript interfaces for expected Kinetica response shapes. Validate response structure before returning. Add tests with mock Kinetica responses.
- Test coverage: No tests for Kinetica integration. Connection failures, malformed responses, and timeout handling untested.

**Hardcoded widget visualization types:**
- Files: `src/components/DashboardsPage.tsx` lines 285-294 (VISUALIZATION_TYPES array)
- Why fragile: Adding new chart type requires updating this list, WidgetDto type, and likely adding render logic. Widget type stored as string in DB with no validation.
- Safe modification: Move VISUALIZATION_TYPES to config file or API endpoint. Fetch available types from backend. Add widget type validation on server.
- Test coverage: No tests for widget creation or validation.

**Database schema with no migrations:**
- Files: `server/src/db.ts` (schema created inline with db.exec)
- Why fragile: If DB exists from previous version, schema changes in code are silently ignored. Adding columns or constraints requires manual migration. No version tracking.
- Safe modification: Implement migration system (e.g., db-migrate or similar). Version schema. Add up/down migration functions. Always test schema changes.
- Test coverage: No tests for DB initialization or schema integrity.

## Scaling Limits

**SQLite database single writer:**
- Current capacity: Works for single server with <100 concurrent users
- Limit: SQLite's WAL mode allows one writer at a time. Multiple servers sharing same DB file causes corruption. More than 10 concurrent edits cause contention.
- Scaling path: Migrate to PostgreSQL or MySQL for multi-writer support. Run multiple backend instances with shared database. Add connection pooling.

**Hard-coded limit of 1000 rows from Kinetica:**
- Current capacity: Queries return max 1000 rows regardless of actual data size
- Limit: Dashboards with 1000+ row datasets silently truncate. Users don't know data is incomplete.
- Scaling path: Implement pagination with limit/offset. Stream results to client. Cache large queries. Use Kinetica's native pagination or cursors.

**All entities loaded in memory at page load:**
- Current capacity: <500 dashboards + tables render without noticeable lag
- Limit: 5000+ entities cause page to become sluggish. Table rendering slows to unusable levels.
- Scaling path: Implement server-side pagination. Use virtual scrolling in UI. Add search/filter to reduce visible items. Cache recent queries.

## Dependencies at Risk

**Zustand state management used minimally:**
- Risk: User store exists but only holds hardcoded user info. No shared state for dashboards/tables. Risk of state inconsistency if features expand without proper state management.
- Impact: Components prop-drill complex state. Hard to add features like "recently viewed dashboards" or "user preferences" without refactoring.
- Migration plan: Evaluate if Zustand or Redux needed. If minimal state required, consider lifting state to context providers. If complex, switch to Redux or Zustand with clear state shape.

**react-grid-layout dependency heavy for drag-drop:**
- Risk: Component adds bundle size (~50KB) for single drag-drop feature. ImportError if CSS not loaded breaks entire dashboard view.
- Impact: Large initial bundle. CSS import failure (line 20-22 of DashboardsPage.tsx) not caught until runtime.
- Migration plan: Assess if native drag-drop API sufficient for MVP. If full reordering needed, consider react-dnd. Test CSS loading in build step.

**Better-sqlite3 native binding:**
- Risk: Native binding compiled for current OS. Won't work on different architectures without recompiling. Publishing Docker image requires build in matching environment.
- Impact: Local dev on M1 Mac won't match Linux Docker image build. Production deployment fails if server crashes and auto-scales to different instance type.
- Migration plan: Use pure JS SQLite (sql.js or better-sqlite3-wasm) for portability, or accept native binding and enforce Docker build consistency.

**No typescript strict mode:**
- Risk: tsconfig.json doesn't specify `strict: true`, allowing `any` types and loose type checking. Tech debt accumulates as codebase grows.
- Impact: Type safety gaps hide bugs. IDE autocomplete unreliable. Refactoring risky.
- Migration plan: Enable strict mode in both tsconfig.json files. Fix resulting type errors incrementally in separate PRs.

## Missing Critical Features

**No data query UI for widgets:**
- Problem: Widgets are created but have no way to select what data they display. Widget type is stored but config remains empty {}.
- Blocks: Cannot build actual functional dashboards. Widgets render placeholder text.
- Effort: Medium - need SQL editor component, data preview, field mapping UI.

**No user authentication:**
- Problem: All endpoints public. No way to know who created/modified dashboards.
- Blocks: Multi-user features impossible. Audit trail missing. No per-user dashboard filtering.
- Effort: High - needs auth provider, JWT tokens, user management DB schema.

**No real-time sync between users:**
- Problem: Two users editing same dashboard doesn't show live updates. Last write wins.
- Blocks: Collaborative editing impossible. Confusing for multi-user deployments.
- Effort: High - needs WebSocket server, operational transform or CRDT, conflict resolution.

**No audit logging:**
- Problem: Cannot track who modified what or when. No access logs for dashboards.
- Blocks: Compliance features missing. Debugging data issues difficult.
- Effort: Medium - add audit log table, populate on mutations.

## Test Coverage Gaps

**No tests for DashboardsPage component:**
- What's not tested: State transitions between list/view/edit/create/open modes. Modal open/close. Add/remove table association. Drag-drop layout changes. Error states and recovery.
- Files: `src/components/DashboardsPage.tsx`
- Risk: State machine logic has no safety net. Broken transitions caught only in manual testing. Regressions introduced silently.
- Priority: High - largest component with most complex state

**No tests for API client:**
- What's not tested: Error handling and error message formatting. Successful response parsing. Network timeout/failure scenarios. Status code edge cases (204, 404, 5xx).
- Files: `src/api/client.ts`
- Risk: Breaking changes in backend API responses not caught. Error handling logic untested - errors in production may display wrong message or crash.
- Priority: High - guards all data flow

**No tests for database layer:**
- What's not tested: Schema creation. CRUD operations. Cascading deletes. Foreign key constraints. Concurrent inserts. Transaction behavior.
- Files: `server/src/db.ts`
- Risk: Data corruption scenarios (missing delete cascade, orphaned widgets) not caught. Schema changes break silently.
- Priority: High - foundation of backend

**No tests for server API endpoints:**
- What's not tested: Request validation. Error responses. Authorization (when added). Concurrent requests. Large payloads. SQL error propagation from Kinetica.
- Files: `server/src/index.ts`
- Risk: API contract changes break frontend silently. Malformed input crashes server. Error messages inconsistent or leak implementation details.
- Priority: High - server-client contract

**No E2E tests:**
- What's not tested: Create dashboard → Add table → Add widget → Drag layout → Save flow. Multi-page navigation. Error recovery workflows. Performance under load.
- Files: All
- Risk: Integration issues between components hidden. Only caught after deployment or by manual testing.
- Priority: Medium - catches critical user flows but not individual unit concerns

---

*Concerns audit: 2026-03-23*

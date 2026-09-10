# Architecture

**Analysis Date:** 2026-03-23

## Pattern Overview

**Overall:** Client-server full-stack application with separated frontend (React SPA) and backend (Node.js Express API)

**Key Characteristics:**
- Full-stack TypeScript with strict mode enabled
- RESTful API backend with SQLite persistence
- React component-based frontend with Zustand state management
- Dashboard/visualization builder with drag-and-drop grid layout
- Kinetica database integration for data discovery and SQL execution

## Layers

**Frontend (React SPA):**
- Purpose: Interactive UI for dashboard creation, visualization, and dataset management
- Location: `src/`
- Contains: React components, state store, API client, type definitions, styles
- Depends on: Backend API, browser APIs
- Used by: End users via browser

**Backend (Express API):**
- Purpose: REST API for dashboard/widget/table persistence, Kinetica proxy
- Location: `server/src/`
- Contains: Express routes, SQLite database layer, type definitions
- Depends on: SQLite database, Kinetica remote service
- Used by: React frontend, direct HTTP clients

**Database Layer:**
- Purpose: Local SQLite persistence for dashboards, widgets, tables, and associations
- Location: `server/src/db.ts`
- Contains: CRUD operations with proper mapping to domain models
- Depends on: better-sqlite3 driver
- Used by: All backend routes

## Data Flow

**Dashboard Creation Flow:**

1. User clicks "New Dashboard" in `DashboardsPage` component
2. UI renders `DashboardCreate` form component (input: name, description)
3. Form submission calls `createDashboard()` from `src/api/client.ts`
4. HTTP POST to `/api/dashboards` → `server/src/index.ts` route handler
5. Backend calls `createDashboard()` from `server/src/db.ts`
6. SQLite INSERT into `dashboards` table with auto-generated ID
7. Response returns `Dashboard` object (id, name, description, timestamps)
8. Frontend updates local state and redirects to detail view

**Widget Management Flow:**

1. User opens a dashboard in `DashboardOpen` component
2. Widgets loaded via `listWidgets(dashboardId)` from API
3. Widgets rendered in responsive grid via `react-grid-layout`
4. User drags/resizes widgets → `handleLayoutChange()` triggered
5. Each layout change persists via `updateWidget()` API call
6. Backend updates widget config (including layout coordinates) in SQLite
7. On next load, layout is restored from widget.config.layout

**Kinetica Discovery Flow:**

1. User creates new dataset in `TableCreate` component
2. `fetchKineticaSchemas()` fetches available schemas from Kinetica
3. Backend route `/api/kinetica/schemas` proxies SQL query to Kinetica
4. User selects schema → `fetchKineticaTables(schema)` loads table names
5. User selects table → `fetchKineticaColumns(schema, table)` loads column metadata
6. Column info previewed in UI before registration
7. `createTableEntry()` saves table metadata to local SQLite `tables` table
8. User can later query this table via dashboard visualizations

**State Management:**

- **Global User State:** Zustand store at `src/store/user.ts` (user name, role, initials)
- **Component Local State:** React hooks (useState) for form inputs, loading states, errors
- **Server Source of Truth:** All persistent data lives in SQLite; frontend is stateless between page loads
- **Layout State:** Widget positions/sizes stored in widget.config.layout JSON field

## Key Abstractions

**Dashboard:**
- Purpose: Container for visualizations and associated data tables
- Examples: `server/src/types.ts` (Dashboard type), `src/api/client.ts` (API functions)
- Pattern: Aggregate root with one-to-many relationship to Widgets

**Widget:**
- Purpose: Individual visualization on a dashboard with configurable layout and type
- Examples: `server/src/types.ts` (Widget type), `server/src/db.ts` (CRUD functions)
- Pattern: Value object with position, type, and flexible config JSON

**Table:**
- Purpose: Metadata registry of Kinetica tables available for dashboard queries
- Examples: `server/src/types.ts` (Table type), `server/src/db.ts` (Table CRUD)
- Pattern: Data Transfer Object (DTO) caching table schema and column information

**Dashboard-Table Association:**
- Purpose: Many-to-many relationship tracking which tables belong to a dashboard
- Examples: `server/src/db.ts` (listDashboardTables, addDashboardTable, removeDashboardTable)
- Pattern: Junction table with cascade deletes for referential integrity

**API Client:**
- Purpose: Typed HTTP client wrapping all backend endpoints
- Examples: `src/api/client.ts` (all exported async functions)
- Pattern: Fetch-based client with consistent error handling and JSON parsing

## Entry Points

**Frontend Entry:**
- Location: `src/main.tsx`
- Triggers: Browser loads index.html
- Responsibilities: Mounts React app into DOM root, imports global CSS

**Frontend App Root:**
- Location: `src/App.tsx`
- Triggers: Mounted by React at startup
- Responsibilities: Layout shell (sidebar, topbar, main content), page routing (useState), page delegation

**Backend Entry:**
- Location: `server/src/index.ts`
- Triggers: `npm run dev` or `npm run start`
- Responsibilities: Express app setup, middleware configuration (CORS, JSON), route registration, server listen

## Error Handling

**Strategy:** Graceful degradation with error messages to UI

**Patterns:**

- **API Errors:** All fetch calls wrapped in try-catch, error.message extracted and shown to user via state
- **Backend Validation:** Route handlers check required fields, return 400/404/500 with JSON error object
- **Kinetica Proxy:** SQL errors from remote service caught and re-thrown with context
- **Database Integrity:** SQLite foreign keys enabled; cascade deletes prevent orphaned records

Example error flow in `DashboardCreate`:
1. `createDashboard()` throws Error with message
2. Component catches in `.catch((err) => setSaveError(err.message))`
3. UI renders error div with text
4. User can retry after fixing input

## Cross-Cutting Concerns

**Logging:** Console.error calls in backend for failures (Kinetica, database); no structured logging configured

**Validation:** Frontend input validation (non-empty name), backend validation (required fields, type checks via TypeScript)

**Authentication:** Not implemented; assumes single-user or local-only deployment; no auth middleware

**CORS:** Configured in server setup; origin list from env var `CORS_ORIGIN` (comma-separated)

**Configuration:** Environment variables loaded via `dotenv`; critical vars: KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, DB_PATH, PORT, CORS_ORIGIN

---

*Architecture analysis: 2026-03-23*

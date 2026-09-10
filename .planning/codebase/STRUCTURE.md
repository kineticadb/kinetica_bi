# Codebase Structure

**Analysis Date:** 2026-03-23

## Directory Layout

```
kinetica_bi/
├── index.html              # Entry HTML page (React SPA root)
├── package.json            # Frontend dependencies (React, Recharts, Zustand)
├── tsconfig.json           # TypeScript configuration (strict: true)
├── vite.config.ts          # Vite build tool configuration
├── src/                    # Frontend React application
│   ├── main.tsx            # Entry point (mounts React app)
│   ├── App.tsx             # Root component (navigation shell)
│   ├── components/         # React components
│   ├── api/                # API client and type definitions
│   ├── store/              # Zustand global state
│   ├── types/              # Frontend-specific types
│   ├── data/               # Sample data for demo dashboard
│   └── styles/             # CSS stylesheets
├── server/                 # Backend Node.js Express API
│   ├── package.json        # Backend dependencies (Express, SQLite)
│   ├── tsconfig.json       # TypeScript configuration for backend
│   ├── src/                # Backend source code
│   │   ├── index.ts        # Express app setup and route handlers
│   │   ├── db.ts           # SQLite database layer (CRUD operations)
│   │   └── types.ts        # Type definitions (Dashboard, Widget, Table)
│   ├── data/               # SQLite database file (generated)
│   └── node_modules/       # Backend dependencies
└── node_modules/           # Frontend dependencies
```

## Directory Purposes

**src/ (Frontend):**
- Purpose: React single-page application source code
- Contains: Component files (.tsx), utility modules, state management, API integration
- Key files: `main.tsx` (startup), `App.tsx` (shell), components/

**src/components/:**
- Purpose: Reusable React components for UI
- Contains: Functional components with hooks, styled containers
- Key files: `Dashboard.tsx` (overview), `DashboardsPage.tsx` (list/edit), `DatasetsPage.tsx` (table registry), `Topbar.tsx`, `Sidebar.tsx`, `ChartCard.tsx` (card wrapper)

**src/api/:**
- Purpose: HTTP API client and type definitions for backend communication
- Contains: Fetch-based functions, TypeScript DTOs matching backend types
- Key files: `client.ts` (all endpoints: dashboards, widgets, tables, Kinetica proxy)

**src/store/:**
- Purpose: Global application state management
- Contains: Zustand stores for shared state
- Key files: `user.ts` (user name, role, initials)

**src/types/:**
- Purpose: Frontend TypeScript type definitions
- Contains: Domain types specific to frontend (KPIMetric, ActivityRow)
- Key files: `index.ts`

**src/data/:**
- Purpose: Sample data for demo/development
- Contains: Mock data objects for charts and tables
- Key files: `sampleData.ts` (kpi, throughput, datasetUsage, latencyDistribution, recentActivity)

**src/styles/:**
- Purpose: Cascading stylesheets for UI
- Contains: CSS (global styles, layout, components)
- Key files: `global.css` (Tailwind or custom CSS)

**server/src/ (Backend):**
- Purpose: Node.js Express backend for API and persistence
- Contains: Route handlers, database operations, type definitions
- Key files: `index.ts` (routes), `db.ts` (SQLite layer), `types.ts` (domain types)

**server/data/:**
- Purpose: SQLite database file location
- Contains: `kinetica.db` (created at runtime if missing)
- Generated: Yes
- Committed: No (should be in .gitignore)

## Key File Locations

**Entry Points:**
- `src/main.tsx`: React app startup (renders App into #root)
- `server/src/index.ts`: Express server startup (routes, middleware, listen)
- `index.html`: HTML template for SPA

**Configuration:**
- `vite.config.ts`: Frontend build and dev server (port 5173)
- `tsconfig.json`: Frontend TypeScript settings (strict: true)
- `server/tsconfig.json`: Backend TypeScript settings
- `package.json` (root): Frontend dependencies and build scripts
- `server/package.json`: Backend dependencies and start scripts
- `.env` (server only): Runtime configuration (KINETICA_URL, KINETICA_USERNAME, KINETICA_PASSWORD, DB_PATH, PORT, CORS_ORIGIN)

**Core Logic:**
- `src/App.tsx`: Page navigation and shell layout
- `src/components/DashboardsPage.tsx`: Dashboard CRUD and grid layout
- `src/components/DatasetsPage.tsx`: Table registration and Kinetica discovery
- `src/components/Dashboard.tsx`: Demo overview with sample charts
- `server/src/db.ts`: SQLite CRUD operations for all entities
- `server/src/index.ts`: All HTTP endpoints (dashboards, widgets, tables, Kinetica proxy)

**State Management:**
- `src/store/user.ts`: Global user state (Zustand)
- `src/api/client.ts`: API functions replacing explicit HTTP calls

**Testing:**
- Not present in codebase (no .test.tsx, .spec.ts files detected)

## Naming Conventions

**Files:**
- React components: PascalCase (e.g., `Dashboard.tsx`, `DashboardsPage.tsx`)
- Utilities/modules: camelCase (e.g., `client.ts`, `sampleData.ts`)
- Types: camelCase or PascalCase for types (e.g., `types.ts`, containing `Dashboard`, `Widget`, `Table`)
- Directories: camelCase (e.g., `components`, `store`, `api`)

**Functions:**
- API client functions: camelCase with action prefix (e.g., `createDashboard`, `listWidgets`, `updateWidget`)
- Database operations: camelCase with action prefix (e.g., `createDashboard`, `getDashboard`, `listDashboards`)
- React components: PascalCase (e.g., `Dashboard`, `DashboardCreate`, `TableEdit`)
- Hooks/utilities: camelCase with prefix if custom (e.g., `useContainerWidth` from react-grid-layout)

**Types:**
- Domain types: PascalCase (e.g., `Dashboard`, `Widget`, `Table`, `User`)
- DTO types: PascalCase with Dto suffix (e.g., `DashboardDto`, `TableDto`, `WidgetDto`)
- Union types: PascalCase (e.g., `View` as discriminated union in DashboardsPage)

**Variables:**
- State variables: camelCase (e.g., `dashboards`, `loading`, `error`)
- Event handlers: camelCase with handle prefix (e.g., `handleDelete`, `handleSave`)
- Component props: interfaces with PascalCase, field names camelCase

## Where to Add New Code

**New Feature:**
- Primary code: `src/components/NewFeaturePage.tsx` (component shell)
- API integration: Add functions to `src/api/client.ts`
- Backend routes: Add handlers to `server/src/index.ts`
- Database schema: Modify `server/src/db.ts` (CREATE TABLE, CRUD functions)
- Backend types: Add to `server/src/types.ts`
- Frontend types: Add to `src/types/index.ts` if frontend-specific

**New Component/Module:**
- Implementation: `src/components/ComponentName.tsx` (if UI-facing) or `src/utils/moduleName.ts` (if utility)
- Export from: `src/components/` index if creating barrel file (currently none exist)

**Utilities:**
- Shared helpers: Create new file in `src/utils/` directory (does not exist yet—create if needed)
- API helpers: Extend `src/api/client.ts`

## Special Directories

**node_modules/ (root):**
- Purpose: Frontend dependencies cache
- Generated: Yes (npm install)
- Committed: No (in .gitignore)

**server/node_modules/:**
- Purpose: Backend dependencies cache
- Generated: Yes (npm install in server/)
- Committed: No (in .gitignore)

**server/data/:**
- Purpose: SQLite database persistence
- Generated: Yes (created by db.ts on first run)
- Committed: No (should be in .gitignore)

**.planning/codebase/:**
- Purpose: GSD documentation (this file)
- Generated: No (manually maintained)
- Committed: Yes

---

*Structure analysis: 2026-03-23*

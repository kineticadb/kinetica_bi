# External Integrations

**Analysis Date:** 2026-03-23

## APIs & External Services

**Kinetica Database:**
- Kinetica - In-memory SQL analytics database
  - SDK/Client: Native HTTP REST API via `fetch()` calls
  - Auth: Basic HTTP authentication (username/password)
  - Endpoints accessed:
    - `/execute/sql` - Execute SQL queries
    - `/wms` - Web Map Service for geospatial visualization
    - `INFORMATION_SCHEMA` endpoints for schema/table discovery
  - Implementation: `kinetica_bi/server/src/index.ts` lines 177-316

**Backend API Proxy:**
- Self-hosted REST API (backend server)
  - Purpose: Provides dashboard/widget/table CRUD operations and Kinetica query proxying
  - Port: Configured via `PORT` environment variable (default 4000)
  - Base URL: Configurable via frontend `VITE_API_URL` (defaults to `http://localhost:4000`)

## Data Storage

**Databases:**
- SQLite (Better SQLite3 9.4.3)
  - Connection: File-based at path `DB_PATH` (default `./data/kinetica.db`)
  - Client: `better-sqlite3` npm package
  - Purpose: Persistent storage for dashboards, widgets, and table metadata
  - Schema defined in `kinetica_bi/server/src/db.ts` lines 18-54:
    - `dashboards` table - Dashboard records
    - `widgets` table - Widget records per dashboard
    - `tables` table - Table metadata and Kinetica table references
    - `dashboard_tables` table - Many-to-many associations between dashboards and tables
  - Features: WAL (Write-Ahead Logging) enabled for concurrency

**External Data Source:**
- Kinetica Database - Primary analytics data source
  - Connection: HTTPS endpoint via `KINETICA_URL` environment variable
  - SQL Interface: POST to `/execute/sql` endpoint
  - Authentication: Basic auth with `KINETICA_USERNAME` and `KINETICA_PASSWORD`
  - Data Discovery: INFORMATION_SCHEMA queries for schemas, tables, and columns

**File Storage:**
- Local filesystem only - No cloud storage integration
- SQLite database file: `./data/kinetica.db`

**Caching:**
- None detected - No caching layer (Redis/memcached)

## Authentication & Identity

**Auth Provider:**
- Custom/None for frontend - No authentication system
- Kinetica requires Basic HTTP Authentication
  - Implementation: `kinetica_bi/server/src/index.ts` lines 180-182, 263-265, 295-297
  - Credentials configured via environment variables:
    - `KINETICA_USERNAME`
    - `KINETICA_PASSWORD`
  - Credentials encoded to base64 in Authorization header

## Monitoring & Observability

**Error Tracking:**
- None detected - No integration with Sentry, LogRocket, or similar

**Logs:**
- Console logging only (`console.error()` in error handlers)
- Log locations: `kinetica_bi/server/src/index.ts` lines 218, 232, 250, 278, 313

## CI/CD & Deployment

**Hosting:**
- Not detected - Project is development-only configuration

**CI Pipeline:**
- Not detected - No GitHub Actions, GitLab CI, or similar

**Environment Configuration:**
- Development scripts defined in package.json:
  - Frontend: `npm run dev` (Vite dev server), `npm run build` (production build)
  - Backend: `npm run dev` (tsx watch), `npm run start` (production run), `npm run build` (TypeScript compilation)

## Environment Configuration

**Required env vars:**

*Backend (`kinetica_bi/server/.env`):**
- `PORT` - Server port (default 4000)
- `KINETICA_URL` - Kinetica HTTPS endpoint (e.g., `https://localhost:9191`)
- `KINETICA_USERNAME` - Kinetica admin username
- `KINETICA_PASSWORD` - Kinetica admin password
- `CORS_ORIGIN` - Allowed CORS origin (default `http://localhost:5173`)
- `DB_PATH` - SQLite database file path (default `./data/kinetica.db`)

*Frontend (`VITE_API_URL` in environment):**
- `VITE_API_URL` - Backend API base URL (default `http://localhost:4000`)

**Secrets location:**
- Backend: `.env` file (not committed; `.env.example` shows structure)
- Frontend: Vite environment variables (can be set via `.env`, `.env.local`, or system environment)

## Webhooks & Callbacks

**Incoming:**
- Not detected - No webhook receivers

**Outgoing:**
- Not detected - No external service callbacks

## CORS Configuration

**Allowed Origins:**
- Configured via `CORS_ORIGIN` environment variable (comma-separated list)
- Implementation: `kinetica_bi/server/src/index.ts` lines 35-38
- Default: `http://localhost:5173` (Vite dev server)

## API Response Format

**Standard Response:**
- JSON responses with `{ data: ... }` or `{ error: ... }` structure
- Error responses include HTTP status codes and error messages
- Kinetica SQL endpoint returns nested JSON with `data_str` containing encoded response (decoded in lines 203-207)

## Security Notes

- Kinetica credentials stored in environment variables (basic auth, not token-based)
- SQLite database file stored locally with no encryption
- No request validation or SQL injection protection on user SQL queries (direct proxy at line 284-316)
- CORS must be properly configured to prevent unauthorized access to Kinetica

---

*Integration audit: 2026-03-23*

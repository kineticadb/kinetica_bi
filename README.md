# Kinetica BI

A modern business intelligence dashboard application that connects to Kinetica (GPU-accelerated database).

## Architecture

Kinetica BI is a TypeScript monorepo (npm workspaces) with two independently-run parts:

- **Frontend** (`packages/web/`) — a React 18 + Vite single-page app.
- **Backend** (`packages/server/`) — a Node/Express API that proxies analytics queries to **Kinetica** and stores dashboard metadata in **SQLite**.

The backend holds **no Kinetica credentials at runtime**: every Kinetica call is made with the **signed-in user's** credentials (OIDC bearer token or basic auth), so data access is enforced by Kinetica per user.

### Request flow

```
Browser (React SPA, :5173)
  │  fetch /api/*  (session cookie)
  ▼
Express backend (:4000)
  ├─ app metadata ─────────►  SQLite  (packages/server/data/kinetica.db)
  │                           dashboards, widgets, registered tables,
  │                           dynamic views, map layers
  │
  └─ analytics (per-user) ─►  Kinetica (GPU DB)
        POST /execute/sql        SQL: charts, aggregations, drill-downs
        GET  /wms                map tiles (WMS)
        /show/table              column metadata
```

SQLite holds everything *about* the dashboards (layout + configs); it never holds analytics data. Kinetica holds the data.

### Frontend

| Concern | Tech |
|---|---|
| UI / build | React 18, Vite 5, TypeScript |
| State | Zustand — small per-domain stores (filters, filter-views, dynamic-views, dashboard-layers, theme, auth, toast) |
| Charts | Recharts — bar / line / pie / scatter / timeline / numeric-line / big-number |
| Map | OpenLayers (`ol`) — WMS layers, draw-to-filter tools, info popups |
| Dashboard grid | react-grid-layout (drag / resize) |
| Editors | CodeMirror (`@uiw/react-codemirror`) for SQL + HTML templates |
| Theming | CSS variables in `src/styles/global.css`; light/dark via `data-theme` on `<html>` (`store/theme.ts`) |
| Tests | Vitest + Testing Library (jsdom) |

Widgets render through a **chart-type registry** (see [Chart Configuration System](#chart-configuration-system)). In `WidgetRenderer.tsx`, the `map`, `timeline`, `numericline`, `records`, `info-card`, `legend`, and `datafilter` types short-circuit to dedicated renderers that own their full data lifecycle; all other types flow through the generic `AggregatedWidgetRenderer` (group-by + aggregate SQL → Recharts).

### Backend

| Concern | Tech / file |
|---|---|
| HTTP API | Express 4 (`packages/server/src/index.ts`); dev via `tsx watch`, prod via `tsc` → `node dist` |
| Kinetica access | `packages/server/src/kinetica.ts` — per-request auth header; audited SQL / WMS / show-table helpers |
| App metadata | better-sqlite3 (`packages/server/src/db.ts`) — schema + migrations in code |
| Auth | `auth.ts` / `oidc.ts` / `sessionStore.ts` — `AUTH_MODE=oidc` (openid-client) or `password` (basic); encrypted server-side sessions + cookie |
| Analytics SQL | `packages/server/src/lib/*` — materialized views, spatial WHERE clauses, quantile / top-values / column-stats builders |

### Filtering & dynamic views

- **Filter pipeline:** applying a filter materializes a per-user, TTL'd Kinetica **filter view** (`_kbi_filt_…`). Widgets on that table then re-query the filter view instead of the base table, so the whole dashboard narrows together.
- **Dynamic views:** a saved SQL template (`{view}` token) materialized on top of the filter view — or the unfiltered base table when no filter is applied (when unlimited or under the row cap) — producing `_kbi_dv_…` under a configurable `max_records` cap (`0` = unlimited).

### Repository layout

```
.
├── package.json                  # workspace root (no code): workspaces: ["packages/*"]
├── packages/
│   ├── web/                      # frontend (React + Vite) — @kinetica-bi/web
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── components/       # UI: charts/, map, modals, dashboard shell
│   │       ├── store/            # Zustand stores
│   │       ├── lib/              # pure helpers (SQL builders, binning, theming)
│   │       ├── api/client.ts     # typed fetch wrapper to the backend
│   │       └── styles/global.css # CSS-variable theme (light / dark)
│   └── server/                   # backend (Express) — @kinetica-bi/server
│       ├── src/
│       │   ├── index.ts          # routes
│       │   ├── kinetica.ts       # per-user Kinetica proxy
│       │   ├── db.ts             # SQLite schema + accessors
│       │   ├── auth.ts / oidc.ts # auth + sessions
│       │   └── lib/              # SQL builders, view naming, spatial
│       └── data/kinetica.db      # SQLite metadata file (gitignored)
└── README.md
```

## Ports

| Service  | Default Port | Config                          |
|----------|--------------|---------------------------------|
| Frontend | `5173`       | `packages/web/vite.config.ts`            |
| Backend  | `4000`       | `PORT` env var in `packages/server/.env` |

## Basemaps

Map widgets default to **OpenStreetMap**, which needs no API key. Its look is a per-theme CSS concern rather than a second basemap (`packages/web/src/lib/basemaps.ts`): unstyled in the light theme, dark-filtered in the dark theme.

Each map widget has **Light / Dark mode basemap CSS** fields, pre-filled with that theme's default CSS, so a customer can tune the look per widget and per theme (`filter` and `opacity`; blank re-tracks the default). Under each field, **Dark map / Light Gray Map / None** buttons set a style in one click without touching CSS, and highlight whichever matches the current value. The CSS applies to the basemap alone — OL renders it in its own canvas container, so data layers are never filtered.

The **CartoDB Voyager / Dark Matter** options remain selectable, but `basemaps.cartocdn.com` now watermarks unauthenticated tiles. A key is free within CARTO's fair-use limit ([request one](https://carto.com/basemaps/apikey)); set `VITE_CARTO_API_KEY` in `packages/web/.env` and it is appended to CARTO tile requests. Without it the config panel labels those options "(API key required)". CARTO's raster basemaps are being retired in favour of vector, so treat them as a stopgap.

## Getting Started

```bash
npm install                      # installs frontend + server (npm workspaces)
cp packages/server/.env.example packages/server/.env   # fill in Kinetica credentials
cp packages/web/.env.example packages/web/.env         # optional — all vars have defaults

npm run dev                      # frontend → http://localhost:5173
npm run dev:server               # backend  → http://localhost:4000  (separate terminal)
```

Other workspace scripts (run from the repo root): `npm run test` (frontend), `npm run test:server`, `npm run test:shared`, `npm run test:all`, `npm run build`, `npm run build:server`.

## Production Deployment

The app is **two independently-deployed pieces**: a static frontend bundle and the Node/Express API. The dev commands above are **not** suitable for production — do the following instead.

### 1. Build & run

The server bundle inlines the @kinetica-bi/shared workspace package; always build with npm run build:server (plain tsc no longer produces a runnable dist).

```bash
# From the repo root — one npm ci covers both workspaces
npm ci

# Backend  → compiled JS, run under a process supervisor (systemd / pm2 / container)
npm run build:server    # tsc --noEmit + esbuild bundle (inlines packages/shared) → packages/server/dist/index.js
NODE_ENV=production npm start --workspace @kinetica-bi/server   # node dist/index.js  (listens on $PORT, default 4000)

# Frontend → static bundle; serve dist/ from a static host / CDN / nginx (NOT the API server)
VITE_API_URL=https://api.your-domain.com npm run build   # → packages/web/dist/
```

`node_modules/` is not committed, so `npm ci` is required on the build host.

### 2. Serve over HTTPS + set `NODE_ENV=production`

In production the session and OIDC cookies are set `Secure` (`auth.ts`), so they are only sent over **HTTPS**. Serving the public URL over plain HTTP will silently break login. Always set `NODE_ENV=production` and terminate TLS in front of both the SPA and the API.

### 3. `VITE_API_URL` is baked at **build time**

The frontend reads `import.meta.env.VITE_API_URL` (defaults to `http://localhost:4000`). It is inlined by Vite during `npm run build`, so set it to your production API origin **before building** — it cannot be changed at runtime; point it elsewhere by rebuilding.

### 4. Persist the SQLite database

`DB_PATH` (default `./data/kinetica.db`) holds all dashboard/widget/layer definitions and is auto-created on first boot. Point it at **durable storage / a mounted volume** so it survives restarts and redeploys — otherwise every deploy starts with zero dashboards. (Analytics data lives in Kinetica, not here.)

### 5. Production environment

Set real values in the backend environment (see [Environment Variables](#environment-variables)). Minimum for a TLS SSO deployment:

- `NODE_ENV=production`, `PORT`
- `KINETICA_URL` → production Kinetica
- `AUTH_SECRET`, `SESSION_ENCRYPTION_KEY` — strong and **stable** (rotating `SESSION_ENCRYPTION_KEY` force-logs-out all users)
- `CORS_ORIGIN` → the frontend's production origin(s), comma-separated
- `DB_PATH` → durable path/volume
- `AUTH_MODE=oidc` (for SSO) + `AUTH_OIDC_ISSUER_URL` / `AUTH_OIDC_CLIENT_ID` / `AUTH_OIDC_CLIENT_SECRET`, an `AUTH_OIDC_REDIRECT_URI` matching the **exact** prod HTTPS callback registered at your IdP (`https://api.your-domain.com/api/auth/oidc/callback`), and `WEB_REDIRECT_BASE` → the SPA's production URL

## Chart Configuration System

Each visualization type has its own configuration panel with type-specific settings (colors, axis mappings, display options, etc.). The system is built on an extensible registry pattern.

### Adding a New Chart Type

1. Create a definition file in `src/components/charts/definitions/` (e.g. `funnel.ts`):

```ts
import { registerChartType } from "../registry";

export default function register() {
  registerChartType({
    type: "funnel",
    label: "Funnel Chart",
    icon: "V",
    fields: [
      { key: "valueField", label: "Value Field", type: "text", defaultValue: "", group: "Data" },
      { key: "color", label: "Color", type: "color", defaultValue: "#22c55e", group: "Appearance" },
      // ... more fields
    ],
    defaultConfig: { valueField: "", color: "#22c55e" },
  });
}
```

2. Import and call the register function in `definitions/index.ts`.

The visualization picker, config modal, and persistence all wire up automatically from the registry.

**Supported field types:** `text`, `number`, `boolean`, `select`, `color`, `range`

**Custom config UI:** For charts needing UI beyond simple fields, set `CustomConfigPanel` on the definition to provide a custom React component.

### File Structure

```
src/components/charts/
├── registry.ts              # registerChartType(), getChartType(), getAllChartTypes()
├── ChartConfigPanel.tsx     # Generic config form renderer
└── definitions/             # One file per chart type
    ├── index.ts             # Registers all types on startup
    ├── bar.ts
    ├── line.ts
    ├── pie.ts
    ├── scatter.ts
    ├── table.ts
    ├── bignumber.ts
    ├── heatmap.ts
    ├── map.ts
    ├── timeline.ts          # time-binned multi-metric line (custom renderer)
    ├── numericline.ts       # numeric-X interval-binned multi-metric line (custom renderer)
    ├── records.ts           # raw record viewer
    ├── info-card.ts         # single-record info card
    ├── legend.ts            # standalone map legend widget
    └── data-filter.ts       # dashboard filter control
```

Types with a dedicated renderer (`CustomConfigPanel` + a short-circuit in `WidgetRenderer.tsx`) own their own data lifecycle; the rest use the generic aggregated path.

## Environment Variables

Backend config lives in `packages/server/.env` (copy `packages/server/.env.example`). **Req.** marks variables required to boot/operate; OIDC vars are required only when `AUTH_MODE=oidc`.

**AI (optional, off by default).** AI stays off unless `AI_ENABLED=true`; see the commented AI block in `packages/server/.env.example` for the Gemini and Ollama examples. Misconfiguration disables AI without stopping the server (the `[ai]` line in the server log names each bad setting), and the API key is never logged.
Governance settings (all documented in that block): `AI_MAX_ANSWERS_PER_USER_PER_HOUR` (default 30, 0 = no cap), `AI_MAX_ANSWERS_PER_DAY` (whole deployment, rolling 24 h, 0 = off; use it for shared/free-tier keys), `AI_AUDIT_RETENTION_DAYS` (default 90, 0 = keep forever; the sweep runs even when AI is off), `AI_GENERATED_TTL_HOURS` (default 24, 0 = only on logout and server start; how long a generated dashboard nobody kept survives), `AI_HISTORY_TURNS` (default 6 recent exchanges sent in full) and `AI_TOOL_MODE` (`native` default, `json` fallback for models with weak tool calling).
Tested models (Phase 142):

| Provider | Model ID | Tool mode | Result | Notes | Date |
|----------|----------|-----------|--------|-------|------|
| OpenAI-compatible (Gemini, AI Studio) | `gemini-3-flash-preview` | native | pass (live G0-G9); S6 spike borderline: json (best effort) by its rule | `AI_TIMEOUT_MS=120000`; free tier ~20 requests/day/model; asks take 3-25 s, Generate 8-12 s; S6 over 21 clean trials: 88.9% valid tool calls (rule needs 90%), malformed calls not repaired (0/2), second turn 2/3; malformed calls are blocked, never applied | 2026-10-23 to 2026-10-28; S6 2026-10-30, 11-02, 11-03 |
| OpenAI-compatible (Ollama in Docker, CPU) | `qwen2.5:7b-instruct` | json | partial | `OLLAMA_CONTEXT_LENGTH=16384`, `AI_TIMEOUT_MS=600000`; 4 CPUs: asks 26-97 s, Generate did not finish in 600 s; S6 valid tool calls 86% json vs 58% native; malformed calls are blocked, never applied | 2026-10-26, 2026-10-29 |
| Claude | — | — | not live-verified | unit-tested against doc-derived fixtures only (no Anthropic key, AI-F11) | — |

Set `AI_MODEL` to the provider's model ID (e.g. `gemini-3-flash-preview`), not a product or display name — a wrong ID fails every request with HTTP 400. Gemini 3 "thinking" models can take longer than the 60 s default on a cold first call; use `AI_TIMEOUT_MS=120000` or more. The Gemini free tier allowed only 20 requests per day per model for `gemini-3-flash-preview` when tested, and one AI ask uses several requests (one per tool step), so a free-tier key supports only a handful of asks per day — set `AI_MAX_ANSWERS_PER_DAY` accordingly. Run Ollama in Docker with `OLLAMA_CONTEXT_LENGTH=16384` (the CPU default context of 4k silently cuts the AI's instructions); the command is in the AI block of `packages/server/.env.example`. On a CPU-only machine raise `AI_TIMEOUT_MS` (up to 600000) and use a small tool-capable model.
Use AI (`ai:use`) is granted to admin and designer by default; grant it to other roles on the Roles page.
Designers with Use AI can tick "Generate from a table" on the New Dashboard form: the AI builds 4 to 8 charts plus the AI Assistant from one table, and the dashboard stays private to its creator until they keep it (Discard deletes it with its widgets and AI views). Admins with the existing `audit:view` permission get an "AI activity" page listing every AI answer, generation and Keep (question, answer, tools, changes and the SQL the AI ran); query results are never logged.

**Claude Desktop connector (optional, off by default).** The connector routes exist only when `MCP_ENABLED=true`; it works even with the in-app AI off, and the configured AI provider is never called by it. Users with Use AI build and edit dashboards from Claude Desktop, then Keep or Discard them in the browser. `MCP_APP_URL` sets the address in the review link Claude returns, and `MCP_TOKEN_TTL_DAYS` (default 90) how long the access tokens users create on their Profile page last (password sign-in only). Setup: `packages/mcp/README.md`.

**Core**

| Variable | Default | Req. | Description |
|----------|---------|------|-------------|
| `PORT` | `4000` | – | Backend server port |
| `KINETICA_URL` | `https://localhost:9191` | ✓ | Kinetica database base URL |
| `CORS_ORIGIN` | `http://localhost:5173` | – | Allowed CORS origins (comma-separated) |
| `DB_PATH` | `./data/kinetica.db` | – | SQLite metadata file path (directory auto-created) |
| `NODE_ENV` | – | – | `production` hardens cookies / trims error output |

**Auth & sessions**

| Variable | Default | Req. | Description |
|----------|---------|------|-------------|
| `AUTH_MODE` | `password` | – | Auth flow: `password` or `oidc` |
| `AUTH_SECRET` | – | ✓ | Secret used to sign session cookies (≥16 chars; `openssl rand -hex 32`) |
| `SESSION_ENCRYPTION_KEY` | – | ✓ | 64 hex chars (32 bytes) — AES-256-GCM key encrypting session credentials at rest |
| `WEB_REDIRECT_BASE` | – | – | Absolute base URL the SPA is redirected back to after the OIDC callback (e.g. `http://localhost:5173`) |

**OIDC SSO** — required when `AUTH_MODE=oidc`

| Variable | Default | Req. | Description |
|----------|---------|------|-------------|
| `AUTH_OIDC_ISSUER_URL` | – | ✓* | OIDC issuer base (host of `/.well-known/openid-configuration`) |
| `AUTH_OIDC_CLIENT_ID` | – | ✓* | OIDC client ID registered at the IdP |
| `AUTH_OIDC_CLIENT_SECRET` | – | ✓* | OIDC client secret (confidential client — keep out of version control) |
| `AUTH_OIDC_REDIRECT_URI` | – | ✓* | Exact callback URL registered at the IdP (e.g. `http://localhost:4000/api/auth/oidc/callback`) |
| `AUTH_OIDC_USERNAME_CLAIM` | `preferred_username` | – | `id_token` claim used as the Kinetica username |
| `AUTH_OIDC_USERNAME_REGEX` | – | – | Optional regex applied to the claim (capture group 1, else full match) |

<sub>✓* = required only in `oidc` mode.</sub>

**v1.8 RBAC**

| Variable | Default | Req. | Description |
|----------|---------|------|-------------|
| `APP_ADMIN_USERNAME` | `admin` | – | Bootstrap admin username — always resolves to all permissions (short-circuit before DB lookup). Case-insensitive. In OIDC mode, set to the intended admin's OIDC username (post-regex claim value); otherwise the server logs an `rbac_bootstrap_admin_warning` at boot. |

**Kinetica service account** — backs the anonymous WMS GetCapabilities probe (and `password`-mode validation). Per-user analytics queries use the signed-in user's own credentials, **not** these (see [Architecture](#architecture)).

| Variable | Default | Req. | Description |
|----------|---------|------|-------------|
| `KINETICA_USERNAME` | – | – | Service-account username |
| `KINETICA_PASSWORD` | – | – | Service-account password |

> Dev-only diagnostic scripts read additional `CB_*`, `TRACK_*`, `WKB_PROBE_*`, `PROBE_*`, `LATLON_*`, and `WKT_*` variables — not needed to run the app. See [Diagnostic Scripts](#diagnostic-scripts-kinetica-probes) below.

## Diagnostic Scripts (Kinetica probes)

`packages/server/src/spikes/` holds standalone CLI "spike" runners — **not part of the Express app** and not imported by any runtime code. Each one probes the live Kinetica instance to confirm a contract (WMS params, spatial SQL, classbreak/track styling). Their findings are already baked into production (`lib/wmsUrlBuilder.ts`, `lib/spatialQuery.ts`, `lib/spatialWhereClause.ts`, `/api/quantile`); they're kept as **re-runnable verification tools** for when the Kinetica server version changes.

Run from `packages/server/` (each reads `packages/server/.env` via `dotenv`):

| Script | Purpose | Required env (beyond `KINETICA_URL` / `KINETICA_USERNAME` / `KINETICA_PASSWORD`) |
|--------|---------|----------------------------------------------------------------------------------|
| `npm run wms-spike` | WMS `GetCapabilities` + render-param probes → `src/spikes/wmsCapabilities.xml` (gitignored) | — |
| `npm run wkb-spike` | Spatial-proximity function against a WKB geometry column | `WKB_PROBE_SCHEMA`, `WKB_PROBE_TABLE`, `WKB_PROBE_COLUMN`, `WKB_PROBE_LON`, `WKB_PROBE_LAT` |
| `npm run spatial-predicate-spike` | bbox / circle / lasso predicates in latlon + WKT modes | `LATLON_TABLE`, `LATLON_LON_COL`, `LATLON_LAT_COL`, `WKT_TABLE`, `WKT_GEOM_COL`, `PROBE_CENTER_LON`, `PROBE_CENTER_LAT`, `PROBE_HALF_DEG` |
| `npm run cb-track-spike` | Classbreak (`CB_*`) + track (`TRACK_*`) WMS params; writes tiles to `packages/server/spike-output/` (gitignored) | `CB_NUMERIC_TABLE`, `CB_NUMERIC_COLUMN`, `CB_CATEGORICAL_TABLE`, `CB_CATEGORICAL_COLUMN`, `CB_X_COL`, `CB_Y_COL`, `TRACK_TABLE`, `TRACK_ID_COL`, `TRACK_ORDER_COL`, `TRACK_X_COL`, `TRACK_Y_COL`, `TRACK_BBOX` |

All three Kinetica vars (`KINETICA_URL`, `KINETICA_USERNAME`, `KINETICA_PASSWORD`) are required by every spike. These scripts run with a **service account** (basic auth), independent of the app's per-user auth.

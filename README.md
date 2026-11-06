# Kinetica BI

A business intelligence dashboard application for data stored in **Kinetica** (GPU-accelerated database). Users build dashboards of charts, maps and tables on Kinetica tables, click any chart element to filter the whole dashboard to that slice, and can ask an optional AI assistant to change the dashboard for them.

Main features:

- **Dashboards** of charts (bar, line, pie, scatter, timeline, calendar heatmap, big number, tables), maps with WMS layers (heatmap, raster, class-break, track) and record viewers, on a drag-and-resize grid.
- **Click-through filtering**: a click on a chart, a map selection or a filter control narrows every widget on the same table, through server-side Kinetica views.
- **Dynamic views**: saved SQL templates materialized on top of the current filter.
- **Exports**: CSV download in the browser, or a background export job for large tables (resumable, optional .zip).
- **Roles and permissions**, per-dashboard sharing, dashboard export/import and links, white-label theming (light and dark).
- **AI assistant** (optional, off by default): ask a question and the AI answers by changing the dashboard; changes are checked by the server and saved only when you press **Keep**.
- **Claude Desktop connector** (optional, off by default): build and edit dashboards from Claude Desktop through the same checks.

## Architecture

Kinetica BI is a TypeScript monorepo (npm workspaces):

| Package | What it is |
|---|---|
| `packages/web` | React 18 + Vite single-page app |
| `packages/server` | Node/Express API; proxies analytics queries to Kinetica and stores dashboard metadata in SQLite |
| `packages/shared` | Code used by both web and server (the AI change contract and the widget-action allow-list, zod schemas) |
| `packages/mcp` | The Claude Desktop connector (an MCP server over stdio that calls the API) |

The backend holds **no Kinetica credentials for analytics**: every Kinetica query runs with the **signed-in user's** credentials (OIDC bearer token or basic auth), so Kinetica enforces data access per user.

### Request flow

```
Browser (React SPA, :5173)
  │  fetch /api/*  (session cookie)
  ▼
Express backend (:4000)
  ├─ app metadata ─────────►  SQLite  (packages/server/data/kinetica.db)
  │                           dashboards, widgets, registered tables,
  │                           dynamic views, map layers, roles, AI audit
  │
  ├─ analytics (per-user) ─►  Kinetica (GPU DB)
  │     POST /execute/sql        SQL: charts, aggregations, drill-downs
  │     GET  /wms                map tiles (WMS)
  │     /show/table              column metadata
  │
  └─ AI (optional) ────────►  AI provider (OpenAI-compatible API, or Claude)
```

SQLite holds everything *about* the dashboards (layout and configuration); it never holds analytics data.

### Frontend

| Concern | Tech |
|---|---|
| UI / build | React 18, Vite 5, TypeScript |
| State | Zustand: small per-domain stores (filters, filter views, dynamic views, dashboard layers, AI session, theme, auth, toast) |
| Charts | Recharts |
| Map | OpenLayers (`ol`): WMS layers, draw-to-filter tools, info popups |
| Dashboard grid | react-grid-layout (drag / resize) |
| Editors | CodeMirror (`@uiw/react-codemirror`) for SQL and HTML templates |
| Theming | CSS variables in `src/styles/global.css`; light/dark via `data-theme` on `<html>` |
| Tests | Vitest + Testing Library (jsdom) |

### Backend

| Concern | Tech / file |
|---|---|
| HTTP API | Express 4 (`src/index.ts`); dev via `tsx watch`, production via an esbuild bundle (`dist/index.js`) |
| Kinetica access | `src/kinetica.ts`: per-request auth header; audited SQL / WMS / show-table helpers |
| App metadata | better-sqlite3 (`src/db.ts`): schema and migrations in code, applied at boot |
| Auth | `auth.ts` / `oidc.ts` / `sessionStore.ts`: `AUTH_MODE=password` (basic) or `oidc` (openid-client); encrypted server-side sessions |
| Analytics SQL | `src/lib/*`: materialized views, spatial WHERE clauses, quantile / top-values / column-stats builders, exports |
| AI | `src/lib/ai/*`: provider adapters, agent loop and the gateway that checks every AI change |

### Filtering and dynamic views

- **Filter pipeline:** applying a filter materializes a per-user, time-limited Kinetica **filter view** (`_kbi_filt_…`). Widgets on that table query the filter view instead of the base table, so the whole dashboard narrows together.
- **Dynamic views:** a saved SQL template (`{view}` token) materialized on top of the filter view, or on the base table when no filter is applied, producing `_kbi_dv_…` under a configurable `max_records` cap (`0` = unlimited).

### Repository layout

```
.
├── package.json              # workspace root: workspaces ["packages/*"]
├── Dockerfile                # multi-stage build: web (nginx) and server images
├── docker/                   # nginx config + container notes
├── .github/workflows/        # CI (tests on PRs and master) and image publishing on release tags
├── RELEASING.md              # versioning and release steps
└── packages/
    ├── web/src/
    │   ├── components/       # UI: charts/, map, modals, dashboard shell, AI widget
    │   ├── store/            # Zustand stores
    │   ├── lib/              # pure helpers (SQL builders, binning, theming, AI session)
    │   ├── api/client.ts     # typed fetch wrapper to the backend
    │   └── styles/global.css # CSS-variable theme (light / dark)
    ├── server/src/
    │   ├── index.ts          # routes
    │   ├── kinetica.ts       # per-user Kinetica proxy
    │   ├── db.ts             # SQLite schema + accessors
    │   ├── auth.ts, oidc.ts  # auth + sessions
    │   ├── lib/              # SQL builders, view naming, spatial, exports, AI
    │   └── spikes/           # diagnostic scripts (not part of the app)
    ├── shared/src/           # contract shared by web and server
    └── mcp/src/              # Claude Desktop connector
```

## Getting started

Requires Node.js 20 and a reachable Kinetica instance.

```bash
npm install                                            # installs every workspace
cp packages/server/.env.example packages/server/.env   # set KINETICA_URL, AUTH_SECRET, SESSION_ENCRYPTION_KEY
cp packages/web/.env.example packages/web/.env         # optional, every var has a default

npm run dev:server     # backend  → http://localhost:4000
npm run dev            # frontend → http://localhost:5173  (separate terminal)
```

Sign in with a Kinetica username and password (or through your identity provider with `AUTH_MODE=oidc`). The user named by `APP_ADMIN_USERNAME` (default `admin`) has every permission; grant others roles on the Roles page.

### Tests

Run from the repo root:

| Command | Runs |
|---|---|
| `npm run test` | web tests |
| `npm run test:server` | server tests |
| `npm run test:server:gate` | server tests with the CI gate (see `RELEASING.md`: a known set of files only fails when run together with the rest) |
| `npm run test:shared` | shared package tests |
| `npm run test:mcp` | connector tests |
| `npm run test:all` | all of the above except the gate |

Type checks: `npx tsc --noEmit` in each package.

## Production deployment

The app is two pieces: a static frontend bundle and the Node/Express API. The dev commands above are not suitable for production.

**Containers.** The `Dockerfile` builds a `web` image (nginx serving the SPA and proxying `/api`) and a `server` image. Release tags publish both to GHCR. See `docker/README.md` to build and run them and `RELEASING.md` for the release steps.

**Without containers:**

```bash
npm ci                                                        # on the build host; node_modules is not committed
npm run build:server                                          # tsc --noEmit + esbuild bundle (inlines packages/shared) → packages/server/dist/index.js
NODE_ENV=production npm start --workspace @kinetica-bi/server # node dist/index.js, listens on $PORT (default 4000)
VITE_API_URL=https://api.your-domain.com npm run build        # → packages/web/dist/, serve from a static host / CDN / nginx
```

Always build the server with `npm run build:server`; plain `tsc` does not produce a runnable bundle.

Things that matter in production:

1. **HTTPS and `NODE_ENV=production`.** Session and OIDC cookies are `Secure` in production, so they are only sent over HTTPS; serving the public URL over plain HTTP silently breaks login.
2. **`VITE_API_URL` is fixed at build time.** Vite inlines it during `npm run build`; set it to the production API origin before building. Unset means `http://localhost:4000`; an empty value means the same origin, which the container image uses so nginx can proxy `/api`.
3. **Persist the SQLite database.** `DB_PATH` (default `./data/kinetica.db`) holds every dashboard, widget, layer, role and AI audit row and is created on first boot. Put it on durable storage or every deploy starts empty. Large exports are written under `EXPORT_DIR` (default `./data/exports`).
4. **Environment.** At minimum: `NODE_ENV=production`, `PORT`, `KINETICA_URL`, strong and stable `AUTH_SECRET` and `SESSION_ENCRYPTION_KEY` (rotating the key signs everyone out), `CORS_ORIGIN` (the frontend origin), `DB_PATH`. For SSO: `AUTH_MODE=oidc`, the `AUTH_OIDC_*` settings with an `AUTH_OIDC_REDIRECT_URI` that exactly matches the HTTPS callback registered at your IdP (`https://api.your-domain.com/api/auth/oidc/callback`), and `WEB_REDIRECT_BASE` (the SPA's URL).
5. **AI streaming through proxies.** AI answers stream as server-sent events; any proxy in front of the API must not buffer `/api/ai/ask` (see `docker/README.md`).

## Basemaps

Map widgets default to **OpenStreetMap**, which needs no API key. Its look is a per-theme CSS setting (`packages/web/src/lib/basemaps.ts`): unstyled in the light theme, dark-filtered in the dark theme.

Each map widget has **Light / Dark mode basemap CSS** fields, pre-filled with that theme's default, so the look can be tuned per widget and per theme (`filter` and `opacity`; blank restores the default). **Dark map / Light Gray Map / None** buttons set a style in one click. The CSS applies to the basemap only; data layers are never filtered.

The **CartoDB Voyager / Dark Matter** basemaps remain selectable, but `basemaps.cartocdn.com` watermarks tiles without a key. A key is free within CARTO's fair-use limit ([request one](https://carto.com/basemaps/apikey)); set `VITE_CARTO_API_KEY` in `packages/web/.env`. Without it the config panel labels those options "(API key required)". CARTO is retiring its raster basemaps in favour of vector ones, so treat them as a stopgap.

## AI assistant (optional)

Off unless `AI_ENABLED=true`. When it is on:

- An **AI Assistant** widget on a dashboard takes questions. The AI answers by changing the dashboard: it adds, edits, moves and removes charts and heatmap map layers, applies filters and builds temporary dynamic views. Each answer lists what it changed and can be reverted.
- Changes are visible only to the person asking until they press **Keep** (one save that checks edit rights and refuses if someone else changed the dashboard meanwhile). **Discard** or a reload reverts them.
- Designers can tick **Generate from a table** on the New Dashboard form: the AI builds a starter dashboard of 4 to 8 widgets that stays private until kept.
- Admins with `audit:view` get an **AI activity** page listing every AI answer, generation and Keep (question, answer, tools, changes and any SQL the AI ran; never query results).
- The **Use AI** permission (`ai:use`) is granted to admin and designer by default.

Every change the model proposes goes through one server gateway that checks it against the shared contract, the user's permissions and the live table schema; the model never writes SQL for charts or views. With `AI_DATA_ACCESS=schema` (default) the AI sees table structure only, never row values. `AI_DATA_ACCESS=query` also lets it run read-only, guarded SELECTs as the signed-in user, with row, size and time limits.

Configure the provider with `AI_PROVIDER` (`openai-compatible` or `claude`), `AI_BASE_URL`, `AI_MODEL` and `AI_API_KEY`; the commented AI block in `packages/server/.env.example` documents every setting with its range, plus working Gemini and Ollama examples. Invalid settings turn AI off without stopping the server (the `[ai]` line in the server log names each one), and the API key is never logged.

Tested models:

| Provider | Model ID | Tool mode | Result | Notes |
|---|---|---|---|---|
| OpenAI-compatible (Gemini, Google AI Studio) | `gemini-3-flash-preview` | `native` | Pass | Every in-app check passed live. Set `AI_TIMEOUT_MS=120000` (cold first calls can exceed 60 s). The free tier allows about 20 requests per day per model and one answer uses several, so set `AI_MAX_ANSWERS_PER_DAY`. In a tool-calling benchmark (21 trials) 88.9% of tool calls were valid; invalid calls are refused by the server, never applied. |
| OpenAI-compatible (Ollama in Docker, CPU) | `qwen2.5:7b-instruct` | `json` | Partial | The adapter works, but this model on 4 CPUs is too weak for most changes and Generate does not finish in 600 s. Run Ollama with `OLLAMA_CONTEXT_LENGTH=16384` (the 4k CPU default silently cuts the AI's instructions) and raise `AI_TIMEOUT_MS`. |
| Claude | — | — | Not live-tested | Unit-tested against Anthropic's documented responses only. |

Set `AI_MODEL` to the provider's model ID, not a product name: a wrong ID fails every request with HTTP 400.

## Claude Desktop connector (optional)

Off unless `MCP_ENABLED=true`. Users with Use AI create an access token on their Profile page and add the connector to Claude Desktop; Claude then builds or edits dashboards through the same server checks, and the user reviews the result in the browser and presses Keep or Discard. It works with the in-app AI off and never calls the configured AI provider. `MCP_APP_URL` sets the address in the review link Claude returns; `MCP_TOKEN_TTL_DAYS` (default 90) sets how long tokens last (password sign-in only). Setup: `packages/mcp/README.md`.

`MCP_DATA_ACCESS` decides what Claude Desktop can see, separately from `AI_DATA_ACCESS` (which only governs the in-app AI). With `schema` (default) Claude's tools return table structure and dashboard configuration only, never row values, even when the in-app AI runs with `AI_DATA_ACCESS=query`. With `query` Claude also gets `run_query` and `get_column_profile`: read-only, guarded SELECTs run as the signed-in user, limited to the dashboard's tables and saved views, with the same row, size and time limits as the in-app AI's query mode. The values they return reach the Claude Desktop conversation, and so Anthropic, Claude Desktop's model provider, outside this server's control. In query mode each Claude Desktop query is a separate call, so the in-app per-answer query cap (`AI_QUERY_MAX_PER_ANSWER`) does not apply; the hourly call limit is what bounds query volume, and with the limit at `0` nothing bounds it. An invalid value falls back to `schema` with a warning in the server log.

`MCP_MAX_CALLS_PER_USER_PER_HOUR` (default 300, `0` = no limit; an invalid value falls back to 300 with a warning) caps each user's Claude Desktop calls over a rolling hour; over the limit Claude is told how long to wait and nothing is changed. Refused calls are not audited and do not count. `finish_dashboard` is exempt, so a build can always be handed over for review. Counts are kept in server memory, per server process, and reset when the server restarts.

## Chart configuration system

Each widget type is registered in a chart-type registry with its own config fields; the visualization picker, config modal and persistence are driven from it.

### Adding a chart type

1. Create a definition file in `packages/web/src/components/charts/definitions/` (for example `funnel.ts`):

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
    ],
    defaultConfig: { valueField: "", color: "#22c55e" },
  });
}
```

2. Import and call the register function in `definitions/index.ts`.

Field types: `text`, `number`, `boolean`, `select`, `color`, `range`. For UI beyond simple fields, set `CustomConfigPanel` on the definition.

### Widget types

`definitions/` has one file per type: `bar`, `line`, `pie`, `scatter`, `table` (data table), `bignumber`, `heatmap`, `calendar` (calendar heatmap), `timeline` and `numericline` (binned multi-metric lines), `map`, `records` (raw records with CSV/export), `info-card` (single record), `legend` (a map's legend), `data-filter` and `radio-group` (dashboard controls), `text` (markdown) and `ai` (AI Assistant).

Types with a custom config panel and a dedicated renderer in `WidgetRenderer.tsx` own their data loading; the rest go through the generic aggregated path (group-by + aggregate SQL → Recharts).

## Environment variables

Backend settings live in `packages/server/.env` (copy `packages/server/.env.example`, which documents each one). **Req.** marks settings required to start. Tuning settings are read once at boot; an invalid value falls back to the default with a warning in the server log.

**Core**

| Variable | Default | Req. | Description |
|---|---|---|---|
| `PORT` | `4000` | – | Backend port |
| `KINETICA_URL` | `https://localhost:9191` | ✓ | Kinetica base URL |
| `CORS_ORIGIN` | `http://localhost:5173` | – | Allowed browser origins (comma-separated) |
| `DB_PATH` | `./data/kinetica.db` | – | SQLite metadata file (directory created automatically) |
| `NODE_ENV` | – | – | `production` makes cookies `Secure` and trims error output |

**Auth and sessions**

| Variable | Default | Req. | Description |
|---|---|---|---|
| `AUTH_MODE` | `password` | – | `password` or `oidc` |
| `AUTH_SECRET` | – | ✓ | Signs session cookies (16+ chars; `openssl rand -hex 32`) |
| `SESSION_ENCRYPTION_KEY` | – | ✓ | 64 hex chars; AES-256-GCM key for session credentials at rest |
| `WEB_REDIRECT_BASE` | – | – | SPA URL to return to after the OIDC callback (e.g. `http://localhost:5173`) |
| `APP_ADMIN_USERNAME` | `admin` | – | Bootstrap admin: always has every permission (case-insensitive). In OIDC mode set it to the admin's OIDC username, or the server logs `rbac_bootstrap_admin_warning` |

**OIDC SSO** (required when `AUTH_MODE=oidc`)

| Variable | Default | Description |
|---|---|---|
| `AUTH_OIDC_ISSUER_URL` | – | Issuer base (host of `/.well-known/openid-configuration`) |
| `AUTH_OIDC_CLIENT_ID` | – | Client ID registered at the IdP |
| `AUTH_OIDC_CLIENT_SECRET` | – | Client secret (keep out of version control) |
| `AUTH_OIDC_REDIRECT_URI` | – | Exact callback URL registered at the IdP (e.g. `http://localhost:4000/api/auth/oidc/callback`) |
| `AUTH_OIDC_USERNAME_CLAIM` | `preferred_username` | `id_token` claim used as the Kinetica username |
| `AUTH_OIDC_USERNAME_REGEX` | – | Optional regex applied to the claim (capture group 1, else the full match) |

**Kinetica service account** (optional). Used only for the anonymous WMS GetCapabilities probe and by the diagnostic scripts; user queries never use it.

| Variable | Description |
|---|---|
| `KINETICA_USERNAME` | Service-account username |
| `KINETICA_PASSWORD` | Service-account password |

**Views, queries and charts**

| Variable | Default | Description |
|---|---|---|
| `DEFAULT_VIEW_TTL_MINUTES` | `5` | Lifetime of filter views and dynamic views in Kinetica |
| `TTL_KEEPALIVE_LEAD_MINUTES` | `1` | How long before expiry the browser keeps an open view alive |
| `MAX_COMBINATION_VIEWS_PER_TABLE` | `10` | Max per-widget filter-combination views per table; beyond it widgets use the all-filters view |
| `DISABLE_DV_FILTER_SCOPE` | `false` | `true` turns off per-widget filter scope for dynamic views |
| `MAX_BAR_GROUP_BY_SERIES` | `12` | Max colored series on a grouped bar or line chart (top series kept, a note shows the cut) |
| `KINETICA_MAX_ROWS_PER_QUERY` | `20000` | Max rows any app query returns |
| `KINETICA_MAX_RECORDS_PER_CALL` | `20000` | Max rows per Kinetica call; keep at or below the server's `max_get_records_size` |
| `CSV_INBROWSER_MAX_ROWS` | `100000` | Ceiling for the in-browser CSV download |

**Exports**

| Variable | Default | Description |
|---|---|---|
| `EXPORT_DIR` | `./data/exports` | Where export files are written |
| `EXPORT_TTL_HOURS` | `24` | How long a finished export (and its history row) is kept |
| `EXPORT_MAX_ROWS` | unlimited | Max rows per export; larger exports fail before writing |
| `EXPORT_MAX_FILE_MB` | unlimited | Max export file size in MiB |
| `EXPORT_MAX_CONCURRENT_PER_USER` | `2` | Queued plus running exports per user |
| `EXPORT_VIEW_TTL_MINUTES` | `60` | Lifetime of an export's snapshot view in Kinetica |

**AI and Claude Desktop:** `AI_*` and `MCP_*`, see [AI assistant](#ai-assistant-optional), [Claude Desktop connector](#claude-desktop-connector-optional) and the commented blocks in `packages/server/.env.example`.

**Frontend** (`packages/web/.env`, fixed at build time; never put a secret here)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:4000` | Backend base URL |
| `VITE_CARTO_API_KEY` | – | Key for the CARTO basemaps |
| `VITE_CARTO_API_KEY_PARAM` | `api_key` | Query parameter the CARTO key is sent under |

## Diagnostic scripts

`packages/server/src/spikes/` holds standalone command-line probes. They are **not part of the app** and nothing imports them. They check behaviour the app relies on against a live Kinetica (and, for the tool-call probe, an AI provider), which is useful after a Kinetica or model upgrade. Run them from `packages/server/`; each reads `packages/server/.env`.

| Script | Checks | Extra settings |
|---|---|---|
| `npm run wms-spike` | WMS GetCapabilities and render parameters; writes `src/spikes/wmsCapabilities.xml` (git-ignored) | — |
| `npm run wkb-spike` | Spatial proximity against a WKB geometry column | `WKB_PROBE_SCHEMA`, `WKB_PROBE_TABLE`, `WKB_PROBE_COLUMN`, `WKB_PROBE_LON`, `WKB_PROBE_LAT` |
| `npm run spatial-predicate-spike` | Box, circle and lasso filters in lat/lon and WKT modes | `LATLON_TABLE`, `LATLON_LON_COL`, `LATLON_LAT_COL`, `WKT_TABLE`, `WKT_GEOM_COL`, `PROBE_CENTER_LON`, `PROBE_CENTER_LAT`, `PROBE_HALF_DEG` |
| `npm run cb-track-spike` | Class-break and track WMS styling; writes tiles to `spike-output/` (git-ignored) | `CB_NUMERIC_TABLE`, `CB_NUMERIC_COLUMN`, `CB_CATEGORICAL_TABLE`, `CB_CATEGORICAL_COLUMN`, `CB_X_COL`, `CB_Y_COL`, `TRACK_TABLE`, `TRACK_ID_COL`, `TRACK_ORDER_COL`, `TRACK_X_COL`, `TRACK_Y_COL`, `TRACK_BBOX` |
| `npm run export-runner-smoke` | The background export job end to end against a real table | `EXPORT_SMOKE_TABLE` (schema.table) |
| `npm run export-routes-smoke` | The export HTTP routes (start, progress, resumable download, cancel) | `EXPORT_SMOKE_TABLE`, optional `EXPORT_SMOKE_COLUMNS` |
| `npm run query-mode-spike` | The AI query mode's guard, row cap, timeout and job cancel (no AI provider needed; `--dry-run` runs offline) | see the script header |
| `npm run tool-call-spike` | How reliably an AI model makes tool calls (uses provider quota) | the `AI_*` provider settings |

The Kinetica probes need `KINETICA_URL`, `KINETICA_USERNAME` and `KINETICA_PASSWORD` and run as that account, not as a signed-in user.

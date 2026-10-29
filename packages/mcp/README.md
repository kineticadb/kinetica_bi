# Kinetica BI MCP server (spike)

Lets Claude Desktop build Kinetica BI dashboards. Claude's model does the thinking; Kinetica BI checks every change with the same rules as the in-app AI (structured changes only, never SQL; column names checked against the live schema; your permissions). Nothing is saved by Claude: it finishes with a link, you open it, review the dashboard and press **Keep** (or **Discard**).

Spike scope: new dashboards only; Claude can read tables and add dynamic views, charts (KPI, bar, line, pie, table, timeline, records), markdown text, maps and heatmap layers. No edits before handoff, no filters, password login only.

## 1. Run Kinetica BI with the MCP routes on

```
cd packages/server && MCP_ENABLED=true npm run dev     # or add MCP_ENABLED=true to packages/server/.env
cd packages/web && npx vite
```

AI must be enabled on the server (`AI_ENABLED=true`): Keep uses the in-app AI's save route. The configured provider is never called by MCP.
`MCP_APP_URL` sets the web address used in the link (default `http://localhost:5173`).

## 2. Add the server to Claude Desktop

Claude Desktop -> Settings -> Developer -> Edit Config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "kinetica-bi": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/kinetica_bi/node_modules/tsx/dist/cli.mjs",
        "/absolute/path/to/kinetica_bi/packages/mcp/src/index.ts"
      ],
      "env": {
        "KBI_URL": "http://localhost:4000",
        "KBI_USERNAME": "your Kinetica BI user",
        "KBI_PASSWORD": "that user's password"
      }
    }
  }
}
```

Use absolute paths (`which node`): Claude Desktop does not load your shell's PATH. The credentials stay in this local file; the server signs in as that user and acts with that user's permissions. Restart Claude Desktop; "kinetica-bi" should appear under the tools icon.

## 3. Use it

Ask Claude, for example: *"Using kinetica-bi, build a dashboard for demo.nyctaxi showing trips and tips by payment type, with a pickup map."* Claude calls `list_tables`, `start_dashboard`, `describe_table`, `add_*`, then `finish_dashboard`, which returns a link. Open it while signed in to Kinetica BI as the same user. The link loads once.

## Tools

| Tool | What it does |
|---|---|
| `list_tables` | Registered tables |
| `start_dashboard` | Creates a new dashboard with the chosen tables |
| `describe_table` | Live columns and types |
| `add_dynamic_view`, `add_widget`, `add_heatmap_layer` | Validated by the server; rejections come back with reasons to fix |
| `finish_dashboard` | Returns the review link |

## Tests

`npx vitest run` (in this folder) drives the server with the MCP SDK client over an in-memory transport. Server routes: `packages/server/tests/routes.mcp.spec.ts`.

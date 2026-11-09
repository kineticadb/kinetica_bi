# Kinetica BI MCP server

Lets Claude Desktop build Kinetica BI dashboards. Claude's model does the thinking; Kinetica BI checks every change with the same rules as the in-app AI (structured changes only, never SQL; column names checked against the live schema; your permissions). Nothing is saved by Claude: it finishes with a link, you open it, review the dashboard and press **Keep** (or **Discard**).

Claude can build a new dashboard or change one you can edit (`list_dashboards`, `open_dashboard`): read tables and the dashboard, add dynamic views, charts (KPI, bar, line, pie, table, timeline, records), markdown text, maps and heatmap layers, edit, move, rename and remove them (removing saved items needs your OK in chat), and apply filters. Filters only last while you review: Keep does not save them.

## 1. Run Kinetica BI with the MCP routes on

```
MCP_ENABLED=true npm run dev:server     # from the repo root, or add MCP_ENABLED=true to packages/server/.env
npm run dev                            # the web app, in a second terminal
```

The in-app AI does not need to be on: with `MCP_ENABLED=true`, Claude Desktop can build and you can Keep even when `AI_ENABLED` is off (Keep is refused only when both are off). The configured AI provider is never called by MCP.
`MCP_APP_URL` sets the web address used in the link (default `http://localhost:5173`). `MCP_TOKEN_TTL_DAYS` sets how long access tokens last (default 90).

## 2. Create an access token

In Kinetica BI open your user menu, **Profile**, then **Claude Desktop** and press **Create token**. The token is shown once; **Copy config** copies the `env` block below with the token filled in. Revoke it on the same page; revoking also signs the connector out. You can still see and revoke your tokens after losing the Use AI permission. Tokens need password sign-in (with single sign-on there is no lasting credential to wrap), and stop working if your Kinetica password changes: create a new one.

## 3. Add the server to Claude Desktop

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
        "KBI_TOKEN": "kbi_... (from your Profile page)"
      }
    }
  }
}
```

Use absolute paths (`which node`): Claude Desktop does not load your shell's PATH. The connector signs in as you and acts with your permissions. `KBI_USERNAME` / `KBI_PASSWORD` still work when no `KBI_TOKEN` is set, but put a token there instead of your password. Quit Claude Desktop (Cmd+Q, closing the window is not enough) and reopen it; "kinetica-bi" should appear under the tools icon.

## 4. Use it

Ask Claude, for example: *"Using kinetica-bi, build a dashboard for demo.nyctaxi showing trips and tips by payment type, with a pickup map."* Claude calls `list_tables`, `start_dashboard`, `describe_table`, `add_*`, then `finish_dashboard`, which returns a link. Open it while signed in to Kinetica BI as the same user. The link loads once.

## Tools

| Tool | What it does |
|---|---|
| `list_tables` | Tables you can read in Kinetica (registered tables your Kinetica user cannot read are left out) |
| `start_dashboard` | Creates a new, unkept dashboard with the chosen tables (only you see it; `replace` discards your previous unkept one) |
| `list_dashboards`, `open_dashboard` | Pick a saved dashboard you can edit and start changing it |
| `describe_table`, `get_dashboard` | Live columns and types; the dashboard's widgets, layers and views |
| `add_dynamic_view`, `add_widget` (incl. `text`), `add_heatmap_layer` | Validated by the server; rejections come back with reasons to fix |
| `edit_widget`, `rename_widget`, `change_widget_type`, `set_layout`, `edit_heatmap_layer`, `set_layer_visibility` | Change saved or new items |
| `remove_widget`, `remove_layer`, `remove_dynamic_view` | Saved items need `confirmed: true` after you approve in chat |
| `apply_filter`, `clear_filter` | Narrow the dashboard while you review (not saved by Keep) |
| `run_query`, `get_column_profile` | Only when the server sets `MCP_DATA_ACCESS=query`: read rows or profile a column, as you, through the same guarded, limited path as the in-app AI |
| `finish_dashboard` | Returns the review link (Keep or Discard there; the build is logged on the AI activity page as Claude Desktop) |

## Data access and call limit

Two server settings (in the Kinetica BI server's environment, not Claude Desktop's) control what Claude can reach.

- `MCP_DATA_ACCESS`: `schema` (default) gives structure only, never row values, regardless of `AI_DATA_ACCESS`. `query` adds the two query tools. The values they return reach the Claude Desktop conversation, so Anthropic sees them. Each Claude Desktop query is a separate call, so the in-app per-answer query cap (`AI_QUERY_MAX_PER_ANSWER`) does not apply; the hourly call limit is what bounds query volume, and with the limit at 0 nothing bounds it. An invalid value falls back to `schema` with a server-log warning.
- `MCP_MAX_CALLS_PER_USER_PER_HOUR`: default 300, 0 = no limit. Counted: `list_tables`, `start_dashboard`/`open_dashboard` and every Kinetica BI tool call. `finish_dashboard` is exempt and always returns the review link. Over the limit the tool returns "Claude Desktop call limit reached: ..." and nothing is changed; call again after the wait. Refused calls are not audited and do not count. Counts are in server memory and reset when the server restarts.

## Tests

`npx vitest run` (in this folder) drives the server with the MCP SDK client over an in-memory transport. Server routes: `packages/server/tests/routes.mcp.spec.ts`.

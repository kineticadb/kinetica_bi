// kbi-mcp: the MCP tool surface. Claude Desktop's model does the thinking; Kinetica BI validates every change
// with the in-app AI's gateway and nothing is saved until the user opens the link and presses Keep.
import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { KbiError, type KbiClient } from "./kbiClient.js";

export const INSTRUCTIONS = [
  "Build and change Kinetica BI dashboards. New: list_tables -> start_dashboard (a new dashboard with the tables it uses) ->",
  "describe_table for each table -> add_dynamic_view / add_widget / add_heatmap_layer -> finish_dashboard.",
  "Change an existing one: list_dashboards -> open_dashboard -> get_dashboard (ids, titles, layout) -> describe_table ->",
  "edit_widget / rename_widget / change_widget_type / set_layout / edit_heatmap_layer / set_layer_visibility / add_* /",
  "remove_* -> finish_dashboard. Before removing anything saved, ask the user in chat; then pass confirmed: true.",
  "apply_filter / clear_filter narrow the dashboard while the user reviews it; Keep does not save filters, so say so if the",
  "user asks for a filtered dashboard.",
  "Nothing is saved by these tools: finish_dashboard returns a link; the user opens it, reviews the dashboard and presses Keep.",
  "Column names must come from describe_table. Do not size or place widgets: finish_dashboard lays the dashboard out to fit",
  "one screen (up to about 3 KPIs, 4 charts and a map; a records table goes below). A rejected call returns the reasons:",
  "fix them and call again with the same tempId. A good dashboard: 1-3 KPIs (bignumber) on top, a time trend (timeline),",
  "2-3 breakdowns (bar/pie), a map with a heatmap layer when the table has lat/lon or geometry, and a records table.",
  "Name what a value means: for a count of rows set yAxisLabel on a chart or label on a KPI, such as \"Trips\" (otherwise it reads \"Count of <column>\"),",
  "and a KPI of money sets numberFormat currency.",
  "Optionally start with a text widget (type text, markdown, no tableId) summarising what the dashboard shows: a short",
  "heading and at most 3-4 one-line bullets with the key findings (the charts carry the detail). Only state facts you know.",
  "Keep widget titles short (a few words, no findings) and leave KPI subLabel empty: findings belong in the text widget.",
].join(" ");

const LOCAL_TOOLS: Tool[] = [
  {
    name: "list_tables",
    description: "List the tables registered in Kinetica BI (id, schema.name, description). Call first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "start_dashboard",
    description:
      "Create a new, empty Kinetica BI dashboard with the given tables and start building it. Later tools add to this dashboard. " +
      "It stays unkept (only you see it) until the user presses Keep. A user has one unkept dashboard at a time: if this " +
      "reports one, ask the user before calling again with replace: true, which discards it.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120, description: "Dashboard name" },
        tableIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 4, description: "Table ids from list_tables" },
        replace: { type: "boolean", description: "Discard the user's existing unkept dashboard first (ask the user)" },
      },
      required: ["name", "tableIds"],
      additionalProperties: false,
    },
  },
  {
    name: "list_dashboards",
    description: "List the Kinetica BI dashboards you can see (id and name), to change one with open_dashboard.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "open_dashboard",
    description:
      "Start changing an existing dashboard (needs edit rights). Then call get_dashboard for its widgets, layers and views. " +
      "Your changes are reviewed in the browser like a new build: nothing is saved until the user presses Keep.",
    inputSchema: {
      type: "object",
      properties: { dashboardId: { type: "integer", description: "Dashboard id from list_dashboards" } },
      required: ["dashboardId"],
      additionalProperties: false,
    },
  },
  {
    name: "finish_dashboard",
    description: "Finish the current dashboard and get the link to open it. The user reviews it in Kinetica BI and presses Keep to save.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string", maxLength: 2000, description: "One or two sentences on what the dashboard shows" } },
      additionalProperties: false,
    },
  },
];
const LOCAL_NAMES = new Set(LOCAL_TOOLS.map((t) => t.name));

const text = (t: string, isError = false): CallToolResult => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** Reported to Claude Desktop; follows the monorepo version in package.json. */
const { version: VERSION } = createRequire(import.meta.url)("../package.json") as { version: string };

type ServerToolSpec = { name: string; description: string; jsonSchema: Record<string, unknown> };
type CallBody = { ok: boolean; text?: string; stage?: string; reasons?: string[] };

export function createKbiMcpServer(client: KbiClient, log: (msg: string) => void = (m) => process.stderr.write(`${m}\n`)): Server {
  const server = new Server({ name: "kinetica-bi", version: VERSION }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  let session: { id: string; dashboardId: number; name: string } | undefined;
  let remote: ServerToolSpec[] | undefined;

  const remoteTools = async (): Promise<ServerToolSpec[]> => {
    if (remote) return remote;
    const r = await client.request("GET", "/api/mcp/tools");
    remote = ((r.body as { tools?: ServerToolSpec[] }).tools ?? []).filter((t) => !LOCAL_NAMES.has(t.name));
    return remote;
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    let extra: Tool[] = [];
    try {
      extra = (await remoteTools()).map((t) => ({ name: t.name, description: t.description, inputSchema: t.jsonSchema as Tool["inputSchema"] }));
    } catch (e) {
      log(`[kbi-mcp] could not load Kinetica BI tools: ${e instanceof Error ? e.message : "unknown error"}`);
    }
    return { tools: [...LOCAL_TOOLS, ...extra] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = req.params.name;
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    try {
      if (name === "list_tables") {
        const r = await client.request("GET", "/api/tables");
        const rows = ((r.body as { data?: { id: number; schema: string; name: string; description?: string | null }[] }).data ?? []);
        if (rows.length === 0) return text("No tables are registered in Kinetica BI. Ask an administrator to register one in Datasets.");
        return text(rows.map((t) => `${t.id}: ${t.schema}.${t.name}${t.description ? ` - ${t.description}` : ""}`).join("\n"));
      }
      if (name === "start_dashboard") {
        const dashName = typeof args.name === "string" ? args.name.trim() : "";
        const tableIds = Array.isArray(args.tableIds) ? args.tableIds.filter((n): n is number => Number.isInteger(n)) : [];
        if (!dashName || tableIds.length === 0) return text("start_dashboard needs a name and at least one table id.", true);
        const s = await client.request("POST", "/api/mcp/sessions", { name: dashName, tableIds, ...(args.replace === true ? { replace: true } : {}) });
        const { sessionId, dashboardId } = s.body as { sessionId: string; dashboardId: number };
        session = { id: sessionId, dashboardId, name: dashName };
        return text(`Started dashboard "${dashName}" (id ${dashboardId}) with tables ${tableIds.join(", ")}. Next: describe_table, then add widgets.`);
      }
      if (name === "list_dashboards") {
        const r = await client.request("GET", "/api/dashboards");
        const rows = (r.body as { data?: { id: number; name: string; generated_pending?: boolean }[] }).data ?? [];
        if (rows.length === 0) return text("You can't see any dashboards yet. Use start_dashboard to build one.");
        return text(rows.map((d) => `${d.id}: ${d.name}${d.generated_pending ? " (not kept yet)" : ""}`).join("\n"));
      }
      if (name === "open_dashboard") {
        const dashboardId = typeof args.dashboardId === "number" && Number.isInteger(args.dashboardId) ? args.dashboardId : 0;
        if (dashboardId <= 0) return text("open_dashboard needs a dashboardId from list_dashboards.", true);
        const s = await client.request("POST", "/api/mcp/sessions", { dashboardId });
        const b = s.body as { sessionId: string; dashboardId: number; name: string };
        session = { id: b.sessionId, dashboardId: b.dashboardId, name: b.name };
        return text(`Opened dashboard "${b.name}" (id ${b.dashboardId}). Next: get_dashboard for its widgets, layers and views.`);
      }
      if (name === "finish_dashboard") {
        if (!session) return text("No dashboard in progress. Call start_dashboard first.", true);
        const f = await client.request("POST", `/api/mcp/sessions/${session.id}/finish`, { summary: typeof args.summary === "string" ? args.summary : undefined });
        const body = f.body as { url: string; applied: string[] };
        const done = session;
        session = undefined;
        return text(
          `Dashboard "${done.name}" is ready to review: ${body.url}\n` +
            `Open the link, check it, and press Keep to save it (Discard throws it away). The link loads once.\n` +
            `Changes: ${body.applied.join("; ")}`,
        );
      }
      // Kinetica BI's own tools (read the schema, add views/widgets/layers) run on the server against the session.
      if (!session) return text("No dashboard in progress. Call start_dashboard first.", true);
      const r = await client.request("POST", `/api/mcp/sessions/${session.id}/call`, { name, args });
      const body = r.body as CallBody;
      if (body.ok) return text(body.text ?? "OK");
      return text(`Rejected (${body.stage ?? "invalid"}): ${(body.reasons ?? []).join("; ")}. Fix it and call again with the same tempId.`, true);
    } catch (e) {
      if (e instanceof KbiError) return text(`Kinetica BI: ${e.message}`, true);
      log(`[kbi-mcp] ${name} failed: ${e instanceof Error ? e.message : "unknown error"}`);
      return text("The tool failed; check that Kinetica BI is running.", true);
    }
  });

  return server;
}

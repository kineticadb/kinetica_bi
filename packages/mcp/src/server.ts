// kbi-mcp spike: the MCP tool surface. Claude Desktop's model does the thinking; Kinetica BI validates every change
// with the in-app AI's gateway and nothing is saved until the user opens the link and presses Keep.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { KbiError, type KbiClient } from "./kbiClient.js";

export const INSTRUCTIONS = [
  "Build Kinetica BI dashboards. Workflow: list_tables -> start_dashboard (a new dashboard with the tables it uses) ->",
  "describe_table for each table -> add_dynamic_view / add_widget / add_heatmap_layer -> finish_dashboard.",
  "Nothing is saved by these tools: finish_dashboard returns a link; the user opens it, reviews the dashboard and presses Keep.",
  "Column names must come from describe_table. Do not size or place widgets: finish_dashboard lays the dashboard out to fit",
  "one screen (up to about 3 KPIs, 4 charts and a map; a records table goes below). A rejected call returns the reasons:",
  "fix them and call again with the same tempId. A good dashboard: 1-3 KPIs (bignumber) on top, a time trend (timeline),",
  "2-3 breakdowns (bar/pie), a map with a heatmap layer when the table has lat/lon or geometry, and a records table.",
  "Name what a value means: for a count of rows set yAxisLabel on a chart or label on a KPI, such as \"Trips\" (otherwise it reads \"Count of <column>\"),",
  "and a KPI of money sets numberFormat currency.",
  "Optionally start with a text widget (type text, markdown, no tableId) summarising what the dashboard shows; keep it to a",
  "heading and a few bullets, and only state facts you know (never invent numbers).",
].join(" ");

const LOCAL_TOOLS: Tool[] = [
  {
    name: "list_tables",
    description: "List the tables registered in Kinetica BI (id, schema.name, description). Call first.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "start_dashboard",
    description: "Create a new, empty Kinetica BI dashboard with the given tables and start building it. Later tools add to this dashboard.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 120, description: "Dashboard name" },
        tableIds: { type: "array", items: { type: "integer" }, minItems: 1, maxItems: 4, description: "Table ids from list_tables" },
      },
      required: ["name", "tableIds"],
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

type ServerToolSpec = { name: string; description: string; jsonSchema: Record<string, unknown> };
type CallBody = { ok: boolean; text?: string; stage?: string; reasons?: string[] };

export function createKbiMcpServer(client: KbiClient, log: (msg: string) => void = (m) => process.stderr.write(`${m}\n`)): Server {
  const server = new Server({ name: "kinetica-bi", version: "0.1.0-spike" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
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
        const d = await client.request("POST", "/api/dashboards", { name: dashName });
        const dashboardId = (d.body as { id: number }).id;
        for (const tableId of tableIds) await client.request("POST", `/api/dashboards/${dashboardId}/tables`, { table_id: tableId });
        const s = await client.request("POST", "/api/mcp/sessions", { dashboardId });
        session = { id: (s.body as { sessionId: string }).sessionId, dashboardId, name: dashName };
        return text(`Started dashboard "${dashName}" (id ${dashboardId}) with tables ${tableIds.join(", ")}. Next: describe_table, then add widgets.`);
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

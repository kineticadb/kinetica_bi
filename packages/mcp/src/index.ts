// kbi-mcp: stdio entry point for Claude Desktop. Configure in claude_desktop_config.json (see README.md).
// stdout carries the MCP protocol, so diagnostics go to stderr only.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { KbiClient } from "./kbiClient.js";
import { createKbiMcpServer } from "./server.js";

const client = new KbiClient(process.env.KBI_URL ?? "http://localhost:4000", {
  token: process.env.KBI_TOKEN,
  username: process.env.KBI_USERNAME,
  password: process.env.KBI_PASSWORD,
});
const server = createKbiMcpServer(client);
await server.connect(new StdioServerTransport());
process.stderr.write(`[kbi-mcp] ready (Kinetica BI at ${process.env.KBI_URL ?? "http://localhost:4000"})\n`);

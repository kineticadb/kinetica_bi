// kbi-mcp: the MCP surface driven like Claude Desktop does (SDK client over an in-memory transport).
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KbiClient, KbiError, type KbiResponse } from "./kbiClient.js";
import { createKbiMcpServer } from "./server.js";

type Call = { method: string; path: string; body?: unknown };

function fakeKbi(reply: (c: Call) => KbiResponse | KbiError): { client: KbiClient; calls: Call[] } {
  const calls: Call[] = [];
  const client = {
    request: async (method: string, path: string, body?: unknown) => {
      const c = { method, path, body };
      calls.push(c);
      const r = reply(c);
      if (r instanceof KbiError) throw r;
      return r;
    },
  } as unknown as KbiClient;
  return { client, calls };
}

const TOOLS = {
  tools: [
    { name: "describe_table", description: "d", jsonSchema: { type: "object", properties: { tableId: { type: "integer" } } } },
    { name: "add_widget", description: "a", jsonSchema: { type: "object", properties: {} } },
  ],
};

function routes(c: Call): KbiResponse | KbiError {
  if (c.path === "/api/mcp/tools") return { status: 200, body: TOOLS };
  if (c.path === "/api/tables") return { status: 200, body: { data: [{ id: 7, schema: "demo", name: "nyctaxi", description: "Taxi trips" }] } };
  if (c.path === "/api/dashboards") return { status: 200, body: { data: [{ id: 5, name: "Ops" }, { id: 6, name: "Draft", generated_pending: true }] } };
  if (c.path === "/api/mcp/sessions" && (c.body as { dashboardId?: number }).dashboardId !== undefined) {
    return { status: 201, body: { sessionId: "s2", dashboardId: 5, name: "Ops" } };
  }
  if (c.path === "/api/mcp/sessions") {
    const b = c.body as { name: string; replace?: boolean };
    if (b.name === "Busy" && !b.replace) return new KbiError(409, 'You already have an unkept dashboard, "Old". Open it and Keep or Discard it, or start again with replace to discard it.');
    return { status: 201, body: { sessionId: "s1", dashboardId: 42 } };
  }
  if (c.path === "/api/mcp/sessions/s1/call") {
    const args = (c.body as { args: { aggregation?: string } }).args;
    return args.aggregation
      ? { status: 200, body: { ok: true, text: 'OK: Add bar "Tips"' } }
      : { status: 200, body: { ok: false, stage: "allow_list", reasons: ["missing required field aggregation"] } };
  }
  if (c.path === "/api/mcp/sessions/s1/finish") return { status: 200, body: { url: "http://localhost:5173/?dashboard=42&mcp=s1", applied: ['Add bar "Tips"'] } };
  return new KbiError(404, "not found");
}

async function connect(client: KbiClient) {
  const server = createKbiMcpServer(client, () => {});
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  const mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(b);
  return mcp;
}
const textOf = (r: unknown): string => ((r as { content: { text: string }[] }).content[0]?.text ?? "");

describe("kbi-mcp server", () => {
  it("MCPS-1 lists the local tools plus Kinetica BI's tools", async () => {
    const mcp = await connect(fakeKbi(routes).client);
    const names = (await mcp.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(["list_tables", "start_dashboard", "list_dashboards", "open_dashboard", "finish_dashboard", "describe_table", "add_widget"]);
    expect(await mcp.getInstructions()).toContain("presses Keep");
  });

  it("MCPS-1b reports the package version to Claude Desktop", async () => {
    const mcp = await connect(fakeKbi(routes).client);
    const { version } = createRequire(import.meta.url)("../package.json") as { version: string };
    expect(mcp.getServerVersion()).toEqual({ name: "kinetica-bi", version });
  });

  it("MCPS-2 Kinetica BI tools need a dashboard in progress", async () => {
    const mcp = await connect(fakeKbi(routes).client);
    const r = await mcp.callTool({ name: "add_widget", arguments: {} });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("start_dashboard");
  });

  it("MCPS-3 start -> add (rejected, then repaired) -> finish returns the review link", async () => {
    const { client, calls } = fakeKbi(routes);
    const mcp = await connect(client);
    expect(textOf(await mcp.callTool({ name: "list_tables", arguments: {} }))).toBe("7: demo.nyctaxi - Taxi trips");
    expect(textOf(await mcp.callTool({ name: "start_dashboard", arguments: { name: "Tips", tableIds: [7] } }))).toContain("id 42");
    // one server call creates the unkept dashboard with its tables and opens the session
    expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual(["/api/mcp/sessions"]);
    expect(calls.find((c) => c.path === "/api/mcp/sessions")?.body).toEqual({ name: "Tips", tableIds: [7] });
    const bad = await mcp.callTool({ name: "add_widget", arguments: { tempId: -1, type: "bar" } });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toBe("Rejected (allow_list): missing required field aggregation. Fix it and call again with the same tempId.");
    const good = await mcp.callTool({ name: "add_widget", arguments: { tempId: -1, type: "bar", aggregation: "avg" } });
    expect(good.isError).toBeFalsy();
    const fin = await mcp.callTool({ name: "finish_dashboard", arguments: { summary: "Tips by vendor." } });
    expect(textOf(fin)).toContain("http://localhost:5173/?dashboard=42&mcp=s1");
    expect(textOf(fin)).toContain("press Keep");
    // the session is over: the next widget needs a new dashboard
    expect((await mcp.callTool({ name: "add_widget", arguments: {} })).isError).toBe(true);
  });

  it("MCPS-3b an unkept dashboard blocks a new one until Claude asks to replace it", async () => {
    const { client, calls } = fakeKbi(routes);
    const mcp = await connect(client);
    const busy = await mcp.callTool({ name: "start_dashboard", arguments: { name: "Busy", tableIds: [7] } });
    expect(busy.isError).toBe(true);
    expect(textOf(busy)).toContain('"Old"');
    expect(textOf(busy)).toContain("replace");
    const ok = await mcp.callTool({ name: "start_dashboard", arguments: { name: "Busy", tableIds: [7], replace: true } });
    expect(ok.isError).toBeFalsy();
    expect(calls.at(-1)?.body).toEqual({ name: "Busy", tableIds: [7], replace: true });
  });

  it("MCPS-5 list_dashboards and open_dashboard start an edit session on a saved dashboard", async () => {
    const { client, calls } = fakeKbi(routes);
    const mcp = await connect(client);
    expect(textOf(await mcp.callTool({ name: "list_dashboards", arguments: {} }))).toBe("5: Ops\n6: Draft (not kept yet)");
    const opened = await mcp.callTool({ name: "open_dashboard", arguments: { dashboardId: 5 } });
    expect(opened.isError).toBeFalsy();
    expect(textOf(opened)).toContain("get_dashboard");
    expect(calls.find((c) => c.path === "/api/mcp/sessions")?.body).toEqual({ dashboardId: 5 });
    await mcp.callTool({ name: "add_widget", arguments: { tempId: -1, type: "bar", aggregation: "sum" } });
    expect(calls.at(-1)?.path).toBe("/api/mcp/sessions/s2/call");
  });

  it("MCPS-4 server errors come back as tool errors with the server's message", async () => {
    const mcp = await connect(fakeKbi(() => new KbiError(403, "dashboards:create is required")).client);
    const r = await mcp.callTool({ name: "start_dashboard", arguments: { name: "x", tableIds: [1] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toBe("Kinetica BI: dashboards:create is required");
  });
});

describe("KbiClient", () => {
  const login = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Set-Cookie": "kbi_session=tok1; HttpOnly; Path=/" } });

  it("MCPC-1 signs in once, sends the session cookie, and re-signs-in on a 401", async () => {
    const seen: { path: string; cookie: string | null }[] = [];
    let first = true;
    const f = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path === "/api/auth/login") return login();
      seen.push({ path, cookie: new Headers(init?.headers).get("Cookie") });
      if (first) {
        first = false;
        return new Response("{}", { status: 401 });
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    const c = new KbiClient("http://kbi:4000/", { username: "u", password: "p" }, f);
    const r = await c.request("GET", "/api/tables");
    expect(r.body).toEqual({ data: [] });
    expect(seen).toEqual([{ path: "/api/tables", cookie: "kbi_session=tok1" }, { path: "/api/tables", cookie: "kbi_session=tok1" }]);
  });

  it("MCPC-2 missing credentials and failed sign-in are clear errors", async () => {
    await expect(new KbiClient("http://kbi", {}).request("GET", "/x")).rejects.toThrow("KBI_TOKEN");
    const f = (async () => new Response(JSON.stringify({ error: "Invalid credentials." }), { status: 401 })) as unknown as typeof fetch;
    await expect(new KbiClient("http://kbi", { username: "u", password: "bad" }, f).request("GET", "/x")).rejects.toThrow("Kinetica BI sign-in failed: Invalid credentials.");
  });

  it("MCPC-3 an access token signs in through token-login and wins over a password", async () => {
    const posted: { path: string; body: unknown }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (init?.method === "POST") posted.push({ path, body: JSON.parse(String(init.body)) });
      if (path === "/api/mcp/token-login") return login();
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as typeof fetch;
    const c = new KbiClient("http://kbi", { token: "kbi_0123456789abcdef_x", username: "u", password: "p" }, f);
    await c.request("GET", "/api/tables");
    expect(posted).toEqual([{ path: "/api/mcp/token-login", body: { token: "kbi_0123456789abcdef_x" } }]);
  });
});

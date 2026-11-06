// Claude Desktop connector env config (MCP_DATA_ACCESS), separate from AI_DATA_ACCESS.
import { describe, it, expect, afterEach, vi } from "vitest";
import { parseMcpConfig, loadMcpConfig, mcpQueryLimits, MCP_QUERY_DEFAULTS } from "../src/lib/mcp/mcpConfig";
import type { AiConfigResult } from "../src/lib/aiConfig";

afterEach(() => vi.restoreAllMocks());

describe("mcpConfig", () => {
  it("MCPCFG-1 unset and empty give schema with no warnings", () => {
    expect(parseMcpConfig({})).toEqual({ config: { dataAccess: "schema" }, warnings: [] });
    expect(parseMcpConfig({ MCP_DATA_ACCESS: "" })).toEqual({ config: { dataAccess: "schema" }, warnings: [] });
  });

  it("MCPCFG-2 query and schema are accepted, trimmed", () => {
    expect(parseMcpConfig({ MCP_DATA_ACCESS: "query" }).config.dataAccess).toBe("query");
    expect(parseMcpConfig({ MCP_DATA_ACCESS: "schema" }).config.dataAccess).toBe("schema");
    expect(parseMcpConfig({ MCP_DATA_ACCESS: "  query  " }).config.dataAccess).toBe("query");
  });

  it("MCPCFG-3 invalid values fall back to schema with exactly one warning naming the value", () => {
    for (const bad of ["qurey", "Query", "values"]) {
      const r = parseMcpConfig({ MCP_DATA_ACCESS: bad });
      expect(r.config.dataAccess).toBe("schema");
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("MCP_DATA_ACCESS");
      expect(r.warnings[0]).toContain(`"${bad}"`);
      expect(r.warnings[0]).toContain("using schema");
    }
  });

  it("MCPCFG-4 is independent of AI_DATA_ACCESS", () => {
    expect(parseMcpConfig({ AI_DATA_ACCESS: "query" }).config.dataAccess).toBe("schema");
    expect(parseMcpConfig({ AI_DATA_ACCESS: "schema", MCP_DATA_ACCESS: "query" }).config.dataAccess).toBe("query");
  });

  it("MCPCFG-5 loadMcpConfig logs warnings once and one info line; hostile values are escaped and clipped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cfg = loadMcpConfig({ MCP_DATA_ACCESS: "x".repeat(10) + "\n" + "y".repeat(190) });
    expect(cfg.dataAccess).toBe("schema");
    expect(warn).toHaveBeenCalledTimes(1);
    const w = String(warn.mock.calls[0][0]);
    expect(w).not.toContain("\n");
    expect(w).toContain("\\n");
    expect(w).not.toContain("y".repeat(40));
    expect(log).toHaveBeenCalledTimes(1);
    const l = String(log.mock.calls[0][0]);
    expect(l.startsWith("[mcp] Claude Desktop connector:")).toBe(true);
    expect(l).toContain("dataAccess=schema");
  });

  it("MCPCFG-6 query limits follow the in-app AI config when on, else the defaults", () => {
    const on = { enabled: true, config: { queryMaxRows: 7, queryMaxChars: 8, queryTimeoutMs: 9, queryMaxPerAnswer: 3 } } as unknown as AiConfigResult;
    expect(mcpQueryLimits(on)).toEqual({ maxRows: 7, maxChars: 8, timeoutMs: 9, maxPerAnswer: 3 });
    const off: AiConfigResult = { enabled: false, reason: "not_enabled" };
    expect(mcpQueryLimits(off)).toEqual(MCP_QUERY_DEFAULTS);
    expect(MCP_QUERY_DEFAULTS).toEqual({ maxRows: 200, maxChars: 20000, timeoutMs: 30000, maxPerAnswer: 5 });
  });
});

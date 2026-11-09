// 145 (MCPSAFE-V21-01/02): the server-held Claude Desktop Keep baseline.
import { describe, it, expect, beforeEach } from "vitest";
import { createMcpSession, noteMcpOwnWrite, mcpKeepBaseline, __resetMcpSessionsForTest } from "../src/lib/mcp/mcpSessions";

beforeEach(() => __resetMcpSessionsForTest());

describe("Claude Desktop Keep baseline (session)", () => {
  it("MKB-1 an edit session starts at the version captured when it opened", () => {
    const s = createMcpSession("Dee", 7, { mode: "edit", baseVersion: 5 });
    expect(mcpKeepBaseline(s)).toBe(5);
  });

  it("MKB-2 the user's own writes advance the baseline; other users' and other dashboards' writes do not", () => {
    const s = createMcpSession("Dee", 7, { mode: "edit", baseVersion: 5 });
    noteMcpOwnWrite(7, "dee", 5, 6);
    noteMcpOwnWrite(7, "eve", 6, 7);
    noteMcpOwnWrite(8, "dee", 6, 9);
    expect(mcpKeepBaseline(s)).toBe(6);
    noteMcpOwnWrite(7, "DEE", 6, 6); // no-op edge
    expect(mcpKeepBaseline(s)).toBe(6);
    noteMcpOwnWrite(7, "DEE", 6, 8);
    expect(mcpKeepBaseline(s)).toBe(8);
  });

  it("MKB-3 a foreign write leaves a gap the baseline does not cross", () => {
    const s = createMcpSession("Dee", 7, { mode: "edit", baseVersion: 5 });
    noteMcpOwnWrite(7, "dee", 5, 6);
    noteMcpOwnWrite(7, "dee", 7, 8); // 6 -> 7 was foreign, never noted
    expect(mcpKeepBaseline(s)).toBe(6);
  });
});

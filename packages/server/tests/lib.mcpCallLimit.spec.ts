// Per-user Claude Desktop call limiter: rolling hour, in memory.
import { describe, it, expect } from "vitest";
import { createMcpCallLimiter, mcpCallLimitMessage } from "../src/lib/mcp/mcpCallLimit";

describe("mcpCallLimit", () => {
  it("MCPLIM-U1 refuses the call over the limit, case-insensitive per user", () => {
    let now = 0;
    const l = createMcpCallLimiter({ maxPerHour: 2, now: () => now });
    expect(l.take("Dee")).toEqual({ ok: true });
    now = 1000;
    expect(l.take("dee")).toEqual({ ok: true });
    now = 2000;
    expect(l.take("dee")).toEqual({ ok: false, retryAfterSec: 3598 });
  });

  it("MCPLIM-U2 another user is unaffected", () => {
    let now = 0;
    const l = createMcpCallLimiter({ maxPerHour: 1, now: () => now });
    l.take("dee");
    now = 2000;
    expect(l.take("dee").ok).toBe(false);
    expect(l.take("eve")).toEqual({ ok: true });
  });

  it("MCPLIM-U3 refusals do not count", () => {
    let now = 0;
    const l = createMcpCallLimiter({ maxPerHour: 2, now: () => now });
    l.take("dee");
    now = 1000;
    l.take("dee");
    for (let i = 0; i < 5; i++) { now = 2000 + i; expect(l.take("dee").ok).toBe(false); }
    now = 3_600_001;
    expect(l.take("dee").ok).toBe(true);
    now = 3_601_001;
    expect(l.take("dee").ok).toBe(true);
    now = 3_601_002;
    expect(l.take("dee").ok).toBe(false);
  });

  it("MCPLIM-U4 0 means no limit", () => {
    const l = createMcpCallLimiter({ maxPerHour: 0, now: () => 5 });
    for (let i = 0; i < 1000; i++) expect(l.take("dee").ok).toBe(true);
  });

  it("MCPLIM-U5 the message", () => {
    expect(mcpCallLimitMessage(300, 61)).toBe("Claude Desktop call limit reached: 300 calls per hour for each user. Nothing was changed. finish_dashboard still works. Try again in about 2 minutes.");
    expect(mcpCallLimitMessage(3, 30).endsWith("about 1 minute.")).toBe(true);
  });
});

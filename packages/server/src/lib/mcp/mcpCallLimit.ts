// Per-user Claude Desktop call limit: a rolling hour of accepted-call timestamps per user, in memory, per server process (resets on restart).
export const MCP_CALL_WINDOW_MS = 60 * 60 * 1000;
export type McpCallTake = { ok: true } | { ok: false; retryAfterSec: number };

export function createMcpCallLimiter(opts: { maxPerHour: number; now?: () => number }): { readonly maxPerHour: number; take(username: string): McpCallTake } {
  const { maxPerHour } = opts;
  const now = opts.now ?? Date.now;
  const calls = new Map<string, number[]>();
  return {
    maxPerHour,
    take(username: string): McpCallTake {
      if (maxPerHour === 0) return { ok: true };
      const key = username.toLowerCase();
      const t = now();
      const kept = (calls.get(key) ?? []).filter((ts) => ts > t - MCP_CALL_WINDOW_MS);
      if (kept.length >= maxPerHour) {
        calls.set(key, kept);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((kept[0] + MCP_CALL_WINDOW_MS - t) / 1000)) };
      }
      kept.push(t);
      calls.set(key, kept);
      return { ok: true };
    },
  };
}

export function mcpCallLimitMessage(maxPerHour: number, retryAfterSec: number): string {
  const m = Math.max(1, Math.ceil(retryAfterSec / 60));
  return `Claude Desktop call limit reached: ${maxPerHour} calls per hour for each user. Nothing was changed. finish_dashboard still works. Try again in about ${m} minute${m === 1 ? "" : "s"}.`;
}
